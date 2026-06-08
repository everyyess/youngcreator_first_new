"use client";

import { useState, type CSSProperties } from "react";
import { BarChart3, ClipboardList, Info, LockKeyhole, PieChart, ShieldCheck, Sparkles, UserRound, WalletCards } from "lucide-react";
import { useCustomerContext } from "../CustomerContext";
import { fieldGroups, returnOptions, riskExperienceOptions } from "../CustomerContext";
import type { SmartExtractionPayload } from "../CustomerContext";
import { Panel, TextField, TextAreaField, IncomeWithNoneField, ExpectedReturnField, ChoiceGroup, MultiChoiceGroup, LiquiditySummary, CheckerboardGrid } from "../ui";

const grayQuestionCardStyle = {
  "--question-card-bg": "#f8fafc",
  "--question-card-border": "#d7dde8",
} as CSSProperties;

type ExtractionSection = Record<string, unknown>;
type SmartExtractionEnvelope = {
  extracted?: {
    profile?: ExtractionSection;
    financialProfile?: ExtractionSection;
    financial?: ExtractionSection;
    rrttllu?: ExtractionSection;
  };
  inferred?: {
    profile?: ExtractionSection;
    financialProfile?: ExtractionSection;
    financial?: ExtractionSection;
    rrttllu?: ExtractionSection;
  };
  unmapped?: string[];
  notes?: string[];
  confidence?: Record<string, number>;
};

const inferredSelectableKeys = new Set([
  "returnObjective",
  "investmentExperience",
  "knowledgeLevel",
  "derivativesExperience",
  "financialAssetRatio",
  "investmentAssetRatio",
  "riskAttitude",
  "lossResponse",
  "timeHorizon",
  "giftingPlan",
  "globalTaxImportance",
  "recentGlobalTaxSubject",
  "foreignStockTaxImportance",
  "legalConstraints",
]);

function compactSection(section?: ExtractionSection) {
  const next: ExtractionSection = {};
  Object.entries(section ?? {}).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (typeof value === "string" && !value.trim()) return;
    if (Array.isArray(value) && !value.length) return;
    next[key] = value;
  });
  return next;
}

function pickSelectable(section?: ExtractionSection) {
  const next: ExtractionSection = {};
  Object.entries(section ?? {}).forEach(([key, value]) => {
    if (!inferredSelectableKeys.has(key)) return;
    if (value === null || value === undefined) return;
    if (typeof value === "string" && !value.trim()) return;
    if (Array.isArray(value) && !value.length) return;
    next[key] = value;
  });
  return next;
}

function mergeUniqueNotes(existing: unknown, notes: string[]) {
  const values = [
    ...(typeof existing === "string" ? existing.split(/\n/) : []),
    ...notes,
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return values.filter((value, index, list) => {
    return index === list.findIndex((other) => other === value || other.includes(value) || value.includes(other));
  }).join("\n");
}

function toSmartExtractionPayload(envelope: SmartExtractionEnvelope): SmartExtractionPayload {
  const extracted = envelope.extracted ?? {};
  const inferred = envelope.inferred ?? {};
  const financial = compactSection(extracted.financialProfile ?? extracted.financial);
  const rrttllu = {
    ...compactSection(extracted.rrttllu),
    ...pickSelectable(inferred.rrttllu),
  };
  const mappedValues = [
    ...Object.values(compactSection(extracted.profile)),
    ...Object.values(financial),
    ...Object.values(rrttllu),
  ].flat().filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const preservedNotes = [...(envelope.notes ?? []), ...(envelope.unmapped ?? [])]
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => !mappedValues.some((mapped) => mapped.includes(value) || value.includes(mapped)))
    .filter(Boolean);
  if (preservedNotes.length) {
    rrttllu.uniqueOther = mergeUniqueNotes(rrttllu.uniqueOther, preservedNotes);
  }
  return {
    profile: compactSection(extracted.profile) as SmartExtractionPayload["profile"],
    financial: financial as SmartExtractionPayload["financial"],
    rrttllu: rrttllu as SmartExtractionPayload["rrttllu"],
  };
}

// ── Editable customer fields ─────────────────────────────────────────────────
function EditableField({
  label, value, placeholder, widthClassName = "w-32", onChange,
}: {
  label: string; value: string; placeholder?: string; widthClassName?: string; onChange: (value: string) => void;
}) {
  return (
    <label className={`block ${widthClassName}`}>
      <span className="mb-1 block text-xs font-bold text-samsung">[{label}]</span>
      <input
        className="h-11 min-w-0 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-navy transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
        value={value}
        placeholder={placeholder ?? "입력 대기"}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function CustomerInfoCard() {
  const { selectedCustomerProfile, updateCustomerProfile } = useCustomerContext();
  const profile = selectedCustomerProfile;
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-soft">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex min-w-32 items-center gap-2 pb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-samsung">
            <UserRound size={18} />
          </div>
          <p className="text-base font-bold text-navy">고객 프로필</p>
        </div>
        <div className="ml-0 flex flex-wrap items-end gap-3 lg:ml-6">
          <EditableField label="성명" value={profile.name} onChange={(v) => updateCustomerProfile("name", v)} />
          <EditableField label="성별" value={profile.gender} onChange={(v) => updateCustomerProfile("gender", v)} />
          <div className="flex flex-wrap gap-2">
            <EditableField label="출생연도" value={profile.birth_year ?? profile.birthYear} placeholder="입력 대기" onChange={(v) => updateCustomerProfile("birthYear", v)} />
            <EditableField label="만 나이" value={profile.age} placeholder="입력 대기" onChange={(v) => updateCustomerProfile("age", v)} />
          </div>
          <EditableField label="직업" value={profile.job} widthClassName="w-80 max-w-full" onChange={(v) => updateCustomerProfile("job", v)} />
        </div>
      </div>
    </section>
  );
}

function SmartInputCard({
  onOpenSummary,
}: {
  onOpenSummary: () => void;
}) {
  const { applySmartExtraction, formData, resetSelectedCustomerInputs, setSmartInputNote } = useCustomerContext();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const note = formData.smartInputNote;

  const extract = async () => {
    if (!note.trim()) {
      setMessage("자연어 메모를 먼저 입력해주세요.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/extract-customer/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) throw new Error(result?.error ?? "extract failed");
      console.log("Smart Input extraction result", result.data);
      if (Array.isArray(result.data?.unmapped) && result.data.unmapped.length) {
        console.warn("Smart Input unmapped fields", result.data.unmapped);
      }
      if (Array.isArray(result.data?.notes) && result.data.notes.length) {
        console.warn("Smart Input preserved candidate notes", result.data.notes);
      }
      applySmartExtraction(toSmartExtractionPayload(result.data as SmartExtractionEnvelope));
      setMessage(result.source === "mock" ? "Mock Parser로 추출 가능한 항목을 반영했습니다." : "Gemini 추출 결과를 입력값에 반영했습니다.");
    } catch {
      setMessage("추출에 실패했습니다. 직접 입력하거나 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    if (!window.confirm("지금까지 입력한 정보가 사라집니다. 정말 초기화하시겠습니까?")) return;
    setMessage("");
    resetSelectedCustomerInputs();
  };

  return (
    <section className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 shadow-soft sm:p-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_140px]">
        <div>
          <p className="mb-2 text-sm font-extrabold text-yellow-900">Smart Input</p>
          <textarea
            className="min-h-40 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] leading-6 text-ink shadow-inner transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
            value={note}
            placeholder="고객 정보와 니즈를 자연어로 입력합니다."
            onChange={(e) => setSmartInputNote(e.target.value)}
          />
          {message ? <p className={`mt-2 text-sm font-bold ${message.includes("실패") ? "text-red-700" : "text-yellow-900"}`}>{message}</p> : null}
        </div>
        <div className="grid content-start gap-2 lg:pt-7">
          <button
            type="button"
            onClick={extract}
            disabled={loading}
            className="min-h-11 rounded-lg border border-yellow-300 bg-white px-4 py-2 text-sm font-extrabold text-yellow-900 transition hover:bg-yellow-100 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "추출 중" : "추출하기"}
          </button>
          <button
            type="button"
            onClick={onOpenSummary}
            className="min-h-11 rounded-lg border border-yellow-300 bg-white px-4 py-2 text-sm font-extrabold text-yellow-900 transition hover:bg-yellow-100"
          >
            분석 및 요약
          </button>
          <button
            type="button"
            onClick={resetAll}
            className="min-h-11 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-extrabold text-red-700 transition hover:bg-red-50"
          >
            초기화
          </button>
        </div>
      </div>
    </section>
  );
}

function summaryValue(value: string | null | undefined) {
  return value && value.trim() ? value : "입력 대기";
}

const reasonFieldPattern = /(?:이유|reason|rationale|description|설명)\s*[:：]/i;
const assetFieldPattern = /(?:선호\s*자산|선호하는\s*자산|기피\s*자산|피하고\s*싶은\s*자산|자산|asset|assets|preferred_assets|avoided_assets|계획)\s*[:：]/i;

function extractAssetSegment(line: string) {
  const trimmed = line.trim().replace(/^[-•·\s]+/, "");
  if (!trimmed || reasonFieldPattern.test(trimmed) && trimmed.search(reasonFieldPattern) === 0) return "";

  const reasonIndex = trimmed.search(reasonFieldPattern);
  const beforeReason = reasonIndex >= 0 ? trimmed.slice(0, reasonIndex) : trimmed;
  const assetMatch = beforeReason.match(assetFieldPattern);
  const assetText = assetMatch ? beforeReason.slice((assetMatch.index ?? 0) + assetMatch[0].length) : beforeReason;

  return assetText
    .replace(/\([^)]*\)/g, "")
    .replace(/(?:이유|reason|rationale|description|설명)\s*[:：].*$/i, "")
    .trim();
}

function assetNamesOnly(value: string) {
  const items = value
    .split(/\n|;/)
    .map(extractAssetSegment)
    .flatMap((segment) => segment.split(","))
    .map((item) => item.trim().replace(/^[-•·\s]+/, ""))
    .filter(Boolean);
  return items.length ? items.join(", ") : "입력 대기";
}

function formatKoreanKrw(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^([\d,]+)\s*원$/);
  if (!match) return value;

  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return value;

  const eok = Math.floor(amount / 100000000);
  const man = Math.floor((amount % 100000000) / 10000);
  if (eok && man) return `${eok}억 ${man.toLocaleString("ko-KR")}만`;
  if (eok) return `${eok}억`;
  if (man) return `${man.toLocaleString("ko-KR")}만`;
  return `${amount.toLocaleString("ko-KR")}원`;
}

const riskGradeGuide = [
  {
    range: "85~100점",
    level: "초고위험",
    detail: "1등급 - 초고위험 - 매우 높은 위험",
    color: "text-red-600",
    description: "시장 평균 수익률보다 훨씬 높은 투자수익을 추구하며, 손실 위험을 적극적으로 수용합니다.",
  },
  {
    range: "70~84점",
    level: "고위험",
    detail: "2등급 - 고위험 - 높은 위험",
    color: "text-orange-600",
    description: "높은 투자수익을 위해 상당 부분을 위험자산에 투자합니다.",
  },
  {
    range: "55~69점",
    level: "중위험",
    detail: "3등급 - 중위험 - 다소 높은 위험",
    color: "text-yellow-700",
    description: "다소 높은 투자수익을 위해 상당 부분을 위험자산에 투자합니다.",
  },
  {
    range: "40~54점",
    level: "저위험 [1]",
    detail: "4등급 - 저위험 [1] - 보통 위험",
    color: "text-lime-600",
    description: "예·적금보다 높은 수익을 기대할 수 있다면 일부 위험을 감수합니다.",
  },
  {
    range: "25~39점",
    level: "저위험 [2]",
    detail: "5등급 - 저위험 [2] - 낮은 위험",
    color: "text-green-600",
    description: "손실 위험 최소화를 목표로 하지만, 수익을 위해 단기적인 위험을 수용합니다.",
  },
  {
    range: "0~24점",
    level: "초저위험",
    detail: "6등급 - 초저위험 - 매우 낮은 위험",
    color: "text-blue-600",
    description: "예·적금 수준의 기대수익률을 추구하며, 원금 손실 발생을 원하지 않습니다.",
  },
];

function summaryRiskGrade(score: number) {
  if (score >= 85) {
    return {
      level: "초고위험",
      detail: "1등급, 매우 높은 위험",
      color: riskGradeGuide[0].color,
      description: riskGradeGuide[0].description,
    };
  }
  if (score >= 70) {
    return {
      level: "고위험",
      detail: "2등급, 높은 위험",
      color: riskGradeGuide[1].color,
      description: riskGradeGuide[1].description,
    };
  }
  if (score >= 55) {
    return {
      level: "중위험",
      detail: "3등급, 다소 높은 위험",
      color: riskGradeGuide[2].color,
      description: riskGradeGuide[2].description,
    };
  }
  if (score >= 40) {
    return {
      level: "저위험",
      detail: "4등급, 보통 위험",
      color: riskGradeGuide[3].color,
      description: riskGradeGuide[3].description,
    };
  }
  if (score >= 25) {
    return {
      level: "저위험",
      detail: "5등급, 낮은 위험",
      color: riskGradeGuide[4].color,
      description: riskGradeGuide[4].description,
    };
  }
  return {
    level: "초저위험",
    detail: "6등급, 매우 낮은 위험",
    color: riskGradeGuide[5].color,
    description: riskGradeGuide[5].description,
  };
}

function SummaryRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid sm:grid-cols-[170px_minmax(0,1fr)]">
      <div className="flex items-center bg-sky-100 px-4 py-3 text-sm font-bold text-samsung">{label}</div>
      <div className="px-4 py-3 text-sm font-semibold leading-6 text-navy">{children}</div>
    </div>
  );
}

function SummaryChips({ rows }: { rows: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-sky-100 px-2.5 py-1 text-xs font-extrabold text-samsung">{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

function SummaryPopup({
  open,
  onClose,
  formData,
  riskResult,
  liquiditySummary,
}: {
  open: boolean;
  onClose: () => void;
  formData: ReturnType<typeof useCustomerContext>["formData"];
  riskResult: ReturnType<typeof useCustomerContext>["riskResult"];
  liquiditySummary: ReturnType<typeof useCustomerContext>["liquiditySummary"];
}) {
  const [riskGuideOpen, setRiskGuideOpen] = useState(false);
  if (!open) return null;

  const financial = formData.financial;
  const rrttllu = formData.rrttllu;
  const riskGrade = summaryRiskGrade(riskResult.score);
  const returnRows: [string, string][] = [
    ["투자 목적", summaryValue(rrttllu.returnObjective)],
    ["기대수익률", rrttllu.expectedReturnUnknown ? "구체적인 수치는 모름" : summaryValue(rrttllu.expectedReturn)],
  ];
  const financialSummary: [string, string][] = [
    ["총 자산", summaryValue(financial.totalAssets)],
    ["금융자산", summaryValue(financial.financialAssets)],
    ["부동산", summaryValue(financial.realEstate)],
    ["부채", summaryValue(financial.debt)],
    ["연 고정소득", summaryValue(financial.annualFixedIncome)],
    ["월 고정지출", summaryValue(financial.monthlyFixedExpense)],
    ["향후 예상되는 비정기 소득", financial.irregularIncomeNone ? "없음" : summaryValue(financial.irregularIncome)],
  ];
  const taxSummary: [string, string][] = [
    ["사전증여", summaryValue(rrttllu.giftingPlan)],
    ["종합과세 절감", summaryValue(rrttllu.globalTaxImportance)],
    ["최근 과세대상", summaryValue(rrttllu.recentGlobalTaxSubject)],
    ["해외주식 절세", summaryValue(rrttllu.foreignStockTaxImportance)],
  ];
  const legalSummary = rrttllu.legalConstraints.length
    ? `${rrttllu.legalConstraints.join(", ")}${rrttllu.legalConstraintOther ? ` (${rrttllu.legalConstraintOther})` : ""}`
    : "입력 대기";
  const legalRows: [string, string][] = [
    ["법적/제도적 제약", legalSummary],
  ];
  const liquidityRows: [string, string][] = [
    ["필요자금", formatKoreanKrw(liquiditySummary.requiredDisplay)],
    ["투자 가능 자산", formatKoreanKrw(liquiditySummary.investableDisplay)],
  ];
  const uniqueRows: [string, string][] = [
    ["선호하는 자산", assetNamesOnly(rrttllu.preferredAssets)],
    ["피하고 싶은 자산", assetNamesOnly(rrttllu.avoidedAssets)],
    ["계속 보유하거나 향후 처분할 계획", assetNamesOnly(rrttllu.holdingOrDisposalPlan)],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
      <section className="max-h-[86vh] w-full max-w-4xl overflow-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-samsung">분석 및 요약</p>
            <h2 className="mt-1 text-xl font-bold text-navy">고객 재무 현황 및 RRTTLLU 분석 요약</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            닫기
          </button>
        </div>
        <div className="grid gap-2">
          <SummaryRow label="고객 재무 현황"><SummaryChips rows={financialSummary} /></SummaryRow>
          <SummaryRow label="Return"><SummaryChips rows={returnRows} /></SummaryRow>
          <SummaryRow
            label={
              <div className="flex items-center gap-2">
                <span>Risk</span>
                <button
                  type="button"
                  onClick={() => setRiskGuideOpen(true)}
                  aria-label="위험등급 안내 보기"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-sky-200 bg-white text-samsung transition hover:bg-sky-50"
                >
                  <Info size={14} />
                </button>
              </div>
            }
          >
            <div>
              <span>{riskResult.score}/100 </span>
              <span className={`font-extrabold ${riskGrade.color}`}>{riskGrade.level}</span>
              <span> ({riskGrade.detail})</span>
              <p className="mt-2 font-semibold text-slate-700">{riskGrade.description}</p>
            </div>
          </SummaryRow>
          <SummaryRow label="Time Horizon"><SummaryChips rows={[["투자 기간", summaryValue(rrttllu.timeHorizon)]]} /></SummaryRow>
          <SummaryRow label="Tax"><SummaryChips rows={taxSummary} /></SummaryRow>
          <SummaryRow label="Liquidity"><SummaryChips rows={liquidityRows} /></SummaryRow>
          <SummaryRow label="Legal"><SummaryChips rows={legalRows} /></SummaryRow>
          <SummaryRow label="Unique Circumstances"><SummaryChips rows={uniqueRows} /></SummaryRow>
        </div>
        {riskGuideOpen ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 px-4 py-6">
            <section className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-navy">위험등급 안내</h3>
                <button type="button" onClick={() => setRiskGuideOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                  닫기
                </button>
              </div>
              <div className="grid gap-2">
                {riskGradeGuide.map((grade) => (
                  <div key={grade.range} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6">
                    <span className="font-extrabold text-navy">{grade.range}</span>
                    <span className="px-2 text-slate-400">|</span>
                    <span className={`font-extrabold ${grade.color}`}>{grade.detail}</span>
                    <span className="px-2 text-slate-400">|</span>
                    <span className="font-semibold text-slate-700">{grade.description}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}

// ── 고객 성향 분석 탭 메인 컴포넌트 ────────────────────────────────────────
export default function CustomerAnalysisTab() {
  const {
    formData, liquiditySummary, riskResult,
    setFinancial, setRrttllu, setIrregularIncome, toggleNoIrregularIncome,
    setExpectedReturn, toggleExpectedReturnUnknown, toggleInvestmentExperience,
    toggleLegalConstraint,
  } = useCustomerContext();
  const [summaryOpen, setSummaryOpen] = useState(false);

  return (
    <div className="space-y-5">
      <CustomerInfoCard />
      <SmartInputCard onOpenSummary={() => setSummaryOpen(true)} />
      <SummaryPopup
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        formData={formData}
        riskResult={riskResult}
        liquiditySummary={liquiditySummary}
      />

      {/* 기본 재무 정보 */}
      <Panel icon={<WalletCards size={18} />} eyebrow="기본 재무 정보" title="고객 재무 현황" note="※ 금액은 원화(KRW) 기준으로 입력해주세요.">
        <div className="question-card asset-summary-card rounded-lg border border-slate-200 p-4" style={grayQuestionCardStyle}>
          <p className="text-sm font-bold text-slate-800">Q. 현재 자산 현황을 알려주세요.</p>
          <CheckerboardGrid className="asset-detail-grid mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[0.72fr_0.72fr_0.72fr_0.72fr_1.45fr_1.45fr]">
            <TextField compact label="총 자산" value={formData.financial.totalAssets} placeholder="예. 20억 원" onChange={(v) => setFinancial("totalAssets", v)} />
            <TextField compact label="금융자산" value={formData.financial.financialAssets} placeholder="예. 8억 원" onChange={(v) => setFinancial("financialAssets", v)} />
            <TextField compact label="부동산" value={formData.financial.realEstate} placeholder="예. 15억 원" onChange={(v) => setFinancial("realEstate", v)} />
            <TextField compact label="부채" value={formData.financial.debt} placeholder="예. 3억 원" onChange={(v) => setFinancial("debt", v)} />
            <TextField compact label="(가구 기준) 연 고정소득" value={formData.financial.annualFixedIncome} placeholder="예. 3억 원~5억 원" onChange={(v) => setFinancial("annualFixedIncome", v)} />
            <TextField compact label="(가구 기준) 월 고정지출" value={formData.financial.monthlyFixedExpense} placeholder="예. 500만 원~1,000만 원" onChange={(v) => setFinancial("monthlyFixedExpense", v)} />
          </CheckerboardGrid>
        </div>
        <CheckerboardGrid className="grid gap-3">
          <IncomeWithNoneField label="향후 예상되는 비정기 소득" value={formData.financial.irregularIncome} placeholder="예. 연 성과급 6~7억 원, 3년 내 스톡옵션 행사" noneSelected={formData.financial.irregularIncomeNone} onChange={setIrregularIncome} onToggleNone={toggleNoIrregularIncome} />
        </CheckerboardGrid>
      </Panel>

      {/* ① Return */}
      <Panel icon={<BarChart3 size={18} />} eyebrow="RRTTLLU" title="① Return 목표 수익률">
        <CheckerboardGrid className="grid gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
          <ChoiceGroup label="투자 목적은 무엇인가요?" options={returnOptions} value={formData.rrttllu.returnObjective} onChange={(v) => setRrttllu("returnObjective", v)} />
          <ExpectedReturnField value={formData.rrttllu.expectedReturn} unknownSelected={formData.rrttllu.expectedReturnUnknown} onChange={setExpectedReturn} onToggleUnknown={toggleExpectedReturnUnknown} />
        </CheckerboardGrid>
      </Panel>

      {/* ② Risk */}
      <Panel icon={<ShieldCheck size={18} />} eyebrow="RRTTLLU" title="② Risk 위험 허용도">
        <CheckerboardGrid className="grid gap-4 xl:grid-cols-2" invert itemClassName={(index) => (index === 0 ? "xl:col-span-2" : "")}>
          <MultiChoiceGroup label="투자 경험이 있는 금융상품을 모두 선택해주세요." options={riskExperienceOptions} values={formData.rrttllu.investmentExperience} onToggle={toggleInvestmentExperience} />
          <ChoiceGroup label="투자 지식 수준은 어느 정도인가요?" options={fieldGroups.knowledge} value={formData.rrttllu.knowledgeLevel} onChange={(v) => setRrttllu("knowledgeLevel", v)} />
          <ChoiceGroup label="파생상품 투자 경험이 있으신가요?" description="파생상품: 파생상품, 원금비보장형 파생결합 증권, 파생상품펀드, 레버리지/인버스 ETF 등" options={fieldGroups.derivatives} value={formData.rrttllu.derivativesExperience} onChange={(v) => setRrttllu("derivativesExperience", v)} />
          <ChoiceGroup label="총 자산 중 금융자산의 비중" description="금융자산: 예·적금, CMA, 투자자산(주식·채권·펀드·ETF 등) 등" options={fieldGroups.financialAssetRatio} value={formData.rrttllu.financialAssetRatio} onChange={(v) => setRrttllu("financialAssetRatio", v)} />
          <ChoiceGroup label="금융자산 중 투자자산의 비중" description="투자자산: 주식, ETF, 펀드, 채권, 리츠(REITs), ELS 등" options={fieldGroups.investmentAssetRatio} value={formData.rrttllu.investmentAssetRatio} onChange={(v) => setRrttllu("investmentAssetRatio", v)} />
          <ChoiceGroup label="기대이익 및 기대손실 등을 고려한 위험에 대한 태도" options={fieldGroups.riskAttitude} value={formData.rrttllu.riskAttitude} onChange={(v) => setRrttllu("riskAttitude", v)} />
          <ChoiceGroup label="단기적으로 손실이 초과 발생할 때 대응" options={fieldGroups.lossResponse} value={formData.rrttllu.lossResponse} onChange={(v) => setRrttllu("lossResponse", v)} />
        </CheckerboardGrid>
      </Panel>

      {/* ③ Time Horizon */}
      <Panel icon={<ClipboardList size={18} />} eyebrow="RRTTLLU" title="③ Time Horizon 투자 기간">
        <ChoiceGroup label="투자 가능한 기간을 선택해 주세요." options={fieldGroups.timeHorizon} value={formData.rrttllu.timeHorizon} onChange={(v) => setRrttllu("timeHorizon", v)} />
      </Panel>

      {/* ④ Tax */}
      <Panel icon={<PieChart size={18} />} eyebrow="RRTTLLU" title="④ Tax 세금 요인">
        <CheckerboardGrid className="tax-grid grid gap-4 lg:grid-cols-2">
          <ChoiceGroup label="자녀/가족 사전증여 계획" options={fieldGroups.giftingPlan} value={formData.rrttllu.giftingPlan} onChange={(v) => setRrttllu("giftingPlan", v)} />
          <ChoiceGroup label="금융소득종합과세 절감 중요도" options={fieldGroups.taxImportance} value={formData.rrttllu.globalTaxImportance} onChange={(v) => setRrttllu("globalTaxImportance", v)} />
          <ChoiceGroup label="최근 3년 내 금융소득종합과세 대상 여부" options={fieldGroups.recentTax} value={formData.rrttllu.recentGlobalTaxSubject} onChange={(v) => setRrttllu("recentGlobalTaxSubject", v)} />
          <ChoiceGroup label="해외주식 양도소득세 절감 중요도" options={fieldGroups.taxImportance} value={formData.rrttllu.foreignStockTaxImportance} onChange={(v) => setRrttllu("foreignStockTaxImportance", v)} />
        </CheckerboardGrid>
      </Panel>

      {/* ⑤ Liquidity */}
      <Panel icon={<WalletCards size={18} />} eyebrow="RRTTLLU" title="⑤ Liquidity 유동성 필요 시기">
        <CheckerboardGrid className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <TextField label="향후 정기적인 현금흐름 필요" value={formData.rrttllu.regularCashflowNeed} placeholder="예. 20년간 월 생활비 500만 원" onChange={(v) => setRrttllu("regularCashflowNeed", v)} />
          <TextField label="향후 목돈 사용 계획" value={formData.rrttllu.lumpSumPlan} placeholder="예. 5년 후 자녀 유학비 1억원" onChange={(v) => setRrttllu("lumpSumPlan", v)} />
          <TextField label="향후 비상예비자금 확보 계획" value={formData.rrttllu.emergencyReservePlan} placeholder="예. 의료비 등 비상 상황 대비 1억 원" onChange={(v) => setRrttllu("emergencyReservePlan", v)} />
        </CheckerboardGrid>
        <LiquiditySummary summary={liquiditySummary} />
      </Panel>

      {/* ⑥ Legal */}
      <Panel icon={<LockKeyhole size={18} />} eyebrow="RRTTLLU" title="⑥ Legal 법적 규제">
        <CheckerboardGrid className="grid gap-3">
          <MultiChoiceGroup label="투자 의사결정에 영향을 줄 수 있는 법적/제도적 제약" options={fieldGroups.legal} values={formData.rrttllu.legalConstraints} onToggle={toggleLegalConstraint} />
        </CheckerboardGrid>
        {formData.rrttllu.legalConstraints.includes("기타") ? (
          <CheckerboardGrid className="grid gap-3">
            <TextField label="기타 제약 직접 입력" value={formData.rrttllu.legalConstraintOther} placeholder="예. 내부 투자심의 승인 필요" onChange={(v) => setRrttllu("legalConstraintOther", v)} />
          </CheckerboardGrid>
        ) : null}
      </Panel>

      {/* ⑦ Unique */}
      <Panel icon={<Sparkles size={18} />} eyebrow="RRTTLLU" title="⑦ Unique Circumstances 고객 고유 상황">
        <CheckerboardGrid className="grid gap-3 md:grid-cols-2">
          <TextAreaField label="선호하는 자산" value={formData.rrttllu.preferredAssets} placeholder="예. 미국 배당주 ETF, 은퇴 후 안정적 현금흐름" onChange={(v) => setRrttllu("preferredAssets", v)} />
          <TextAreaField label="피하고 싶은 자산" value={formData.rrttllu.avoidedAssets} placeholder="예. 가상자산, 가치 평가가 어려움" onChange={(v) => setRrttllu("avoidedAssets", v)} />
        </CheckerboardGrid>
        <CheckerboardGrid className="grid gap-3">
          <TextAreaField label="계속 보유하거나 향후 처분할 계획" value={formData.rrttllu.holdingOrDisposalPlan} placeholder="예. 삼성전자 10억 원은 계속 보유, 1년 내 임대용 부동산 매각" onChange={(v) => setRrttllu("holdingOrDisposalPlan", v)} />
          <TextAreaField label="기타" value={formData.rrttllu.uniqueOther} placeholder="예. 투자 의사결정에 영향을 줄 수 있는 가족 상황, 선호 상담 방식 등" onChange={(v) => setRrttllu("uniqueOther", v)} />
        </CheckerboardGrid>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">선호 자산은 추천 시 우선 고려하고, 비선호 자산은 추천 후보에서 제외하거나 최대 비중 0% 제한 조건으로 저장됩니다.</div>
      </Panel>

      <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm font-semibold leading-6 text-slate-600 shadow-soft">민감 정보는 필수 입력이 아니며, 제공이 어려운 경우 대략적인 범위만 입력하셔도 됩니다.</p>
    </div>
  );
}
