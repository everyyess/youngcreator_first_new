const DAY_MS = 24 * 60 * 60 * 1000;
const SUCCESS_CACHE_MS = 24 * 60 * 60 * 1000;
const FAILURE_CACHE_MS = 30 * 60 * 1000;
const MAX_PLAUSIBLE_YIELD = 2;

const KNOWN_LEVERAGED_ETFS = new Set([
  'SOXS', 'SOXL', 'TQQQ', 'SQQQ', 'UPRO', 'SPXU', 'SPXL', 'SPXS',
  'TNA', 'TZA', 'TECL', 'TECS', 'FAS', 'FAZ', 'LABU', 'LABD',
  'NUGT', 'DUST', 'JNUG', 'JDST', 'BOIL', 'KOLD', 'UVXY',
]);

const cache = globalThis.__leveragedEtfDistributionCache ?? new Map();
globalThis.__leveragedEtfDistributionCache = cache;

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// External provider responses are normalized before they reach portfolio logic.

async function fetchJson(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.error || body?.message || body?.Information || body?.Note || `HTTP ${response.status}`;
      throw new Error(String(message).slice(0, 180));
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function splitAdjustedAmount(amount, eventDate, splits) {
  return splits
    .filter(split => split.date > eventDate)
    .reduce((adjusted, split) => adjusted * split.oldRate / split.newRate, amount);
}

function summarize(ticker, provider, events, currentPrice, now = new Date()) {
  const nowMs = now.getTime();
  const oneYearAgoMs = nowMs - 365 * DAY_MS;
  const yearStartMs = Date.UTC(now.getUTCFullYear(), 0, 1);
  const valid = events.filter(event => {
    const dateMs = Date.parse(event.date);
    return Number.isFinite(dateMs) && dateMs <= nowMs && event.amount > 0;
  });
  const trailingEvents = valid.filter(event => Date.parse(event.date) >= oneYearAgoMs);
  const calendarEvents = valid.filter(event => Date.parse(event.date) >= yearStartMs);
  const trailingAnnualDividendRate = trailingEvents.reduce((sum, event) => sum + event.amount, 0);
  const calendarYtdDividendPerShare = calendarEvents.reduce((sum, event) => sum + event.amount, 0);
  const dividendYield = currentPrice > 0 ? trailingAnnualDividendRate / currentPrice : 0;

  if (!trailingEvents.length) throw new Error('최근 12개월 배당 내역 없음');
  if (!isPlausibleDistribution(dividendYield, trailingAnnualDividendRate, currentPrice)) {
    throw new Error(`비정상 배당수익률 감지 (${(dividendYield * 100).toFixed(2)}%)`);
  }

  return {
    ticker,
    provider,
    quality: provider === 'massive' ? 'split-adjusted-source' : 'split-adjusted-locally',
    dividendYield,
    trailingAnnualDividendRate,
    calendarYtdDividendPerShare,
    eventCount: trailingEvents.length,
    asOf: isoDate(now),
  };
}

async function fetchMassive(ticker, currentPrice, now) {
  const apiKey = process.env.MASSIVE_API_KEY;
  if (!apiKey) throw new Error('API 키 미설정');
  const url = new URL('https://api.massive.com/stocks/v1/dividends');
  url.searchParams.set('ticker', ticker);
  url.searchParams.set('ex_dividend_date.gte', isoDate(now.getTime() - 370 * DAY_MS));
  url.searchParams.set('limit', '100');
  url.searchParams.set('sort', 'ex_dividend_date.asc');
  const body = await fetchJson(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const events = (body?.results ?? []).map(item => ({
    date: item.ex_dividend_date,
    amount: numeric(item.split_adjusted_cash_amount),
  })).filter(item => item.date && item.amount > 0);
  return summarize(ticker, 'massive', events, currentPrice, now);
}

function alpacaActions(body, key) {
  const actions = body?.corporate_actions ?? body ?? {};
  return Array.isArray(actions[key]) ? actions[key] : [];
}

async function fetchAlpaca(ticker, currentPrice, now) {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secret) throw new Error('API 키 미설정');
  const url = new URL('https://data.alpaca.markets/v1/corporate-actions');
  url.searchParams.set('symbols', ticker);
  url.searchParams.set('types', 'cash_dividend,capital_gains_distribution,reverse_split,forward_split');
  url.searchParams.set('start', isoDate(now.getTime() - 370 * DAY_MS));
  url.searchParams.set('end', isoDate(now));
  url.searchParams.set('data_quality', 'complete');
  url.searchParams.set('limit', '1000');
  const body = await fetchJson(url, {
    headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret },
  });
  const splits = [
    ...alpacaActions(body, 'reverse_splits'),
    ...alpacaActions(body, 'forward_splits'),
  ].map(item => ({
    date: item.ex_date || item.process_date,
    oldRate: numeric(item.old_rate),
    newRate: numeric(item.new_rate),
  })).filter(item => item.date && item.oldRate > 0 && item.newRate > 0);
  const distributions = [
    ...alpacaActions(body, 'cash_dividends'),
    ...alpacaActions(body, 'capital_gains_distributions'),
  ];
  const events = distributions.map(item => {
    const date = item.ex_date || item.process_date;
    return { date, amount: splitAdjustedAmount(numeric(item.rate), date, splits) };
  }).filter(item => item.date && item.amount > 0);
  return summarize(ticker, 'alpaca', events, currentPrice, now);
}

function alphaData(body) {
  if (body?.Information || body?.Note || body?.['Error Message']) {
    throw new Error(body.Information || body.Note || body['Error Message']);
  }
  return Array.isArray(body?.data) ? body.data : [];
}

async function fetchAlphaVantage(ticker, currentPrice, now) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) throw new Error('API 키 미설정');
  const dividendsUrl = new URL('https://www.alphavantage.co/query');
  dividendsUrl.searchParams.set('function', 'DIVIDENDS');
  dividendsUrl.searchParams.set('symbol', ticker);
  dividendsUrl.searchParams.set('apikey', apiKey);
  const splitsUrl = new URL('https://www.alphavantage.co/query');
  splitsUrl.searchParams.set('function', 'SPLITS');
  splitsUrl.searchParams.set('symbol', ticker);
  splitsUrl.searchParams.set('apikey', apiKey);
  const [dividendsBody, splitsBody] = await Promise.all([
    fetchJson(dividendsUrl),
    fetchJson(splitsUrl),
  ]);
  const splits = alphaData(splitsBody).map(item => ({
    date: item.effective_date,
    oldRate: 1,
    newRate: numeric(item.split_factor),
  })).filter(item => item.date && item.newRate > 0);
  const events = alphaData(dividendsBody).map(item => ({
    date: item.ex_dividend_date,
    amount: splitAdjustedAmount(numeric(item.amount), item.ex_dividend_date, splits),
  })).filter(item => item.date && item.amount > 0);
  return summarize(ticker, 'alpha-vantage', events, currentPrice, now);
}

const PROVIDERS = [fetchMassive, fetchAlpaca, fetchAlphaVantage];

export function isLeveragedEtf(ticker, metadata = {}) {
  const symbol = String(ticker || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (KNOWN_LEVERAGED_ETFS.has(symbol)) return true;
  const name = `${metadata.shortName || ''} ${metadata.longName || ''}`;
  return /(?:^|[^a-z0-9])(?:[+-]?[23]x|double|triple|ultra(?:pro|short)?|leveraged|daily +(?:bull|bear)|(?:bull|bear) +[23]x)(?:$|[^a-z0-9])/i.test(name);
}

export function isPlausibleDistribution(dividendYield, trailingRate, currentPrice) {
  if (![dividendYield, trailingRate, currentPrice].every(Number.isFinite)) return false;
  if (dividendYield < 0 || trailingRate < 0 || currentPrice <= 0) return false;
  if (dividendYield > MAX_PLAUSIBLE_YIELD || trailingRate > currentPrice * MAX_PLAUSIBLE_YIELD) return false;
  const calculatedYield = trailingRate / currentPrice;
  return Math.abs(calculatedYield - dividendYield) <= Math.max(0.001, calculatedYield * 0.1);
}

export async function getLeveragedEtfDistribution({ ticker, currentPrice, force = false, now = new Date() }) {
  const symbol = String(ticker || '').toUpperCase();
  const cacheKey = symbol;
  const cached = cache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) {
    if (!cached.value.provider) return cached.value;
    const price = numeric(currentPrice);
    return {
      ...cached.value,
      dividendYield: price > 0 ? cached.value.trailingAnnualDividendRate / price : 0,
    };
  }

  const attempts = [];
  for (const provider of PROVIDERS) {
    const providerName = provider.name.replace(/^fetch/, '').replace('AlphaVantage', 'alpha-vantage').toLowerCase();
    try {
      const result = await provider(symbol, numeric(currentPrice), now);
      const value = { ...result, attempts };
      cache.set(cacheKey, { value, expiresAt: Date.now() + SUCCESS_CACHE_MS });
      return value;
    } catch (error) {
      attempts.push({ provider: providerName, error: String(error?.message || error).slice(0, 180) });
    }
  }

  const value = { ticker: symbol, provider: null, quality: 'unavailable', attempts };
  cache.set(cacheKey, { value, expiresAt: Date.now() + FAILURE_CACHE_MS });
  return value;
}

export const __test = { splitAdjustedAmount, summarize };
