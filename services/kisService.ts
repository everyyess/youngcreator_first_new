import "server-only";
import { unstable_cache } from "next/cache";

export type KisMarketMove = {
  label: string;
  symbol?: string;
  value: number | null;
  changePercent: number | null;
  asOf: string | null;
  source: "kis" | "unavailable";
  status: "available" | "unavailable";
  reason?: string;
};

export type KisMarketNewsItem = {
  title: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  status: "available" | "unavailable";
  reason?: string;
};

export type DomesticMarketBrief = {
  market: "kr";
  reportDate: string;
  dataAsOf: string;
  headline: string;
  bullets: string[];
  indices: KisMarketMove[];
  exchangeRates: KisMarketMove[];
  sectors: KisMarketMove[];
  stocks: KisMarketMove[];
  news: KisMarketNewsItem[];
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

const indices = [
  { label: "KOSPI", symbol: "0001" },
  { label: "KOSDAQ", symbol: "1001" },
];

const majorStocks = [
  { label: "삼성전자", symbol: "005930" },
  { label: "SK하이닉스", symbol: "000660" },
  { label: "LG에너지솔루션", symbol: "373220" },
  { label: "현대차", symbol: "005380" },
  { label: "NAVER", symbol: "035420" },
  { label: "카카오", symbol: "035720" },
  { label: "셀트리온", symbol: "068270" },
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

function outputKeys(output: unknown) {
  if (Array.isArray(output)) return output[0] ? Object.keys(output[0] as Record<string, unknown>).slice(0, 20) : [];
  if (output && typeof output === "object") return Object.keys(output as Record<string, unknown>).slice(0, 20);
  return [];
}

function logKisResponse(context: string, path: string, trId: string, params: Record<string, string>, status: number, data: KisResponse) {
  console.info("[market-report][kis] response", {
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
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: getKisAppKey(),
        appsecret: getKisAppSecret(),
      }),
      cache: "no-store",
    });
    const data = await response.json() as { access_token?: string; msg_cd?: string; msg1?: string };
    console.info("[market-report][kis] token response", { env: kisEnvLabel(), status: response.status, ok: response.ok, hasAccessToken: Boolean(data.access_token), msg_cd: data.msg_cd, msg1: data.msg1 });
    if (!response.ok || !data.access_token) throw new Error(data.msg1 || `KIS 토큰 발급 실패: HTTP ${response.status}`);
    return data.access_token;
  },
  ["market-report-kis-access-token"],
  { revalidate: 82_800 },
);

async function getToken() {
  return _fetchToken();
}

function unavailableMove(label: string, symbol: string, reason: string): KisMarketMove {
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

function outputArray(data: KisResponse, preferred: "output" | "output1" | "output2" = "output") {
  const output = data[preferred] ?? data.output ?? data.output1 ?? data.output2;
  if (Array.isArray(output)) return output;
  return output ? [output] : [];
}

function compactDate(value: unknown) {
  const text = typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
  if (text.length < 8) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function normalizeTime(value: unknown) {
  const text = typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
  if (text.length < 4) return "16:00:00";
  return `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6) || "00"}`;
}


function kstNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${map.year}-${map.month}-${map.day}`;
  return { date, iso: `${date}T${map.hour}:${map.minute}:${map.second}+09:00` };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function pickDate(row: Record<string, unknown>) {
  return compactDate(row.stck_bsop_date) || compactDate(row.bsop_date) || compactDate(row.trd_dd) || compactDate(row.xymd) || compactDate(row.date);
}

function pickAsOf(row: Record<string, unknown>) {
  const date = pickDate(row);
  if (!date) return null;
  const time = normalizeTime(row.stck_cntg_hour ?? row.bsop_hour ?? row.cntg_hour);
  return `${date}T${time}+09:00`;
}

function pickPrice(row: Record<string, unknown>) {
  return toNumber(row.bstp_nmix_prpr ?? row.stck_prpr ?? row.ovrs_nmix_prpr ?? row.clos ?? row.last ?? row.price);
}

function pickChangePercent(row: Record<string, unknown>) {
  return toNumber(row.bstp_nmix_prdy_ctrt ?? row.prdy_ctrt ?? row.prdy_vrss_rate ?? row.rate ?? row.chg_rate);
}

async function kisGet(context: string, path: string, trId: string, params: Record<string, string>, tokenOverride?: string): Promise<KisResponse> {
  const token = tokenOverride ?? await getToken();
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
      console.warn("[market-report][kis] rate limited; retrying", { context, path, trId, attempt, nextDelayMs: 1600 });
      await wait(1600);
      continue;
    }

    if (!response.ok || (data.rt_cd && data.rt_cd !== "0")) throw new Error(data.msg1 || data.msg_cd || `KIS HTTP ${response.status}`);
    return data;
  }

  throw new Error("KIS 요청 재시도 한도를 초과했습니다.");
}
function moveFromRow(label: string, symbol: string, row: Record<string, unknown> | null, reportDate: string, requireDate: boolean): KisMarketMove {
  if (!row) return unavailableMove(label, symbol, "KIS 응답 데이터가 없습니다.");
  let asOf = pickAsOf(row);
  let asOfDate = asOf?.slice(0, 10) || null;
  if (requireDate && !asOf) {
    const now = kstNow();
    if (now.date === reportDate) {
      asOf = now.iso;
      asOfDate = now.date;
      console.info("[market-report][kis] date field missing; using request time for live quote", { label, symbol, reportDate, asOf, rowKeys: Object.keys(row).slice(0, 30) });
    }
  }
  if (requireDate && asOfDate !== reportDate) {
    console.warn("[market-report][kis] date validation failed", { label, symbol, reportDate, asOf, rowKeys: Object.keys(row).slice(0, 30) });
    return unavailableMove(label, symbol, asOfDate ? `당일(${reportDate}) 데이터가 아닙니다. dataAsOf=${asOfDate}` : "응답에서 기준일자를 찾지 못했습니다.");
  }
  const value = pickPrice(row);
  const changePercent = pickChangePercent(row);
  if (value == null || changePercent == null) {
    console.warn("[market-report][kis] parse failed", { label, symbol, reportDate, asOf, value, changePercent, rowKeys: Object.keys(row).slice(0, 30) });
    return unavailableMove(label, symbol, "가격 또는 등락률 필드가 누락되었습니다.");
  }
  return { label, symbol, value, changePercent, asOf, source: "kis", status: "available" };
}

async function fetchIndex(token: string, label: string, symbol: string, reportDate: string): Promise<KisMarketMove> {
  try {
    const data = await kisGet(`index:${symbol}`, "/uapi/domestic-stock/v1/quotations/inquire-index-price", "FHPUP02100000", {
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: symbol,
    }, token);
    return moveFromRow(label, symbol, firstOutput(data), reportDate, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "KIS 지수 조회에 실패했습니다.";
    return unavailableMove(label, symbol, message);
  }
}

async function fetchMajorStock(token: string, label: string, symbol: string, reportDate: string): Promise<KisMarketMove> {
  try {
    const data = await kisGet(`stock:${symbol}`, "/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
      fid_cond_mrkt_div_code: "J",
      fid_input_iscd: symbol,
    }, token);
    return moveFromRow(label, symbol, firstOutput(data), reportDate, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "KIS 종목 현재가 조회에 실패했습니다.";
    return unavailableMove(label, symbol, message);
  }
}

async function fetchSectors(token: string, reportDate: string): Promise<KisMarketMove[]> {
  try {
    const data = await kisGet("sectors", "/uapi/domestic-stock/v1/quotations/inquire-index-category-price", "FHPUP02140000", {
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: "0001",
      FID_COND_SCR_DIV_CODE: "20214",
      FID_MRKT_CLS_CODE: "K",
      FID_BLNG_CLS_CODE: "0",
    }, token);
    const rows = outputArray(data, "output2").slice(0, 12);
    if (!rows.length) return [unavailableMove("주요 업종", "KR-SECTOR", "KIS 업종 목록 output2 응답이 없습니다.")];
    return rows.map((row, index) => {
      const label = String(row.hts_kor_isnm ?? row.bstp_cls_name ?? row.idx_name ?? row.bstp_kor_isnm ?? `업종 ${index + 1}`);
      const symbol = String(row.bstp_cls_code ?? row.stck_shrn_iscd ?? row.bstp_iscd ?? `sector-${index + 1}`);
      return moveFromRow(label, symbol, row, reportDate, true);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "KIS 업종 조회에 실패했습니다.";
    return [unavailableMove("주요 업종", "KR-SECTOR", message)];
  }
}

async function fetchUsdKrw(token: string, reportDate: string): Promise<KisMarketMove> {
  try {
    const data = await kisGet("fx:usdkrw", "/uapi/overseas-price/v1/quotations/dailyprice", "HHDFS76240000", {
      AUTH: "",
      EXCD: "FX",
      SYMB: "USD/KRW",
      GUBN: "0",
      BYMD: reportDate.replace(/-/g, ""),
      MODP: "1",
    }, token);
    const row = outputArray(data, "output2")[0] ?? firstOutput(data);
    if (!row) return unavailableMove("원/달러 환율", "USD/KRW", "KIS 환율 응답 데이터가 없습니다.");

    const asOfDate = pickDate(row);
    if (asOfDate !== reportDate) {
      console.warn("[market-report][kis] fx date validation failed", { reportDate, asOfDate, rowKeys: Object.keys(row).slice(0, 30) });
      return unavailableMove("원/달러 환율", "USD/KRW", asOfDate ? `당일(${reportDate}) 환율 데이터가 아닙니다. dataAsOf=${asOfDate}` : "환율 응답에서 기준일자를 찾지 못했습니다.");
    }

    const value = pickPrice(row);
    if (value == null) {
      console.warn("[market-report][kis] fx parse failed", { reportDate, asOfDate, rowKeys: Object.keys(row).slice(0, 30) });
      return unavailableMove("원/달러 환율", "USD/KRW", "환율 가격 필드가 누락되었습니다.");
    }

    return { label: "원/달러 환율", symbol: "USD/KRW", value, changePercent: null, asOf: `${asOfDate}T16:00:00+09:00`, source: "kis", status: "available" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "KIS 환율 조회에 실패했습니다.";
    return unavailableMove("원/달러 환율", "USD/KRW", message);
  }
}
function formatPercent(value: number | null) {
  if (value == null) return "조회 불가";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function collectUnavailable(groups: KisMarketMove[][], news: KisMarketNewsItem[]) {
  const moves = groups.flat().filter((item) => item.status === "unavailable").map((item) => `${item.label}: ${item.reason || "unavailable"}`);
  const newsItems = news.filter((item) => item.status === "unavailable").map((item) => `${item.title}: ${item.reason || "unavailable"}`);
  return [...moves, ...newsItems];
}

function buildHeadline(indexMoves: KisMarketMove[]) {
  const available = indexMoves.filter((item) => item.status === "available");
  if (!available.length) return "당일 국내 시황 핵심 지수를 조회하지 못했습니다.";
  return available.map((item) => `${item.label} ${formatPercent(item.changePercent)}`).join(" · ");
}

function buildBullets(indexMoves: KisMarketMove[], exchangeRates: KisMarketMove[], sectors: KisMarketMove[], stockMoves: KisMarketMove[]) {
  const availableSectors = sectors.filter((item) => item.changePercent != null);
  const sectorBullet = availableSectors.length >= 2
    ? (() => {
        const sorted = [...availableSectors].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
        const strongestSector = sorted[0];
        const weakestSector = sorted[sorted.length - 1];
        return `업종 기준 강세는 ${strongestSector.label}(${formatPercent(strongestSector.changePercent)}), 약세는 ${weakestSector.label}(${formatPercent(weakestSector.changePercent)})입니다.`;
      })()
    : "주요 업종 비교는 2개 이상 조회된 경우에만 표시됩니다.";
  const strongestStock = stockMoves.filter((item) => item.changePercent != null).sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0];
  const usdKrw = exchangeRates[0];

  return [
    `주요 지수: ${indexMoves.map((item) => `${item.label} ${formatPercent(item.changePercent)}`).join(", ")}`,
    usdKrw?.status === "available" ? `원/달러 환율은 ${usdKrw.value?.toLocaleString("ko-KR")}원, 등락률 ${formatPercent(usdKrw.changePercent)}입니다.` : "원/달러 환율은 현재 조회할 수 없습니다.",
    sectorBullet,
    strongestStock ? `주요 종목 중 ${strongestStock.label}가 ${formatPercent(strongestStock.changePercent)}로 가장 강했습니다.` : "주요 종목 등락률은 현재 조회할 수 없습니다.",
  ];
}
function latestAsOf(groups: KisMarketMove[][]) {
  return groups.flat().map((item) => item.asOf).filter(Boolean).sort().reverse()[0] || "";
}

export async function fetchTodayKoreanMarketBrief(reportDate: string): Promise<DomesticMarketBrief> {
  if (!hasKisEnv()) throw new Error("KIS_APP_KEY 또는 KIS_APP_SECRET이 설정되지 않았습니다.");

  const token = await getToken();
  const indexMoves: KisMarketMove[] = [];
  for (const item of indices) {
    indexMoves.push(await fetchIndex(token, item.label, item.symbol, reportDate));
    await wait(900);
  }

  const exchangeRate = await fetchUsdKrw(token, reportDate);
  await wait(900);

  const sectorMoves = await fetchSectors(token, reportDate);
  await wait(900);

  const stockMoves: KisMarketMove[] = [];
  for (const item of majorStocks) {
    stockMoves.push(await fetchMajorStock(token, item.label, item.symbol, reportDate));
    await wait(900);
  }
  const news: KisMarketNewsItem[] = [{ title: "국내 시황/공시 본문", status: "unavailable", reason: "현재 연결된 KIS 시장정보 endpoint에서 본문형 시황/공시 데이터를 제공하지 않습니다." }];
  const exchangeRates = [exchangeRate];
  const dataAsOf = latestAsOf([indexMoves, exchangeRates, sectorMoves, stockMoves]);
  const unavailable = collectUnavailable([indexMoves, exchangeRates, sectorMoves, stockMoves], news);

  console.info("[market-report][kis] report summary", {
    env: kisEnvLabel(),
    reportDate,
    dataAsOf,
    indexAvailable: indexMoves.filter((item) => item.status === "available").length,
    exchangeAvailable: exchangeRates.filter((item) => item.status === "available").length,
    sectorAvailable: sectorMoves.filter((item) => item.status === "available").length,
    stockAvailable: stockMoves.filter((item) => item.status === "available").length,
    unavailableCount: unavailable.length,
  });

  return {
    market: "kr",
    reportDate,
    dataAsOf,
    headline: buildHeadline(indexMoves),
    bullets: buildBullets(indexMoves, exchangeRates, sectorMoves, stockMoves),
    indices: indexMoves,
    exchangeRates,
    sectors: sectorMoves,
    stocks: stockMoves,
    news,
    unavailable,
  };
}














