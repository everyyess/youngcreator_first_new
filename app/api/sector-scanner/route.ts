import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { sectorsForMarket, type SectorDef } from "./sectorMaster";
import { recordTick, get30mAgo } from "@/lib/marketHistory";
import { isKrMarketOpen, isUsMarketOpen } from "@/lib/marketHours";

/**
 * /api/sector-scanner
 *
 * GET ?market=domestic|global
 *   → 섹터별 실시간 등락률 랭킹 (시총 가중) + 구성 종목 시세
 *
 * GET ?market=...&details=<sectorId>
 *   → 해당 섹터 구성 종목의 매출액(TTM)·영업이익 (quoteSummary, 6시간 캐시)
 */

export const runtime = "nodejs";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type ScannerStock = {
  symbol: string;
  name: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  tradingValue: number | null; // 거래대금 = 거래량 × 현재가
  currency: string;
  isCustom?: boolean; // 사용자가 직접 추가한 관심 종목
};

export type ScannerSector = {
  id: string;
  name: string;
  changePercent: number | null; // 시총 가중 평균 (관심 종목 포함)
  changePercent30mAgo: number | null; // 서버가 자체 기록한 30분 전 실측 변동률 (기본 구성종목 기준, 없으면 null)
  topGainer: string | null;
  topLoser: string | null;
  stocks: ScannerStock[];
};

export type ScannerResponse = {
  market: "domestic" | "global";
  asOf: string;
  sectors: ScannerSector[];
};

export type StockFinancials = {
  symbol: string;
  totalRevenue: number | null;    // TTM 매출액
  operatingIncome: number | null; // 최근 회계연도 영업이익
  financialCurrency: string | null;
};

// ── 캐시 ─────────────────────────────────────────────────────────────────────
const quoteCache = new Map<string, { data: ScannerResponse; ts: number }>();
const QUOTE_TTL_MS = 60 * 1000;

const finCache = new Map<string, { data: StockFinancials; ts: number }>();
const FIN_TTL_MS = 6 * 60 * 60 * 1000;

function toNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── extra 파라미터 파싱: "SYMBOL:sectorId[:encodedName],..." ─────────────────
function parseExtras(extraParam: string | null): { symbol: string; sectorId: string; name?: string }[] {
  if (!extraParam) return [];
  return extraParam
    .split(",")
    .map((pair) => {
      const parts = pair.split(":");
      if (parts.length < 2) return null;
      const symbol = parts[0].trim().toUpperCase();
      const sectorId = parts[1].trim();
      const name = parts[2] ? decodeURIComponent(parts[2]) : undefined;
      return symbol && sectorId ? { symbol, sectorId, name } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 200); // 과도한 요청 방지 (관심 종목은 시장별 최대치를 넉넉히 수용)
}

/** 야후 quote 배치 — 심볼이 많으면 80개 단위로 분할 요청 */
async function batchQuotes(symbols: string[]): Promise<Map<string, Record<string, unknown>>> {
  const bySymbol = new Map<string, Record<string, unknown>>();
  const CHUNK = 80;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    const quotes = await yahooFinance.quote(chunk);
    const list = Array.isArray(quotes) ? quotes : [quotes];
    for (const q of list) {
      const rec = q as unknown as Record<string, unknown>;
      if (typeof rec.symbol === "string") bySymbol.set(rec.symbol, rec);
    }
  }
  return bySymbol;
}

// ── 섹터 시세 집계 ───────────────────────────────────────────────────────────
export async function buildScannerResponse(
  market: "domestic" | "global",
  extras: { symbol: string; sectorId: string; name?: string }[],
): Promise<ScannerResponse> {
  const sectorDefs = sectorsForMarket(market);
  const baseSymbols = new Set(sectorDefs.flatMap((s) => s.symbols.map((x) => x.symbol)));
  // 기본 구성 종목과 중복되는 관심 종목은 제외
  const validExtras = extras.filter((e) => !baseSymbols.has(e.symbol) && sectorDefs.some((s) => s.id === e.sectorId));
  const allSymbols = [...baseSymbols, ...validExtras.map((e) => e.symbol)];

  const bySymbol = await batchQuotes(allSymbols);

  const toStock = (symbol: string, name: string, isCustom: boolean): ScannerStock => {
    const q = bySymbol.get(symbol);
    const price = toNum(q?.regularMarketPrice);
    const volume = toNum(q?.regularMarketVolume);
    // 관심 종목: 클라이언트가 전달한 한국어 이름 우선, 없으면 야후 이름
    const quoteName = typeof q?.shortName === "string" ? q.shortName : typeof q?.longName === "string" ? q.longName : null;
    return {
      symbol,
      name: isCustom ? (name !== symbol ? name : (quoteName ?? symbol)) : name,
      price,
      changePercent: toNum(q?.regularMarketChangePercent),
      marketCap: toNum(q?.marketCap),
      tradingValue: price !== null && volume !== null ? price * volume : null,
      currency: typeof q?.currency === "string" ? q.currency : (market === "domestic" ? "KRW" : "USD"),
      ...(isCustom ? { isCustom: true } : {}),
    };
  };

  // 시총 가중 평균 등락률 (시총 없는 종목은 균등 가중 폴백)
  const weightedChangePercent = (list: ScannerStock[]): number | null => {
    const valid = list.filter((s) => s.changePercent !== null);
    if (!valid.length) return null;
    const totalCap = valid.reduce((sum, s) => sum + (s.marketCap ?? 0), 0);
    return totalCap > 0
      ? valid.reduce((sum, s) => sum + (s.changePercent ?? 0) * ((s.marketCap ?? 0) / totalCap), 0)
      : valid.reduce((sum, s) => sum + (s.changePercent ?? 0), 0) / valid.length;
  };

  const now = Date.now();
  const sectors: ScannerSector[] = sectorDefs.map((def: SectorDef) => {
    const baseStocks = def.symbols.map(({ symbol, name }) => toStock(symbol, name, false));
    const extraStocks = validExtras.filter((e) => e.sectorId === def.id).map((e) => toStock(e.symbol, e.name ?? e.symbol, true));
    const stocks: ScannerStock[] = [...baseStocks, ...extraStocks];

    const changePercent = weightedChangePercent(stocks);
    // 30분 전 대비 비교는 사용자별 관심 종목에 흔들리지 않도록 기본 구성종목만으로 기록/조회한다.
    const baseChangePercent = weightedChangePercent(baseStocks);
    if (baseChangePercent != null) recordTick(`sect:${market}:${def.id}`, baseChangePercent, now);
    const changePercent30mAgo = get30mAgo(`sect:${market}:${def.id}`, now);

    const valid = stocks.filter((s) => s.changePercent !== null);
    const sortedByChange = [...valid].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
    return {
      id: def.id,
      name: def.name,
      changePercent,
      changePercent30mAgo,
      topGainer: sortedByChange[0]?.name ?? null,
      topLoser: sortedByChange[sortedByChange.length - 1]?.name ?? null,
      stocks,
    };
  });

  sectors.sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));
  return { market, asOf: new Date().toISOString(), sectors };
}

// ── 재무 상세 (매출액·영업이익) ──────────────────────────────────────────────
async function fetchFinancials(symbol: string): Promise<StockFinancials> {
  const cached = finCache.get(symbol);
  if (cached && Date.now() - cached.ts < FIN_TTL_MS) return cached.data;

  let totalRevenue: number | null = null;
  let operatingIncome: number | null = null;
  let financialCurrency: string | null = null;
  try {
    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: ["financialData", "incomeStatementHistory"],
    }) as unknown as {
      financialData?: { totalRevenue?: number; financialCurrency?: string; operatingMargins?: number };
      incomeStatementHistory?: { incomeStatementHistory?: Array<{ operatingIncome?: number }> };
    };
    totalRevenue = toNum(summary.financialData?.totalRevenue);
    financialCurrency = summary.financialData?.financialCurrency ?? null;
    operatingIncome = toNum(summary.incomeStatementHistory?.incomeStatementHistory?.[0]?.operatingIncome);
    // Yahoo가 incomeStatementHistory를 비워 주는 경우 — TTM 영업이익률로 추정
    if (operatingIncome === null && totalRevenue !== null) {
      const margins = toNum(summary.financialData?.operatingMargins);
      if (margins !== null) operatingIncome = totalRevenue * margins;
    }
  } catch {
    // 재무 데이터 미제공 종목 — null 유지
  }

  const data: StockFinancials = { symbol, totalRevenue, operatingIncome, financialCurrency };
  finCache.set(symbol, { data, ts: Date.now() });
  return data;
}

// ── 야후 업종(sector/industry) → 우리 섹터 id 매핑 ───────────────────────────
const classifyCache = new Map<string, { data: ClassifyResult; ts: number }>();
const CLASSIFY_TTL_MS = 24 * 60 * 60 * 1000;

export type ClassifyResult = {
  symbol: string;
  name: string | null;
  sectorId: string | null;
  sectorName: string | null;
  yahooSector: string | null;
  yahooIndustry: string | null;
};

/** industry(우선) → sector(폴백) 키워드 매핑. 시장별로 우리 섹터 id가 다르다. */
function mapToSectorId(market: "domestic" | "global", yahooSector: string, yahooIndustry: string): string | null {
  const ind = yahooIndustry.toLowerCase();
  const sec = yahooSector.toLowerCase();

  const byIndustry: [RegExp, string, string][] = [
    // [패턴, 국내 섹터 id, 해외 섹터 id(GICS 산업그룹)]
    // ※ 순서 중요: 구체적 패턴이 포괄 패턴보다 먼저 와야 오분류가 없다.
    //    (예: "Marine Shipping"은 조선이 아니라 운송, "Utilities—Regulated Gas"는 정유가 아니라 유틸리티)
    [/semiconductor/, "semiconductor", "semiconductor"],
    [/battery/, "battery", "capitalgoods"],
    [/electrical equipment/, "electric", "capitalgoods"],
    [/biotech|drug|pharma|life science|diagnostics/, "bio", "pharma"],
    [/medical|health/, "medical", "healthequip"],
    [/auto|tires|rubber/, "auto", "auto"],
    [/gaming/, "game", "media"],
    [/internet content/, "internet", "media"],
    [/software|information technology|it services/, "internet", "software"],
    [/computer hardware|communication equipment|electronic components|consumer electronics/, "techhardware", "techhardware"],
    [/entertainment|media|broadcasting|music|publishing|advertising|interactive/, "entertainment", "media"],
    [/internet retail|specialty retail|home improvement|department/, "consumer", "discretionaryretail"],
    [/bank/, "finance", "banks"],
    [/insurance/, "insurance", "insurance"],
    [/capital market/, "securities", "finservices"],
    [/credit|asset management|financial/, "finance", "finservices"],
    [/aerospace|defense/, "defense", "capitalgoods"],
    [/marine shipping|airline|railroad|trucking|logistics|integrated freight|ground transport/, "transport", "transport"],
    [/marine|shipbuilding/, "ship", "capitalgoods"],
    [/farm & heavy|industrial machinery|specialty industrial/, "machinery", "capitalgoods"],
    [/conglomerate/, "holdings", "capitalgoods"],
    [/waste|staffing|consulting|specialty business|security & protection/, "consumer", "commservices"],
    [/utilit|power producer|renewable|nuclear/, "utilities", "utilities"],
    [/oil|gas|refin|energy/, "chemical", "energy"],
    [/steel|aluminum|copper|gold|metal|mining/, "steel", "materials"],
    [/chemical|paper|material/, "chemical", "materials"],
    [/engineering & construction|building products|building materials|cement/, "construction", "capitalgoods"],
    [/grocery|discount stores|food distribution/, "consumer", "staplesretail"],
    [/beverage|packaged food|confection|tobacco|farm products/, "food", "foodbev"],
    [/household|personal product/, "cosmetics", "household"],
    [/apparel|footwear|luxury|furnishing|leisure|residential construction/, "consumer", "durables"],
    [/restaurant|lodging|resort|casino|travel/, "consumer", "conservices"],
    [/telecom/, "telecom", "telecom"],
    [/reit|real estate/, "construction", "realestate"],
  ];
  for (const [re, dom, glob] of byIndustry) {
    if (re.test(ind)) return market === "domestic" ? dom : glob;
  }

  const bySector: [RegExp, string, string][] = [
    [/technology/, "internet", "software"],
    [/healthcare/, "bio", "pharma"],
    [/financial/, "finance", "finservices"],
    [/energy/, "chemical", "energy"],
    [/industrials/, "machinery", "capitalgoods"],
    [/consumer cyclical/, "consumer", "discretionaryretail"],
    [/consumer defensive/, "food", "staplesretail"],
    [/consumer/, "consumer", "discretionaryretail"],
    [/communication/, "entertainment", "media"],
    [/basic materials/, "chemical", "materials"],
    [/utilities/, "utilities", "utilities"],
    [/real estate/, "construction", "realestate"],
  ];
  for (const [re, dom, glob] of bySector) {
    if (re.test(sec)) return market === "domestic" ? dom : glob;
  }
  return null;
}

async function classifySymbol(symbol: string, market: "domestic" | "global"): Promise<ClassifyResult> {
  const cacheKey = `${market}:${symbol}`;
  const cached = classifyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CLASSIFY_TTL_MS) return cached.data;

  let yahooSector: string | null = null;
  let yahooIndustry: string | null = null;
  let name: string | null = null;
  try {
    const summary = await yahooFinance.quoteSummary(symbol, { modules: ["assetProfile", "quoteType"] }) as unknown as {
      assetProfile?: { sector?: string; industry?: string };
      quoteType?: { shortName?: string; longName?: string };
    };
    yahooSector = summary.assetProfile?.sector ?? null;
    yahooIndustry = summary.assetProfile?.industry ?? null;
    name = summary.quoteType?.shortName ?? summary.quoteType?.longName ?? null;
  } catch {
    // assetProfile 미제공 종목 (ETF 등) — sectorId null 유지
  }

  const sectorId = mapToSectorId(market, yahooSector ?? "", yahooIndustry ?? "");
  const sectorName = sectorId ? sectorsForMarket(market).find((s) => s.id === sectorId)?.name ?? null : null;
  const data: ClassifyResult = { symbol, name, sectorId, sectorName, yahooSector, yahooIndustry };
  classifyCache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

// 클라이언트 요청 여부와 무관하게 서버가 스스로 주기 기록 — 탭이 백그라운드거나
// 아무도 접속하지 않은 새벽에도 섹터 "30분 전" 히스토리가 끊기지 않도록 한다.
const globalForSectorScheduler = globalThis as unknown as {
  _sectorScannerSchedulerInitialized?: boolean;
};

function ensureSectorScheduler() {
  if (globalForSectorScheduler._sectorScannerSchedulerInitialized) return;
  globalForSectorScheduler._sectorScannerSchedulerInitialized = true;
  const tick = async () => {
    const now = Date.now();
    const markets = (["domestic", "global"] as const).filter((market) =>
      market === "domestic" ? isKrMarketOpen(now) : isUsMarketOpen(now)
    );
    for (const market of markets) {
      try {
        const data = await buildScannerResponse(market, []);
        quoteCache.set(`${market}|`, { data, ts: Date.now() });
      } catch {
        // 다음 주기에 재시도
      }
    }
  };
  setInterval(() => { tick().catch(() => {}); }, 5 * 60_000);
}

export async function GET(req: NextRequest) {
  ensureSectorScheduler();
  const { searchParams } = new URL(req.url);
  const marketParam = searchParams.get("market");
  const market: "domestic" | "global" = marketParam === "global" ? "global" : "domestic";
  const detailsSectorId = searchParams.get("details");
  const extras = parseExtras(searchParams.get("extra"));
  const classifyParam = searchParams.get("classify");

  try {
    // ── 섹터 자동 분류 요청 ───────────────────────────────────────────────────
    if (classifyParam) {
      const result = await classifySymbol(classifyParam.trim().toUpperCase(), market);
      return NextResponse.json(result);
    }

    // ── 재무 상세 요청 ────────────────────────────────────────────────────────
    if (detailsSectorId) {
      const sector = sectorsForMarket(market).find((s) => s.id === detailsSectorId);
      if (!sector) {
        return NextResponse.json({ error: `알 수 없는 섹터: ${detailsSectorId}` }, { status: 400 });
      }
      const symbols = [
        ...sector.symbols.map((s) => s.symbol),
        ...extras.filter((e) => e.sectorId === detailsSectorId).map((e) => e.symbol),
      ];
      const results = await Promise.all(symbols.map((symbol) => fetchFinancials(symbol)));
      return NextResponse.json({ sectorId: detailsSectorId, financials: results });
    }

    // ── 섹터 랭킹 요청 (60초 캐시, 관심 종목 조합별 캐시 키) ─────────────────
    const cacheKey = `${market}|${extras.map((e) => `${e.symbol}:${e.sectorId}`).join(",")}`;
    const cached = quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < QUOTE_TTL_MS) {
      return NextResponse.json(cached.data);
    }
    const data = await buildScannerResponse(market, extras);
    quoteCache.set(cacheKey, { data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "섹터 데이터를 불러오지 못했습니다.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
