"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChevronDown,
  ChevronUp,
  PiggyBank,
  ShieldCheck,
  TrendingUp,
  Info,
  Sparkles,
  Lock,
  Ban,
} from "lucide-react";
import { NEW_PORTFOLIO_INCOME_STORAGE_KEY } from "./FinancialIncomeGauge";
import type { FinancialIncomeSummary } from "./FinancialIncomeGauge";
import { useCustomerContext } from "../CustomerContext";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const THRESHOLD = 20_000_000;
const LOCAL_TAX_MULTIPLIER = 1.1;
const COMBINED_CREDIT_MAX = 9_000_000;
const SAVING_CREDIT_MAX = 6_000_000;
const PENSION_MAX = 18_000_000; // 연금저축+IRP 실제 합산 납입한도
const ISA_NONTAX = 2_000_000;
const ISA_SEPARATE_RATE = 0.099;
const GENERAL_RATE = 0.154;
const IRP_RISK_CAP = 0.7;
const NEW_PORTFOLIO_ASSETS_KEY = "new-portfolio-assets-v1";
const priorKey = (cid: string) => `pension-prior-${cid}`;

// ─────────────────────────────────────────────
// Design tokens — 대시보드 전체 톤에 맞춤
// ─────────────────────────────────────────────
const C = {
  navy:           "#1e293b",  // slate-800
  paper:          "#f8fafc",  // slate-50
  card:           "#FFFFFF",
  line:           "#e2e8f0",  // slate-200
  ink:            "#334155",  // slate-700
  slate:          "#64748b",  // slate-500
  gold:           "#d97706",  // amber-600
  goldSoft:       "#fef3c7",  // amber-100
  green:          "#059669",  // emerald-600
  greenSoft:      "#d1fae5",  // emerald-100
  terracotta:     "#e11d48",  // rose-600
  terracottaSoft: "#ffe4e6",  // rose-100
  grayBg:         "#f1f5f9",  // slate-100
  rose:           "#be123c",  // rose-700
  roseSoft:       "#fff1f2",  // rose-50
} as const;

const serif = "'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
const sans  = "inherit";

// ─────────────────────────────────────────────
// Eligibility matrix  (6 categories × 3 accounts)
// ─────────────────────────────────────────────
const ELIGIBILITY: Record<string, { saving: boolean; irp: boolean; isa: boolean }> = {
  국내주식: { saving: false, irp: false, isa: true  },
  해외주식: { saving: false, irp: false, isa: false },
  국내채권: { saving: false, irp: true,  isa: true  },
  해외채권: { saving: false, irp: false, isa: false },
  국내ETF:  { saving: true,  irp: true,  isa: true  },
  해외ETF:  { saving: true,  irp: true,  isa: true  }, // 국내 상장 ETF이므로 편입 가능
  기타:     { saving: false, irp: false, isa: false },
};
const NEVER_ELIGIBLE = ["해외주식", "해외채권"];

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface RawAsset {
  name?: string;
  asset_class?: string;
  productType?: string;
  country?: string;
  amount?: number;
  amount_type?: "quantity" | "value";
  buy_price?: number | null;
  dividendYield?: number;
  bond_yield?: number;
  current_price?: number;
  current_value?: number;
}

interface SimAsset {
  id:        string;
  name:      string;
  category:  string;
  riskClass: "위험자산" | "안전자산";
  balance:   number;
  rate:      number;
  remaining: number;
}

interface AllocPick {
  id: string; name: string; category: string; rate: number; amount: number;
}
interface AllocResult {
  picks: AllocPick[]; totalAmount: number; totalIncome: number;
}
interface IRPResult extends AllocResult {
  riskRatio: number;
}

// ─────────────────────────────────────────────
// Mapping helpers
// ─────────────────────────────────────────────
function toCategory(a: RawAsset): string {
  if (a.productType === "국내ETF") return "국내ETF";
  if (a.productType === "해외ETF") return "해외ETF";
  if (a.productType === "ETF") {
    return a.country === "국내" ? "국내ETF" : "해외ETF";
  }
  const cls = a.asset_class ?? "";
  if (["국내주식", "해외주식", "국내채권", "해외채권"].includes(cls)) return cls;
  return "기타";
}

function toRiskClass(a: RawAsset): "위험자산" | "안전자산" {
  const cls = a.asset_class ?? "";
  return cls.includes("채권") || a.productType === "예금" ? "안전자산" : "위험자산";
}

function toBalance(a: RawAsset): number {
  if ((a.current_value ?? 0) > 0) return a.current_value!;
  if (a.amount_type === "value" && (a.amount ?? 0) > 0) return a.amount!;
  if (a.buy_price != null && (a.amount ?? 0) > 0) return a.buy_price * a.amount!;
  return 0;
}

// ─────────────────────────────────────────────
// Allocation engine
// ─────────────────────────────────────────────
function filterEligible(pool: SimAsset[], key: "saving" | "irp" | "isa"): SimAsset[] {
  return pool.filter(a => ELIGIBILITY[a.category]?.[key]);
}

function allocateGreedy(assets: SimAsset[], target: number): AllocResult {
  const sorted = [...assets].sort((a, b) => b.rate - a.rate);
  let left = target;
  const picks: AllocPick[] = [];
  for (const a of sorted) {
    if (left <= 0) break;
    if (a.remaining <= 0) continue;
    const take = Math.min(a.remaining, left);
    if (take > 0) { picks.push({ id: a.id, name: a.name, category: a.category, rate: a.rate, amount: take }); left -= take; }
  }
  return {
    picks,
    totalAmount: picks.reduce((s, p) => s + p.amount, 0),
    totalIncome: picks.reduce((s, p) => s + p.amount * p.rate, 0),
  };
}

function allocateIRP(pool: SimAsset[], target: number): IRPResult {
  const riskCap = target * IRP_RISK_CAP;
  const sorted = [...pool].sort((a, b) => b.rate - a.rate);
  let left = target, riskUsed = 0;
  const picks: AllocPick[] = [];
  for (const a of sorted) {
    if (left <= 0) break;
    if (a.remaining <= 0) continue;
    let cap = left;
    if (a.riskClass === "위험자산") cap = Math.min(cap, riskCap - riskUsed);
    const take = Math.min(a.remaining, cap);
    if (take > 0) {
      picks.push({ id: a.id, name: a.name, category: a.category, rate: a.rate, amount: take });
      left -= take;
      if (a.riskClass === "위험자산") riskUsed += take;
    }
  }
  const totalAmount = picks.reduce((s, p) => s + p.amount, 0);
  return {
    picks,
    totalAmount,
    totalIncome: picks.reduce((s, p) => s + p.amount * p.rate, 0),
    riskRatio: totalAmount > 0 ? riskUsed / totalAmount : 0,
  };
}

// ─────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────
const man = (n: number) => `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────
function Metric({
  label, value, tone, emphasize,
}: { label: string; value: string; tone?: string; emphasize?: boolean }) {
  const toneColor = ({ green: C.green, gold: C.gold, terracotta: C.terracotta, slate: C.slate } as Record<string, string>)[tone ?? ""] ?? C.ink;
  const toneBg   = ({ green: C.greenSoft, gold: C.goldSoft, terracotta: C.terracottaSoft, slate: C.grayBg } as Record<string, string>)[tone ?? ""] ?? C.paper;
  return (
    <div style={{ background: emphasize ? toneBg : "transparent", border: `1px solid ${emphasize ? toneColor : C.line}`, borderRadius: 10, padding: "9px 11px" }}>
      <div style={{ fontSize: 11, color: C.slate, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: emphasize ? 17 : 15, fontWeight: 800, color: toneColor }}>{value}</div>
    </div>
  );
}

function AllocationBreakdown({ picks, totalAmount, totalIncome }: AllocResult) {
  if (totalAmount === 0) {
    return <div style={{ fontSize: 12, color: C.slate, padding: "6px 0" }}>이전 금액을 조정하면 추천 종목이 표시됩니다.</div>;
  }
  return (
    <div style={{ marginTop: 10, marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
        <Sparkles size={12} /> 추천 이전 종목 (배당률/이자율 우선순위)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {picks.map(p => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, background: C.paper, borderRadius: 6, padding: "5px 8px" }}>
            <span>{p.name} <span style={{ color: C.slate }}>({p.category})</span></span>
            <span style={{ fontWeight: 700 }}>{man(p.amount)} · {pct(p.rate)}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: C.slate, marginTop: 6 }}>
        가중평균 배당률/이자율 {pct(totalIncome / totalAmount)}
      </div>
    </div>
  );
}

function ScenarioCard({
  icon, title, children, blocked, blockedReason,
}: {
  icon: React.ReactNode; title: string;
  children?: React.ReactNode; blocked?: boolean; blockedReason?: string;
}) {
  return (
    <div style={{ background: blocked ? C.grayBg : C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 14 }}>
        <span style={{ color: blocked ? C.slate : "#f97316" }}>{icon}</span>
        <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 15, color: blocked ? C.slate : C.navy }}>{title}</div>
      </div>
      {blocked ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 8, padding: "18px 6px", color: C.slate }}>
          <Lock size={22} />
          <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{blockedReason}</div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────
interface PensionTaxPanelProps {
  /** 한계세율 (소수, 예: 0.45). ExistingPortfolioTab과 동일한 로직으로 부모에서 계산해 전달. */
  tMarginal: number;
  /** true이면 접기/펼치기 없이 항상 본문만 표시 (모달 내부에서 사용). */
  alwaysOpen?: boolean;
  /** 탭4에서 계산된 금융소득 요약. 없으면 localStorage에서 자동 읽음. */
  financialSummary?: FinancialIncomeSummary | null;
  /** 탭3-3의 신규 포트폴리오 자산 목록. 없으면 localStorage에서 자동 읽음. */
  portfolioAssets?: RawAsset[];
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export default function PensionTaxPanel({
  tMarginal,
  alwaysOpen = false,
  financialSummary: propSummary,
  portfolioAssets: propAssets,
}: PensionTaxPanelProps) {
  const { selectedCustomer } = useCustomerContext();
  const [isOpen, setIsOpen] = useState(false);
  const open = alwaysOpen || isOpen;
  const [localAssets,  setLocalAssets]  = useState<RawAsset[]>([]);
  const [localSummary, setLocalSummary] = useState<FinancialIncomeSummary | null>(null);

  // ── Read from localStorage when props are absent ─────────────────
  useEffect(() => {
    const read = () => {
      try {
        if (!propAssets) {
          const s = localStorage.getItem(NEW_PORTFOLIO_ASSETS_KEY);
          if (s) setLocalAssets(JSON.parse(s) as RawAsset[]);
        }
        if (!propSummary) {
          const s = localStorage.getItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY);
          if (s) setLocalSummary(JSON.parse(s) as FinancialIncomeSummary);
        }
      } catch {}
    };
    read();
    window.addEventListener("portfolio-result-updated", read);
    window.addEventListener("new-financial-income-updated", read);
    return () => {
      window.removeEventListener("portfolio-result-updated", read);
      window.removeEventListener("new-financial-income-updated", read);
    };
  }, [propAssets, propSummary]);

  const rawAssets = propAssets ?? localAssets;
  const summary   = propSummary ?? localSummary;

  const TOP_MARGINAL_RATE = tMarginal * LOCAL_TAX_MULTIPLIER;

  // ── Build SimAsset array from portfolio ──────────────────────────
  const simAssets: SimAsset[] = useMemo(() =>
    rawAssets
      .map((a, i) => {
        const bal = toBalance(a);
        return {
          id:        String(i),
          name:      a.name || `자산${i + 1}`,
          category:  toCategory(a),
          riskClass: toRiskClass(a),
          balance:   bal,
          rate:      a.dividendYield ?? (a.bond_yield != null ? a.bond_yield / 100 : 0),
          remaining: bal,
        };
      })
      .filter(a => a.balance > 0 && a.category !== "기타"),
  [rawAssets]);

  const baseFinancialIncome = summary?.totalFinancialIncome ?? 0;
  const neverEligibleIncome = simAssets
    .filter(a => NEVER_ELIGIBLE.includes(a.category))
    .reduce((s, a) => s + a.balance * a.rate, 0);
  const isOverThreshold = baseFinancialIncome > THRESHOLD;

  // ── 기납입액 state (고객별 localStorage 격리) ────────────────────
  const [priorSaving, setPriorSaving] = useState(0);
  const [priorIrp,    setPriorIrp]    = useState(0);
  const [priorIsa,    setPriorIsa]    = useState(0);

  // 고객 전환 시 해당 고객의 기납입액 로드
  useEffect(() => {
    try {
      const raw = localStorage.getItem(priorKey(selectedCustomer));
      if (raw) {
        const d = JSON.parse(raw) as { saving?: number; irp?: number; isa?: number };
        setPriorSaving(typeof d.saving === "number" ? d.saving : 0);
        setPriorIrp(typeof d.irp    === "number" ? d.irp    : 0);
        setPriorIsa(typeof d.isa    === "number" ? d.isa    : 0);
      } else {
        setPriorSaving(0); setPriorIrp(0); setPriorIsa(0);
      }
    } catch {}
  }, [selectedCustomer]);

  // 기납입액 변경 즉시 저장 (onChange 핸들러에서 호출)
  const savePrior = useCallback((patch: { saving?: number; irp?: number; isa?: number }) => {
    try {
      const key = priorKey(selectedCustomer);
      const cur = (() => { try { return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, number>; } catch { return {}; } })();
      localStorage.setItem(key, JSON.stringify({ ...cur, ...patch }));
    } catch {}
  }, [selectedCustomer]);

  const handlePriorSaving = (v: number) => { setPriorSaving(v); savePrior({ saving: v }); };
  const handlePriorIrp    = (v: number) => { setPriorIrp(v);    savePrior({ irp: v }); };
  const handlePriorIsa    = (v: number) => { setPriorIsa(v);    savePrior({ isa: v }); };

  // ── Scenario state ───────────────────────────────────────────────
  const [savingAmountRaw, setSavingAmountRaw] = useState(6_000_000);
  const [irpAmountRaw,    setIrpAmountRaw]    = useState(3_000_000);
  const [isaRestricted,   setIsaRestricted]   = useState(true);
  const [isaAmountRaw,    setIsaAmountRaw]    = useState(20_000_000);
  const [isaInitialized,  setIsaInitialized]  = useState(false);

  // Sync ISA restriction with actual threshold when data first loads
  useEffect(() => {
    if (!isaInitialized && summary !== null) {
      setIsaRestricted(summary.isOverThreshold);
      setIsaInitialized(true);
    }
  }, [summary, isaInitialized]);

  // ── 기납입액 반영 잔여 한도 계산 ─────────────────────────────────
  const savingMax       = Math.max(SAVING_CREDIT_MAX - priorSaving, 0);
  const savingAmount    = Math.min(savingAmountRaw, savingMax);
  const irpCreditMax    = Math.max(COMBINED_CREDIT_MAX - priorSaving - priorIrp - savingAmount, 0); // 세액공제 잔여한도
  const irpMax          = Math.max(PENSION_MAX - priorSaving - priorIrp - savingAmount, 0);          // 실제 납입 잔여한도
  const irpAmount       = Math.min(irpAmountRaw, irpMax);
  const isaMax       = Math.max(20_000_000 - priorIsa, 0);
  const isaAmount    = Math.min(isaAmountRaw, isaMax);
  const isaEligible  = !isaRestricted;

  // ── Sequential allocation (연금저축 → IRP → ISA 우선권) ──────────
  const consumed: Record<string, number> = {};
  const pool = () => simAssets.map(a => ({ ...a, remaining: a.balance - (consumed[a.id] ?? 0) }));

  const savingResult = allocateGreedy(filterEligible(pool(), "saving"), savingAmount);
  savingResult.picks.forEach(p => { consumed[p.id] = (consumed[p.id] ?? 0) + p.amount; });

  const irpResult = allocateIRP(filterEligible(pool(), "irp"), irpAmount);
  irpResult.picks.forEach(p => { consumed[p.id] = (consumed[p.id] ?? 0) + p.amount; });

  const isaResult = isaEligible
    ? allocateGreedy(filterEligible(pool(), "isa"), isaAmount)
    : { picks: [], totalAmount: 0, totalIncome: 0 };

  // ── Tax calculations ─────────────────────────────────────────────
  // 세액공제는 연금저축 600만+IRP 합산 900만원까지만, 초과분은 과세이연 효과만
  const creditableSaving = Math.min(savingResult.totalAmount, SAVING_CREDIT_MAX);
  const creditableIrp    = Math.min(irpResult.totalAmount, irpCreditMax);
  const creditPension    = (creditableSaving + creditableIrp) * 0.132;
  const irpDeferralOnly  = Math.max(irpResult.totalAmount - creditableIrp, 0); // 900만 초과분
  const isaProfit       = isaResult.totalIncome;
  const isaSaving       = isaProfit * GENERAL_RATE - Math.max(isaProfit - ISA_NONTAX, 0) * ISA_SEPARATE_RATE;
  const totalAvoided    = savingResult.totalIncome + irpResult.totalIncome + isaProfit;
  const afterIncome     = Math.max(baseFinancialIncome - totalAvoided, 0);
  const overBefore      = Math.max(baseFinancialIncome - THRESHOLD, 0);
  const overAfter       = Math.max(afterIncome - THRESHOLD, 0);
  const thresholdSaving = (overBefore - overAfter) * TOP_MARGINAL_RATE;
  const totalBenefit    = creditPension + thresholdSaving + isaSaving;

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className={alwaysOpen ? "" : "rounded-xl border border-slate-200 bg-white shadow-soft overflow-hidden"}>
      {/* ─── Collapsed header (토글 모드에서만 표시) ─── */}
      {!alwaysOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-rose-50 transition text-left"
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-rose-700">
              <Sparkles size={13} /> 절세 제안 전략
            </span>
            {totalBenefit > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                연 최대 {man(totalBenefit)} 절세
              </span>
            )}
            {!open && baseFinancialIncome > 0 && (
              <span className="text-xs text-slate-400 font-medium">
                · 금융소득 {man(baseFinancialIncome)}
                {isOverThreshold ? " (종합과세 대상)" : " (종합과세 미대상)"}
              </span>
            )}
          </div>
          {open
            ? <ChevronUp size={16} className="shrink-0 text-slate-400" />
            : <ChevronDown size={16} className="shrink-0 text-slate-400" />}
        </button>
      )}

      {/* ─── Expanded body ─── */}
      {open && (
        <div style={{ fontFamily: sans, color: C.ink, borderTop: `1px solid ${C.line}` }}>
          {/* Sub-header */}
          <div className="px-5 py-3 bg-rose-50 border-b border-rose-100">
            <p className="text-xs font-bold uppercase tracking-wide text-rose-600">절세 제안 전략</p>
            <p className="text-sm font-bold text-slate-700 mt-0.5">신규 포트폴리오 기반 계좌 이전 효과 시뮬레이션</p>
            <p className="text-xs text-slate-400 mt-0.5">한계세율 {pct(tMarginal)} · 지방소득세 포함 {pct(TOP_MARGINAL_RATE)} 적용</p>
          </div>

          <div style={{ padding: "16px 20px" }}>
            {/* Financial income summary bar */}
            <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 16px", marginBottom: 12, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 11, color: C.slate }}>연간 금융소득 (신규 포폴)</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                  <span style={{ fontWeight: 800, fontSize: 18, color: isOverThreshold ? C.terracotta : C.green }}>
                    {man(baseFinancialIncome)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                    background: isOverThreshold ? C.terracottaSoft : C.greenSoft,
                    color: isOverThreshold ? C.terracotta : C.green }}>
                    {isOverThreshold ? "종합과세 대상" : "종합과세 미대상"}
                  </span>
                </div>
              </div>
              {neverEligibleIncome > 0 && baseFinancialIncome > 0 && (
                <>
                  <div style={{ height: 28, width: 1, background: C.line }} />
                  <div>
                    <div style={{ fontSize: 11, color: C.slate, display: "flex", alignItems: "center", gap: 3 }}>
                      <Ban size={11} /> 3계좌 편입 불가 소득
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.slate }}>
                      {man(neverEligibleIncome)} ({pct(neverEligibleIncome / baseFinancialIncome)})
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Not over threshold notice */}
            {!isOverThreshold && baseFinancialIncome > 0 && (
              <div style={{ background: C.greenSoft, border: `1px solid ${C.green}`, borderRadius: 10, padding: "12px 16px", marginBottom: 12, fontSize: 12.5, lineHeight: 1.6 }}>
                <strong style={{ color: C.green }}>종합과세 구간 절감 효과는 해당없음.</strong>{" "}
                금융소득이 2,000만원 미만이라 초과분이 없습니다. 대신{" "}
                <strong>세액공제 + ISA 비과세·저율과세</strong>를 중심으로 제안하세요.
              </div>
            )}

            {/* No data state */}
            {simAssets.length === 0 && (
              <div style={{ textAlign: "center", padding: "32px 16px", color: C.slate, fontSize: 13, border: `1px dashed ${C.line}`, borderRadius: 12 }}>
                포트폴리오 데이터가 없습니다.<br />
                탭 3-3에서 신규 포트폴리오를 완성하면 자동으로 반영됩니다.
              </div>
            )}

            {simAssets.length > 0 && (
              <>
                {/* Portfolio eligibility table */}
                <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 16px", marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginBottom: 8 }}>
                    보유 종목 · 계좌별 편입 가능 여부
                  </div>
                  <p style={{ fontSize: 11.5, color: C.slate, marginBottom: 10 }}>
                    직접 보유 해외주식·해외채권은 3계좌 모두 편입 불가합니다. 국내 상장 해외ETF(TIGER S&P500 등)는 편입 가능합니다.
                  </p>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${C.line}`, color: C.slate }}>
                          {["종목명", "분류", "평가액", "배당률/이자율", "연금저축", "IRP", "ISA"].map(h => (
                            <th key={h} style={{ padding: "5px 6px", fontWeight: 600, whiteSpace: "nowrap", textAlign: ["연금저축", "IRP", "ISA"].includes(h) ? "center" : "left" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...simAssets].sort((a, b) => b.rate - a.rate).map(a => {
                          const elig = ELIGIBILITY[a.category] ?? { saving: false, irp: false, isa: false };
                          const blocked = NEVER_ELIGIBLE.includes(a.category);
                          return (
                            <tr key={a.id} style={{ borderBottom: `1px solid ${C.line}`, background: blocked ? C.grayBg : "transparent" }}>
                              <td style={{ padding: "5px 6px", fontWeight: 600 }}>{a.name}</td>
                              <td style={{ padding: "5px 6px", color: C.slate }}>{a.category}</td>
                              <td style={{ padding: "5px 6px" }}>{man(a.balance)}</td>
                              <td style={{ padding: "5px 6px", fontWeight: 700, color: C.gold }}>{pct(a.rate)}</td>
                              {(["saving", "irp", "isa"] as const).map(k => (
                                <td key={k} style={{ padding: "5px 6px", textAlign: "center", color: elig[k] ? C.green : C.slate, fontWeight: 700 }}>
                                  {elig[k] ? "✓" : "–"}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Scenario description */}
                <p style={{ fontSize: 12.5, color: C.slate, marginBottom: 12, lineHeight: 1.6 }}>
                  각 카드의 이전 금액을 조정하면 편입 가능한 종목 중 배당률/이자율 순으로 자동 추천합니다.
                  연금저축 → IRP → ISA 순으로 우선권을 둡니다.
                </p>

                {/* Three scenario cards */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 12 }}>
                  {/* 연금저축 */}
                  <ScenarioCard
                    icon={<PiggyBank size={15} />}
                    title="연금저축 추가 납입"
                  >
                    {/* 기납입액 입력 */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6 }}>
                      <span style={{ fontSize: 11, color: C.slate, fontWeight: 600, whiteSpace: "nowrap" }}>올해 기납입액</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="number" min={0} max={600} step={10}
                          value={Math.round(priorSaving / 10000)}
                          onChange={e => handlePriorSaving(Math.max(0, Math.min(600, Number(e.target.value))) * 10000)}
                          style={{ width: 64, fontSize: 12, padding: "2px 6px", border: `1px solid ${C.line}`, borderRadius: 6, textAlign: "right" }}
                        />
                        <span style={{ fontSize: 11, color: C.slate }}>만원</span>
                      </div>
                    </div>
                    {savingMax === 0 ? (
                      <div style={{ fontSize: 12, color: C.terracotta, background: C.terracottaSoft, borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
                        연간 세액공제 한도(600만원)에 도달했습니다.
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: C.green, marginBottom: 4 }}>
                        세액공제 잔여한도 {man(savingMax)}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: C.slate, marginBottom: 4, fontWeight: 600 }}>추가 납입할 금액</div>
                    <input
                      type="range" min={0} max={savingMax} step={100000}
                      value={savingAmount}
                      onChange={e => setSavingAmountRaw(Number(e.target.value))}
                      disabled={savingMax === 0}
                      style={{ width: "100%", accentColor: "#f97316" }}
                    />
                    <div style={{ textAlign: "right", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{man(savingAmount)}</div>
                    <AllocationBreakdown {...savingResult} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      <Metric label="세액공제 (13.2%)" value={man(savingResult.totalAmount * 0.132)} tone="green" />
                      <Metric label="연간 회피 금융소득" value={man(savingResult.totalIncome)} tone="green" />
                    </div>
                  </ScenarioCard>

                  {/* IRP */}
                  <ScenarioCard
                    icon={<ShieldCheck size={15} />}
                    title="IRP 추가 납입"
                  >
                    {/* 기납입액 입력 */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6 }}>
                      <span style={{ fontSize: 11, color: C.slate, fontWeight: 600, whiteSpace: "nowrap" }}>올해 기납입액</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="number" min={0} max={900} step={10}
                          value={Math.round(priorIrp / 10000)}
                          onChange={e => handlePriorIrp(Math.max(0, Math.min(900, Number(e.target.value))) * 10000)}
                          style={{ width: 64, fontSize: 12, padding: "2px 6px", border: `1px solid ${C.line}`, borderRadius: 6, textAlign: "right" }}
                        />
                        <span style={{ fontSize: 11, color: C.slate }}>만원</span>
                      </div>
                    </div>
                    {irpMax === 0 ? (
                      <div style={{ fontSize: 12, color: C.terracotta, background: C.terracottaSoft, borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
                        연금저축+IRP 합산 납입한도(1,800만원)에 도달했습니다.
                      </div>
                    ) : (
                      <div style={{ marginBottom: 4 }}>
                        <div style={{ fontSize: 11, color: C.green }}>
                          세액공제 잔여한도 {man(irpCreditMax)}
                        </div>
                        <div style={{ fontSize: 11, color: C.slate }}>
                          총 납입 잔여한도 {man(irpMax)}
                        </div>
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: C.slate, marginBottom: 4, fontWeight: 600 }}>추가 납입할 금액</div>
                    <input
                      type="range" min={0} max={irpMax} step={100000}
                      value={irpAmount}
                      onChange={e => setIrpAmountRaw(Number(e.target.value))}
                      disabled={irpMax === 0}
                      style={{ width: "100%", accentColor: "#f97316" }}
                    />
                    <div style={{ textAlign: "right", fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{man(irpAmount)}</div>
                    {irpDeferralOnly > 0 && (
                      <div style={{ textAlign: "right", fontSize: 10, color: C.slate, marginBottom: 4 }}>
                        세액공제 {man(creditableIrp)} · 과세이연만 {man(irpDeferralOnly)}
                      </div>
                    )}
                    <AllocationBreakdown {...irpResult} />
                    {irpResult.totalAmount > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", border: `1px solid ${C.line}` }}>
                          <div style={{ width: `${irpResult.riskRatio * 100}%`, background: C.gold }} />
                          <div style={{ width: `${(1 - irpResult.riskRatio) * 100}%`, background: C.green }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.slate, marginTop: 3 }}>
                          <span>위험자산 {pct(irpResult.riskRatio)} (상한 70%)</span>
                          <span>안전자산 {pct(1 - irpResult.riskRatio)}</span>
                        </div>
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      <Metric label="세액공제 (13.2%)" value={man(creditableIrp * 0.132)} tone="green" />
                      <Metric label="연간 회피 금융소득" value={man(irpResult.totalIncome)} tone="green" />
                    </div>
                  </ScenarioCard>

                  {/* ISA */}
                  <ScenarioCard
                    icon={<TrendingUp size={15} />}
                    title="ISA 활용"
                    blocked={isaRestricted}
                    blockedReason="직전 3개 과세기간 중 금융소득종합과세 대상자는 ISA 신규가입·연장이 제한됩니다."
                  >
                    {/* 기납입액 입력 */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 6 }}>
                      <span style={{ fontSize: 11, color: C.slate, fontWeight: 600, whiteSpace: "nowrap" }}>올해 기납입액</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="number" min={0} max={2000} step={100}
                          value={Math.round(priorIsa / 10000)}
                          onChange={e => handlePriorIsa(Math.max(0, Math.min(2000, Number(e.target.value))) * 10000)}
                          style={{ width: 64, fontSize: 12, padding: "2px 6px", border: `1px solid ${C.line}`, borderRadius: 6, textAlign: "right" }}
                        />
                        <span style={{ fontSize: 11, color: C.slate }}>만원</span>
                      </div>
                    </div>
                    {isaMax === 0 ? (
                      <div style={{ fontSize: 12, color: C.terracotta, background: C.terracottaSoft, borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
                        연간 납입한도(2,000만원)에 도달했습니다.
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: C.green, marginBottom: 4 }}>
                        납입 잔여한도 {man(isaMax)}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: C.slate, marginBottom: 4, fontWeight: 600 }}>추가 납입할 금액</div>
                    <input
                      type="range" min={0} max={isaMax} step={500000}
                      value={isaAmount}
                      onChange={e => setIsaAmountRaw(Number(e.target.value))}
                      disabled={isaMax === 0}
                      style={{ width: "100%", accentColor: "#f97316" }}
                    />
                    <div style={{ textAlign: "right", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{man(isaAmount)}</div>
                    <AllocationBreakdown {...isaResult} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      <Metric label="ISA 절세 (200만원 비과세 · 초과분 9.9%)" value={man(isaSaving)} tone="green" />
                    </div>
                  </ScenarioCard>
                </div>

                {/* ISA restriction toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.slate, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={isaRestricted}
                      onChange={e => setIsaRestricted(e.target.checked)}
                    />
                    최근 3년 내 금융소득종합과세 대상자였음 (자동 반영 · 직접 조정 가능)
                  </label>
                  <div style={{ fontSize: 11, color: C.slate, textAlign: "right", lineHeight: 1.7, flexShrink: 0 }}>
                    <div>고소득자 기준 (13.2%) 적용</div>
                    <div>저소득자 기준 (16.5%) 적용</div>
                  </div>
                </div>

                {/* Summary card */}
                <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                    <Info size={15} style={{ color: C.gold }} />
                    <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 15, color: C.navy }}>
                      선택 시나리오 합산 절세효과
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                    <Metric label="연금계좌 세액공제 (13.2%)" value={man(creditPension)} tone="green" />
                    <Metric label="ISA 세금 절감" value={man(isaSaving)} tone="green" />
                    <Metric
                      label="종합과세 구간 절감"
                      value={isOverThreshold ? man(thresholdSaving) : "해당없음"}
                      tone={isOverThreshold ? "green" : "slate"}
                    />
                    <Metric label="연간 총 절세효과" value={man(totalBenefit)} tone="gold" emphasize />
                  </div>
                </div>

                {/* Footnote */}
                <div style={{ fontSize: 11, color: C.slate, marginTop: 14, lineHeight: 1.7, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
                  탭 3-3 신규 포트폴리오 및 탭 4 금융소득 계산 결과를 자동 반영합니다.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
