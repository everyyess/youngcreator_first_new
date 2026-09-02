"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// ── 공통 관측 타입 ────────────────────────────────────────────────────────────

type Obs = { time: string; value: string };

// ── 지수 (Yahoo Finance) 시리즈 ───────────────────────────────────────────────

const IDX_SERIES = [
  { id: "^KS11",    label: "KOSPI",             color: "#005B52", unit: "pt" },
  { id: "^KQ11",    label: "KOSDAQ",            color: "#1B5E20", unit: "pt" },
  { id: "^IXIC",    label: "NASDAQ",            color: "#1565C0", unit: "pt" },
  { id: "NQ=F",     label: "NASDAQ 선물",       color: "#1976D2", unit: "pt" },
  { id: "^GSPC",    label: "S&P500",            color: "#6A1B9A", unit: "pt" },
  { id: "ES=F",     label: "S&P500 선물",       color: "#8E24AA", unit: "pt" },
  { id: "RTY=F",    label: "러셀 2000 선물",    color: "#AD1457", unit: "pt" },
  { id: "^DJI",     label: "다우존스",          color: "#C62828", unit: "pt" },
  { id: "^SOX",     label: "필라델피아 반도체", color: "#E65100", unit: "pt" },
  { id: "DX-Y.NYB", label: "달러 인덱스",       color: "#00695C", unit: "pt" },
  { id: "^VIX",     label: "VIX",               color: "#37474F", unit: "pt" },
] as const;

type IdxSeriesId = (typeof IDX_SERIES)[number]["id"];

/** /api/ta-ohlcv 응답에서 추려 캐시하는 지수 데이터 */
type IdxEntry = {
  chartData: { date: string; value: number }[];
  current: number | null;
  changePercent: number | null;
};

type OhlcvResponse = {
  dates: string[];
  prices: number[];
  currentPrice: number;
  prevClose: number;
};

// ── US (FRED) 시리즈 ──────────────────────────────────────────────────────────

type FredObs = { date: string; value: string };
type FredSeriesResult = { title: string; unit: string; observations: FredObs[] };
type FredResponse = { data: Record<string, FredSeriesResult> };

const US_SERIES = [
  { id: "DGS10",      label: "미 10년 국채금리",      color: "#005B52", unit: "%" },
  { id: "DGS2",       label: "미 2년 국채금리",       color: "#1B5E20", unit: "%" },
  { id: "FEDFUNDS",   label: "미국 기준금리",         color: "#2E7D32", unit: "%" },
  { id: "T10Y2Y",     label: "장단기 스프레드",       color: "#558B2F", unit: "%" },
  { id: "DEXKOUS",    label: "원/달러 환율",          color: "#1565C0", unit: "KRW" },
  { id: "DEXJPUS",    label: "엔/달러 환율",          color: "#1976D2", unit: "JPY" },
  { id: "VIXCLS",     label: "VIX 공포지수",         color: "#6A1B9A", unit: "pt" },
  { id: "PCEPI",      label: "PCE 물가지수",         color: "#AD1457", unit: "pt" },
  { id: "CPIAUCSL",   label: "미국 CPI",             color: "#C62828", unit: "pt" },
  { id: "UNRATE",     label: "미국 실업률",           color: "#00695C", unit: "%" },
  { id: "PAYEMS",     label: "비농업고용 (NFP)",      color: "#00838F", unit: "천명" },
  { id: "ICSA",       label: "신규 실업수당 청구",    color: "#37474F", unit: "천건" },
  { id: "DCOILWTICO", label: "WTI 유가",             color: "#E65100", unit: "USD" },
  { id: "RSAFS",      label: "소매판매",             color: "#F57F17", unit: "백만$" },
] as const;

type UsSeriesId = (typeof US_SERIES)[number]["id"];

// ── KR 시리즈 (ECOS + KOSIS 통합) ────────────────────────────────────────────

type EcosSource  = { source: "ECOS";  statCode: string; cycle: string; itemCode?: string };
type KosisSource = { source: "KOSIS"; orgId: string; tblId: string; objL1: string; itmId: string; prdSe: string };
type KredSource  = { source: "KRED" };

type KrSeriesConfig = {
  id: string;
  label: string;
  color: string;
  unit: string;
  timeCycle: string;
} & (EcosSource | KosisSource | KredSource);

const KR_SERIES: KrSeriesConfig[] = [
  // ── 금리 (일별) ───────────────────────────────────────────────────────────
  { id: "kr:722Y001:D",   label: "기준금리",           color: "#005B52", unit: "%",        timeCycle: "D",
    source: "ECOS", statCode: "722Y001", cycle: "D", itemCode: "0101000" },
  { id: "kr:817Y002:3Y",  label: "국고채 3년",         color: "#1B5E20", unit: "%",        timeCycle: "D",
    source: "ECOS", statCode: "817Y002", cycle: "D", itemCode: "010200000" },
  { id: "kr:817Y002:10Y", label: "국고채 10년",        color: "#558B2F", unit: "%",        timeCycle: "D",
    source: "ECOS", statCode: "817Y002", cycle: "D", itemCode: "010210000" },
  // ── 환율/주식 (일별) ─────────────────────────────────────────────────────
  { id: "kr:731Y001",     label: "원/달러 환율",       color: "#1565C0", unit: "KRW",      timeCycle: "D",
    source: "ECOS", statCode: "731Y001", cycle: "D", itemCode: "0000001" },
  { id: "kr:802Y001",     label: "KOSPI",             color: "#6A1B9A", unit: "pt",       timeCycle: "D",
    source: "ECOS", statCode: "802Y001", cycle: "D", itemCode: "0001000" },
  { id: "kr:KRVKOSPI",    label: "코스피 변동지수",   color: "#7C3AED", unit: "%",        timeCycle: "D",
    source: "KRED" },
  // ── 물가 ──────────────────────────────────────────────────────────────────
  { id: "kr:901Y009",     label: "소비자물가 (CPI)",   color: "#C62828", unit: "2020=100", timeCycle: "M",
    source: "ECOS", statCode: "901Y009", cycle: "M", itemCode: "0" },
  { id: "kr:404Y014",     label: "생산자물가 (PPI)",   color: "#E65100", unit: "2020=100", timeCycle: "M",
    source: "ECOS", statCode: "404Y014", cycle: "M", itemCode: "*AA" },
  // ── 고용 ──────────────────────────────────────────────────────────────────
  { id: "kr:901Y027:UR",  label: "실업률",             color: "#00695C", unit: "%",        timeCycle: "M",
    source: "ECOS", statCode: "901Y027", cycle: "M", itemCode: "I61BC" },
  { id: "kr:901Y027:ER",  label: "고용률",             color: "#00838F", unit: "%",        timeCycle: "M",
    source: "ECOS", statCode: "901Y027", cycle: "M", itemCode: "I61E" },
  // ── 무역 ──────────────────────────────────────────────────────────────────
  { id: "kr:901Y118:EX",  label: "수출금액",           color: "#37474F", unit: "천불",     timeCycle: "M",
    source: "ECOS", statCode: "901Y118", cycle: "M", itemCode: "T002" },
  { id: "kr:901Y118:IM",  label: "수입금액",           color: "#546E7A", unit: "천불",     timeCycle: "M",
    source: "ECOS", statCode: "901Y118", cycle: "M", itemCode: "T004" },
  // ── 경기 ──────────────────────────────────────────────────────────────────
  { id: "kr:901Y067",     label: "선행지수순환변동치", color: "#AD1457", unit: "2020=100", timeCycle: "M",
    source: "ECOS", statCode: "901Y067", cycle: "M", itemCode: "I16E" },
];

function buildKrUrl(s: KrSeriesConfig): string {
  if (s.source === "ECOS") {
    const p = new URLSearchParams({ statCode: s.statCode, cycle: s.cycle, chart: "true" });
    if (s.itemCode) p.set("itemCode", s.itemCode);
    return `/api/market/ecos?${p.toString()}`;
  }
  if (s.source === "KOSIS") return `/api/market/kosis?${new URLSearchParams({
    orgId: s.orgId, tblId: s.tblId, objL1: s.objL1, itmId: s.itmId, prdSe: s.prdSe, chart: "true",
  }).toString()}`;
  return "/api/market/vkospi";
}

/** ECOS/KOSIS TIME → X축 레이블 */
function formatTime(time: string, cycle: string): string {
  if ((cycle === "D" || cycle === "W") && time.length === 8)
    return `${time.slice(0, 4)}.${time.slice(4, 6)}.${time.slice(6, 8)}`;
  if (cycle === "M" && time.length === 6)
    return `${time.slice(0, 4)}.${time.slice(4, 6)}`;
  return time;
}

/** 관측 기준일 레이블 — FRED(YYYY-MM-DD) / ECOS(YYYYMM·YYYYMMDD) 공용 */
function formatObsDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.replace(/-/g, ".");
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}.${raw.slice(4, 6)}.${raw.slice(6, 8)}`;
  if (/^\d{6}$/.test(raw)) return `${raw.slice(0, 4)}.${raw.slice(4, 6)}`;
  return raw;
}

// ── 공통 차트 패널 ─────────────────────────────────────────────────────────────

interface ChartPanelProps {
  label: string; unit: string; color: string; decimals: number;
  chartData: { date: string; value: number }[];
  loading: boolean; error: string | null;
}

function ChartPanel({ label, unit, color, decimals, chartData, loading, error }: ChartPanelProps) {
  const values = chartData.map((d) => d.value).filter(isFinite);
  const yMin = values.length ? Math.floor(Math.min(...values) * 0.97 * 100) / 100 : undefined;
  const yMax = values.length ? Math.ceil(Math.max(...values) * 1.03 * 100) / 100 : undefined;

  if (loading) {
    return (
      <div className="flex h-56 items-center justify-center gap-2 text-xs text-[#7A9488]">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        불러오는 중
      </div>
    );
  }

  return (
    <>
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-xs text-red-600">{error}</p>}
      {!error && chartData.length === 0 && (
        <p className="py-8 text-center text-xs text-[#7A9488]">데이터 없음</p>
      )}
      {chartData.length > 0 && (
        <div className="h-56">
          <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF4F1" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#7A9488" }}
                tickLine={false}
                interval={Math.max(0, Math.floor(chartData.length / 6) - 1)}
              />
              <YAxis
                domain={[yMin ?? "auto", yMax ?? "auto"]}
                tick={{ fontSize: 10, fill: "#7A9488" }}
                tickLine={false}
                axisLine={false}
                width={decimals === 0 ? 58 : 48}
                tickFormatter={(v: number) => v.toFixed(decimals)}
              />
              <Tooltip
                contentStyle={{ fontSize: 11, border: "1px solid #DDE8E5", borderRadius: 8 }}
                formatter={(value) => {
                  const v = Number(value);
                  return [`${v.toLocaleString("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${unit}`, label];
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}

// ── 시리즈 탭 (가로 스크롤) ───────────────────────────────────────────────────

interface SeriesTabsProps {
  series: readonly { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}

function SeriesTabs({ series, active, onSelect }: SeriesTabsProps) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {series.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold transition ${
            active === s.id
              ? "border-blue-600 bg-blue-600 text-white"
              : "border-[#DDE8E5] text-[#5F7A70] hover:border-blue-600 hover:text-blue-700"
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

type MarketMode = "IDX" | "KR" | "US";

const MODE_LABELS: Record<MarketMode, string> = { IDX: "지수", KR: "한국", US: "미국" };

const MODE_SUBTITLES: Record<MarketMode, string> = {
  IDX: "주요 지수·선물 일별 시세 · 최근 2년 · 11개 시리즈",
  US:  "FRED 일별 데이터 · 최근 2년 · 미국 14개 시리즈",
  KR:  "한국은행 ECOS·KRED · 13개 시리즈 · 금리·환율·주가·변동성 일별 / 물가·고용·무역·경기 월별",
};

export function MacroChartViewer() {
  const [market, setMarket] = useState<MarketMode>("IDX");

  // ── 지수 (Yahoo) 상태 — 온-디맨드 캐시 ──────────────────────────────────
  const [idxCache, setIdxCache]       = useState<Record<string, IdxEntry>>({});
  const [idxLoading, setIdxLoading]   = useState(false);
  const [idxError, setIdxError]       = useState<string | null>(null);
  const [activeIdx, setActiveIdx]     = useState<IdxSeriesId>("^KS11");

  // ── US (FRED) 상태 ────────────────────────────────────────────────────────
  const [fredData, setFredData]       = useState<Record<string, FredSeriesResult>>({});
  const [fredLoading, setFredLoading] = useState(false);
  const [fredError, setFredError]     = useState<string | null>(null);
  const [activeUs, setActiveUs]       = useState<UsSeriesId>("DGS10");

  // ── KR (ECOS/KOSIS) 상태 — 온-디맨드 캐시 ──────────────────────────────
  const [krCache, setKrCache]         = useState<Record<string, Obs[]>>({});
  const [krLoading, setKrLoading]     = useState(false);
  const [krError, setKrError]         = useState<string | null>(null);
  const [activeKr, setActiveKr]       = useState<string>(KR_SERIES[0].id);

  // ── 지수 단건 온-디맨드 로드 (ta-ohlcv 일봉 재사용, 최근 2년만 표시) ─────
  const loadIdx = useCallback(async (symbol: string) => {
    if (idxCache[symbol]) return;
    setIdxLoading(true);
    setIdxError(null);
    try {
      const res = await fetch(`/api/ta-ohlcv?ticker=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as OhlcvResponse;
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 2);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const chartData = (json.dates ?? [])
        .map((d, i) => ({ date: d.replace(/-/g, "."), value: json.prices?.[i] ?? 0, raw: d }))
        .filter((o) => o.raw >= cutoffStr && isFinite(o.value) && o.value > 0)
        .map(({ date, value }) => ({ date, value }));
      const current = isFinite(json.currentPrice) ? json.currentPrice : null;
      const changePercent =
        current != null && isFinite(json.prevClose) && json.prevClose > 0
          ? (current / json.prevClose - 1) * 100
          : null;
      setIdxCache((prev) => ({ ...prev, [symbol]: { chartData, current, changePercent } }));
    } catch {
      setIdxError("지수 데이터 로드 실패");
    } finally {
      setIdxLoading(false);
    }
  }, [idxCache]);

  // 지수 탭 진입 or 시리즈 변경 시 로드
  useEffect(() => {
    if (market === "IDX") void loadIdx(activeIdx);
  }, [market, activeIdx, loadIdx]);

  // ── FRED 배치 로드 (US 탭 최초 진입 시) ─────────────────────────────────
  useEffect(() => {
    if (market !== "US" || Object.keys(fredData).length > 0) return;
    const ids = US_SERIES.map((s) => s.id).join(",");
    setFredLoading(true);
    setFredError(null);
    fetch(`/api/market/fred?series=${ids}&chart=true`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json: FredResponse) => setFredData(json.data ?? {}))
      .catch(() => setFredError("FRED 데이터 로드 실패"))
      .finally(() => setFredLoading(false));
  }, [market, fredData]);

  // ── KR 단건 온-디맨드 로드 ───────────────────────────────────────────────
  const loadKr = useCallback(async (id: string) => {
    if (krCache[id]) return;
    const s = KR_SERIES.find((x) => x.id === id);
    if (!s) return;
    setKrLoading(true);
    setKrError(null);
    try {
      const res = await fetch(buildKrUrl(s));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { indicators?: Array<{ observations: Obs[] }> };
      const raw  = json.indicators?.[0]?.observations ?? [];
      // 721Y001처럼 한 기간에 복수 항목 반환되는 경우 첫 번째 값만 유지
      const seen = new Set<string>();
      const obs  = raw.filter((o) => {
        if (seen.has(o.time)) return false;
        seen.add(o.time);
        return true;
      });
      setKrCache((prev) => ({ ...prev, [id]: obs }));
    } catch {
      setKrError("데이터 로드 실패");
    } finally {
      setKrLoading(false);
    }
  }, [krCache]);

  // KR 탭 진입 or 시리즈 변경 시 로드
  useEffect(() => {
    if (market === "KR") void loadKr(activeKr);
  }, [market, activeKr, loadKr]);

  // ── 지수 차트 데이터 ───────────────────────────────────────────────────────
  const idxMeta      = IDX_SERIES.find((s) => s.id === activeIdx)!;
  const idxEntry     = idxCache[activeIdx];
  const idxChartData = idxEntry?.chartData ?? [];

  // ── US 차트 데이터 ─────────────────────────────────────────────────────────
  const usMeta      = US_SERIES.find((s) => s.id === activeUs)!;
  const usChartData = (fredData[activeUs]?.observations ?? [])
    .map((o) => ({ date: o.date.replace(/-/g, "."), value: parseFloat(o.value) }))
    .filter((o) => isFinite(o.value));

  // ── KR 차트 데이터 ─────────────────────────────────────────────────────────
  const krMeta      = KR_SERIES.find((s) => s.id === activeKr)!;
  const krChartData = (krCache[activeKr] ?? [])
    .map((o) => ({ date: formatTime(o.time, krMeta?.timeCycle ?? "M"), value: parseFloat(o.value) }))
    .filter((o) => isFinite(o.value));

  const meta =
    market === "IDX" ? { label: idxMeta.label, unit: idxMeta.unit, color: idxMeta.color } :
    market === "US"  ? { label: usMeta.label,  unit: usMeta.unit,  color: usMeta.color } :
                       { label: krMeta.label,  unit: krMeta.unit,  color: krMeta.color };
  const chartData  = market === "IDX" ? idxChartData : market === "US" ? usChartData : krChartData;
  const isLoading  = market === "IDX" ? idxLoading   : market === "US" ? fredLoading : krLoading;
  const chartError = market === "IDX" ? idxError     : market === "US" ? fredError   : krError;

  // 큰 값(지수·환율)은 정수, 그 외 소수 2자리
  const maxValue = chartData.reduce((m, d) => Math.max(m, d.value), 0);
  const decimals = meta.unit === "KRW" || maxValue >= 1000 ? 0 : 2;

  // 지수 현재가 배지 — 한국식 등락 색상 (상승 빨강 / 하락 파랑)
  const idxChangeClass =
    idxEntry?.changePercent == null ? "text-[#94A8A0]"
      : idxEntry.changePercent > 0 ? "text-red-500"
      : idxEntry.changePercent < 0 ? "text-blue-600"
      : "text-[#5F7A70]";

  // KR/US 최신값 배지 — 마지막 관측치 + 직전 관측 대비 변화
  const latest = chartData.length > 0 ? chartData[chartData.length - 1].value : null;
  const prevVal = chartData.length > 1 ? chartData[chartData.length - 2].value : null;
  const latestObsDate =
    market === "US"
      ? (fredData[activeUs]?.observations ?? []).slice(-1)[0]?.date ?? null
      : market === "KR"
        ? (krCache[activeKr] ?? []).slice(-1)[0]?.time ?? null
        : null;
  const delta = latest != null && prevVal != null ? latest - prevVal : null;
  // 금리·스프레드(%) 지표는 %p 절대 변화, 그 외는 % 상대 변화로 표기
  const changeText =
    delta == null ? null
      : meta.unit === "%" ? `${delta > 0 ? "+" : ""}${delta.toFixed(2)}%p`
      : prevVal !== 0 && prevVal != null ? `${delta > 0 ? "+" : ""}${((latest! / prevVal - 1) * 100).toFixed(2)}%`
      : null;
  const macroChangeClass =
    delta == null ? "text-[#94A8A0]"
      : delta > 0 ? "text-red-500"
      : delta < 0 ? "text-blue-600"
      : "text-[#5F7A70]";

  return (
    <div className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
      {/* 헤더 */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-[#0D2318]">글로벌 매크로 지표</h3>
          <p className="text-xs font-semibold text-[#7A9488]">{MODE_SUBTITLES[market]}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 지수/한국/미국 토글 */}
          <div className="flex rounded-lg bg-blue-50 p-1">
            {(["IDX", "KR", "US"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                  market === m
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-[#4B6358] hover:text-blue-700"
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 시리즈 탭 — 가로 스크롤 */}
      {market === "IDX" && (
        <SeriesTabs
          series={IDX_SERIES}
          active={activeIdx}
          onSelect={(id) => setActiveIdx(id as IdxSeriesId)}
        />
      )}
      {market === "US" && (
        <SeriesTabs
          series={US_SERIES}
          active={activeUs}
          onSelect={(id) => setActiveUs(id as UsSeriesId)}
        />
      )}
      {market === "KR" && (
        <SeriesTabs
          series={KR_SERIES}
          active={activeKr}
          onSelect={(id) => setActiveKr(id)}
        />
      )}

      {/* 지수 모드 — 선택 지수의 현재가·등락률 */}
      {market === "IDX" && !isLoading && idxEntry?.current != null && (
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-lg font-black tracking-tight text-[#0D2318]">
            {idxEntry.current.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {idxEntry.changePercent != null && (
            <span className={`text-xs font-black ${idxChangeClass}`}>
              {idxEntry.changePercent > 0 ? "+" : ""}{idxEntry.changePercent.toFixed(2)}%
            </span>
          )}
        </div>
      )}

      {/* 한국/미국 모드 — 선택 지표의 최신값·직전 대비 변화·기준일 */}
      {market !== "IDX" && !isLoading && latest != null && (
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-lg font-black tracking-tight text-[#0D2318]">
            {latest.toLocaleString("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
            <span className="ml-1 text-[11px] font-bold text-[#7A9488]">{meta.unit}</span>
          </span>
          {changeText != null && (
            <span className={`text-xs font-black ${macroChangeClass}`}>{changeText}</span>
          )}
          {latestObsDate != null && (
            <span className="text-[10px] font-medium text-[#AAC2BB]">{formatObsDate(latestObsDate)} 기준</span>
          )}
        </div>
      )}

      {/* 차트 */}
      <ChartPanel
        label={meta.label}
        unit={meta.unit}
        color={meta.color}
        decimals={decimals}
        chartData={chartData}
        loading={isLoading}
        error={chartError}
      />

      {chartData.length > 0 && (
        <p className="mt-2 text-right text-[10px] text-[#AAC2BB]">
          {market === "IDX"
            ? `${idxMeta.label} · ${idxMeta.unit} · Yahoo Finance 일봉`
            : market === "US"
              ? `${fredData[activeUs]?.title ?? meta.label} · ${meta.unit}`
              : `${meta.label} · ${meta.unit} · ${krMeta.source === "ECOS" ? "한국은행 ECOS" : krMeta.source === "KOSIS" ? "통계청 KOSIS" : "KRED · KRX 공식 공표 종가"}`}
        </p>
      )}
    </div>
  );
}
