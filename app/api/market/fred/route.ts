import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const API_KEY = process.env.FRED_API_KEY ?? "";

// 시리즈별 TTL 캐시 — 일별 데이터(30분), 차트 데이터(1시간)
// 경제지표는 발표 주기가 일·주·월 단위라 30분 캐시로도 충분히 최신성 유지
const fredCache = new Map<string, { data: FredSeriesResult; expiry: number }>();
const FRED_TTL_DEFAULT = 30 * 60 * 1000;  // 30분 — 최신값 조회
const FRED_TTL_CHART   = 60 * 60 * 1000;  // 1시간 — 시계열 차트 (덜 민감)

// 기본 매크로 시리즈
const DEFAULT_SERIES = [
  "FEDFUNDS", "DGS10", "DGS2", "T10Y2Y", "DCOILWTICO", "VIXCLS",
  "DEXKOUS", "DEXJPUS", "UNRATE", "PCEPI", "CPIAUCSL", "PAYEMS", "ICSA", "RSAFS",
];

const SERIES_META: Record<string, { title: string; unit: string }> = {
  FEDFUNDS:   { title: "미국 기준금리 (Fed Funds Rate)",         unit: "%" },
  DGS10:      { title: "미국 10년물 국채 금리",                  unit: "%" },
  DGS2:       { title: "미국 2년물 국채 금리",                   unit: "%" },
  T10Y2Y:     { title: "10년-2년 스프레드 (장단기 역전)",       unit: "%" },
  DCOILWTICO: { title: "WTI 국제유가",                           unit: "USD/배럴" },
  VIXCLS:     { title: "VIX 공포지수",                           unit: "pt" },
  DEXKOUS:    { title: "원/달러 환율 (KRW/USD)",                 unit: "KRW" },
  DEXJPUS:    { title: "엔/달러 환율 (JPY/USD)",                 unit: "JPY" },
  UNRATE:     { title: "미국 실업률",                            unit: "%" },
  PCEPI:      { title: "PCE 물가지수",                           unit: "pt" },
  CPIAUCSL:   { title: "미국 CPI (도시 소비자물가)",             unit: "pt" },
  PAYEMS:     { title: "비농업고용 (NFP)",                       unit: "천명" },
  ICSA:       { title: "신규 실업수당 청구건수",                 unit: "천건" },
  RSAFS:      { title: "소매판매 (월간)",                        unit: "백만달러" },
};

type Observation = { date: string; value: string };
type FredSeriesResult = {
  title: string;
  unit: string;
  frequency: string;
  observations: Observation[];
};

async function fetchSeries(seriesId: string, limit: number, ascending = false): Promise<FredSeriesResult | null> {
  const cacheKey = `${seriesId}:${limit}:${ascending ? 1 : 0}`;
  const hit = fredCache.get(cacheKey);
  if (hit && hit.expiry > Date.now()) return hit.data;

  // Always fetch desc (newest first) so limit picks the most recent N observations.
  // For chart mode (ascending=true) we reverse AFTER slicing — never pass asc+ancient
  // observation_start because that would return data from the 1800s instead of today.
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: API_KEY,
    file_type: "json",
    sort_order: "desc",
    limit: String(limit),
    observation_start: "1776-07-04",
  });

  const res = await fetch(
    `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) return null;

  const data = (await res.json()) as {
    observations?: Observation[];
    frequency_short?: string;
    error_message?: string;
  };
  if (data.error_message) return null;

  const meta = SERIES_META[seriesId] ?? { title: seriesId, unit: "" };
  const validObs = (data.observations ?? [])
    .filter((o) => o.value !== "." && o.value !== "")
    .slice(0, limit);

  if (ascending) validObs.reverse();

  const result: FredSeriesResult = {
    title: meta.title,
    unit: meta.unit,
    frequency: data.frequency_short ?? "",
    observations: validObs,
  };
  fredCache.set(cacheKey, { data: result, expiry: Date.now() + (ascending ? FRED_TTL_CHART : FRED_TTL_DEFAULT) });
  return result;
}

export async function GET(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json({ error: "FRED_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  }

  const seriesParam = req.nextUrl.searchParams.get("series")?.trim() ?? "";
  const seriesIds = seriesParam ? seriesParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : DEFAULT_SERIES;
  const isChart = req.nextUrl.searchParams.get("chart") === "true";
  const maxLimit = isChart ? 730 : 20;
  const defaultLimit = isChart ? 730 : 5;
  const limit = Math.min(maxLimit, parseInt(req.nextUrl.searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit);

  try {
    const results = await Promise.all(seriesIds.map((id) => fetchSeries(id, limit, isChart)));
    const data: Record<string, FredSeriesResult> = {};
    for (let i = 0; i < seriesIds.length; i++) {
      if (results[i]) data[seriesIds[i]] = results[i]!;
    }
    return NextResponse.json({ data, generatedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "FRED 조회 중 오류" },
      { status: 500 },
    );
  }
}
