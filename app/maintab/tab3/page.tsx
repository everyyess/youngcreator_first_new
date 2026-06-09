"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  GitCompare,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type { PortfolioAnalysisResult, PortfolioAsset } from "../CustomerContext";

// ─── Constants ───────────────────────────────────────────────────────────────

const CLASS_COLORS: Record<string, string> = {
  국내주식: "#3B82F6",
  해외주식: "#10B981",
  국내채권: "#F59E0B",
  해외채권: "#EF4444",
  금: "#F97316",
  리츠: "#8B5CF6",
  현금: "#64748B",
  달러: "#06B6D4",
};

const ASSET_CLASS_ALIAS: Record<string, string> = {
  원자재: "금", 골드: "금", gold: "금", 귀금속: "금",
  외화: "달러", usd: "달러", 달러화: "달러",
  부동산: "리츠", 리츠etf: "리츠", reits: "리츠",
  해외채권etf: "해외채권", 미국채: "해외채권", 달러채권: "해외채권",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2) { return n.toFixed(decimals); }
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%`; }
function fmtWon(n: number) {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}억 원`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(0)}만 원`;
  return `${n.toFixed(0)} 원`;
}
// 스트레스 테스트 전용 — 0.01억(100만원) 미만은 만원, 이상은 억원
function fmtStressAmount(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1_000_000) return `${Math.round(abs / 10_000)}만 원`;
  return `${(abs / 1e8).toFixed(2)}억 원`;
}
function normalizeAssetClass(cls: string): string {
  return ASSET_CLASS_ALIAS[cls] ?? ASSET_CLASS_ALIAS[cls.toLowerCase()] ?? cls;
}

// ─── Layout Primitives ───────────────────────────────────────────────────────

function ResultCard({
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

function MetricWithNote({ label, value, note }: { label: string; value: string; note: string }) {
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

function PieChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  );
}

// ─── Holding Performance Table ───────────────────────────────────────────────

function HoldingPerformanceTable({ assets }: { assets: PortfolioAsset[] }) {
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
            // value-type 자산은 amount/current_value 자체가 원화 평가금액이므로 직접 표시
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

function DonutChart({ assets }: { assets: PortfolioAsset[] }) {
  const [hoveredCls, setHoveredCls] = useState<string | null>(null);
  const totalValue = assets.reduce((s, a) => s + (a.current_value ?? a.amount ?? 0), 0);
  const byClass: Record<string, number> = {};
  for (const a of assets) {
    const value = a.current_value ?? a.amount ?? 0;
    const pct = totalValue > 0 ? (value / totalValue) * 100 : (a.weight ?? 0) * 100;
    const cls = normalizeAssetClass(a.asset_class);
    byClass[cls] = (byClass[cls] ?? 0) + pct;
  }
  const segments = Object.entries(byClass).filter(([, pct]) => pct > 0.5).sort(([, a], [, b]) => b - a);
  const r = 15.9155;
  let cumulative = 0;
  const hovered = hoveredCls ? (segments.find(([cls]) => cls === hoveredCls) ?? null) : null;
  return (
    <div className="flex items-center gap-6">
      {/* 도넛 SVG — 고정 크기, shrink 금지 */}
      <div className="relative h-36 w-36 shrink-0">
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
              <p className="text-xs font-bold text-navy">{hovered[0]}</p>
              <p className="text-sm font-bold text-samsung">{hovered[1].toFixed(1)}%</p>
            </div>
          ) : <p className="text-xs text-slate-400">자산군별 비중</p>}
        </div>
      </div>
      {/* 범례 — 남은 너비를 모두 사용, 줄바꿈 허용 */}
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-1 text-xs font-semibold">
        {segments.map(([cls, pct]) => (
          <div key={cls} className={`flex items-center gap-1.5 cursor-default rounded px-1 py-0.5 transition-colors ${hoveredCls === cls ? "bg-slate-100" : ""}`}
            onMouseEnter={() => setHoveredCls(cls)} onMouseLeave={() => setHoveredCls(null)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: CLASS_COLORS[cls] ?? "#94a3b8" }} />
            <span className="truncate text-slate-600">{cls}</span>
            <span className="ml-auto shrink-0 text-navy">{pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Correlation Heatmap ─────────────────────────────────────────────────────

function CorrelationHeatmap({ matrix, labels }: { matrix: number[][]; labels: string[] }) {
  if (!matrix.length || !labels.length) return null;
  const shortLabel = (l: string) => l.slice(0, 4);
  function cellStyles(val: number): { bg: string; text: string } {
    if (val >= 0.7)  return { bg: "bg-red-500",     text: "text-white font-bold" };
    if (val >= 0.3)  return { bg: "bg-orange-400",  text: "text-slate-900 font-semibold" };
    if (val > -0.3)  return { bg: "bg-slate-100",   text: "text-slate-800" };
                     return { bg: "bg-emerald-500", text: "text-white font-bold" };
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto w-full">
        <table className="w-full text-xs border-separate" style={{ borderSpacing: "2px" }}>
          <thead>
            <tr>
              <th className="bg-slate-200 p-3 w-14 rounded-sm text-center align-middle" />
              {labels.map((l) => (
                <th key={l} className="bg-slate-200 p-3 text-center align-middle text-slate-700 font-bold rounded-sm">{shortLabel(l)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, ri) => (
              <tr key={ri}>
                <td className="bg-slate-200 p-3 text-center align-middle text-slate-700 font-bold whitespace-nowrap rounded-sm">{shortLabel(labels[ri])}</td>
                {row.map((val, ci) => {
                  const { bg, text } = cellStyles(val);
                  return <td key={ci} className={`p-4 text-center align-middle rounded-sm select-none ${bg} ${text}`}>{val.toFixed(2)}</td>;
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

// ─── Stress Test Diverging Bar Chart ─────────────────────────────────────────

function StressScenarioBar({
  scenario,
}: {
  scenario: { label: string; lossRate: number; lossAmount: number; details: { name: string; contribution: number }[] };
}) {
  const details = scenario.details.slice(0, 8);
  const maxContrib = Math.max(...details.map((d) => Math.abs(d.contribution)), 0.001);
  // Fixed domain ±50 % — small losses render as short bars, not full-width
  const CHART_DOMAIN = Math.max(maxContrib, 0.50);
  const isGain = scenario.lossRate >= 0;
  const ratePct = Math.abs(scenario.lossRate * 100).toFixed(1);
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
        {details.map((d, i) => {
          const barPct = Math.min((Math.abs(d.contribution) / CHART_DOMAIN) * 100, 100);
          const isNeg = d.contribution < 0;
          const isPos = d.contribution > 0;
          const valColor = isPos ? "text-emerald-600" : isNeg ? "text-red-500" : "text-slate-400";
          const sign = isPos ? "+" : "";
          return (
            <div key={i} className="grid grid-cols-[96px_1fr_2px_1fr_52px] items-center gap-x-1 text-xs">
              <span className="truncate font-semibold text-slate-700" title={d.name}>{d.name}</span>
              <div className="flex h-5 items-center justify-end">
                {isNeg && <div className="h-3 rounded-l-sm transition-all" style={{ width: `${barPct}%`, backgroundColor: "#ef4444" }} />}
              </div>
              <div className="h-5 w-0.5 rounded-full bg-slate-300 mx-auto" />
              <div className="flex h-5 items-center justify-start">
                {isPos && <div className="h-3 rounded-r-sm transition-all" style={{ width: `${barPct}%`, backgroundColor: "#22c55e" }} />}
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

function HealthBadge({ badge, badgeKo, totalScore }: { badge: string; badgeKo: string; totalScore: number }) {
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
function HealthSummaryBox({ healthResult }: { healthResult: any }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = healthResult.items ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const problemItems = items.filter((it: any) => it.score === 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cautionItems = items.filter((it: any) => it.score === 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const penaltyItems = items.filter((it: any) => it.penalty);
  const actionText = penaltyItems.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? `${penaltyItems.map((i: any) => i.label).join(", ")} – 즉시 분산 조정 필요.`
    : problemItems.length ? "위 문제 항목에 대한 즉각적인 리밸런싱을 권고합니다."
    : cautionItems.length ? "위 주의 항목을 점검하고 점진적 조정을 검토하세요."
    : "현재 포트폴리오를 유지하며 정기 점검을 진행하세요.";
  return (
    <div className="rounded-lg bg-blue-50 px-4 py-4 text-sm text-blue-900 space-y-3">
      <div>
        <p className="font-bold text-blue-800 mb-0.5">[종합 점수 및 권고]</p>
        <p className="font-semibold">{healthResult.totalScore}/14점 → {healthResult.badgeKo}</p>
      </div>
      {problemItems.length > 0 && (
        <div>
          <p className="font-bold text-red-700 mb-0.5">[문제 항목]</p>
          <ul className="list-disc list-inside space-y-0.5 ml-1">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {problemItems.map((it: any) => <li key={it.key} className="text-red-800 font-semibold">{it.label}</li>)}
          </ul>
        </div>
      )}
      {cautionItems.length > 0 && (
        <div>
          <p className="font-bold text-amber-700 mb-0.5">[주의 항목]</p>
          <ul className="list-disc list-inside space-y-0.5 ml-1">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {cautionItems.map((it: any) => <li key={it.key} className="text-amber-800 font-semibold">{it.label}</li>)}
          </ul>
        </div>
      )}
      <div>
        <p className="font-bold text-blue-800 mb-0.5">[행동 지침]</p>
        <p className="font-semibold">{actionText}</p>
      </div>
    </div>
  );
}

// ─── Left Column: Existing Portfolio Analysis ─────────────────────────────────

function ExistingPortfolioColumn({ data }: { data: PortfolioAnalysisResult | null }) {
  const [selectedScenario, setSelectedScenario] = useState(0);

  if (!data) {
    return (
      <div className="flex min-h-[480px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center px-6">
        <WalletCards size={32} className="text-slate-300" />
        <p className="text-sm font-semibold text-slate-400">
          1번 탭에서 자산을 입력하고 분석 실행을 눌러주세요.
        </p>
      </div>
    );
  }

  const enrichedAssets: PortfolioAsset[] = Array.isArray(data.enrichedAssets)
    ? (data.enrichedAssets as PortfolioAsset[])
    : [];
  const { portfolioIssueSummary, quantResult, stressResult, healthResult, tlhResult } = data;

  return (
    <div className="space-y-5">

      {/* BLUF 경고 배너 */}
      {portfolioIssueSummary && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 px-5 py-4 shadow-sm">
          <AlertTriangle className="mt-0.5 shrink-0 text-red-500" size={20} />
          <div className="min-w-0">
            <p className="mb-1 text-xs font-extrabold uppercase tracking-widest text-red-600">포트폴리오 핵심 이슈</p>
            <p className="text-sm font-semibold leading-relaxed text-red-800">{portfolioIssueSummary}</p>
          </div>
        </div>
      )}

      {/* 보유 자산 성과 */}
      <ResultCard icon={<WalletCards size={18} />} title="보유 자산 성과 (현재가 · 수익률)" accent="slate">
        <HoldingPerformanceTable assets={enrichedAssets} />
        {!enrichedAssets.filter((a) => a.name).length && (
          <p className="text-sm text-slate-400">표시할 자산이 없습니다.</p>
        )}
      </ResultCard>

      {/* 건강 진단 */}
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

      {/* 자산 배분 */}
      <ResultCard icon={<PieChartIcon />} title="자산군별 비중 분포" accent="slate">
        <DonutChart assets={enrichedAssets} />
      </ResultCard>

      {/* 상관관계 히트맵 */}
      <ResultCard icon={<Activity size={18} />} title="자산 간 상관관계 히트맵" accent="slate">
        {quantResult?.risk?.correlationHeatmap?.matrix?.length ? (
          <CorrelationHeatmap matrix={quantResult.risk.correlationHeatmap.matrix} labels={quantResult.risk.correlationHeatmap.labels} />
        ) : (
          <p className="text-sm text-slate-400">자산이 2개 이상일 때 표시됩니다.</p>
        )}
      </ResultCard>

      {/* 리스크 분석 3-카드 */}
      {quantResult && (
        <div className="grid gap-5">
          <ResultCard icon={<TrendingUp size={18} />} title="성과 및 효율성" accent="green">
            <div className="grid gap-2">
              <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm font-semibold text-slate-500">세후 기대수익률</span>
                <span className="text-right text-sm font-bold text-navy">{fmtPct(quantResult.performance.afterTaxExpectedReturn)}</span>
              </div>
              <MetricWithNote label="샤프 비율" value={fmt(quantResult.performance.sharpeRatio)} note="위험 한 단위당 초과 수익 효율성 지표입니다." />
              <MetricWithNote label="소르티노 비율" value={fmt(quantResult.performance.sortinoRatio)} note="하방 리스크 대비 변동성 방어력 지표입니다." />
              <MetricWithNote label="젠센 알파" value={fmtPct(quantResult.performance.jensensAlpha)} note={`시장 평균 대비 순수 알파 수익: 연 ${fmtPct(quantResult.performance.jensensAlpha)}`} />
            </div>
          </ResultCard>

          <ResultCard icon={<Activity size={18} />} title="리스크 및 하방 손실" accent="orange">
            <div className="grid gap-2">
              <MetricWithNote label="연환산 변동성" value={fmtPct(quantResult.risk.volatility)}
                note={`연간 가격 흔들림 폭 ${fmtPct(quantResult.risk.volatility)}.`} />
              <MetricWithNote label="최대 낙폭(MDD)" value={fmtPct(Math.abs(quantResult.risk.mdd))}
                note={`역사적 최고점 대비 최악 하락률 ${fmtPct(Math.abs(quantResult.risk.mdd))}.`} />
              <MetricWithNote label="95% VaR" value={fmtWon(quantResult.risk.var95)}
                note={`월간 최대 손실 가능금액(95% 신뢰): ${fmtWon(Math.abs(quantResult.risk.var95))}`} />
              <MetricWithNote label="분산화 점수" value={fmt(quantResult.risk.diversificationScore)}
                note="1에 가까울수록 자산 간 동조화가 강함을 의미합니다." />
            </div>
            {quantResult.sensitivity.hhiWarning && (
              <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800">
                집중도 경고: {quantResult.sensitivity.hhiWarningAssets?.join(", ")}
              </p>
            )}
          </ResultCard>

          <ResultCard icon={<BarChart3 size={18} />} title="민감도 및 쏠림" accent="blue">
            <div className="grid gap-2">
              <MetricWithNote label="시장 베타" value={fmt(quantResult.sensitivity.beta)}
                note={`시장 1% 변동 시 포트폴리오 ${fmt(quantResult.sensitivity.beta)}% 반응.`} />
              <MetricWithNote label="HHI 집중도" value={fmt(quantResult.sensitivity.hhi, 4)}
                note="종목별 비중 불균형 지표. 높을수록 특정 종목 집중 위험." />
              <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm font-semibold text-slate-500">해외주식 양도세</span>
                <span className="text-right text-sm font-bold text-navy">{fmtWon(quantResult.tax.foreignStock?.tax ?? 0)}</span>
              </div>
              <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-sm font-semibold text-slate-500">금융소득종합과세</span>
                <span className="text-right text-sm font-bold text-navy">{quantResult.tax.financialIncome?.warning ? "해당" : "비해당"}</span>
              </div>
            </div>
          </ResultCard>
        </div>
      )}

      {/* 스트레스 테스트 */}
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

      {/* TLH 권고안 */}
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

// ─── Right Column: Placeholder ────────────────────────────────────────────────

function NewPortfolioPlaceholder() {
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Tab3Page() {
  const [data, setData] = useState<PortfolioAnalysisResult | null>(null);

  useEffect(() => {
    // 마운트 시 저장된 결과 로드 (SSR/클라이언트 hydration 불일치 방지)
    try {
      const stored = localStorage.getItem("portfolio-result-v1");
      if (stored) {
        const p = JSON.parse(stored);
        if (p) setData(p);
      }
    } catch {}

    const onResultUpdated = () => {
      try {
        const stored = localStorage.getItem("portfolio-result-v1");
        if (stored) {
          const p = JSON.parse(stored);
          if (p) setData(p);
        }
      } catch {}
    };
    window.addEventListener("portfolio-result-updated", onResultUpdated);
    return () => {
      window.removeEventListener("portfolio-result-updated", onResultUpdated);
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* 페이지 헤더 */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-samsung text-white">
          <GitCompare size={20} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">포트폴리오 비교 분석</p>
          <h1 className="text-lg font-bold text-navy">기존 포트폴리오 vs 신규 포트폴리오</h1>
        </div>
      </div>

      {/* 2분할 Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* 좌측: 기존 포트폴리오 분석 결과 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-samsung text-xs font-bold text-white">A</span>
            <span className="text-sm font-bold text-navy">기존 포트폴리오 분석 결과</span>
          </div>
          <ExistingPortfolioColumn data={data} />
        </div>

        {/* 우측: 신규 포트폴리오 (Placeholder) */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-soft">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-xs font-bold text-white">B</span>
            <span className="text-sm font-bold text-slate-400">신규 포트폴리오 (준비 중)</span>
          </div>
          <NewPortfolioPlaceholder />
        </div>

      </div>
    </div>
  );
}
