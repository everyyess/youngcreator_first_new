/**
 * /api/ta-ohlcv
 * GET: ?ticker=XXX&interval=1d|1wk|1mo → Yahoo Finance OHLCV 반환
 * 기술적 분석용 전용 엔드포인트
 */

export const runtime = 'nodejs';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
};

const cache = new Map<string, { data: OhlcvResponse; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export type Interval = '1d' | '1wk' | '1mo';

export interface OhlcvResponse {
  ticker: string;
  interval: Interval;
  dates: string[];
  prices: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  currentPrice: number;
  prevClose: number;
}

// 봉 종류별 조회 기간 (지표 계산에 충분한 데이터 확보)
const YEARS_BY_INTERVAL: Record<Interval, number> = { '1d': 5, '1wk': 10, '1mo': 20 };

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      const e = new Error('Yahoo Finance 응답 시간 초과') as Error & { isTimeout: boolean };
      e.isTimeout = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

function cleanArray(arr: (number | null | undefined)[]): number[] {
  return arr.map((v) => (v == null || isNaN(v as number) ? 0 : (v as number)));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker')?.trim();
  const rawInterval = searchParams.get('interval')?.trim() ?? '1d';
  const interval: Interval = ['1d', '1wk', '1mo'].includes(rawInterval) ? (rawInterval as Interval) : '1d';

  if (!ticker) {
    return Response.json({ error: 'ticker 파라미터가 필요합니다.' }, { status: 400 });
  }

  const cacheKey = `${ticker}::${interval}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return Response.json(cached.data);
  }

  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - YEARS_BY_INTERVAL[interval] * 365 * 24 * 3600;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${startTs}&period2=${endTs}&interval=${interval}&events=history`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 10_000);
  } catch (err: unknown) {
    const e = err as Error & { isTimeout?: boolean };
    if (e.isTimeout) return Response.json({ error: e.message }, { status: 504 });
    return Response.json({ error: '네트워크 오류가 발생했습니다.' }, { status: 500 });
  }

  if (res.status === 429)
    return Response.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
  if (!res.ok)
    return Response.json({ error: `Yahoo Finance 오류 (HTTP ${res.status})` }, { status: res.status });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return Response.json({ error: '데이터 파싱 실패' }, { status: 502 });
  }

  const result = (json as { chart?: { result?: unknown[] } }).chart?.result?.[0] as {
    meta?: { regularMarketPrice?: number; previousClose?: number };
    timestamp?: number[];
    indicators?: {
      quote?: { open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }[];
      adjclose?: { adjclose?: number[] }[];
    };
  } | undefined;

  if (!result || !result.timestamp) {
    return Response.json({ error: `'${ticker}' 데이터를 찾을 수 없습니다.` }, { status: 404 });
  }

  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjClose = result.indicators?.adjclose?.[0]?.adjclose ?? quote.close ?? [];

  let dates = timestamps.map((ts) => new Date(ts * 1000).toISOString().slice(0, 10));
  let prices = cleanArray(adjClose as (number | null)[]);
  let opens = cleanArray((quote.open ?? []) as (number | null)[]);
  let highs = cleanArray((quote.high ?? []) as (number | null)[]);
  let lows = cleanArray((quote.low ?? []) as (number | null)[]);
  let volumes = cleanArray((quote.volume ?? []) as (number | null)[]);

  // 종가가 0인 구간(미완성/결측 봉) 제거
  const keep: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (prices[i] > 0) keep.push(i);
  }
  dates = keep.map((i) => dates[i]);
  prices = keep.map((i) => prices[i]);
  opens = keep.map((i) => opens[i]);
  highs = keep.map((i) => highs[i]);
  lows = keep.map((i) => lows[i]);
  volumes = keep.map((i) => volumes[i]);

  if (dates.length === 0) {
    return Response.json({ error: '유효한 시세 데이터가 없습니다.' }, { status: 404 });
  }

  const currentPrice = result.meta?.regularMarketPrice ?? prices[prices.length - 1] ?? 0;
  const prevClose = result.meta?.previousClose ?? prices[prices.length - 2] ?? currentPrice;

  const data: OhlcvResponse = { ticker, interval, dates, prices, opens, highs, lows, volumes, currentPrice, prevClose };
  cache.set(cacheKey, { data, ts: Date.now() });

  return Response.json(data);
}