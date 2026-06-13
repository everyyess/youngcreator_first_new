"use client";

import { useEffect, useState } from "react";
import type React from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  GitCompare,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type { PortfolioAnalysisResult, PortfolioAsset } from "./CustomerContext";

// ─── Constants ───────────────────────────────────────────────────────────────

export const CLASS_COLORS: Record<string, string> = {
  국내주식:    "#3B82F6",
  해외주식:    "#10B981",
  국내채권:    "#F59E0B",
  해외채권:    "#EF4444",
  금:          "#F97316",  // 대안자산 / 원자재
  리츠:        "#8B5CF6",  // 부동산 / 대안자산
  현금:        "#64748B",
  달러:        "#06B6D4",  // 현금성자산 / 외환
  암호화폐:    "#EC4899",  // 초고위험 대안자산
};

// 도넛 차트용 표시 레이블 (내부 asset_class → 사용자 표시명)
export const CLASS_DISPLAY_LABELS: Record<string, string> = {
  국내주식: "국내주식",
  해외주식: "해외주식",
  국내채권: "국내채권",
  해외채권: "해외채권",
  금:       "금·원자재",
  리츠:     "리츠·부동산",
  현금:     "현금성자산",
  달러:     "외화·현금",
  암호화폐: "암호화폐",
};

const ASSET_CLASS_ALIAS: Record<string, string> = {
  // 기존 별칭
  원자재: "금", 골드: "금", gold: "금", 귀금속: "금",
  외화: "달러", usd: "달러", 달러화: "달러",
  부동산: "리츠", 리츠etf: "리츠", reits: "리츠",
  해외채권etf: "해외채권", 미국채: "해외채권", 달러채권: "해외채권",
  // 신규 통합 상품유형 → 내부 asset_class 정규화
  국내etf: "국내주식", 해외etf: "해외주식",
  "예적금/현금": "현금", 예적금: "현금",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function fmt(n: number, decimals = 2) { return n.toFixed(decimals); }
export function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%`; }
/**
 * 원화 금액을 PB/VVIP 한국어 표기로 변환
 *   < 1억            → "X만 원"          (예: 500만 원)
 *   ≥ 1억, 만 단위 없음 → "X억 원"         (예: 3억 원)
 *   ≥ 1억, 만 단위 있음 → "X억 Y,ZZZ만 원" (예: 1억 2,500만 원)
 *   0               → "0원"
 */
export function formatKrwAmount(won: number): string {
  if (won === 0) return "0원";
  const abs = Math.abs(won);
  const sign = won < 0 ? "-" : "";

  if (abs < 1e8) {
    const manFloat = abs / 1e4;
    if (manFloat >= 1) return `${sign}${Math.round(manFloat).toLocaleString()}만 원`;
    return `${sign}${Math.round(abs).toLocaleString()}원`;
  }

  const eok = Math.floor(abs / 1e8);
  const man = Math.round((abs - eok * 1e8) / 1e4);
  return man > 0
    ? `${sign}${eok}억 ${man.toLocaleString()}만 원`
    : `${sign}${eok}억 원`;
}

// 기존 호출부 호환성 유지 — 내부적으로 formatKrwAmount 에 위임
export function fmtWon(n: number) { return formatKrwAmount(n); }
export function fmtStressAmount(n: number) { return formatKrwAmount(Math.abs(n)); }
export function normalizeAssetClass(cls: string): string {
  return ASSET_CLASS_ALIAS[cls] ?? ASSET_CLASS_ALIAS[cls.toLowerCase()] ?? cls;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePortfolioResult(): PortfolioAnalysisResult | null {
  const [result, setResult] = useState<PortfolioAnalysisResult | null>(null);

  useEffect(() => {
    const load = () => {
      try {
        const stored = localStorage.getItem("portfolio-result-v1");
        setResult(stored ? JSON.parse(stored) : null);
      } catch {
        setResult(null);
      }
    };
    load();
    window.addEventListener("portfolio-result-updated", load);
    return () => window.removeEventListener("portfolio-result-updated", load);
  }, []);

  return result;
}

// ─── Layout Primitives ───────────────────────────────────────────────────────

export function ResultCard({
  icon, title, accent, children,
}: {
  icon?: React.ReactNode;
  title: string;
  accent: "blue" | "green" | "gold" | "red" | "orange" | "slate";
  children: React.ReactNode;
}) {
  const accentMap = {
    blue: "text-samsung bg-blue-50",
    green: "text-mint bg-emerald-50",
    gold: "text-gold bg-amber-50",
    red: "text-red-700 bg-red-50",
    orange: "text-orange-700 bg-orange-50",
    slate: "text-slate-700 bg-slate-100",
  };
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-3">
        {icon && (
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accentMap[accent]}`}>
            {icon}
          </div>
        )}
        <h3 className="text-base font-bold text-navy">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function MetricWithNote({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-500">{label}</span>
        <span className="text-sm font-bold text-navy">{value}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{note}</p>
    </div>
  );
}

export function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-slate-50 px-3 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="text-lg font-black text-navy leading-none">{value}</span>
      {sub && <span className="text-[10px] leading-snug text-slate-400">{sub}</span>}
    </div>
  );
}

export function PieChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  );
}

// ─── Holding Performance Table ───────────────────────────────────────────────

export function HoldingPerformanceTable({ assets }: { assets: PortfolioAsset[] }) {
  const rows = assets.filter((a) => a.name);
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            {["종목명", "자산군", "현재가", "매수단가", "평가금액", "수익률", "평가손익"].map((h) => (
              <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((a, i) => {
            const cp: number | null = typeof a.current_price === "number" && a.current_price > 0 ? a.current_price : null;
            const bp: number | null = typeof a.buy_price === "number" && a.buy_price > 0 ? a.buy_price : null;
            const qty = a.amount;
            const totalCost: number | null = a.amount_type === "value" ? qty : bp !== null ? qty * bp : null;
            const totalCurrentValue: number | null = cp === null ? null : a.amount_type === "quantity" ? qty * cp : bp !== null ? (qty / bp) * cp : null;
            const displayValue: number | null = totalCurrentValue !== null
              ? totalCurrentValue
              : a.amount_type === "value"
                ? (typeof a.current_value === "number" ? a.current_value : typeof a.amount === "number" ? a.amount : null)
                : null;
            const gainPct: number | null = cp !== null && bp !== null ? ((cp - bp) / bp) * 100 : null;
            const gainAmt: number | null = totalCurrentValue !== null && totalCost !== null ? totalCurrentValue - totalCost : null;
            const isPos = gainAmt !== null && gainAmt > 0;
            const isNeg = gainAmt !== null && gainAmt < 0;
            return (
              <tr key={i} className="bg-white hover:bg-slate-50">
                <td className="px-3 py-2.5 font-semibold text-navy whitespace-nowrap">{a.name}</td>
                <td className="px-3 py-2.5">
                  <span className="rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{ backgroundColor: (CLASS_COLORS[a.asset_class] ?? "#94a3b8") + "22", color: CLASS_COLORS[a.asset_class] ?? "#64748b" }}>
                    {a.asset_class}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right text-xs font-semibold text-slate-700">
                  {cp !== null ? fmtWon(cp) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-xs text-slate-500">
                  {bp !== null ? fmtWon(bp) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-xs font-semibold text-navy">
                  {displayValue !== null ? fmtWon(displayValue) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-xs font-bold">
                  {gainPct !== null ? (
                    <span className={isPos ? "text-emerald-600" : isNeg ? "text-red-600" : "text-slate-400"}>
                      {gainPct >= 0 ? "+" : ""}{gainPct.toFixed(2)}%
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-xs font-bold">
                  {gainAmt !== null ? (
                    <span className={isPos ? "text-emerald-600" : isNeg ? "text-red-600" : "text-slate-400"}>
                      {gainAmt >= 0 ? "+" : ""}{fmtWon(gainAmt)}
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Donut Chart ─────────────────────────────────────────────────────────────

export function DonutChart({ assets }: { assets: PortfolioAsset[] }) {
  const [hoveredCls, setHoveredCls] = useState<string | null>(null);
  const getAssetValue = (a: PortfolioAsset): number => {
    if (a.current_value != null && a.current_value > 0) return a.current_value;
    if (a.amount_type === 'quantity' && a.buy_price != null && a.buy_price > 0 && a.amount > 0)
      return a.buy_price * a.amount;
    return a.amount ?? 0;
  };
  const totalValue = assets.reduce((s, a) => s + getAssetValue(a), 0);
  const byClass: Record<string, number> = {};
  for (const a of assets) {
    const value = getAssetValue(a);
    if (!Number.isFinite(value) || value <= 0) continue;
    const pct = totalValue > 0 ? (value / totalValue) * 100 : (a.weight ?? 0) * 100;
    if (!Number.isFinite(pct) || pct <= 0) continue;
    const cls = normalizeAssetClass(a.asset_class ?? a.productType ?? "기타");
    byClass[cls] = (byClass[cls] ?? 0) + pct;
  }
  const segments = Object.entries(byClass).filter(([, pct]) => pct > 0.5).sort(([, a], [, b]) => b - a);
  const r = 15.9155;
  let cumulative = 0;
  const hovered = hoveredCls ? (segments.find(([cls]) => cls === hoveredCls) ?? null) : null;
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative h-56 w-56">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90" style={{ overflow: "visible" }} onMouseLeave={() => setHoveredCls(null)}>
          <circle cx="18" cy="18" r={r} fill="none" stroke="#f1f5f9" strokeWidth="3.5" />
          {segments.map(([cls, pct], i) => {
            const offset = -cumulative;
            const dash = `${pct.toFixed(2)} ${(100 - pct).toFixed(2)}`;
            cumulative += pct;
            return (
              <circle key={i} cx="18" cy="18" r={r} fill="none"
                stroke={CLASS_COLORS[cls] ?? "#94a3b8"}
                strokeWidth={hoveredCls === cls ? "5" : "3.5"}
                strokeDasharray={dash} strokeDashoffset={offset}
                style={{ pointerEvents: "stroke", cursor: "pointer", transition: "stroke-width 0.15s" }}
                onMouseEnter={() => setHoveredCls(cls)}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {hovered ? (
            <div className="text-center leading-tight">
              <p className="text-sm font-bold text-navy">{CLASS_DISPLAY_LABELS[hovered[0]] ?? hovered[0]}</p>
              <p className="text-base font-bold text-samsung">{hovered[1].toFixed(1)}%</p>
            </div>
          ) : <p className="text-sm text-slate-400">자산군별 비중</p>}
        </div>
      </div>
      {/* 범례 */}
      <div className="grid w-full max-w-sm grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-semibold">
        {segments.map(([cls, pct]) => (
          <div key={cls} className={`flex items-center gap-1.5 cursor-default rounded px-1.5 py-1 transition-colors ${hoveredCls === cls ? "bg-slate-100" : ""}`}
            onMouseEnter={() => setHoveredCls(cls)} onMouseLeave={() => setHoveredCls(null)}>
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: CLASS_COLORS[cls] ?? "#94a3b8" }} />
            <span className="truncate text-slate-600">{CLASS_DISPLAY_LABELS[cls] ?? cls}</span>
            <span className="ml-auto shrink-0 font-bold text-navy">{pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Correlation Heatmap ─────────────────────────────────────────────────────

export function CorrelationHeatmap({ matrix, labels }: { matrix: number[][]; labels: string[] }) {
  if (!matrix.length || !labels.length) return null;

  const n = labels.length;
  // 자산 수에 따라 폰트·패딩을 동적 축소 (잘림 없이 전체 레이블 표시)
  const isCompact = n >= 6;
  const isTiny    = n >= 9;
  const labelFont  = isTiny ? "text-[9px]"  : isCompact ? "text-[10px]" : "text-xs";
  const headerPad  = isTiny ? "p-0.5"       : isCompact ? "p-1"         : "p-2.5";
  const cellPad    = isTiny ? "p-0.5"       : isCompact ? "p-1.5"       : "p-3";
  const valueFont  = isTiny ? "text-[9px]"  : isCompact ? "text-[10px]" : "text-xs";

  function cellStyles(val: number): { bg: string; text: string } {
    if (val >= 0.7)  return { bg: "bg-red-500",     text: "text-white font-bold" };
    if (val >= 0.3)  return { bg: "bg-orange-400",  text: "text-slate-900 font-semibold" };
    if (val > -0.3)  return { bg: "bg-slate-100",   text: "text-slate-800" };
                     return { bg: "bg-emerald-500", text: "text-white font-bold" };
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto w-full">
        <table className="border-separate" style={{ borderSpacing: "2px" }}>
          <thead>
            <tr>
              {/* 좌상단 빈 셀 */}
              <th className={`bg-slate-200 ${headerPad} rounded-sm`} />
              {labels.map((l, i) => (
                <th
                  key={i}
                  className={`bg-slate-200 ${headerPad} text-center align-bottom text-slate-700 font-bold rounded-sm ${labelFont} leading-tight break-words`}
                  style={{ maxWidth: isCompact ? "4rem" : "6rem", wordBreak: "break-word" }}
                >
                  {l || '자산'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, ri) => (
              <tr key={ri}>
                <td
                  className={`bg-slate-200 ${headerPad} text-center align-middle text-slate-700 font-bold rounded-sm ${labelFont} leading-tight break-words`}
                  style={{ maxWidth: isCompact ? "4rem" : "6rem", wordBreak: "break-word" }}
                >
                  {labels[ri] || '자산'}
                </td>
                {row.map((val, ci) => {
                  const { bg, text } = cellStyles(val);
                  return (
                    <td key={ci} className={`${cellPad} text-center align-middle rounded-sm select-none ${bg} ${text} ${valueFont}`}>
                      {val.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-4 text-xs font-semibold">
        {[
          { color: "bg-red-500",     label: "0.7 이상 · 고상관 (리스크 쏠림)" },
          { color: "bg-orange-400",  label: "0.3 ~ 0.7 · 중상관 (동조화 주의)" },
          { color: "bg-slate-100 border border-slate-300", label: "|r| < 0.3 · 저상관" },
          { color: "bg-emerald-500", label: "−0.3 미만 · 역상관 (최우수 헷지)" },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`h-3.5 w-3.5 rounded-sm shrink-0 ${color}`} />
            <span className="text-slate-600">{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Stress Test ─────────────────────────────────────────────────────────────

export function StressScenarioBar({
  scenario,
}: {
  scenario: { label: string; lossRate: number; lossAmount: number; details: { name: string; contribution: number }[] };
}) {
  const details = scenario.details.slice(0, 8);
  const maxContrib = Math.max(...details.map((d) => Math.abs(d.contribution)), 0.001);
  const CHART_DOMAIN = Math.max(maxContrib, 0.50);
  const isGain = scenario.lossRate >= 0;
  const ratePct = Math.abs(scenario.lossRate * 100).toFixed(1);

  // CSS transition duration — 내부 스타일로 고정해 Tailwind 클래스 파싱 순서에 독립
  const BAR_TRANSITION = "width 0.35s ease";

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-bold text-slate-700">{scenario.label}</span>
        <span className={`text-sm font-bold ${isGain ? "text-emerald-600" : "text-red-600"}`}>
          {isGain ? "예상 이익" : "예상 손실"} {ratePct}% ({fmtStressAmount(scenario.lossAmount)})
        </span>
      </div>
      <div className="grid grid-cols-[96px_1fr_2px_1fr_52px] items-center gap-x-1 text-[10px] font-bold text-slate-400 select-none">
        <span /><span className="text-right pr-1">← 손실</span><span /><span className="text-left pl-1">수익 →</span><span />
      </div>
      <div className="space-y-1.5">
        {details.map((d) => {
          const barPct = Math.min((Math.abs(d.contribution) / CHART_DOMAIN) * 100, 100);
          const isNeg = d.contribution < 0;
          const isPos = d.contribution > 0;
          const valColor = isPos ? "text-emerald-600" : isNeg ? "text-red-500" : "text-slate-400";
          const sign = isPos ? "+" : "";
          return (
            // key = 자산명 고정: 시나리오 전환 시 순서가 바뀌어도 동일 DOM 노드를 재사용
            <div key={d.name} className="grid grid-cols-[96px_1fr_2px_1fr_52px] items-center gap-x-1 text-xs">
              <span className="truncate font-semibold text-slate-700" title={d.name}>{d.name}</span>

              {/* 손실 바 — 항상 DOM에 존재, width=0으로 수렴하여 unmount 없이 트랜지션 유지 */}
              <div className="flex h-5 items-center justify-end overflow-hidden">
                <div
                  className="h-3 rounded-l-sm"
                  style={{
                    width: isNeg ? `${barPct}%` : "0%",
                    backgroundColor: "#ef4444",
                    transition: BAR_TRANSITION,
                  }}
                />
              </div>

              <div className="h-5 w-0.5 rounded-full bg-slate-300 mx-auto" />

              {/* 수익 바 — 항상 DOM에 존재, width=0으로 수렴 */}
              <div className="flex h-5 items-center justify-start overflow-hidden">
                <div
                  className="h-3 rounded-r-sm"
                  style={{
                    width: isPos ? `${barPct}%` : "0%",
                    backgroundColor: "#22c55e",
                    transition: BAR_TRANSITION,
                  }}
                />
              </div>

              <span className={`text-right font-bold ${valColor}`}>
                {sign}{(d.contribution * 100).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export function HealthBadge({ badge, badgeKo, totalScore }: { badge: string; badgeKo: string; totalScore: number }) {
  const styles: Record<string, string> = {
    Hold: "bg-emerald-100 text-emerald-800 border-emerald-200",
    Rebalance: "bg-amber-100 text-amber-800 border-amber-200",
    Sell: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <div className="flex items-center gap-3">
      <span className={`rounded-lg border px-4 py-2 text-lg font-bold ${styles[badge] ?? styles.Rebalance}`}>{badge}</span>
      <div>
        <p className="text-sm font-bold text-navy">{badgeKo}</p>
        <p className="text-xs text-slate-500">{totalScore}/14점</p>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function HealthSummaryBox({ healthResult }: { healthResult: any }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = healthResult.items ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const problemItems = items.filter((it: any) => it.score === 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cautionItems = items.filter((it: any) => it.score === 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const penaltyItems = items.filter((it: any) => it.penalty);
  const score: number = healthResult.totalScore ?? 0;
  const badge: string = healthResult.badge ?? "Rebalance";

  const arcLen = Math.PI * 75;
  const filled = arcLen * (score / 14);
  const gaugeColor =
    badge === "Hold" ? "#10b981" :
    badge === "Sell" ? "#ef4444" :
                       "#f59e0b";

  const actionText = penaltyItems.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? `${penaltyItems.map((i: any) => i.label).join(", ")} – 즉시 분산 조정 필요.`
    : problemItems.length ? "위 문제 항목에 대한 즉각적인 리밸런싱을 권고합니다."
    : cautionItems.length ? "위 주의 항목을 점검하고 점진적 조정을 검토하세요."
    : "현재 포트폴리오를 유지하며 정기 점검을 진행하세요.";

  return (
    <div className="rounded-xl border border-slate-100 bg-white p-5">
      <div className="flex flex-col items-center">
        <svg width="190" height="108" viewBox="0 0 190 108" className="overflow-visible">
          <path
            d="M 20 100 A 75 75 0 0 1 170 100"
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d="M 20 100 A 75 75 0 0 1 170 100"
            fill="none"
            stroke={gaugeColor}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${arcLen + 20}`}
          />
          <text x="95" y="85" textAnchor="middle" fontSize="28" fontWeight="900" fill={gaugeColor}>
            {score}
          </text>
          <text x="95" y="103" textAnchor="middle" fontSize="11" fontWeight="700" fill="#94a3b8">
            / 14점
          </text>
        </svg>
        <p className="mt-1 text-sm font-bold" style={{ color: gaugeColor }}>
          {(healthResult.badgeKo as string)?.split(" – ")[0] ?? badge}
        </p>
      </div>
      <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold leading-relaxed text-slate-600">
        {actionText}
      </p>
    </div>
  );
}

// ─── Empty Data Prompt ────────────────────────────────────────────────────────

export function EmptyDataPrompt({ message }: { message?: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center px-6">
      <WalletCards size={32} className="text-slate-300" />
      <p className="text-sm font-semibold text-slate-400">
        {message ?? "자산을 입력하고 분석 실행을 눌러주세요."}
      </p>
    </div>
  );
}

// ─── New Portfolio Placeholder ────────────────────────────────────────────────

export function NewPortfolioPlaceholder() {
  return (
    <div className="flex min-h-[480px] flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-200 text-slate-400">
        <GitCompare size={28} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-bold text-slate-600">신규 포트폴리오 비교 영역</p>
        <p className="text-xs font-semibold leading-relaxed text-slate-400">
          신규 포트폴리오를 생성하면<br />이 영역에 비교 분석이 표시됩니다.
        </p>
      </div>
    </div>
  );
}

// ─── Portfolio Issue Banner ───────────────────────────────────────────────────
//
// 파싱 전략:
//   • healthResult.items 배열 → 구조화된 문제/주의 항목 칩 렌더링 (배열 직접 사용)
//   • healthResult.summary 문자열 → 정규식으로 AI 코멘터리 슬라이싱
//       패턴 A: "주의 항목: ..." 마침표 이후 남은 문자열 전체
//       패턴 B: "[집중 리스크 경고]..." 형태의 대괄호 시작 액션 텍스트 (fallback)
//   • stressResult.diagnosis → 스트레스 진단 문구 (별도 라인)
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAiCommentary(summary: string): string {
  if (!summary) return "";
  // 패턴 A: "주의 항목: ..." 문장 뒤의 잔여 텍스트
  const afterCaution = summary.match(/주의 항목:[^.]+\.\s+(.+)$/);
  if (afterCaution?.[1]) return afterCaution[1].trim();
  // 패턴 B: "[...경고] ..." 형식의 액션 문장 fallback
  const bracketAction = summary.match(/(\[.+?].+)$/);
  if (bracketAction?.[1]) return bracketAction[1].trim();
  return "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function PortfolioIssueBanner({ healthResult, stressResult }: { healthResult: any; stressResult?: any }) {
  if (!healthResult) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { badge, badgeKo = "", totalScore, items = [] as any[] } = healthResult;

  // badgeKo: "매도/재구성 권고 (Sell) – 포트폴리오 전면 재검토가 필요합니다."
  const dashIdx = (badgeKo as string).indexOf(" – ");
  const gradeLabel   = dashIdx >= 0 ? badgeKo.slice(0, dashIdx).trim() : badgeKo;
  const actionMessage = dashIdx >= 0 ? badgeKo.slice(dashIdx + 3).trim() : "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const problemItems = (items as any[]).filter((it: any) => it.score === 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cautionItems = (items as any[]).filter((it: any) => it.score === 1);

  const aiCommentary   = extractAiCommentary(healthResult.summary ?? "");
  const stressDiagnosis: string = stressResult?.diagnosis ?? "";

  const BADGE: Record<string, { card: string; header: string; chip: string; score: string }> = {
    Sell:      { card: "border-red-200",    header: "bg-red-50 border-red-100",     chip: "bg-red-100 text-red-800 border-red-300",    score: "text-red-700"     },
    Rebalance: { card: "border-amber-200",  header: "bg-amber-50 border-amber-100", chip: "bg-amber-100 text-amber-800 border-amber-300", score: "text-amber-700" },
    Hold:      { card: "border-emerald-200",header: "bg-emerald-50 border-emerald-100", chip: "bg-emerald-100 text-emerald-800 border-emerald-300", score: "text-emerald-700" },
  };
  const bs = BADGE[badge as string] ?? BADGE.Rebalance;

  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-soft ${bs.card}`}>

      {/* ── 헤더: 타이틀 + 등급 뱃지 ── */}
      <div className={`flex items-center justify-between gap-3 border-b px-5 py-3 ${bs.header}`}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0 text-red-500" />
          <span className="text-xs font-extrabold uppercase tracking-widest text-red-600">
            포트폴리오 핵심 이슈
          </span>
        </div>
        <span className={`whitespace-nowrap rounded-full border px-3 py-0.5 text-xs font-bold ${bs.chip}`}>
          {gradeLabel}
        </span>
      </div>

      <div className="space-y-4 p-5">

        {/* ── 1단: 스코어링 ── */}
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3">
          <BarChart3 size={20} className={`shrink-0 ${bs.score}`} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-black ${bs.score}`}>{totalScore}</span>
              <span className="text-sm font-semibold text-slate-500">/ 14점</span>
            </div>
            {actionMessage && (
              <p className="mt-0.5 text-xs font-semibold leading-snug text-slate-600">{actionMessage}</p>
            )}
          </div>
        </div>

        {/* ── 2단: 리스크 항목 칩 ── */}
        {(problemItems.length > 0 || cautionItems.length > 0) && (
          <div className="space-y-3">
            {problemItems.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-bold text-red-600">❌ 위험 항목</p>
                <div className="flex flex-wrap gap-1.5">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {problemItems.map((it: any) => (
                    <span
                      key={it.key}
                      title={it.detail}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        it.penalty
                          ? "border-red-300 bg-red-100 text-red-800"
                          : "border-red-200 bg-red-50 text-red-700"
                      }`}
                    >
                      {it.penalty ? "🔴" : "•"} {it.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {cautionItems.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-bold text-amber-600">⚠️ 주의 항목</p>
                <div className="flex flex-wrap gap-1.5">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {cautionItems.map((it: any) => (
                    <span
                      key={it.key}
                      title={it.detail}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800"
                    >
                      • {it.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 3단: AI 리밸런싱 제언 ── */}
        {(aiCommentary || stressDiagnosis) && (
          <div className="space-y-1.5 rounded-lg bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
              AI 리밸런싱 제언
            </p>
            {aiCommentary && (
              <p className="text-xs font-semibold leading-relaxed text-slate-700">{aiCommentary}</p>
            )}
            {stressDiagnosis && (
              <p className="border-t border-slate-200 pt-1.5 text-xs leading-relaxed text-slate-500">
                {stressDiagnosis}
              </p>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Section: Holding & Diagnosis (Tab2-Sub1 결과 영역) ──────────────────────

export function HoldingAndDiagnosisSection({ data }: { data: PortfolioAnalysisResult }) {
  const enrichedAssets: PortfolioAsset[] = Array.isArray(data.enrichedAssets)
    ? (data.enrichedAssets as PortfolioAsset[])
    : [];
  const { portfolioIssueSummary, healthResult, stressResult } = data as typeof data & { stressResult?: unknown };

  return (
    <div className="space-y-5">
      {portfolioIssueSummary && healthResult && (
        <PortfolioIssueBanner healthResult={healthResult} stressResult={stressResult} />
      )}

      <ResultCard icon={<WalletCards size={18} />} title="보유 자산 성과 (현재가 · 수익률)" accent="slate">
        <HoldingPerformanceTable assets={enrichedAssets} />
        {!enrichedAssets.filter((a) => a.name).length && (
          <p className="text-sm text-slate-400">표시할 자산이 없습니다.</p>
        )}
      </ResultCard>

      {healthResult && (
        <ResultCard icon={<Activity size={18} />} title="포트폴리오 건강 진단" accent="blue">
          <div className="space-y-4">
            <HealthBadge badge={healthResult.badge} badgeKo={healthResult.badgeKo} totalScore={healthResult.totalScore} />
            <div className="grid gap-1.5">
              {healthResult.items?.map(
                (item: { key: string; label: string; score: number; grade: string; detail: string; penalty?: boolean }, i: number) => (
                  <div key={i} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
                    <span className="shrink-0 pt-0.5 font-semibold text-slate-700">{item.label}</span>
                    <div className="flex min-w-0 flex-col items-end text-right">
                      <span className={`font-bold ${item.score === 2 ? "text-emerald-700" : item.score === 1 ? "text-amber-700" : "text-red-700"}`}>
                        {item.score} / 2점
                      </span>
                      <span className="mt-0.5 leading-relaxed text-slate-500">{item.detail}</span>
                    </div>
                  </div>
                )
              )}
            </div>
            {healthResult.summary && <HealthSummaryBox healthResult={healthResult} />}
          </div>
        </ResultCard>
      )}
    </div>
  );
}

// ─── Section: Distribution & Risk (Tab2-Sub2) ────────────────────────────────

export function DistributionAndRiskSection({ data }: { data: PortfolioAnalysisResult }) {
  const [selectedScenario, setSelectedScenario] = useState(0);
  const enrichedAssets: PortfolioAsset[] = Array.isArray(data.enrichedAssets)
    ? (data.enrichedAssets as PortfolioAsset[])
    : [];
  const { quantResult, stressResult, tlhResult } = data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ResultCard icon={<PieChartIcon />} title="자산군별 비중 분포" accent="slate">
          <DonutChart assets={enrichedAssets} />
        </ResultCard>

        <ResultCard icon={<Activity size={18} />} title="자산 간 상관관계 히트맵" accent="slate">
          {quantResult?.risk?.correlationHeatmap?.matrix?.length ? (
            <CorrelationHeatmap matrix={quantResult.risk.correlationHeatmap.matrix} labels={quantResult.risk.correlationHeatmap.labels} />
          ) : (
            <p className="text-sm text-slate-400">자산이 2개 이상일 때 표시됩니다.</p>
          )}
        </ResultCard>
      </div>

      {quantResult && (
        <div className="grid gap-5">
          <ResultCard icon={<TrendingUp size={18} />} title="성과 및 효율성" accent="green">
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="세후 기대수익률" value={fmtPct(quantResult.performance.afterTaxExpectedReturn)} sub="세후 연환산 기대수익" />
              <MetricCard label="샤프 비율" value={fmt(quantResult.performance.sharpeRatio)} sub="위험 단위당 초과수익" />
              <MetricCard label="소르티노 비율" value={fmt(quantResult.performance.sortinoRatio)} sub="하방 리스크 대비 방어력" />
              <MetricCard label="젠센 알파" value={fmtPct(quantResult.performance.jensensAlpha)} sub="시장 초과 순수 알파" />
            </div>
          </ResultCard>

          <ResultCard icon={<Activity size={18} />} title="리스크 및 하방 손실" accent="orange">
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="연환산 변동성" value={fmtPct(quantResult.risk.volatility)} sub="연간 가격 흔들림 폭" />
              <MetricCard label="최대 낙폭(MDD)" value={fmtPct(Math.abs(quantResult.risk.mdd))} sub="최고점 대비 최악 하락률" />
              <MetricCard label="95% VaR" value={fmtWon(quantResult.risk.var95)} sub="월간 최대 손실 가능액" />
              <MetricCard label="분산화 점수" value={fmt(quantResult.risk.diversificationScore)} sub="1에 가까울수록 동조화 강함" />
            </div>
            {quantResult.sensitivity.hhiWarning && (
              <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800">
                집중도 경고: {quantResult.sensitivity.hhiWarningAssets?.join(", ")}
              </p>
            )}
          </ResultCard>

          <ResultCard icon={<BarChart3 size={18} />} title="민감도 및 쏠림" accent="blue">
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="시장 베타" value={fmt(quantResult.sensitivity.beta)} sub="시장 1% 변동 시 반응" />
              <MetricCard label="HHI 집중도" value={fmt(quantResult.sensitivity.hhi, 4)} sub="높을수록 특정 종목 쏠림" />
              <MetricCard label="해외주식 양도세" value={fmtWon(quantResult.tax.foreignStock?.tax ?? 0)} sub="예상 양도소득세" />
              <MetricCard label="금융소득종합과세" value={quantResult.tax.financialIncome?.warning ? "해당" : "비해당"} sub="금융소득 종합과세 여부" />
            </div>
          </ResultCard>
        </div>
      )}

      {stressResult && (
        <ResultCard icon={<AlertTriangle size={18} />} title="스트레스 테스트 – 4대 위기 시나리오" accent="red">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {(["scenario1", "scenario2", "scenario3", "scenario4"] as const).map((key, idx) => {
                const sc = stressResult[key];
                return (
                  <button key={key} type="button" onClick={() => setSelectedScenario(idx)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs font-bold transition ${
                      selectedScenario === idx ? "border-red-300 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}>
                    <span className="block">{sc?.label ?? `시나리오 ${idx + 1}`}</span>
                    <span className={`block text-xs ${selectedScenario === idx ? "text-red-600" : "text-slate-400"}`}>
                      {sc ? `${(sc.lossRate * 100).toFixed(1)}%` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            {(() => {
              const keys = ["scenario1", "scenario2", "scenario3", "scenario4"];
              const sc = stressResult[keys[selectedScenario]];
              if (!sc) return null;
              return <StressScenarioBar scenario={sc} />;
            })()}
            {stressResult.riskTypes?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {stressResult.riskTypes.map((rt: string) => (
                  <span key={rt} className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-800">{rt}</span>
                ))}
              </div>
            )}
          </div>
        </ResultCard>
      )}

      {tlhResult && (tlhResult.priority1?.length > 0 || tlhResult.priority2?.length > 0) && (
        <ResultCard icon={<ShieldCheck size={18} />} title="세금 손실 수확(TLH) 권고안" accent="green">
          <div className="space-y-3">
            {tlhResult.priority1?.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold text-samsung">우선순위 1 – 종합과세 방어</p>
                <div className="space-y-1.5">
                  {tlhResult.priority1.map((r: { name: string; reason: string; taxSaving: number }, i: number) => (
                    <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs">
                      <div><span className="font-bold text-navy">{r.name}</span><span className="ml-2 text-slate-500">{r.reason}</span></div>
                      <span className="shrink-0 font-bold text-samsung">절세 {fmtWon(r.taxSaving)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tlhResult.priority2?.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-bold text-emerald-700">우선순위 2 – 양도세 절감</p>
                <div className="space-y-1.5">
                  {tlhResult.priority2.map((r: { name: string; reason: string; taxSaving: number }, i: number) => (
                    <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs">
                      <div><span className="font-bold text-navy">{r.name}</span><span className="ml-2 text-slate-500">{r.reason}</span></div>
                      <span className="shrink-0 font-bold text-emerald-700">절세 {fmtWon(r.taxSaving)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tlhResult.summary && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{tlhResult.summary}</p>
            )}
          </div>
        </ResultCard>
      )}
    </div>
  );
}

// ─── Comparison Left Column (Tab4 용) ─────────────────────────────────────────

export function ComparisonLeftColumn({ data, afterAssets }: { data: PortfolioAnalysisResult | null; afterAssets?: React.ReactNode }) {
  if (!data) {
    return (
      <div className="flex min-h-[480px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center px-6">
        <WalletCards size={32} className="text-slate-300" />
        <p className="text-sm font-semibold text-slate-400">
          2번 탭에서 자산을 입력하고 분석 실행을 눌러주세요.
        </p>
      </div>
    );
  }

  const enrichedAssets: PortfolioAsset[] = Array.isArray(data.enrichedAssets)
    ? (data.enrichedAssets as PortfolioAsset[])
    : [];
  const { portfolioIssueSummary, quantResult, healthResult } = data;
  const stressResult = (data as typeof data & { stressResult?: unknown }).stressResult;

  return (
    <div className="space-y-5">
      {/* 1. 포트폴리오 핵심 이슈 */}
      {portfolioIssueSummary && healthResult && (
        <PortfolioIssueBanner healthResult={healthResult} stressResult={stressResult} />
      )}

      {/* 2. 자산군별 비중 분포 도넛 차트 */}
      <ResultCard icon={<PieChartIcon />} title="자산군별 비중 분포" accent="slate">
        <DonutChart assets={enrichedAssets} />
      </ResultCard>

      {afterAssets}

      {/* 4. 핵심 지표 요약 */}
      {quantResult && (
        <ResultCard icon={<TrendingUp size={18} />} title="핵심 지표 요약" accent="green">
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="세후 기대수익률" value={fmtPct(quantResult.performance.afterTaxExpectedReturn)} sub="세후 연환산 기대수익" />
            <MetricCard label="샤프 비율" value={fmt(quantResult.performance.sharpeRatio)} sub="위험 대비 초과수익" />
            <MetricCard label="소르티노 비율" value={fmt(quantResult.performance.sortinoRatio)} sub="하방 리스크 방어력" />
            <MetricCard label="최대 낙폭(MDD)" value={fmtPct(Math.abs(quantResult.risk.mdd))} sub="최고점 대비 최악 하락" />
            <MetricCard label="연환산 변동성" value={fmtPct(quantResult.risk.volatility)} sub="연간 가격 흔들림 폭" />
            <MetricCard label="시장 베타" value={fmt(quantResult.sensitivity.beta)} sub="시장 민감도" />
          </div>
        </ResultCard>
      )}
    </div>
  );
}
