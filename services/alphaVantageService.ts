import "server-only";

export type MarketMove = {
  label: string;
  symbol?: string;
  value: number | null;
  changePercent: number | null;
  asOf: string | null;
  source: "alpha-vantage" | "unavailable";
  status: "available" | "unavailable";
  reason?: string;
};

export type MarketNewsItem = {
  title: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  sentiment?: string;
  status: "available" | "unavailable";
  reason?: string;
};

export type ExternalMarketBrief = {
  market: "us";
  reportDate: string;
  dataAsOf: string;
  headline: string;
  bullets: string[];
  indices: MarketMove[];
  sectors: MarketMove[];
  stocks: MarketMove[];
  news: MarketNewsItem[];
  unavailable: string[];
};

type AlphaDailyResponse = {
  "Time Series (Daily)"?: Record<string, { "4. close"?: string }>;
  Note?: string;
  Information?: string;
  Error?: string;
  "Error Message"?: string;
};

type AlphaNewsResponse = {
  feed?: Array<{
    title?: string;
    url?: string;
    time_published?: string;
    source?: string;
    overall_sentiment_label?: string;
  }>;
  Note?: string;
  Information?: string;
  Error?: string;
  "Error Message"?: string;
};

const ALPHA_BASE_URL = "https://www.alphavantage.co/query";

const indexSymbols = [
  { label: "S&P500", symbol: "SPY" },
  { label: "Nasdaq", symbol: "QQQ" },
  { label: "Dow", symbol: "DIA" },
  { label: "SOX", symbol: "SOXX" },
];

const sectorSymbols = [
  { label: "Technology", symbol: "XLK" },
  { label: "Financials", symbol: "XLF" },
  { label: "Energy", symbol: "XLE" },
  { label: "Health Care", symbol: "XLV" },
  { label: "Industrials", symbol: "XLI" },
  { label: "Consumer Discretionary", symbol: "XLY" },
  { label: "Communication Services", symbol: "XLC" },
  { label: "Consumer Staples", symbol: "XLP" },
  { label: "Utilities", symbol: "XLU" },
  { label: "Real Estate", symbol: "XLRE" },
  { label: "Materials", symbol: "XLB" },
];

const majorStockSymbols = [
  { label: "Apple", symbol: "AAPL" },
  { label: "Microsoft", symbol: "MSFT" },
  { label: "NVIDIA", symbol: "NVDA" },
  { label: "Amazon", symbol: "AMZN" },
  { label: "Meta", symbol: "META" },
  { label: "Alphabet", symbol: "GOOGL" },
  { label: "Tesla", symbol: "TSLA" },
];

function getAlphaKey() {
  return process.env.ALPHA_VANTAGE_API_KEY?.trim() || process.env.ALPHAVANTAGE_API_KEY?.trim() || "";
}

function unavailableMove(label: string, symbol: string, reason: string): MarketMove {
  return { label, symbol, value: null, changePercent: null, asOf: null, source: "unavailable", status: "unavailable", reason: redactAlphaSecrets(reason) };
}

function redactAlphaSecrets(message: string) {
  const key = getAlphaKey();
  let redacted = message.replace(/API key as [A-Z0-9]+/gi, "API key as [redacted]");
  if (key) redacted = redacted.replaceAll(key, "[redacted]");
  return redacted;
}
function alphaMessage(data: Record<string, unknown>) {
  const message = data.Note || data.Information || data.Error || data["Error Message"];
  return typeof message === "string" ? redactAlphaSecrets(message) : "";
}

function alphaSeriesDates(data: AlphaDailyResponse) {
  const series = data["Time Series (Daily)"];
  return series ? Object.keys(series).sort((a, b) => b.localeCompare(a)).slice(0, 5) : [];
}

function logAlphaResponse(context: string, params: Record<string, string>, status: number, data: Record<string, unknown>) {
  console.info("[market-report][alpha] response", {
    context,
    status,
    function: params.function,
    symbol: params.symbol,
    topics: params.topics,
    time_from: params.time_from,
    time_to: params.time_to,
    keys: Object.keys(data).slice(0, 8),
    message: alphaMessage(data) || undefined,
    recentDates: alphaSeriesDates(data as AlphaDailyResponse),
    feedCount: Array.isArray((data as AlphaNewsResponse).feed) ? (data as AlphaNewsResponse).feed?.length : undefined,
  });
}

function assertAlphaResponse(data: Record<string, unknown>) {
  const message = alphaMessage(data);
  if (message) throw new Error(message);
}

async function fetchAlpha<T extends Record<string, unknown>>(context: string, params: Record<string, string>): Promise<T> {
  const apiKey = getAlphaKey();
  if (!apiKey) throw new Error("ALPHA_VANTAGE_API_KEY가 설정되지 않았습니다.");

  const url = new URL(ALPHA_BASE_URL);
  for (const [key, value] of Object.entries({ ...params, apikey: apiKey })) url.searchParams.set(key, value);

  const response = await fetch(url.toString(), { cache: "no-store" });
  const data = await response.json() as T;
  logAlphaResponse(context, params, response.status, data);
  if (!response.ok) throw new Error(`Alpha Vantage HTTP ${response.status}`);
  assertAlphaResponse(data);
  return data;
}

function toNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPercent(value: number | null) {
  if (value == null) return "조회 불가";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function findMoveFromSeries(label: string, symbol: string, reportDate: string, data: AlphaDailyResponse): MarketMove {
  const series = data["Time Series (Daily)"];
  if (!series) return unavailableMove(label, symbol, "TIME_SERIES_DAILY 응답에 일별 시계열이 없습니다.");

  const dates = Object.keys(series).sort((a, b) => b.localeCompare(a));
  const selectedDate = dates.find((date) => date <= reportDate);
  if (!selectedDate) return unavailableMove(label, symbol, `${reportDate} 이전 거래일 데이터가 없습니다.`);

  const dateIndex = dates.indexOf(selectedDate);
  const previousDate = dates[dateIndex + 1];
  const close = toNumber(series[selectedDate]?.["4. close"]);
  const previousClose = toNumber(previousDate ? series[previousDate]?.["4. close"] : undefined);
  if (close == null || previousClose == null || previousClose === 0) return unavailableMove(label, symbol, "종가 또는 전일 종가가 누락되었습니다.");

  if (selectedDate !== reportDate) {
    console.info("[market-report][alpha] reportDate adjusted to latest trading row", { label, symbol, requestedReportDate: reportDate, selectedDate, previousDate });
  }

  return {
    label,
    symbol,
    value: close,
    changePercent: ((close - previousClose) / previousClose) * 100,
    asOf: selectedDate,
    source: "alpha-vantage",
    status: "available",
  };
}

async function fetchDailyMove(label: string, symbol: string, reportDate: string): Promise<MarketMove> {
  try {
    const data = await fetchAlpha<AlphaDailyResponse>(`daily:${symbol}`, { function: "TIME_SERIES_DAILY", symbol, outputsize: "compact" });
    const move = findMoveFromSeries(label, symbol, reportDate, data);
    if (move.status === "unavailable") console.warn("[market-report][alpha] unavailable move", { label, symbol, reportDate, reason: move.reason, recentDates: alphaSeriesDates(data) });
    return move;
  } catch (error) {
    const message = error instanceof Error ? redactAlphaSecrets(error.message) : "Alpha Vantage 조회에 실패했습니다.";
    console.warn("[market-report][alpha] request failed", { label, symbol, reportDate, reason: message });
    return unavailableMove(label, symbol, message);
  }
}

function formatAlphaPublishedAt(value: string | undefined) {
  if (!value || value.length < 8) return undefined;
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(9, 11) || "00";
  const minute = value.slice(11, 13) || "00";
  return `${year}-${month}-${day}T${hour}:${minute}:00Z`;
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function alphaTime(value: string) {
  return value.replace(/-/g, "") + "T0000";
}

async function fetchMarketNews(reportDate: string): Promise<MarketNewsItem[]> {
  const params = {
    function: "NEWS_SENTIMENT",
    topics: "financial_markets,economy_macro",
    time_from: alphaTime(addDays(reportDate, -1)),
    time_to: alphaTime(addDays(reportDate, 1)),
    limit: "6",
    sort: "LATEST",
  };

  try {
    const data = await fetchAlpha<AlphaNewsResponse>("news", params);
    const feed = Array.isArray(data.feed) ? data.feed : [];
    if (!feed.length) console.warn("[market-report][alpha] news unavailable", { reportDate, reason: "NEWS_SENTIMENT feed is empty", params });
    return feed.slice(0, 6).map((item) => ({
      title: item.title || "제목 없음",
      source: item.source,
      url: item.url,
      publishedAt: formatAlphaPublishedAt(item.time_published),
      sentiment: item.overall_sentiment_label,
      status: "available",
    }));
  } catch (error) {
    const message = error instanceof Error ? redactAlphaSecrets(error.message) : "Alpha Vantage 뉴스 조회에 실패했습니다.";
    console.warn("[market-report][alpha] news request failed", { reportDate, reason: message, params });
    return [{ title: "주요 시장 뉴스 조회 불가", status: "unavailable", reason: message }];
  }
}

function collectUnavailable(groups: MarketMove[][], news: MarketNewsItem[]) {
  const moveReasons = groups.flat().filter((item) => item.status === "unavailable").map((item) => `${item.label}: ${item.reason || "unavailable"}`);
  const newsReasons = news.filter((item) => item.status === "unavailable").map((item) => `뉴스: ${item.reason || "unavailable"}`);
  return [...moveReasons, ...newsReasons];
}


function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMovesSequential(items: { label: string; symbol: string }[], reportDate: string) {
  const moves: MarketMove[] = [];
  for (const item of items) {
    moves.push(await fetchDailyMove(item.label, item.symbol, reportDate));
    if (item !== items[items.length - 1]) await wait(1_100);
  }
  return moves;
}
function buildHeadline(indices: MarketMove[]) {
  const available = indices.filter((item) => item.status === "available");
  if (!available.length) return "전일 미국 시황 데이터를 조회하지 못했습니다.";
  return available.map((item) => `${item.label} ${formatPercent(item.changePercent)}`).join(" · ");
}

function buildBullets(indices: MarketMove[], sectors: MarketMove[], stocks: MarketMove[], news: MarketNewsItem[]) {
  const availableSectors = sectors.filter((item) => item.changePercent != null);
  const sectorBullet = availableSectors.length >= 2
    ? (() => {
        const sorted = [...availableSectors].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
        const strongestSector = sorted[0];
        const weakestSector = sorted[sorted.length - 1];
        return `업종 ETF 기준 강세는 ${strongestSector.label}(${formatPercent(strongestSector.changePercent)}), 약세는 ${weakestSector.label}(${formatPercent(weakestSector.changePercent)})입니다.`;
      })()
    : "업종 ETF 비교는 2개 이상 조회된 경우에만 표시됩니다.";
  const strongestStock = stocks.filter((item) => item.changePercent != null).sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0];
  const topNews = news.find((item) => item.status === "available");

  return [
    `주요 지수: ${indices.map((item) => `${item.label} ${formatPercent(item.changePercent)}`).join(", ")}`,
    sectorBullet,
    strongestStock ? `주요 종목 중 ${strongestStock.label}가 ${formatPercent(strongestStock.changePercent)}로 가장 강했습니다.` : "주요 종목 등락률은 현재 조회할 수 없습니다.",
    topNews ? `주요 뉴스: ${topNews.title}` : "주요 시장 뉴스는 현재 조회할 수 없습니다.",
  ];
}

export async function fetchPreviousUsMarketBrief(reportDate: string): Promise<ExternalMarketBrief> {
  if (!getAlphaKey()) throw new Error("ALPHA_VANTAGE_API_KEY가 설정되지 않았습니다.");

  const indices = await fetchMovesSequential(indexSymbols, reportDate);
  await wait(1_100);
  const news = await fetchMarketNews(reportDate);
  await wait(1_100);
  const sectors = await fetchMovesSequential(sectorSymbols, reportDate);
  await wait(1_100);
  const stocks = await fetchMovesSequential(majorStockSymbols, reportDate);

  const firstAvailable = [...indices, ...sectors, ...stocks].find((item) => item.asOf);
  const dataAsOf = firstAvailable?.asOf || reportDate;
  const unavailable = collectUnavailable([indices, sectors, stocks], news);

  console.info("[market-report][alpha] report summary", {
    reportDate,
    dataAsOf,
    indexAvailable: indices.filter((item) => item.status === "available").length,
    sectorAvailable: sectors.filter((item) => item.status === "available").length,
    stockAvailable: stocks.filter((item) => item.status === "available").length,
    newsAvailable: news.filter((item) => item.status === "available").length,
    unavailableCount: unavailable.length,
  });

  return {
    market: "us",
    reportDate,
    dataAsOf,
    headline: buildHeadline(indices),
    bullets: buildBullets(indices, sectors, stocks, news),
    indices,
    sectors,
    stocks,
    news,
    unavailable,
  };
}



export type HoldingStockNewsItem = {
  title: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  sentiment?: string;
};

export async function fetchHoldingStockNews(
  ticker: string,
  fromDate: string,
  toDate: string,
): Promise<HoldingStockNewsItem[]> {
  try {
    const data = await fetchAlpha<AlphaNewsResponse>(
      `holding-news:${ticker}`,
      {
        function: "NEWS_SENTIMENT",
        tickers: ticker,
        time_from: alphaTime(fromDate),
        time_to: alphaTime(toDate),
        limit: "20",
        sort: "LATEST",
      },
    );

    const feed = Array.isArray(data.feed) ? data.feed : [];

    return feed.map((item) => ({
      title: item.title || "제목 없음",
      source: item.source,
      url: item.url,
      publishedAt: formatAlphaPublishedAt(item.time_published),
      sentiment: item.overall_sentiment_label,
    }));
  } catch (error) {
    console.warn("[holding-issues][alpha] news request failed", {
      ticker,
      reason:
        error instanceof Error
          ? redactAlphaSecrets(error.message)
          : "Alpha Vantage 뉴스 조회 실패",
    });

    return [];
  }
}
