"use client";

// TAB2 — Peer 분석
// 섹터 지정 시 구성 종목(Peer)들의 밸류에이션·성장·수익성·재고를 그래프로 비교한다.
//  · 섹터 특성(재고 사이클/수주·마진/성장/금융)에 따라 특화 차트와 사분면 기본 축이 달라진다
//  · 사분면: X/Y축 지표를 자유 선택, 버블 크기 = 시총, 기준선 = Peer 중앙값
//  · 데이터: /api/peer-analysis (Yahoo quoteSummary + fundamentalsTimeSeries, 6시간 캐시)
//  · 수주잔고·수주추이는 DART 정기보고서 파싱이 필요해 2차에서 지원 예정
// Peer 색상은 dataviz 기준 팔레트 8색 (검증된 고정 순서 — 순환 금지, 색은 종목에 고정)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { Info, Loader2, RefreshCw, Users } from "lucide-react";
import { DOMESTIC_SECTORS, GLOBAL_SECTORS } from "@/app/api/sector-scanner/sectorMaster";
import type { PeerAnalysisResponse, PeerMetrics } from "@/app/api/peer-analysis/route";
import { useCustomerContext } from "../maintab/CustomerContext";

// ── Peer 색상 (dataviz 기준 팔레트 — 인접쌍 CVD ΔE 24.2, 고정 순서) ─────────────
const PEER_COLORS = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];

const GRID = "#EEF4F2";
const AXIS_TICK = { fontSize: 12, fill: "#94A8A0", fontWeight: 700 } as const;
const AXIS_LINE = { stroke: "#DDE8E5" } as const;

// ── 지표 레지스트리 (사분면 축 선택지) ──────────────────────────────────────────
type MetricKey =
  | "revenueGrowthYoY" | "revenueGrowthQoQ" | "epsGrowthFwd"
  | "operatingMargin" | "roe" | "dividendYield" | "inventoryQoQ"
  | "per" | "forwardPer" | "pbr" | "psr" | "pegRatio";

const METRICS: { key: MetricKey; label: string; unit: "%" | "배" }[] = [
  { key: "revenueGrowthYoY", label: "매출 성장 YoY", unit: "%" },
  { key: "revenueGrowthQoQ", label: "매출 성장 QoQ", unit: "%" },
  { key: "epsGrowthFwd", label: "EPS 성장(컨센서스)", unit: "%" },
  { key: "operatingMargin", label: "영업이익률", unit: "%" },
  { key: "roe", label: "ROE", unit: "%" },
  { key: "dividendYield", label: "배당수익률", unit: "%" },
  { key: "inventoryQoQ", label: "재고 증감 QoQ", unit: "%" },
  { key: "per", label: "PER", unit: "배" },
  { key: "forwardPer", label: "선행 PER", unit: "배" },
  { key: "pbr", label: "PBR", unit: "배" },
  { key: "psr", label: "PSR", unit: "배" },
  { key: "pegRatio", label: "PEG", unit: "배" },
];
const metricOf = (key: MetricKey) => METRICS.find((m) => m.key === key)!;

// ── 섹터 특화 프리셋 ───────────────────────────────────────────────────────────
// focus: 특화 추이 차트 종류 / quadX·quadY: 사분면 기본 축
type FocusKind = "inventory" | "margin" | "growth" | "financial";

const FOCUS_META: Record<FocusKind, { title: string; desc: string }> = {
  inventory: { title: "재고 사이클", desc: "분기 재고 ÷ 분기 매출 (%) — 재고 소진/축적 국면 비교" },
  margin: { title: "수익성 사이클", desc: "연간 영업이익률 (%) — 수주·사이클 업종의 마진 개선 추이 (수주잔고는 2차 지원 예정)" },
  growth: { title: "매출 성장 궤적", desc: "분기 매출 지수 (첫 분기 = 100) — 성장 기울기 비교" },
  financial: { title: "자본 효율·주주환원", desc: "ROE와 배당수익률 — 금융업 핵심 비교 축" },
};

const SECTOR_PRESETS: Record<string, { focus: FocusKind; quadX: MetricKey; quadY: MetricKey }> = {
  // 재고 사이클 업종
  semiconductor: { focus: "inventory", quadX: "inventoryQoQ", quadY: "operatingMargin" },
  techhardware: { focus: "inventory", quadX: "inventoryQoQ", quadY: "revenueGrowthYoY" },
  battery: { focus: "inventory", quadX: "inventoryQoQ", quadY: "revenueGrowthYoY" },
  // 수주·사이클 업종 (마진 추이 중심)
  ship: { focus: "margin", quadX: "revenueGrowthYoY", quadY: "pbr" },
  defense: { focus: "margin", quadX: "revenueGrowthYoY", quadY: "per" },
  machinery: { focus: "margin", quadX: "revenueGrowthYoY", quadY: "per" },
  electric: { focus: "margin", quadX: "revenueGrowthYoY", quadY: "per" },
  construction: { focus: "margin", quadX: "revenueGrowthYoY", quadY: "pbr" },
  capitalgoods: { focus: "margin", quadX: "revenueGrowthYoY", quadY: "per" },
  chemical: { focus: "margin", quadX: "revenueGrowthYoY", quadY: "pbr" },
  steel: { focus: "margin", quadX: "revenueGrowthYoY", quadY: "pbr" },
  materials: { focus: "margin", quadX: "revenueGrowthYoY", quadY: "pbr" },
  energy: { focus: "margin", quadX: "operatingMargin", quadY: "pbr" },
  auto: { focus: "margin", quadX: "revenueGrowthYoY", quadY: "per" },
  transport: { focus: "margin", quadX: "operatingMargin", quadY: "pbr" },
  utilities: { focus: "margin", quadX: "operatingMargin", quadY: "pbr" },
  telecom: { focus: "financial", quadX: "dividendYield", quadY: "per" },
  // 성장 업종 (PSR·성장 중심)
  bio: { focus: "growth", quadX: "revenueGrowthYoY", quadY: "psr" },
  pharma: { focus: "growth", quadX: "revenueGrowthYoY", quadY: "psr" },
  medical: { focus: "growth", quadX: "revenueGrowthYoY", quadY: "psr" },
  healthequip: { focus: "growth", quadX: "revenueGrowthYoY", quadY: "psr" },
  internet: { focus: "growth", quadX: "revenueGrowthYoY", quadY: "psr" },
  game: { focus: "growth", quadX: "revenueGrowthYoY", quadY: "psr" },
  software: { focus: "growth", quadX: "revenueGrowthYoY", quadY: "psr" },
  media: { focus: "growth", quadX: "revenueGrowthYoY", quadY: "psr" },
  entertainment: { focus: "growth", quadX: "revenueGrowthYoY", quadY: "psr" },
  // 금융 (PBR–ROE)
  finance: { focus: "financial", quadX: "roe", quadY: "pbr" },
  banks: { focus: "financial", quadX: "roe", quadY: "pbr" },
  securities: { focus: "financial", quadX: "roe", quadY: "pbr" },
  insurance: { focus: "financial", quadX: "roe", quadY: "pbr" },
  finservices: { focus: "financial", quadX: "roe", quadY: "pbr" },
  holdings: { focus: "financial", quadX: "roe", quadY: "pbr" },
};
const DEFAULT_PRESET = { focus: "growth" as FocusKind, quadX: "revenueGrowthYoY" as MetricKey, quadY: "per" as MetricKey };

// ── 포맷터 ────────────────────────────────────────────────────────────────────
function fmtMarketCap(v: number | null, currency: string | null): string {
  if (v == null || v <= 0) return "-";
  if (currency === "KRW") {
    if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
    return `${Math.round(v / 1e8).toLocaleString("ko-KR")}억`;
  }
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  return `$${Math.round(v / 1e6).toLocaleString("ko-KR")}M`;
}

function fmtMetric(v: number | null | undefined, unit: "%" | "배", digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return unit === "%" ? `${v > 0 ? "+" : ""}${v.toFixed(digits)}%` : `${v.toFixed(1)}배`;
}

function fmtPlain(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? "-" : v.toFixed(digits);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 국내 섹터엔 야후 영문명이 오는 경우가 있어 sectorMaster의 한글명 우선 */
function displayName(p: PeerMetrics, krNames: Map<string, string>): string {
  return krNames.get(p.symbol) ?? p.name;
}

// ── 커스텀 툴팁 ───────────────────────────────────────────────────────────────
type TipPayload = { name?: string | number; value?: number | (number | null)[]; color?: string; fill?: string; dataKey?: string | number };

function ChartTip({ active, label, payload, unit }: { active?: boolean; label?: string; payload?: TipPayload[]; unit?: "%" | "배" }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#DDE8E5] bg-white px-3 py-2 shadow-popup">
      {label != null && <p className="mb-1 text-[12px] font-black text-[#94A8A0]">{label}</p>}
      <div className="flex flex-col gap-0.5">
        {payload.filter((p) => !Array.isArray(p.value) && p.value != null).map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.fill }} />
            <span className="text-[13px] font-bold text-[#33493F]">{p.name}</span>
            <span className="ml-auto pl-3 text-[13px] font-black tabular-nums text-[#0D2318]">
              {fmtMetric(p.value as number, unit ?? "%")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type QuadDatum = { name: string; x: number; y: number; z: number; color: string };

function QuadTip({ active, payload, xM, yM }: {
  active?: boolean; payload?: Array<{ payload?: QuadDatum }>;
  xM: { label: string; unit: "%" | "배" }; yM: { label: string; unit: "%" | "배" };
}) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div className="rounded-lg border border-[#DDE8E5] bg-white px-3 py-2 shadow-popup">
      <p className="mb-1 flex items-center gap-1.5 text-[13px] font-black text-[#0D2318]">
        <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />{d.name}
      </p>
      <p className="text-[13px] font-bold text-[#33493F]">{xM.label}: <span className="font-black">{fmtMetric(d.x, xM.unit)}</span></p>
      <p className="text-[13px] font-bold text-[#33493F]">{yM.label}: <span className="font-black">{fmtMetric(d.y, yM.unit)}</span></p>
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
type Market = "domestic" | "global";

export default function PeerAnalysisTab() {
  useCustomerContext();

  const [market, setMarket] = useState<Market>("domestic");
  const [sectorId, setSectorId] = useState<string>("");
  const [data, setData] = useState<PeerAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [bandMetric, setBandMetric] = useState<"per" | "pbr">("per");
  const [quadX, setQuadX] = useState<MetricKey>(DEFAULT_PRESET.quadX);
  const [quadY, setQuadY] = useState<MetricKey>(DEFAULT_PRESET.quadY);

  const cacheRef = useRef<Map<string, PeerAnalysisResponse>>(new Map());
  const seqRef = useRef(0);

  const sectors = market === "domestic" ? DOMESTIC_SECTORS : GLOBAL_SECTORS;
  const preset = SECTOR_PRESETS[sectorId] ?? DEFAULT_PRESET;

  // 섹터 마스터의 종목명 (국내는 한글명 우선 표시)
  const krNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sectors) for (const sym of s.symbols) m.set(sym.symbol, sym.name);
    return m;
  }, [sectors]);

  const load = useCallback(async (mkt: Market, sec: string, force = false) => {
    const key = `${mkt}:${sec}`;
    const seq = ++seqRef.current;
    if (!force && cacheRef.current.has(key)) {
      setData(cacheRef.current.get(key)!);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/peer-analysis?market=${mkt}&sector=${encodeURIComponent(sec)}`);
      const body = (await res.json()) as PeerAnalysisResponse & { error?: string };
      if (seq !== seqRef.current) return;
      if (!res.ok || body.error) throw new Error(body.error ?? `조회 실패 (${res.status})`);
      cacheRef.current.set(key, body);
      setData(body);
    } catch (e) {
      if (seq === seqRef.current) setError(e instanceof Error ? e.message : "조회 중 오류가 발생했습니다.");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sectorId) return;
    void load(market, sectorId);
  }, [market, sectorId, load]);

  // 섹터 변경 시: 프리셋 축 적용 + 제외 목록 초기화
  const selectSector = (mkt: Market, sec: string) => {
    setMarket(mkt);
    setSectorId(sec);
    setExcluded(new Set());
    if (!sec) {
      setData(null);
      return;
    }
    const p = SECTOR_PRESETS[sec] ?? DEFAULT_PRESET;
    setQuadX(p.quadX);
    setQuadY(p.quadY);
    setBandMetric(p.focus === "financial" || p.quadY === "pbr" ? "pbr" : "per");
  };

  // Peer 색상은 응답 순서(섹터 마스터 순서)에 고정 — 제외 토글로 바뀌지 않음
  const allPeers = useMemo(
    () => (data?.peers ?? []).map((p, i) => ({ ...p, color: PEER_COLORS[i % PEER_COLORS.length], label: displayName(p, krNames) })),
    [data, krNames],
  );
  const peers = allPeers.filter((p) => !excluded.has(p.symbol) && !p.error);
  const failedPeers = allPeers.filter((p) => p.error);

  const togglePeer = (symbol: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else if (peers.length > 2) next.add(symbol); // 최소 2개 유지
      return next;
    });
  };

  // ── 차트 데이터 ─────────────────────────────────────────────────────────────
  // 1) 성장률 그룹바: X = 지표, 시리즈 = Peer
  const growthData = useMemo(() => {
    const rows: { metric: string; [k: string]: string | number | null }[] = [
      { metric: "매출 YoY" }, { metric: "매출 QoQ" }, { metric: "EPS 성장" },
    ];
    for (const p of peers) {
      rows[0][p.label] = p.revenueGrowthYoY;
      rows[1][p.label] = p.revenueGrowthQoQ;
      rows[2][p.label] = p.epsGrowthFwd;
    }
    return rows;
  }, [peers]);

  // 2) 밸류에이션 52주 밴드
  const bandData = useMemo(() => peers.map((p) => {
    const low = bandMetric === "per" ? p.perLow52 : p.pbrLow52;
    const high = bandMetric === "per" ? p.perHigh52 : p.pbrHigh52;
    const cur = bandMetric === "per" ? p.per : p.pbr;
    return { name: p.label, band: low != null && high != null ? [low, high] : null, cur, color: p.color };
  }), [peers, bandMetric]);

  // 3) 섹터 특화 추이
  const focusData = useMemo(() => {
    if (preset.focus === "financial") {
      return peers.map((p) => ({ name: p.label, roe: p.roe, dividendYield: p.dividendYield }));
    }
    if (preset.focus === "margin") {
      const years = [...new Set(peers.flatMap((p) => p.annuals.map((a) => a.year)))].sort();
      return years.map((year) => {
        const row: Record<string, string | number | null> = { x: year };
        for (const p of peers) row[p.label] = p.annuals.find((a) => a.year === year)?.operatingMargin ?? null;
        return row;
      });
    }
    const dates = [...new Set(peers.flatMap((p) => p.quarters.map((q) => q.date)))].sort();
    if (preset.focus === "inventory") {
      return dates.map((date) => {
        const row: Record<string, string | number | null> = { x: date.slice(2, 7) };
        for (const p of peers) {
          const q = p.quarters.find((qq) => qq.date === date);
          row[p.label] = q && q.inventory != null && q.revenue != null && q.revenue > 0
            ? (q.inventory / q.revenue) * 100 : null;
        }
        return row;
      });
    }
    // growth: 분기 매출 지수화 (각 Peer의 첫 유효 분기 = 100)
    const bases = new Map<string, number>();
    for (const p of peers) {
      const first = p.quarters.find((q) => q.revenue != null && q.revenue > 0);
      if (first?.revenue) bases.set(p.symbol, first.revenue);
    }
    return dates.map((date) => {
      const row: Record<string, string | number | null> = { x: date.slice(2, 7) };
      for (const p of peers) {
        const q = p.quarters.find((qq) => qq.date === date);
        const b = bases.get(p.symbol);
        row[p.label] = q?.revenue != null && b ? (q.revenue / b) * 100 : null;
      }
      return row;
    });
  }, [peers, preset.focus]);

  // 4) 사분면
  const xM = metricOf(quadX);
  const yM = metricOf(quadY);
  const quadData: QuadDatum[] = useMemo(() => peers.flatMap((p) => {
    const x = p[quadX];
    const y = p[quadY];
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [{ name: p.label, x, y, z: Math.sqrt(Math.max(p.marketCap ?? 1, 1)), color: p.color }];
  }), [peers, quadX, quadY]);
  const quadMissing = peers.filter((p) => p[quadX] == null || p[quadY] == null);
  const medX = quadData.length ? median(quadData.map((d) => d.x)) : 0;
  const medY = quadData.length ? median(quadData.map((d) => d.y)) : 0;

  const sectorName = data?.sectorName ?? sectors.find((s) => s.id === sectorId)?.name ?? "";
  const currency = peers[0]?.currency ?? null;

  // 요약 테이블 컬럼
  const TABLE_COLS: { label: string; render: (p: PeerMetrics) => string; cls?: (p: PeerMetrics) => string }[] = [
    { label: "시총", render: (p) => fmtMarketCap(p.marketCap, p.currency) },
    { label: "PER", render: (p) => fmtPlain(p.per) },
    { label: "PBR", render: (p) => fmtPlain(p.pbr, 2) },
    { label: "PSR", render: (p) => fmtPlain(p.psr) },
    { label: "ROE", render: (p) => fmtMetric(p.roe, "%") },
    { label: "영업이익률", render: (p) => fmtMetric(p.operatingMargin, "%") },
    {
      label: "매출 YoY", render: (p) => fmtMetric(p.revenueGrowthYoY, "%"),
      cls: (p) => (p.revenueGrowthYoY ?? 0) > 0 ? "text-red-600" : (p.revenueGrowthYoY ?? 0) < 0 ? "text-blue-600" : "",
    },
    {
      label: "EPS 성장", render: (p) => fmtMetric(p.epsGrowthFwd, "%"),
      cls: (p) => (p.epsGrowthFwd ?? 0) > 0 ? "text-red-600" : (p.epsGrowthFwd ?? 0) < 0 ? "text-blue-600" : "",
    },
    { label: "배당", render: (p) => fmtMetric(p.dividendYield, "%") },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* ── 상단 정보/선택 헤더 (종목 분석 스타일 적용) ─────────────────── */}
      <section className="rounded-card border border-[#DDE8E5] bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white">
              <Users size={22} />
            </span>
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-[#0D2318]">
                경쟁사 분석
                {sectorId && (
                  <span className="rounded-full bg-primary/10 px-2 py-[4px] text-[10px] font-black text-primary animate-pulse leading-none">
                    {market === "domestic" ? "국내" : "해외"} &middot; {sectorName}
                  </span>
                )}
              </h2>
              <p className="text-xs font-semibold text-[#7A9488]">
                섹터를 지정하면 경쟁사(Peer)들의 밸류에이션, 성장, 수익성, 재고 순환을 다각도로 종합 비교합니다
              </p>
            </div>
          </div>

          {/* 우측 컨트롤 영역 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-btn bg-[#F0F5F4] p-1">
              {(["domestic", "global"] as Market[]).map((m) => (
                <button key={m} type="button"
                  onClick={() => {
                    if (sectorId) {
                      selectSector(m, (m === "domestic" ? DOMESTIC_SECTORS : GLOBAL_SECTORS)[0].id);
                    } else {
                      setMarket(m);
                    }
                  }}
                  className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${market === m ? "bg-primary text-white shadow-soft" : "text-[#4B6358] hover:text-primary"}`}>
                  {m === "domestic" ? "국내" : "해외"}
                </button>
              ))}
            </div>
            <select
              value={sectorId}
              onChange={(e) => selectSector(market, e.target.value)}
              className="rounded-btn border border-[#DDE8E5] bg-white px-3 py-2 text-sm font-bold text-[#0D2318] focus:border-primary focus:outline-none"
            >
              <option value="">섹터 선택</option>
              {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" onClick={() => void load(market, sectorId, true)} disabled={loading || !sectorId}
              className="flex items-center gap-1.5 rounded-btn border border-[#DDE8E5] bg-white px-3 py-2 text-sm font-bold text-[#4B6358] transition hover:border-primary hover:text-primary disabled:opacity-50">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> 새로고침
            </button>
          </div>
        </div>
      </section>

      {error && <p className="rounded-btn border border-red-200 bg-red-50 px-4 py-2.5 text-base font-semibold text-red-600">{error}</p>}

      {!sectorId ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-[#DDE8E5] bg-white py-16 shadow-sm">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EBF5F3] text-primary">
            <Users size={24} />
          </span>
          <div className="text-center">
            <p className="text-sm font-bold text-[#0D2318]">비교할 섹터를 선택해주세요</p>
            <p className="text-xs font-semibold text-[#7A9488] mt-1">
              우측 상단의 드롭다운 메뉴에서 특정 섹터를 선택하시면 경쟁사(Peer) 분석 정보가 로드됩니다.
            </p>
          </div>
        </div>
      ) : loading && !data ? (
        <div className="rounded-card border border-dashed border-[#CBE3DE] bg-[#F9FCFB] px-4 py-16 text-center">
          <p className="text-base font-black text-[#33493F]"><Loader2 size={15} className="mr-1.5 inline animate-spin" /> {sectorName} Peer 재무 데이터 수집 중…</p>
          <p className="mt-1 text-sm font-bold text-[#94A8A0]">종목당 분기·연간 재무를 조회합니다 (첫 조회는 10~30초, 이후 6시간 캐시)</p>
        </div>
      ) : data && (
        <>
          {/* Peer 칩 (클릭 = 비교에서 제외/포함) */}
          <div className="flex flex-wrap items-center gap-1.5">
            {allPeers.map((p) => {
              const off = excluded.has(p.symbol) || !!p.error;
              return (
                <button key={p.symbol} type="button" onClick={() => !p.error && togglePeer(p.symbol)} disabled={!!p.error}
                  title={p.error ? `수집 실패: ${p.error}` : off ? "비교에 포함" : "비교에서 제외"}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-black transition ${
                    off ? "border-[#E4EEEB] bg-[#F6FAF8] text-[#B9CCC4]" : "border-[#DDE8E5] bg-white text-[#1C3329] hover:border-primary/50"
                  }`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: off ? "#CBD9D4" : p.color }} />
                  {p.label}
                  {p.error && <span className="text-[11px]">수집실패</span>}
                </button>
              );
            })}
            <span className="ml-1 text-[12px] font-bold text-[#94A8A0]">칩 클릭 = 비교 제외/포함 (최소 2개)</span>
            {loading && <Loader2 size={12} className="animate-spin text-[#94A8A0]" />}
          </div>

          {/* 요약 테이블 */}
          <section className="overflow-x-auto rounded-card border border-[#DDE8E5] bg-white shadow-card">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-[#F0F7F4] text-[12px] font-black text-[#94A8A0]">
                  <th className="px-3 py-2">종목</th>
                  {TABLE_COLS.map((c) => <th key={c.label} className="px-3 py-2 text-right">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {peers.map((p) => (
                  <tr key={p.symbol} className="border-b border-[#F6FAF8] last:border-0 hover:bg-[#FAFCFB]">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 text-sm font-black text-[#0D2318]">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
                        {p.label}
                        <span className="text-[11px] font-bold text-[#B9CCC4]">{p.symbol}</span>
                      </span>
                    </td>
                    {TABLE_COLS.map((c) => (
                      <td key={c.label} className={`px-3 py-2 text-right text-sm font-bold tabular-nums text-[#33493F] ${c.cls?.(p) ?? ""}`}>
                        {c.render(p)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* 성장률 비교 */}
            <section className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
              <p className="mb-2 text-[15px] font-black tracking-tight text-[#0D2318]">성장률 비교 <span className="text-[12px] font-bold text-[#94A8A0]">단위 %</span></p>
              <div className="h-[260px]">
                <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                  <BarChart data={growthData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="metric" tick={AXIS_TICK} tickLine={false} axisLine={AXIS_LINE} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip unit="%" />} cursor={{ fill: "rgba(0,91,82,0.06)" }} />
                    <ReferenceLine y={0} stroke="#C3CFCA" />
                    {peers.map((p) => (
                      <Bar key={p.symbol} dataKey={p.label} fill={p.color} maxBarSize={18} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* 밸류에이션 52주 밴드 */}
            <section className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[15px] font-black tracking-tight text-[#0D2318]">
                  {bandMetric.toUpperCase()} 52주 밴드
                  <span className="ml-1.5 text-[12px] font-bold text-[#94A8A0]">52주 주가 고저 × 현재 지표 근사 · ● = 현재</span>
                </p>
                <div className="flex rounded-btn bg-[#F0F5F4] p-0.5">
                  {(["per", "pbr"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setBandMetric(m)}
                      className={`rounded-md px-2.5 py-1 text-[13px] font-black transition ${bandMetric === m ? "bg-primary text-white" : "text-[#4B6358]"}`}>
                      {m.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                  <ComposedChart data={bandData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={AXIS_LINE} interval={0} angle={-20} textAnchor="end" height={44} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip unit="배" />} cursor={{ fill: "rgba(0,91,82,0.06)" }} />
                    <Bar dataKey="band" fill="#DCE9E5" maxBarSize={16} radius={4} isAnimationActive={false} name="52주 밴드" />
                    <Scatter dataKey="cur" isAnimationActive={false} name="현재">
                      {bandData.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Scatter>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {/* 섹터 특화 추이 */}
            <section className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
              <p className="mb-0.5 text-[15px] font-black tracking-tight text-[#0D2318]">{FOCUS_META[preset.focus].title}</p>
              <p className="mb-2 text-[12px] font-bold text-[#94A8A0]">{FOCUS_META[preset.focus].desc}</p>
              <div className="h-[250px]">
                <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                  {preset.focus === "financial" ? (
                    <BarChart data={focusData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={AXIS_LINE} interval={0} angle={-20} textAnchor="end" height={44} />
                      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTip unit="%" />} cursor={{ fill: "rgba(0,91,82,0.06)" }} />
                      <Bar dataKey="roe" name="ROE" fill={PEER_COLORS[0]} maxBarSize={16} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="dividendYield" name="배당수익률" fill={PEER_COLORS[1]} maxBarSize={16} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  ) : (
                    <LineChart data={focusData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={GRID} />
                      <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={AXIS_LINE} />
                      <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} domain={preset.focus === "growth" ? ["auto", "auto"] : undefined} />
                      <Tooltip content={<ChartTip unit="%" />} cursor={{ stroke: "#B9CCC4", strokeDasharray: "3 3" }} />
                      {preset.focus === "growth" && <ReferenceLine y={100} stroke="#C3CFCA" strokeDasharray="4 4" />}
                      {peers.map((p) => (
                        <Line key={p.symbol} dataKey={p.label} name={p.label} stroke={p.color} strokeWidth={2}
                          dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
                      ))}
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
              {preset.focus === "financial" && (
                <p className="mt-1.5 flex items-center gap-1 text-[12px] font-bold text-[#94A8A0]"><Info size={11} /> ROE·배당수익률 (단위 %) — 막대 색은 지표 구분</p>
              )}
              {preset.focus === "growth" && (
                <p className="mt-1.5 flex items-center gap-1 text-[12px] font-bold text-[#94A8A0]"><Info size={11} /> 통화가 달라도 비교되도록 각 Peer의 첫 분기를 100으로 지수화</p>
              )}
            </section>

            {/* 사분면 */}
            <section className="rounded-card border border-[#DDE8E5] bg-white p-4 shadow-card">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] font-black tracking-tight text-[#0D2318]">Peer 사분면 <span className="text-[12px] font-bold text-[#94A8A0]">버블 = 시총 · 기준선 = 중앙값</span></p>
                <div className="flex items-center gap-1.5 text-[12px] font-black text-[#94A8A0]">
                  X
                  <select value={quadX} onChange={(e) => setQuadX(e.target.value as MetricKey)}
                    className="rounded-md border border-[#DDE8E5] bg-white px-1.5 py-1 text-[13px] font-bold text-[#0D2318] focus:border-primary focus:outline-none">
                    {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                  Y
                  <select value={quadY} onChange={(e) => setQuadY(e.target.value as MetricKey)}
                    className="rounded-md border border-[#DDE8E5] bg-white px-1.5 py-1 text-[13px] font-bold text-[#0D2318] focus:border-primary focus:outline-none">
                    {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="relative h-[250px]">
                <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                  <ScatterChart margin={{ top: 14, right: 20, left: -6, bottom: 4 }}>
                    <CartesianGrid stroke={GRID} />
                    <XAxis type="number" dataKey="x" name={xM.label} tick={AXIS_TICK} tickLine={false} axisLine={AXIS_LINE}
                      domain={["auto", "auto"]} label={{ value: `${xM.label} (${xM.unit})`, position: "insideBottom", offset: -2, fontSize: 12, fontWeight: 800, fill: "#7A9488" }} />
                    <YAxis type="number" dataKey="y" name={yM.label} tick={AXIS_TICK} tickLine={false} axisLine={false}
                      domain={["auto", "auto"]} label={{ value: `${yM.label} (${yM.unit})`, angle: -90, position: "insideLeft", offset: 16, fontSize: 12, fontWeight: 800, fill: "#7A9488" }} />
                    <ZAxis type="number" dataKey="z" range={[120, 900]} />
                    <Tooltip content={<QuadTip xM={xM} yM={yM} />} cursor={{ strokeDasharray: "3 3", stroke: "#B9CCC4" }} />
                    {quadData.length > 0 && <ReferenceLine x={medX} stroke="#B9CCC4" strokeDasharray="4 4" />}
                    {quadData.length > 0 && <ReferenceLine y={medY} stroke="#B9CCC4" strokeDasharray="4 4" />}
                    <Scatter data={quadData} isAnimationActive={false}>
                      {quadData.map((d) => <Cell key={d.name} fill={d.color} fillOpacity={0.75} stroke="#fff" strokeWidth={2} />)}
                      <LabelList dataKey="name" position="top" style={{ fontSize: 12, fontWeight: 800, fill: "#33493F" }} />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1.5 flex items-center gap-1 text-[12px] font-bold text-[#94A8A0]">
                <Info size={11} />
                우하단 = {xM.label} 높음 · {yM.label} 낮음{yM.unit === "배" ? " (저평가 후보)" : ""} · 좌상단 = 그 반대
                {quadMissing.length > 0 && ` · 데이터 없음: ${quadMissing.map((p) => p.label).join(", ")}`}
              </p>
            </section>
          </div>

          {failedPeers.length > 0 && (
            <p className="text-[13px] font-bold text-[#94A8A0]">
              수집 실패 종목: {failedPeers.map((p) => `${p.label} (${p.error})`).join(" · ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
