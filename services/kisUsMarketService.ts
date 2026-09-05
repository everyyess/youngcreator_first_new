import "server-only";
import { unstable_cache } from "next/cache";
import { buildMarketNarrative, narrativeToBullets, type MarketReportNarrative, type ReportSource } from "@/services/marketNarrativeService";

export type KisUsMarketMove = {
  label: string;
  symbol?: string;
  value: number | null;
  changePercent: number | null;
  asOf: string | null;
  source: "kis" | "unavailable";
  status: "available" | "unavailable";
  reason?: string;
};

export type KisUsNewsItem = {
  title: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  sentiment?: string;
  summary?: string;
  status: "available" | "unavailable";
  reason?: string;
};

export type KisUsMarketBrief = {
  market: "us";
  reportDate: string;
  dataAsOf: string;
  headline: string;
  bullets: string[];
  indices: KisUsMarketMove[];
  sectors: KisUsMarketMove[];
  stocks: KisUsMarketMove[];
  news: KisUsNewsItem[];
  narrative: MarketReportNarrative;
  sources: ReportSource[];
  unavailable: string[];
};

type KisResponse = {
  rt_cd?: string;
  msg_cd?: string;
  msg1?: string;
  output?: Record<string, unknown> | Record<string, unknown>[];
  output1?: Record<string, unknown> | Record<string, unknown>[];
  output2?: Record<string, unknown> | Record<string, unknown>[];
};

const KIS_BASE = process.env.KIS_BASE_URL?.trim() || "https://openapi.koreainvestment.com:9443";
const OVERSEAS_DAILY_PATH = "/uapi/overseas-price/v1/quotations/dailyprice";
const OVERSEAS_INDEX_DAILY_PATH = "/uapi/overseas-price/v1/quotations/inquire-daily-chartprice";
const OVERSEAS_DAILY_TR_ID = "HHDFS76240000";
const OVERSEAS_INDEX_DAILY_TR_ID = "FHKST03030100";

// KIS overseas index codes verified against inquire-daily-chartprice actual responses.
const usIndexSymbols = [
  { label: "S&P500", code: "SPX" },
  { label: "Nasdaq", code: "COMP" },
  { label: "Dow", code: ".DJI" },
  { label: "SOX", code: "SOX" },
];

// Sector ETF proxies: real listed securities via KIS overseas dailyprice, not synthetic sector data.
const usSectorEtfs = [
  { label: "Technology", symbol: "XLK", exchange: "AMS" },
  { label: "Financials", symbol: "XLF", exchange: "AMS" },
  { label: "Energy", symbol: "XLE", exchange: "AMS" },
  { label: "Health Care", symbol: "XLV", exchange: "AMS" },
  { label: "Industrials", symbol: "XLI", exchange: "AMS" },
  { label: "Consumer Discretionary", symbol: "XLY", exchange: "AMS" },
  { label: "Communication Services", symbol: "XLC", exchange: "AMS" },
  { label: "Consumer Staples", symbol: "XLP", exchange: "AMS" },
  { label: "Utilities", symbol: "XLU", exchange: "AMS" },
  { label: "Real Estate", symbol: "XLRE", exchange: "AMS" },
  { label: "Materials", symbol: "XLB", exchange: "AMS" },
];

// Mega-cap, market-moving names only; selection is strongest/weakest within this fixed universe.
const usMajorStocks = [
  { label: "Apple", symbol: "AAPL", exchange: "NAS" },
  { label: "Microsoft", symbol: "MSFT", exchange: "NAS" },
  { label: "NVIDIA", symbol: "NVDA", exchange: "NAS" },
  { label: "Amazon", symbol: "AMZN", exchange: "NAS" },
  { label: "Meta", symbol: "META", exchange: "NAS" },
  { label: "Alphabet", symbol: "GOOGL", exchange: "NAS" },
  { label: "Tesla", symbol: "TSLA", exchange: "NAS" },
  { label: "Broadcom", symbol: "AVGO", exchange: "NAS" },
  { label: "JPMorgan", symbol: "JPM", exchange: "NYS" },
  { label: "Eli Lilly", symbol: "LLY", exchange: "NYS" },
];

function getKisAppKey() {
  return process.env.KIS_APP_KEY?.trim() || "";
}

function getKisAppSecret() {
  return process.env.KIS_APP_SECRET?.trim() || "";
}

function hasKisEnv() {
  return Boolean(getKisAppKey() && getKisAppSecret());
}

function kisEnvLabel() {
  return KIS_BASE.includes("openapivts") ? "virtual" : "real";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outputKeys(output: unknown) {
  if (Array.isArray(output)) return output[0] ? Object.keys(output[0] as Record<string, unknown>).slice(0, 20) : [];
  if (output && typeof output === "object") return Object.keys(output as Record<string, unknown>).slice(0, 20);
  return [];
}

function logKisResponse(context: string, path: string, trId: string, params: Record<string, string>, status: number, data: KisResponse) {
  console.info("[market-report][kis-us] response", {
    context,
    env: kisEnvLabel(),
    status,
    path,
    trId,
    params,
    rt_cd: data.rt_cd,
    msg_cd: data.msg_cd,
    msg1: data.msg1,
    outputKeys: outputKeys(data.output),
    output1Keys: outputKeys(data.output1),
    output2Keys: outputKeys(data.output2),
    output2Count: Array.isArray(data.output2) ? data.output2.length : undefined,
  });
}

const _fetchToken = unstable_cache(
  async (): Promise<string> => {
    if (!hasKisEnv()) throw new Error("KIS_APP_KEY 또는 KIS_APP_SECRET이 설정되지 않았습니다.");
    const response = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", appkey: getKisAppKey(), appsecret: getKisAppSecret() }),
      cache: "no-store",
    });
    const data = await response.json() as { access_token?: string; msg_cd?: string; msg1?: string };
    console.info("[market-report][kis-us] token response", { env: kisEnvLabel(), status: response.status, ok: response.ok, hasAccessToken: Boolean(data.access_token), msg_cd: data.msg_cd, msg1: data.msg1 });
    if (!response.ok || !data.access_token) throw new Error(data.msg1 || `KIS 토큰 발급 실패: HTTP ${response.status}`);
    return data.access_token;
  },
  ["market-report-kis-us-access-token"],
  { revalidate: 82_800 },
);

async function getToken() {
  return _fetchToken();
}

async function kisGet(context: string, path: string, trId: string, params: Record<string, string>, token: string): Promise<KisResponse> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const url = new URL(`${KIS_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        appkey: getKisAppKey(),
        appsecret: getKisAppSecret(),
        tr_id: trId,
        custtype: "P",
        "Content-Type": "application/json; charset=utf-8",
      },
      cache: "no-store",
    });
    const data = await response.json() as KisResponse;
    logKisResponse(context, path, trId, params, response.status, data);

    const isRateLimited = data.msg_cd === "EGW00201" || /초당 거래건수/.test(data.msg1 || "");
    if (isRateLimited && attempt < maxAttempts) {
      console.warn("[market-report][kis-us] rate limited; retrying", { context, path, trId, attempt, nextDelayMs: 1600 });
      await wait(1600);
      continue;
    }

    if (!response.ok || (data.rt_cd && data.rt_cd !== "0")) throw new Error(data.msg1 || data.msg_cd || `KIS HTTP ${response.status}`);
    return data;
  }

  throw new Error("KIS 요청 재시도 한도를 초과했습니다.");
}

function unavailableMove(label: string, symbol: string, reason: string): KisUsMarketMove {
  return { label, symbol, value: null, changePercent: null, asOf: null, source: "unavailable", status: "unavailable", reason };
}

function toNumber(value: unknown) {
  if (value == null) return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstOutput(data: KisResponse) {
  const output = data.output ?? data.output1 ?? data.output2;
  if (Array.isArray(output)) return output[0] ?? null;
  return output ?? null;
}
function outputArray(data: KisResponse, preferred: "output" | "output1" | "output2" = "output2") {
  const output = data[preferred] ?? data.output2 ?? data.output1 ?? data.output;
  if (Array.isArray(output)) return output;
  return output ? [output] : [];
}

function compactDate(value: unknown) {
  const text = typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
  if (text.length < 8) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function pickDate(row: Record<string, unknown>) {
  return compactDate(row.xymd) || compactDate(row.bymd) || compactDate(row.stck_bsop_date) || compactDate(row.date);
}

function pickClose(row: Record<string, unknown>) {
  return toNumber(row.clos ?? row.last ?? row.ovrs_nmix_prpr ?? row.stck_prpr ?? row.price);
}

function pickChangePercent(row: Record<string, unknown>, previousRow?: Record<string, unknown>) {
  const explicit = toNumber(row.rate ?? row.prdy_ctrt ?? row.chg_rate ?? row.ovrs_nmix_prdy_ctrt);
  if (explicit != null) return explicit;
  const close = pickClose(row);
  const previousClose = previousRow ? pickClose(previousRow) : null;
  if (close == null || previousClose == null || previousClose === 0) return null;
  return ((close - previousClose) / previousClose) * 100;
}

function moveFromDailyRows(label: string, symbol: string, rows: Record<string, unknown>[], reportDate: string): KisUsMarketMove {
  const sortedRows = rows
    .map((row) => ({ row, date: pickDate(row) }))
    .filter((item): item is { row: Record<string, unknown>; date: string } => Boolean(item.date))
    .sort((a, b) => b.date.localeCompare(a.date));
  const selectedIndex = sortedRows.findIndex((item) => item.date <= reportDate);
  if (selectedIndex < 0) return unavailableMove(label, symbol, `${reportDate} 이전 거래일 데이터가 없습니다.`);

  const selected = sortedRows[selectedIndex];
  const previous = sortedRows[selectedIndex + 1];
  const value = pickClose(selected.row);
  const changePercent = pickChangePercent(selected.row, previous?.row);
  if (value == null || changePercent == null) {
    console.warn("[market-report][kis-us] parse failed", { label, symbol, reportDate, selectedDate: selected.date, rowKeys: Object.keys(selected.row).slice(0, 30), previousRowKeys: previous ? Object.keys(previous.row).slice(0, 30) : [] });
    return unavailableMove(label, symbol, "가격 또는 등락률 필드가 누락되었습니다.");
  }

  if (selected.date !== reportDate) {
    console.info("[market-report][kis-us] reportDate adjusted to latest trading row", { label, symbol, requestedReportDate: reportDate, selectedDate: selected.date, previousDate: previous?.date });
  }

  return { label, symbol, value, changePercent, asOf: selected.date, source: "kis", status: "available" };
}

function moveFromQuoteRow(label: string, symbol: string, row: Record<string, unknown> | null, reportDate: string): KisUsMarketMove {
  if (!row) return unavailableMove(label, symbol, "KIS 해외지수 output1 응답 데이터가 없습니다.");
  const value = pickClose(row);
  const changePercent = pickChangePercent(row);
  if (value == null || value <= 0 || changePercent == null) {
    console.warn("[market-report][kis-us] index output1 parse failed", { label, symbol, reportDate, value, changePercent, rowKeys: Object.keys(row).slice(0, 30) });
    return unavailableMove(label, symbol, "해외지수 현재값 또는 전일대비율 필드가 누락되었습니다.");
  }
  console.info("[market-report][kis-us] index output1 used", { label, symbol, reportDate, rowKeys: Object.keys(row).slice(0, 30) });
  return { label, symbol, value, changePercent, asOf: reportDate, source: "kis", status: "available" };
}
async function fetchOverseasIndex(token: string, label: string, code: string, reportDate: string): Promise<KisUsMarketMove> {
  try {
    const startDate = addDays(reportDate, -10).replace(/-/g, "");
    const endDate = reportDate.replace(/-/g, "");
    const data = await kisGet(`index:${code}`, OVERSEAS_INDEX_DAILY_PATH, OVERSEAS_INDEX_DAILY_TR_ID, {
      FID_COND_MRKT_DIV_CODE: "N",
      FID_INPUT_ISCD: code,
      FID_INPUT_DATE_1: startDate,
      FID_INPUT_DATE_2: endDate,
      FID_PERIOD_DIV_CODE: "D",
    }, token);
    const dailyRows = outputArray(data, "output2");
    if (dailyRows.length) return moveFromDailyRows(label, code, dailyRows, reportDate);
    return moveFromQuoteRow(label, code, firstOutput(data), reportDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "KIS 해외지수 조회에 실패했습니다.";
    return unavailableMove(label, code, message);
  }
}

async function fetchOverseasDailyMove(token: string, label: string, symbol: string, exchange: string, reportDate: string): Promise<KisUsMarketMove> {
  try {
    const data = await kisGet(`daily:${exchange}:${symbol}`, OVERSEAS_DAILY_PATH, OVERSEAS_DAILY_TR_ID, {
      AUTH: "",
      EXCD: exchange,
      SYMB: symbol,
      GUBN: "0",
      BYMD: reportDate.replace(/-/g, ""),
      MODP: "1",
    }, token);
    return moveFromDailyRows(label, symbol, outputArray(data, "output2"), reportDate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "KIS 해외주식 기간별시세 조회에 실패했습니다.";
    return unavailableMove(label, symbol, message);
  }
}

function formatPercent(value: number | null) {
  if (value == null) return "조회 불가";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function buildHeadline(indices: KisUsMarketMove[]) {
  const core = indices.filter((item) => item.status === "available" && item.label !== "SOX");
  if (!core.length) return "전일 미국 시황 핵심 지수를 조회하지 못했습니다.";
  return core.map((item) => `${item.label} ${formatPercent(item.changePercent)}`).join(" · ");
}

function buildBullets(indices: KisUsMarketMove[], sectors: KisUsMarketMove[], stocks: KisUsMarketMove[], news: KisUsNewsItem[]) {
  const availableSectors = sectors.filter((item) => item.changePercent != null);
  const sectorBullet = availableSectors.length >= 2
    ? (() => {
        const sorted = [...availableSectors].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
        return `업종 ETF 기준 강세는 ${sorted[0].label}(${formatPercent(sorted[0].changePercent)}), 약세는 ${sorted[sorted.length - 1].label}(${formatPercent(sorted[sorted.length - 1].changePercent)})입니다.`;
      })()
    : "업종 ETF 비교는 2개 이상 조회된 경우에만 표시됩니다.";

  const availableStocks = stocks.filter((item) => item.changePercent != null);
  const stockBullet = availableStocks.length >= 2
    ? (() => {
        const sorted = [...availableStocks].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
        return `미국 주요 대형주 중 강세는 ${sorted[0].label}(${formatPercent(sorted[0].changePercent)}), 약세는 ${sorted[sorted.length - 1].label}(${formatPercent(sorted[sorted.length - 1].changePercent)})입니다.`;
      })()
    : "미국 주요 대형주 등락률은 현재 조회할 수 없습니다.";

  const topNews = news.find((item) => item.status === "available");
  return [
    `주요 지수: ${indices.map((item) => `${item.label} ${formatPercent(item.changePercent)}`).join(", ")}`,
    sectorBullet,
    stockBullet,
    topNews ? `주요 뉴스: ${topNews.title}` : "주요 시장 뉴스는 현재 별도 source가 연결되지 않았습니다.",
  ];
}

function collectUnavailable(groups: KisUsMarketMove[][], news: KisUsNewsItem[]) {
  const moveReasons = groups.flat().filter((item) => item.status === "unavailable").map((item) => `${item.label}: ${item.reason || "unavailable"}`);
  const newsReasons = news.filter((item) => item.status === "unavailable").map((item) => `뉴스: ${item.reason || "unavailable"}`);
  return [...moveReasons, ...newsReasons];
}

function latestAsOf(groups: KisUsMarketMove[][], reportDate: string) {
  return groups.flat().map((item) => item.asOf).filter(Boolean).sort().reverse()[0] || reportDate;
}

export async function fetchPreviousUsMarketBrief(reportDate: string): Promise<KisUsMarketBrief> {
  if (!hasKisEnv()) throw new Error("KIS_APP_KEY 또는 KIS_APP_SECRET이 설정되지 않았습니다.");

  const token = await getToken();
  const indices: KisUsMarketMove[] = [];
  for (const item of usIndexSymbols) {
    indices.push(await fetchOverseasIndex(token, item.label, item.code, reportDate));
    await wait(900);
  }

  const sectors: KisUsMarketMove[] = [];
  for (const item of usSectorEtfs) {
    sectors.push(await fetchOverseasDailyMove(token, item.label, item.symbol, item.exchange, reportDate));
    await wait(900);
  }

  const stocks: KisUsMarketMove[] = [];
  for (const item of usMajorStocks) {
    stocks.push(await fetchOverseasDailyMove(token, item.label, item.symbol, item.exchange, reportDate));
    await wait(900);
  }

  const narrative = await buildMarketNarrative({ market: "us", reportDate, indices, sectors, stocks });
  const news: KisUsNewsItem[] = narrative.news.items.map((item) => ({
    title: item.title,
    source: item.publisher,
    url: item.url,
    publishedAt: item.publishedAt,
    summary: item.summary,
    status: "available",
  }));
  const unavailable = collectUnavailable([indices, sectors, stocks], news);
  const dataAsOf = latestAsOf([indices, sectors, stocks], reportDate);

  console.info("[market-report][kis-us] report summary", {
    reportDate,
    dataAsOf,
    indexAvailable: indices.filter((item) => item.status === "available").length,
    sectorAvailable: sectors.filter((item) => item.status === "available").length,
    stockAvailable: stocks.filter((item) => item.status === "available").length,
    unavailableCount: unavailable.length,
  });

  return {
    market: "us",
    reportDate,
    dataAsOf,
    headline: narrative.indexOverview.text || buildHeadline(indices),
    bullets: narrativeToBullets(narrative),
    indices,
    sectors,
    stocks,
    news,
    narrative,
    sources: narrative.sources,
    unavailable,
  };
}










