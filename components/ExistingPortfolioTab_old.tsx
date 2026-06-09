"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FileUp,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";

// ─── Types (mirrored from page.tsx) ──────────────────────────────────────────

type FinancialInfo = {
  totalAssets: string;
  financialAssets: string;
  realEstate: string;
  debt: string;
  annualFixedIncome: string;
  irregularIncome: string;
  irregularIncomeNone: boolean;
  monthlyFixedExpense: string;
};

type RrttlluInfo = {
  returnObjective: string;
  expectedReturn: string;
  expectedReturnUnknown: boolean;
  investmentExperience: string[];
  knowledgeLevel: string;
  derivativesExperience: string;
  financialAssetRatio: string;
  investmentAssetRatio: string;
  riskAttitude: string;
  lossResponse: string;
  timeHorizon: string;
  expectedInterestIncome: string;
  expectedDividendIncome: string;
  giftingPlan: string;
  globalTaxImportance: string;
  recentGlobalTaxSubject: string;
  foreignStockTaxImportance: string;
  regularCashflowNeed: string;
  lumpSumPlan: string;
  emergencyReservePlan: string;
  legalConstraints: string[];
  legalConstraintOther: string;
  preferredAssets: string;
  avoidedAssets: string;
  holdingOrDisposalPlan: string;
  uniqueOther: string;
};

type AppState = { financial: FinancialInfo; rrttllu: RrttlluInfo };

type RiskResult = {
  score: number;
  level: string;
  answers: Record<string, unknown>;
  interpretation: string;
};

type PortfolioAsset = {
  name: string;
  asset_class: string;
  theme: string;
  country: string;
  buy_price: number | null;
  amount: number;
  amount_type: "quantity" | "value";
  is_hedged: boolean;
  needs_review: boolean;
  review_reason?: string | null;
  current_price?: number;
  current_value?: number;
  weight?: number;
  gain?: number;
  price_source?: string;
  _rawAmount?: string;
};

interface Props {
  formData: AppState;
  riskResult: RiskResult;
  warnings: string[];
  setFinancial: (key: keyof FinancialInfo, value: string) => void;
  setRrttllu: (key: keyof RrttlluInfo, value: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ASSET_CLASSES = ["국내주식", "해외주식", "국내채권", "해외채권", "금", "리츠", "현금", "달러"];

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

const EMPTY_ASSET: PortfolioAsset = {
  name: "",
  asset_class: "해외주식",
  theme: "기타",
  country: "미국",
  buy_price: null,
  amount: 0,
  amount_type: "value",
  is_hedged: false,
  needs_review: false,
};

// ─── Local UI Primitives (styled to match page.tsx) ──────────────────────────

function Panel({
  icon,
  eyebrow,
  title,
  children,
}: {
  icon?: React.ReactNode;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-start gap-3">
        {icon && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-samsung">
            {icon}
          </div>
        )}
        <div>
          <p className="text-xs font-bold uppercase tracking-normal text-slate-500">{eyebrow}</p>
          <h2 className="mt-1 text-lg font-bold text-navy">{title}</h2>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block rounded-lg border border-slate-200 p-4">
      <span className="mb-2 block text-sm font-bold text-slate-700">Q. {label}</span>
      <input
        className="h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block rounded-lg border border-slate-200 p-4">
      <span className="mb-2 block text-sm font-bold text-slate-700">Q. {label}</span>
      <textarea
        className="min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function ResultCard({
  icon,
  title,
  accent,
  children,
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

function ResultGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
          <span className="text-sm font-semibold text-slate-500">{label}</span>
          <span className="text-right text-sm font-bold text-navy">{value}</span>
        </div>
      ))}
    </div>
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

// ─── Portfolio-specific UI Components ────────────────────────────────────────

function WeightBar({ assets }: { assets: PortfolioAsset[] }) {
  const total = assets.reduce((s, a) => s + (a.current_value ?? a.amount ?? 0), 0);
  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
      {assets.map((a, i) => {
        const liveW = total > 0 ? (a.current_value ?? a.amount ?? 0) / total : (a.weight ?? 0);
        return (
          <div
            key={i}
            style={{ width: `${liveW * 100}%`, backgroundColor: CLASS_COLORS[a.asset_class] ?? "#94a3b8" }}
            title={`${a.name}: ${(liveW * 100).toFixed(1)}%`}
          />
        );
      })}
    </div>
  );
}

// 자산군 이름 정규화 – PDF 파서·외부 소스 표기 불일치 방어
const ASSET_CLASS_ALIAS: Record<string, string> = {
  '원자재': '금',
  '골드': '금',
  'gold': '금',
  '귀금속': '금',
  '외화': '달러',
  'usd': '달러',
  '달러화': '달러',
  '부동산': '리츠',
  '리츠etf': '리츠',
  'reits': '리츠',
  '해외채권etf': '해외채권',
  '미국채': '해외채권',
  '달러채권': '해외채권',
};

function normalizeAssetClass(cls: string): string {
  return ASSET_CLASS_ALIAS[cls] ?? ASSET_CLASS_ALIAS[cls.toLowerCase()] ?? cls;
}

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
  const segments = Object.entries(byClass)
    .filter(([, pct]) => pct > 0.5)
    .sort(([, a], [, b]) => b - a);

  const r = 15.9155;
  let cumulative = 0;
  const hovered = hoveredCls ? (segments.find(([cls]) => cls === hoveredCls) ?? null) : null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-44 h-44 shrink-0">
        <svg
          viewBox="0 0 36 36"
          className="w-full h-full -rotate-90"
          style={{ overflow: "visible" }}
          onMouseLeave={() => setHoveredCls(null)}
        >
          <circle cx="18" cy="18" r={r} fill="none" stroke="#f1f5f9" strokeWidth="3.5" />
          {segments.map(([cls, pct], i) => {
            const offset = -cumulative;
            const dash = `${pct.toFixed(2)} ${(100 - pct).toFixed(2)}`;
            cumulative += pct;
            return (
              <circle
                key={i}
                cx="18"
                cy="18"
                r={r}
                fill="none"
                stroke={CLASS_COLORS[cls] ?? "#94a3b8"}
                strokeWidth={hoveredCls === cls ? "5" : "3.5"}
                strokeDasharray={dash}
                strokeDashoffset={offset}
                style={{ pointerEvents: "stroke", cursor: "pointer", transition: "stroke-width 0.15s" }}
                onMouseEnter={() => setHoveredCls(cls)}
              />
            );
          })}
        </svg>
        {/* 중앙 툴팁 오버레이 (CSS absolute로 회전 충돌 방지) */}
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          {hovered ? (
            <div className="text-center leading-tight">
              <p className="text-xs font-bold text-navy">{hovered[0]}</p>
              <p className="text-sm font-bold text-samsung">{hovered[1].toFixed(1)}%</p>
            </div>
          ) : (
            <p className="text-xs text-slate-400">자산군별 비중</p>
          )}
        </div>
      </div>
      {/* 색상 스퀘어 범례 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-semibold">
        {segments.map(([cls, pct]) => (
          <div
            key={cls}
            className={`flex items-center gap-1.5 cursor-default rounded px-1.5 py-0.5 transition-colors ${
              hoveredCls === cls ? "bg-slate-100" : ""
            }`}
            onMouseEnter={() => setHoveredCls(cls)}
            onMouseLeave={() => setHoveredCls(null)}
            title={`${cls}: ${pct.toFixed(1)}%`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: CLASS_COLORS[cls] ?? "#94a3b8" }}
            />
            <span className="text-slate-600">{cls}</span>
            <span className="ml-auto text-navy">{pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CorrelationHeatmap({
  matrix,
  labels,
}: {
  matrix: number[][];
  labels: string[];
}) {
  if (!matrix.length || !labels.length) return null;

  const shortLabel = (l: string) => l.slice(0, 4);

  function cellStyles(val: number): { bg: string; text: string } {
    if (val >= 0.7)   return { bg: "bg-red-500",     text: "text-white font-bold" };
    if (val >= 0.3)   return { bg: "bg-orange-400",  text: "text-slate-900 font-semibold" };
    if (val > -0.3)   return { bg: "bg-slate-100",   text: "text-slate-800" };
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
                <th
                  key={l}
                  className="bg-slate-200 p-3 text-center align-middle text-slate-700 font-bold rounded-sm"
                >
                  {shortLabel(l)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, ri) => (
              <tr key={ri}>
                <td className="bg-slate-200 p-3 text-center align-middle text-slate-700 font-bold whitespace-nowrap rounded-sm">
                  {shortLabel(labels[ri])}
                </td>
                {row.map((val, ci) => {
                  const { bg, text } = cellStyles(val);
                  return (
                    <td
                      key={ci}
                      className={`p-4 text-center align-middle rounded-sm select-none ${bg} ${text}`}
                    >
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
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-sm bg-red-500 shrink-0" />
          <span className="text-slate-600">0.7 이상 · 고상관 (리스크 쏠림)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-sm bg-orange-400 shrink-0" />
          <span className="text-slate-600">0.3 ~ 0.7 · 중상관 (동조화 주의)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-sm bg-slate-100 border border-slate-300 shrink-0" />
          <span className="text-slate-600">|r| &lt; 0.3 · 저상관 (독립적 움직임)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-sm bg-emerald-500 shrink-0" />
          <span className="text-slate-600">−0.3 미만 · 역상관 (최우수 헷지)</span>
        </span>
      </div>
    </div>
  );
}

function StressScenarioBar({
  scenario,
}: {
  scenario: { label: string; lossRate: number; lossAmount: number; details: { name: string; contribution: number }[] };
}) {
  const maxContrib = Math.max(...scenario.details.map((d) => Math.abs(d.contribution)), 1);
  const isGain = scenario.lossRate >= 0;
  const ratePct = Math.abs(scenario.lossRate * 100).toFixed(1);
  const amountEok = Math.abs(scenario.lossAmount / 1e8).toFixed(2);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-bold text-slate-700">{scenario.label}</span>
        <span className={`text-sm font-bold ${isGain ? "text-emerald-600" : "text-red-600"}`}>
          {isGain ? "예상 이익" : "예상 손실"} {ratePct}% ({amountEok}억 원)
        </span>
      </div>
      <div className="space-y-1">
        {scenario.details.slice(0, 8).map((d, i) => {
          const pct = Math.min((Math.abs(d.contribution) / maxContrib) * 100, 100);
          return (
            <div key={i} className="grid grid-cols-[120px_1fr_60px] items-center gap-2 text-xs">
              <span className="truncate text-slate-600 font-semibold">{d.name}</span>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-red-400 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-right text-red-700 font-bold">
                {(d.contribution * 100).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HoldingPerformanceTable({ assets }: { assets: PortfolioAsset[] }) {
  const rows = assets.filter((a) => a.name);
  if (!rows.length) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            {["종목명", "자산군", "현재가", "매수단가", "평가금액", "수익률", "평가손익"].map((h) => (
              <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-slate-500 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((a, i) => {
            // ── 유효한 단가 확인 (API 에러 또는 미입력 시 null) ──
            const cp: number | null =
              typeof a.current_price === "number" && a.current_price > 0 ? a.current_price : null;
            const bp: number | null =
              typeof a.buy_price === "number" && a.buy_price > 0 ? a.buy_price : null;
            const qty = a.amount;  // 수량 또는 총 매입금액

            // [총 매입금액]
            // - 금액형: 입력된 금액 자체
            // - 수량형: 수량 × 매수단가 (매수단가 없으면 null)
            const totalCost: number | null =
              a.amount_type === "value"
                ? qty
                : bp !== null ? qty * bp : null;

            // [총 평가금액]
            // - 현재가 없으면 계산 불가 (Early Return in Render)
            // - 금액형: (총매입금액 / 매수단가) × 현재가
            // - 수량형: 수량 × 현재가
            const totalCurrentValue: number | null =
              cp === null ? null :
              a.amount_type === "quantity"
                ? qty * cp
                : bp !== null ? (qty / bp) * cp : null;

            // [수익률] = (현재가 - 매수단가) / 매수단가 × 100  — 반드시 단가끼리 비교
            const gainPct: number | null =
              cp !== null && bp !== null
                ? ((cp - bp) / bp) * 100
                : null;

            // [평가손익] = 총 평가금액 - 총 매입금액
            const gainAmt: number | null =
              totalCurrentValue !== null && totalCost !== null
                ? totalCurrentValue - totalCost
                : null;

            const isPos = gainAmt !== null && gainAmt > 0;
            const isNeg = gainAmt !== null && gainAmt < 0;

            return (
              <tr key={i} className="bg-white hover:bg-slate-50">
                <td className="px-3 py-2.5 font-semibold text-navy whitespace-nowrap">{a.name}</td>
                <td className="px-3 py-2.5">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-bold"
                    style={{
                      backgroundColor: (CLASS_COLORS[a.asset_class] ?? "#94a3b8") + "22",
                      color: CLASS_COLORS[a.asset_class] ?? "#64748b",
                    }}
                  >
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
                  {totalCurrentValue !== null
                    ? fmtWon(totalCurrentValue)
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-xs font-bold">
                  {gainPct !== null ? (
                    <span className={isPos ? "text-emerald-600" : isNeg ? "text-red-600" : "text-slate-400"}>
                      {gainPct >= 0 ? "+" : ""}{gainPct.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right text-xs font-bold">
                  {gainAmt !== null ? (
                    <span className={isPos ? "text-emerald-600" : isNeg ? "text-red-600" : "text-slate-400"}>
                      {gainAmt >= 0 ? "+" : ""}{fmtWon(gainAmt)}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
    : problemItems.length
    ? "위 문제 항목에 대한 즉각적인 리밸런싱을 권고합니다."
    : cautionItems.length
    ? "위 주의 항목을 점검하고 점진적 조정을 검토하세요."
    : "현재 포트폴리오를 유지하며 정기 점검을 진행하세요.";

  return (
    <div className="rounded-lg bg-blue-50 px-4 py-4 text-sm text-blue-900 space-y-3">
      <div>
        <p className="font-bold text-blue-800 mb-0.5">[종합 점수 및 권고]</p>
        <p className="font-semibold">
          {healthResult.totalScore}/14점 → {healthResult.badgeKo}
        </p>
      </div>
      {problemItems.length > 0 && (
        <div>
          <p className="font-bold text-red-700 mb-0.5">[문제 항목]</p>
          <ul className="list-disc list-inside space-y-0.5 ml-1">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {problemItems.map((it: any) => (
              <li key={it.key} className="text-red-800 font-semibold">{it.label}</li>
            ))}
          </ul>
        </div>
      )}
      {cautionItems.length > 0 && (
        <div>
          <p className="font-bold text-amber-700 mb-0.5">[주의 항목]</p>
          <ul className="list-disc list-inside space-y-0.5 ml-1">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {cautionItems.map((it: any) => (
              <li key={it.key} className="text-amber-800 font-semibold">{it.label}</li>
            ))}
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

function HealthBadge({ badge, badgeKo, totalScore }: { badge: string; badgeKo: string; totalScore: number }) {
  const styles: Record<string, string> = {
    Hold: "bg-emerald-100 text-emerald-800 border-emerald-200",
    Rebalance: "bg-amber-100 text-amber-800 border-amber-200",
    Sell: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <div className="flex items-center gap-3">
      <span
        className={`rounded-lg border px-4 py-2 text-lg font-bold ${styles[badge] ?? styles.Rebalance}`}
      >
        {badge}
      </span>
      <div>
        <p className="text-sm font-bold text-navy">{badgeKo}</p>
        <p className="text-xs text-slate-500">{totalScore}/14점</p>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseKoreanAmount(str: string): number {
  if (!str) return 0;
  const n = str.replace(/[^0-9.억만천]/g, "");
  let result = 0;
  const eok = n.match(/([0-9.]+)억/);
  const man = n.match(/([0-9.]+)만/);
  if (eok) result += parseFloat(eok[1]) * 1e8;
  if (man) result += parseFloat(man[1]) * 1e4;
  if (!eok && !man) result = parseFloat(n.replace(/[^0-9.]/g, "")) || 0;
  return result;
}

function fmt(n: number, decimals = 2) {
  return n.toFixed(decimals);
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtWon(n: number) {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}억 원`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(0)}만 원`;
  return `${n.toFixed(0)} 원`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ExistingPortfolioTab({
  formData,
  riskResult,
  warnings,
  setFinancial,
  setRrttllu,
}: Props) {
  // ── Portfolio analysis state ──
  const [portfolioAssets, setPortfolioAssets] = useState<PortfolioAsset[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [quantResult, setQuantResult] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [stressResult, setStressResult] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [healthResult, setHealthResult] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tlhResult, setTlhResult] = useState<any>(null);
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [infoMsg, setInfoMsg] = useState("");
  const [portfolioIssueSummary, setPortfolioIssueSummary] = useState("");

  // ── localStorage: 포트폴리오 자산 새로고침 후 유지 ──
  useEffect(() => {
    try {
      const stored = localStorage.getItem("portfolio-assets-v1");
      if (stored) setPortfolioAssets(JSON.parse(stored) as PortfolioAsset[]);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("portfolio-assets-v1", JSON.stringify(portfolioAssets));
    } catch {}
  }, [portfolioAssets]);

  // ── Compute t_marginal from financial data ──
  const tMarginal = useMemo(() => {
    const total = parseKoreanAmount(formData.financial.totalAssets);
    if (total >= 5e9) return 0.45;
    if (total >= 3e9) return 0.40;
    if (total >= 1.2e9) return 0.35;
    return 0.38;
  }, [formData.financial.totalAssets]);

  // ── Run full quantitative analysis ──
  const runAnalysis = useCallback(
    async (assets: PortfolioAsset[]) => {
      if (!assets.length) return;

      // ── Step 0-a: 실시간 원/달러 환율 조회 (루프 전 1회만 호출) ──
      setIsRunning(true);
      setErrorMsg("");
      setPortfolioIssueSummary("");
      setStatusMsg("환율 조회 중...");
      let currentExchangeRate = 1380; // Fallback – 조회 실패 시 적용
      try {
        const fxRes = await fetch(`/api/proxy-finance?assetName=${encodeURIComponent("KRW=X")}`);
        if (fxRes.ok) {
          const fxJson = await fxRes.json();
          const fxResult = fxJson?.chart?.result?.[0];
          const fxCloses: (number | null)[] =
            fxResult?.indicators?.adjclose?.[0]?.adjclose ??
            fxResult?.indicators?.quote?.[0]?.close ?? [];
          const latestFx = fxCloses
            .filter((v): v is number => v != null && !Number.isNaN(v))
            .at(-1);
          if (typeof latestFx === "number" && latestFx > 0) {
            currentExchangeRate = latestFx;
          }
        }
      } catch {
        console.warn("실시간 환율 로드 실패. 기본 환율 1380을 적용합니다.");
      }

      // ── Step 0-b: quantity 자산에 실시간 현재가 자동 조회 (현재가 미입력 시) ──
      setStatusMsg("실시간 시세 조회 중...");
      // 해외 자산군 – Yahoo Finance 반환가(USD)를 원화로 환산해야 하는 자산군
      const FOREIGN_CLASSES = new Set(["해외주식", "해외채권", "달러"]);
      const enrichedAssets = await Promise.all(
        assets.map(async (a) => {
          if (a.amount_type !== "quantity" || !a.name || (a.current_price != null && a.current_price > 0)) {
            return a;
          }
          try {
            const res = await fetch(`/api/proxy-finance?assetName=${encodeURIComponent(a.name)}`);
            if (!res.ok) {
              try {
                const errData = await res.json();
                if (errData?.error) setErrorMsg(`[${a.name}] ${errData.error}`);
              } catch { /* JSON 파싱 실패 무시 */ }
              return a;
            }
            const json = await res.json();
            const result = json?.chart?.result?.[0];
            const closes: (number | null)[] =
              result?.indicators?.adjclose?.[0]?.adjclose ??
              result?.indicators?.quote?.[0]?.close ?? [];
            const lastPrice = closes.filter((v): v is number => v != null && !Number.isNaN(v)).at(-1);
            if (typeof lastPrice === "number" && lastPrice > 0) {
              // 해외 자산은 Yahoo 반환가(USD)에 실시간 환율을 곱해 원화(KRW) 평가금액 산출
              const isForeign = FOREIGN_CLASSES.has(a.asset_class);
              const cvKrw = isForeign
                ? a.amount * lastPrice * currentExchangeRate
                : a.amount * lastPrice;
              return { ...a, current_price: lastPrice, current_value: cvKrw };
            }
          } catch { /* 조회 실패 시 기존 값 유지 */ }
          return a;
        })
      );
      // 조회된 현재가로 상태 선반영 (테이블에 즉시 표시)
      setPortfolioAssets(enrichedAssets);

      // 피드백 7: 자산 총액이 0원이면 분석 차단
      const _totalCheck = enrichedAssets.reduce((s, a) => {
        const v = a.current_value ?? (a.amount_type === "quantity" ? (a.current_price ?? 0) * a.amount : a.amount ?? 0);
        return s + v;
      }, 0);
      if (_totalCheck === 0) {
        setInfoMsg("자산을 입력해 주세요.");
        setQuantResult(null);
        setHealthResult(null);
        setStressResult(null);
        setTlhResult(null);
        setIsRunning(false);
        return;
      }
      setInfoMsg("");
      try {
        setStatusMsg("정량 분석 연산 중...");
        const { runQuantAnalysis, runStressTest, portfolioHealthCheck, generateTLHRecommendations, financialIncomeTaxCalculation } =
          await import("../utils/quantEngine");

        // ── Step 1: 총 자산 가치 계산 (enrichedAssets 기준)
        const totalValue = enrichedAssets.reduce((s, a) => {
          const v = a.current_value ?? (a.amount_type === "quantity" ? (a.current_price ?? 0) * a.amount : a.amount ?? 0);
          return s + v;
        }, 0);

        // ── Step 2: 비중(w_i) 및 손익 추정 후 자산 배열 갱신
        const assetsWithWeights: PortfolioAsset[] = enrichedAssets.map((a) => {
          const value = a.current_value ?? (a.amount_type === "quantity" ? (a.current_price ?? 0) * a.amount : a.amount ?? 0);
          const weight = totalValue > 0 ? value / totalValue : 0;

          // 손익 추정: buy_price와 관련 정보가 있을 때만 계산
          let gain = a.gain ?? 0;
          if (!gain && a.buy_price != null && a.buy_price > 0 && a.amount > 0) {
            if (a.amount_type === "quantity" && a.current_price != null && a.current_price > 0) {
              // 수량형: 평가손익 = (현재가 - 매수단가) × 수량
              gain = (a.current_price - a.buy_price) * a.amount;
            } else if (a.amount_type === "value" && a.current_price != null && a.current_price > 0) {
              // 금액형: 수량 = 총매입금액 / 매수단가, 평가손익 = 수량 × (현재가 - 매수단가)
              const inferredQty = a.amount / a.buy_price;
              gain = inferredQty * (a.current_price - a.buy_price);
            }
          }

          return { ...a, weight, current_value: value, gain };
        });

        // 비중이 반영된 자산 배열로 상태 업데이트 → DonutChart, 비중 바 실시간 반영
        setPortfolioAssets(assetsWithWeights);

        // ── Step 3: quantEngine 입력 형식 변환 (w_i 포함)
        const quantInput = assetsWithWeights.map((a) => ({
          name: a.name,
          weight: a.weight ?? 0,
          value: a.current_value ?? 0,
          gain: a.gain ?? 0,
          _meta: {
            asset_class: a.asset_class,
            theme: a.theme,
            country: a.country,
            is_hedged: a.is_hedged,
            buy_price: a.buy_price,
            current_price: a.current_price,
            amount: a.amount,
            amount_type: a.amount_type,
          },
        }));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const qr: any = await runQuantAnalysis(quantInput, tMarginal);
        setQuantResult(qr);

        const sr = runStressTest(quantInput, totalValue);
        setStressResult(sr);

        // 피드백 11: 세션 탭 입력 금융소득을 세금 효율성 계산에 반영
        const userInterest = parseKoreanAmount(formData.rrttllu.expectedInterestIncome);
        const userDividend = parseKoreanAmount(formData.rrttllu.expectedDividendIncome);
        const financialIncomeTaxForHealth = (userInterest > 0 || userDividend > 0)
          ? financialIncomeTaxCalculation(userInterest, userDividend, tMarginal)
          : qr.tax.financialIncome;

        const hr = portfolioHealthCheck(
          {
            // 피드백 8: 단일 종목이면 분산도 0점 강제 처리
            diversificationScore: assetsWithWeights.length <= 1 ? 0 : qr.risk.diversificationScore,
            volatility: qr.risk.volatility,
            sharpeRatio: qr.performance.sharpeRatio,
            mdd: qr.risk.mdd,
            financialIncomeTax: financialIncomeTaxForHealth,
          },
          quantInput,
          tMarginal
        );
        setHealthResult(hr);

        // BLUF: 문제가 있을 때만 배너 텍스트 계산
        const hasPortfolioIssues = hr.badge !== 'Hold' || (sr.riskTypes?.length ?? 0) > 0;
        if (hasPortfolioIssues) {
          const blufParts: string[] = [];
          if (hr.summary) blufParts.push(hr.summary);
          if ((sr.riskTypes?.length ?? 0) > 0 && sr.diagnosis) blufParts.push(sr.diagnosis);
          setPortfolioIssueSummary(blufParts.join("  •  "));
        } else {
          setPortfolioIssueSummary("");
        }

        setTlhResult(generateTLHRecommendations(quantInput, tMarginal));
        setStatusMsg("");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "분석 오류";
        setErrorMsg(msg);
        setStatusMsg("");
      } finally {
        setIsRunning(false);
      }
    },
    [tMarginal, formData.rrttllu.expectedInterestIncome, formData.rrttllu.expectedDividendIncome]
  );

  // ── PDF pipeline handler ──
  const handlePdfUpload = useCallback(
    async (file: File) => {
      setIsRunning(true);
      setErrorMsg("");
      setPortfolioIssueSummary("");
      setQuantResult(null);
      setStressResult(null);
      setHealthResult(null);
      setTlhResult(null);
      try {
        const { runPipeline } = await import("../utils/assetPipeline");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await runPipeline(file, {
          fillMode: "skip",
          onStatusChange: (_: string, detail?: string) => setStatusMsg(detail ?? ""),
        });
        const valuated: PortfolioAsset[] = result.valuatedAssets;
        setPortfolioAssets(valuated);
        await runAnalysis(valuated);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "파이프라인 오류";
        setErrorMsg(msg);
      } finally {
        setIsRunning(false);
        setStatusMsg("");
      }
    },
    [runAnalysis]
  );

  // ── Asset table row handlers ──
  const addRow = () =>
    setPortfolioAssets((prev) => [...prev, { ...EMPTY_ASSET }]);

  const removeRow = (i: number) =>
    setPortfolioAssets((prev) => prev.filter((_, idx) => idx !== i));

  const updateRow = (i: number, patch: Partial<PortfolioAsset>) =>
    setPortfolioAssets((prev) =>
      prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a))
    );

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── BLUF: 포트폴리오 핵심 이슈 경고 배너 ── */}
      {portfolioIssueSummary && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 px-5 py-4 shadow-sm">
          <AlertTriangle className="mt-0.5 shrink-0 text-red-500" size={20} />
          <div className="min-w-0">
            <p className="mb-1 text-xs font-extrabold uppercase tracking-widest text-red-600">
              포트폴리오 핵심 이슈
            </p>
            <p className="text-sm font-semibold leading-relaxed text-red-800">
              {portfolioIssueSummary}
            </p>
          </div>
        </div>
      )}

      {/* ── Section 2: PDF Upload + Asset Input ── */}
      <Panel icon={<FileUp size={18} />} eyebrow="정량 분석 엔진" title="자산 입력 및 PDF 업로드">
        {/* Upload controls */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handlePdfUpload(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={isRunning}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg bg-samsung px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1b35bd] disabled:opacity-50"
          >
            <FileUp size={16} />
            PDF 자동 파싱
          </button>
          <button
            type="button"
            disabled={isRunning || !portfolioAssets.length}
            onClick={() => runAnalysis(portfolioAssets)}
            className="flex items-center gap-2 rounded-lg border border-samsung px-4 py-2.5 text-sm font-bold text-samsung transition hover:bg-blue-50 disabled:opacity-50"
          >
            {isRunning ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            분석 재실행
          </button>
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
          >
            <Plus size={16} />
            자산 추가
          </button>
        </div>

        {/* Status / Error */}
        {statusMsg && (
          <p className="rounded-lg bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-800">
            <Loader2 size={14} className="mr-2 inline animate-spin" />
            {statusMsg}
          </p>
        )}
        {infoMsg && (
          <p className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700">
            {infoMsg}
          </p>
        )}
        {errorMsg && (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">
            오류: {errorMsg}
          </p>
        )}

        {/* Asset Table */}
        {portfolioAssets.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {["종목명", "자산군", "입력방식", "금액(원) / 수량", "매수단가", "헤지", "리뷰", ""].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold text-slate-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {portfolioAssets.map((a, i) => (
                  <tr
                    key={i}
                    className={a.needs_review ? "bg-amber-50" : "bg-white hover:bg-slate-50"}
                  >
                    <td className="px-3 py-2">
                      <input
                        className="h-9 w-32 rounded border border-slate-200 px-2 text-xs text-navy"
                        value={a.name}
                        onChange={(e) => updateRow(i, { name: e.target.value })}
                      />
                    </td>
                    {/* 자산군 */}
                    <td className="px-3 py-2">
                      <select
                        className="h-9 rounded border border-slate-200 px-2 text-xs text-navy"
                        value={a.asset_class}
                        onChange={(e) => updateRow(i, { asset_class: e.target.value })}
                      >
                        {ASSET_CLASSES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    {/* 입력방식 (피드백 5: 자산군과 금액 사이로 이동, 명칭 변경) */}
                    <td className="px-3 py-2">
                      <select
                        className="h-9 rounded border border-slate-200 px-2 text-xs text-navy"
                        value={a.amount_type}
                        onChange={(e) =>
                          updateRow(i, { amount_type: e.target.value as "quantity" | "value", _rawAmount: undefined })
                        }
                      >
                        <option value="value">금액</option>
                        <option value="quantity">수량</option>
                      </select>
                    </td>
                    {/* 금액 / 수량 입력 (피드백 4: 한글 금액 파싱 지원) */}
                    <td className="px-3 py-2">
                      {a.amount_type === "quantity" ? (
                        <input
                          type="number"
                          className="h-9 w-24 rounded border border-slate-200 px-2 text-xs text-navy"
                          placeholder="수량"
                          value={a.amount || ""}
                          onChange={(e) => {
                            const qty = Number(e.target.value);
                            updateRow(i, { amount: qty, current_value: qty * (a.current_price ?? 0) });
                          }}
                        />
                      ) : (
                        <input
                          type="text"
                          className="h-9 w-28 rounded border border-slate-200 px-2 text-xs text-navy"
                          value={a._rawAmount ?? String((a.current_value ?? a.amount) || "")}
                          placeholder="0 또는 1억"
                          onChange={(e) => {
                            const raw = e.target.value;
                            const parsed = parseKoreanAmount(raw);
                            updateRow(i, { _rawAmount: raw, current_value: parsed, amount: parsed });
                          }}
                        />
                      )}
                    </td>
                    {/* 매수단가 */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        className="h-9 w-24 rounded border border-slate-200 px-2 text-xs text-navy"
                        value={a.buy_price ?? ""}
                        placeholder="—"
                        onChange={(e) =>
                          updateRow(i, { buy_price: e.target.value ? Number(e.target.value) : null })
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={a.is_hedged}
                        onChange={(e) => updateRow(i, { is_hedged: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {a.needs_review && (
                        <span className="rounded bg-amber-200 px-1.5 py-0.5 text-amber-800 font-bold">
                          검토
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-slate-400 hover:border-red-200 hover:text-red-600"
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Weight summary bar – 분석 전에도 입력값 기준으로 실시간 표시 */}
        {portfolioAssets.length > 0 && <WeightBar assets={portfolioAssets} />}
      </Panel>

      {/* ── Section 3: Analysis Results (shown after analysis) ── */}
      {quantResult && (
        <div className="space-y-5">
          {/* 보유 자산 성과 – 현재가·수익률 확인 표 */}
          <ResultCard icon={<WalletCards size={18} />} title="보유 자산 성과 (현재가 · 수익률)" accent="slate">
            <HoldingPerformanceTable assets={portfolioAssets} />
          </ResultCard>

          {/* Health Check Badge */}
          {healthResult && (
            <ResultCard icon={<Activity size={18} />} title="포트폴리오 건강 진단" accent="blue">
              <div className="space-y-4">
                <HealthBadge
                  badge={healthResult.badge}
                  badgeKo={healthResult.badgeKo}
                  totalScore={healthResult.totalScore}
                />
                <div className="grid gap-1.5">
                  {healthResult.items?.map(
                    (item: { key: string; label: string; score: number; grade: string; detail: string; penalty?: boolean }, i: number) => (
                      <div
                        key={i}
                        className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs"
                      >
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
                {healthResult.summary && (
                  <HealthSummaryBox healthResult={healthResult} />
                )}
              </div>
            </ResultCard>
          )}

          {/* Metric Cards (3 groups) */}
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Group 1: Performance */}
            <ResultCard icon={<TrendingUp size={18} />} title="성과 및 효율성" accent="green">
              <div className="grid gap-2">
                {/* 세후 기대수익률 */}
                <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-sm font-semibold text-slate-500">세후 기대수익률</span>
                  <span className="text-right text-sm font-bold text-navy">
                    {fmtPct(quantResult.performance.afterTaxExpectedReturn)}
                  </span>
                </div>
                {/* 샤프 비율 + PB 브리핑 */}
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-500">샤프 비율</span>
                    <span className="text-sm font-bold text-navy">{fmt(quantResult.performance.sharpeRatio)}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    위험 한 단위당 얻을 수 있는 초과 수익 효율성이 아주 최적화된 포트폴리오입니다.
                  </p>
                </div>
                {/* 소르티노 비율 + PB 브리핑 */}
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-500">소르티노 비율</span>
                    <span className="text-sm font-bold text-navy">{fmt(quantResult.performance.sortinoRatio)}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    시장 하방 리스크(손실 위험) 대비 변동성 방어력이 매우 탁월한 구간입니다.
                  </p>
                </div>
                {/* 젠센 알파 + PB 브리핑 (동적 바인딩) */}
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-500">젠센 알파</span>
                    <span className="text-sm font-bold text-navy">{fmtPct(quantResult.performance.jensensAlpha)}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    시장 단순 평균 수익률 대비 PB의 자산 배분 역량으로 연{" "}
                    {fmtPct(quantResult.performance.jensensAlpha)}의 순수 알파 수익을 더 얹어드리고 있습니다.
                  </p>
                </div>
              </div>
            </ResultCard>

            {/* Group 2: Risk */}
            <ResultCard icon={<Activity size={18} />} title="리스크 및 하방 손실" accent="orange">
              <div className="grid gap-2">
                <MetricWithNote
                  label="연환산 변동성"
                  value={fmtPct(quantResult.risk.volatility)}
                  note={`포트폴리오의 연간 가격 흔들림 폭을 의미합니다. 현재 ${fmtPct(quantResult.risk.volatility)}는 주식형 자산 집중으로 인해 다소 높은 변동성을 나타내고 있습니다.`}
                />
                <MetricWithNote
                  label="최대 낙폭(MDD)"
                  value={fmtPct(Math.abs(quantResult.risk.mdd))}
                  note={`역사적 최고점 대비 겪을 수 있는 최악의 하락률입니다. 현재 ${fmtPct(Math.abs(quantResult.risk.mdd))}는 위기 상황 시 자산의 상당 부분이 일시적으로 감소할 수 있음을 뜻합니다.`}
                />
                <MetricWithNote
                  label="95% VaR"
                  value={fmtWon(quantResult.risk.var95)}
                  note={`정상적인 시장 환경에서 1개월 동안 발생할 수 있는 최대 손실 금액(확률 95%)입니다. 현재 자산 구조상 최악의 경우 월간 약 ${fmtWon(Math.abs(quantResult.risk.var95))}의 손실 가능성이 대두됩니다.`}
                />
                <MetricWithNote
                  label="분산화 점수"
                  value={fmt(quantResult.risk.diversificationScore)}
                  note={`자산 간 상관계수 평균값입니다. 1에 가까울수록 동조화가 심함을 의미하며, 현재 ${fmt(quantResult.risk.diversificationScore)}(가중 평균값)는 자산 간 분산 효과가 낮아 보완이 필요한 상태입니다.`}
                />
              </div>
              {quantResult.sensitivity.hhiWarning && (
                <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-800">
                  집중도 경고: {quantResult.sensitivity.hhiWarningAssets?.join(", ")}
                </p>
              )}
            </ResultCard>

            {/* Group 3: Sensitivity */}
            <ResultCard icon={<BarChart3 size={18} />} title="민감도 및 쏠림" accent="blue">
              <div className="grid gap-2">
                <MetricWithNote
                  label="시장 베타"
                  value={fmt(quantResult.sensitivity.beta)}
                  note={`시장(KOSPI/S&P500) 대비 포트폴리오의 민감도입니다. ${fmt(quantResult.sensitivity.beta)}는 시장이 1% 움직일 때 본 자산은 ${fmt(quantResult.sensitivity.beta)}% 더 다이내믹하게 움직이는 공격형 포트폴리오임을 뜻합니다.`}
                />
                <MetricWithNote
                  label="HHI 집중도"
                  value={fmt(quantResult.sensitivity.hhi, 4)}
                  note={`종목별 비중 불균형을 측정하는 지표입니다. ${fmt(quantResult.sensitivity.hhi, 4)}는 특정 우량주 및 기술주 펀드에 자산의 상당 부분이 편중되어 있어 개별 종목 리스크에 노출되어 있음을 의미합니다.`}
                />
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

          {/* Donut + Heatmap */}
          <div className="grid gap-5 lg:grid-cols-2">
            <ResultCard icon={<PieChartIcon />} title="자산군별 비중 분포" accent="slate">
              <DonutChart assets={portfolioAssets} />
            </ResultCard>

            <ResultCard icon={<Activity size={18} />} title="자산 간 상관관계 히트맵" accent="slate">
              {quantResult.risk.correlationHeatmap?.matrix?.length ? (
                <CorrelationHeatmap
                  matrix={quantResult.risk.correlationHeatmap.matrix}
                  labels={quantResult.risk.correlationHeatmap.labels}
                />
              ) : (
                <p className="text-sm text-slate-400">자산이 2개 이상일 때 표시됩니다.</p>
              )}
            </ResultCard>
          </div>

          {/* Stress Test */}
          {stressResult && (
            <ResultCard icon={<AlertTriangle size={18} />} title="스트레스 테스트 – 4대 위기 시나리오" accent="red">
              <div className="space-y-4">
                {/* Scenario selector */}
                <div className="flex flex-wrap gap-2">
                  {(["scenario1", "scenario2", "scenario3", "scenario4"] as const).map((key, idx) => {
                    const sc = stressResult[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedScenario(idx)}
                        className={`rounded-lg border px-3 py-2 text-left text-xs font-bold transition ${
                          selectedScenario === idx
                            ? "border-red-300 bg-red-50 text-red-800"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <span className="block">{sc?.label ?? `시나리오 ${idx + 1}`}</span>
                        <span className={`block text-xs ${selectedScenario === idx ? "text-red-600" : "text-slate-400"}`}>
                          {sc ? `${(sc.lossRate * 100).toFixed(1)}%` : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Selected scenario details */}
                {(() => {
                  const keys = ["scenario1", "scenario2", "scenario3", "scenario4"];
                  const sc = stressResult[keys[selectedScenario]];
                  if (!sc) return null;
                  return <StressScenarioBar scenario={sc} />;
                })()}

                {/* Risk type diagnosis */}
                {stressResult.riskTypes?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {stressResult.riskTypes.map((rt: string) => (
                      <span
                        key={rt}
                        className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-800"
                      >
                        {rt}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </ResultCard>
          )}

          {/* TLH Recommendations */}
          {tlhResult && (tlhResult.priority1?.length > 0 || tlhResult.priority2?.length > 0) && (
            <ResultCard icon={<ShieldCheck size={18} />} title="세금 손실 수확(TLH) 권고안" accent="green">
              <div className="space-y-3">
                {tlhResult.priority1?.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-bold text-samsung">
                      우선순위 1 – 종합과세 방어
                    </p>
                    <div className="space-y-1.5">
                      {tlhResult.priority1.map(
                        (r: { name: string; reason: string; taxSaving: number }, i: number) => (
                          <div
                            key={i}
                            className="flex items-start justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs"
                          >
                            <div>
                              <span className="font-bold text-navy">{r.name}</span>
                              <span className="ml-2 text-slate-500">{r.reason}</span>
                            </div>
                            <span className="shrink-0 font-bold text-samsung">
                              절세 {fmtWon(r.taxSaving)}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
                {tlhResult.priority2?.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-bold text-emerald-700">
                      우선순위 2 – 양도세 절감
                    </p>
                    <div className="space-y-1.5">
                      {tlhResult.priority2.map(
                        (r: { name: string; reason: string; taxSaving: number }, i: number) => (
                          <div
                            key={i}
                            className="flex items-start justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs"
                          >
                            <div>
                              <span className="font-bold text-navy">{r.name}</span>
                              <span className="ml-2 text-slate-500">{r.reason}</span>
                            </div>
                            <span className="shrink-0 font-bold text-emerald-700">
                              절세 {fmtWon(r.taxSaving)}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
                {tlhResult.summary && (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                    {tlhResult.summary}
                  </p>
                )}
              </div>
            </ResultCard>
          )}

          {/* ISA Simulation */}
          {quantResult.tax.isaSimulation && (
            <ResultCard icon={<ShieldCheck size={18} />} title="ISA 계좌 전환 시뮬레이션" accent="gold">
              <ResultGrid
                rows={[
                  ["일반 계좌 세금", fmtWon(quantResult.tax.isaSimulation.generalTax ?? 0)],
                  ["ISA 전환 후 세금", fmtWon(quantResult.tax.isaSimulation.isaTax ?? 0)],
                  ["절세 효과", fmtWon(quantResult.tax.isaSimulation.taxSaving ?? 0)],
                ]}
              />
            </ResultCard>
          )}
        </div>
      )}

      {/* Empty state hint */}
      {!portfolioAssets.length && !isRunning && (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <FileUp size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-semibold text-slate-400">
            PDF를 업로드하거나 자산을 추가하여 정량 분석을 시작하세요.
          </p>
        </div>
      )}
    </div>
  );
}

// Tiny inline icon to avoid importing PieChart from lucide which may conflict
function PieChartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  );
}
