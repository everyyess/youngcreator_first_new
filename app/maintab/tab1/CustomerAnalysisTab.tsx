"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { BarChart3, ClipboardList, Info, LockKeyhole, PieChart, ShieldCheck, Sparkles, Trash2, UserRound, WalletCards } from "lucide-react";
import { useCustomerContext } from "../CustomerContext";
import { fieldGroups, returnOptions, riskExperienceOptions } from "../CustomerContext";
import type { SmartExtractionPayload } from "../CustomerContext";
import { Panel, TextField, TextAreaField, IncomeWithNoneField, ExpectedReturnField, ChoiceGroup, MultiChoiceGroup, LiquiditySummary, CheckerboardGrid, ConfirmModal } from "../ui";

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

type AdvisoryGuideLine = { text: string; highlights?: string[] };
type AdvisoryGuideCheckpoint = { id: string; title: string; prompt?: string };
type AdvisoryGuide = {
  conflicts: { lines: AdvisoryGuideLine[] };
  followUps: { lines: AdvisoryGuideLine[]; checkpoints: AdvisoryGuideCheckpoint[] };
  explanation: { lines: AdvisoryGuideLine[] };
};
type Tab1SubTab = "input" | "analysis" | "guide";

const emptyAdvisoryGuide: AdvisoryGuide = {
  conflicts: { lines: [] },
  followUps: { lines: [], checkpoints: [] },
  explanation: { lines: [] },
};
const tab1SubTabStorageKey = "samsung-vvip-tab1-inner-tab";
const geminiDailyLimit = 20;
const geminiUsageStorageKey = "samsung-vvip-gemini-usage";
const smartInputCachePrefix = "samsung-vvip-smart-input-cache";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readGeminiUsageToday() {
  if (typeof window === "undefined") return 0;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(geminiUsageStorageKey) ?? "{}") as { date?: string; count?: number };
    return parsed.date === todayKey() && typeof parsed.count === "number" ? parsed.count : 0;
  } catch {
    return 0;
  }
}

function writeGeminiUsageToday(count: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(geminiUsageStorageKey, JSON.stringify({ date: todayKey(), count }));
}

function incrementGeminiUsageToday() {
  const next = readGeminiUsageToday() + 1;
  writeGeminiUsageToday(next);
  return next;
}

function smartInputCacheKey(customerId: string) {
  return `${smartInputCachePrefix}:${customerId}`;
}

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

function normalizeUniqueMeaning(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (/시장뉴스|단기이슈|뉴스.*민감|민감.*뉴스|민감하게반응/.test(compact)) return "market-sensitivity";
  if (/의사결정.*빠|빠른편|성격.*급|급함|속도가빠/.test(compact)) return "fast-decision";
  if (/배우자|가족.*의사결정|의사결정.*영향력/.test(compact)) return "family-influence";
  if (/질문.*많|충분한설명|설명.*선호|납득/.test(compact)) return "explanation-preference";
  if (/부모님|부모관련|고령부모/.test(compact)) return "parent-related";
  if (/포트폴리오.*부진|벤치마크.*낮|수익률.*훼손|망가진/.test(compact)) return "portfolio-underperformance";
  if (/급등주|과도한레버리지|레버리지.*손실|손실경험/.test(compact)) return "aggressive-loss-experience";
  return compact.replace(/[^\p{Script=Hangul}a-zA-Z0-9]/gu, "").slice(0, 32);
}

function mergeUniqueNotes(existing: unknown, notes: string[]) {
  const values = [
    ...(typeof existing === "string" ? existing.split(/\n/) : []),
    ...notes,
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const byMeaning = new Map<string, string>();
  values.forEach((value) => {
    const key = normalizeUniqueMeaning(value);
    const current = byMeaning.get(key);
    if (!current) {
      byMeaning.set(key, value);
      return;
    }
    const currentLooksRaw = current.length < value.length && !/[.습니다|합니다|편|경향|가능성]/.test(current);
    if (currentLooksRaw) byMeaning.set(key, value);
  });
  return Array.from(byMeaning.values()).join("\n");
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

function PbPrivateNotice() {
  return (
    <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
      <LockKeyhole size={14} />
      <span>PB 참고용 정보입니다. 고객에게 노출되지 않도록 주의하세요.</span>
    </div>
  );
}

function SmartInputCard() {
  const { applySmartExtraction, formData, resetSelectedCustomerInputs, selectedCustomer, selectedCustomerProfile, setSmartInputNote } = useCustomerContext();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [usageToday, setUsageToday] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const note = formData.smartInputNote;

  useEffect(() => {
    setUsageToday(readGeminiUsageToday());
  }, []);

  const extract = async () => {
    const textareaValue = document.querySelector<HTMLTextAreaElement>("[data-smart-input-textarea='true']")?.value ?? "";
    console.log("Smart Input extract requested", {
      customerId: selectedCustomer,
      smartInput: note,
      smartInputLength: note.length,
      trimmedLength: note.trim().length,
      textareaValue,
      textareaValueLength: textareaValue.length,
      textareaMatchesState: textareaValue === note,
    });
    if (!note.trim()) {
      setMessage("자연어 메모를 먼저 입력해주세요.");
      return;
    }
    const cacheKey = smartInputCacheKey(selectedCustomer);
    try {
      const cached = JSON.parse(window.localStorage.getItem(cacheKey) ?? "null") as { note?: string; result?: { data?: SmartExtractionEnvelope; source?: string; fallback?: boolean; fallbackReason?: string; retryDelay?: number; estimatedUsageToday?: number; estimatedRemainingToday?: number; quotaLimit?: number } } | null;
      if (cached?.note === note && cached.result?.data) {
        console.info("Smart Input reused cached extraction result", {
          customerId: selectedCustomer,
          source: cached.result.source,
          fallback: cached.result.fallback,
          fallbackReason: cached.result.fallbackReason,
        });
        applySmartExtraction(toSmartExtractionPayload(cached.result.data));
        setMessage("동일한 Smart Input 원문이라 이전 추출 결과를 재사용했습니다.");
        return;
      }
    } catch (cacheError) {
      console.warn("Smart Input cache read failed", { cacheError, customerId: selectedCustomer });
    }
    setLoading(true);
    setMessage("");
    try {
      const estimatedUsageToday = readGeminiUsageToday();
      console.info("[Gemini Call Trigger] extract-customer", {
        customerId: selectedCustomer,
        smartInputLength: note.length,
        estimatedUsageToday,
      });
      const response = await fetch("/api/extract-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, estimatedUsageToday }),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) {
        console.error("Smart Input extraction API returned an error", {
          status: response.status,
          result,
          customerId: selectedCustomer,
          smartInput: note,
        });
        throw new Error(result?.reason ? `${result.error ?? "extract failed"} (${result.reason})` : result?.error ?? "extract failed");
      }
      console.log("Smart Input extraction result", {
        source: result.source,
        fallback: result.fallback,
        fallbackReason: result.fallbackReason ?? result.debug?.usedFallbackReason,
        retryDelay: result.retryDelay,
        estimatedUsageToday: result.estimatedUsageToday,
        estimatedRemainingToday: result.estimatedRemainingToday,
        data: result.data,
      });
      if (result.source === "mock") {
        console.warn("Smart Input used mock parser", {
          fallbackReason: result.fallbackReason ?? result.debug?.usedFallbackReason,
          customerId: selectedCustomer,
        });
      }
      if (Array.isArray(result.data?.unmapped) && result.data.unmapped.length) {
        console.warn("Smart Input unmapped fields", result.data.unmapped);
      }
      if (Array.isArray(result.data?.notes) && result.data.notes.length) {
        console.warn("Smart Input preserved candidate notes", result.data.notes);
      }
      applySmartExtraction(toSmartExtractionPayload(result.data as SmartExtractionEnvelope));
      if (result.source === "gemini") {
        const nextUsage = incrementGeminiUsageToday();
        setUsageToday(nextUsage);
        setMessage("");
      } else if (result.fallbackReason === "rate_limit") {
        const serverUsage = typeof result.estimatedUsageToday === "number" ? result.estimatedUsageToday : geminiDailyLimit;
        setUsageToday(serverUsage);
        writeGeminiUsageToday(serverUsage);
        setMessage("gemini_rate_limit");
      } else {
        setMessage("Mock Parser로 추출 가능한 항목을 반영했습니다.");
      }
      window.localStorage.setItem(cacheKey, JSON.stringify({
        note,
        result: {
          source: result.source,
          fallback: result.fallback,
          fallbackReason: result.fallbackReason,
          retryDelay: result.retryDelay,
          estimatedUsageToday: result.estimatedUsageToday,
          estimatedRemainingToday: result.estimatedRemainingToday,
          quotaLimit: result.quotaLimit,
          data: result.data,
        },
      }));
    } catch (error) {
      console.error("Smart Input extraction failed", {
        error,
        customerId: selectedCustomer,
        failedSmartInput: note,
        failedSmartInputLength: note.length,
        failedTrimmedLength: note.trim().length,
      });
      setMessage("추출에 실패했습니다. 직접 입력하거나 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    setMessage("");
    resetSelectedCustomerInputs();
    setResetOpen(false);
  };

  return (
    <section className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 shadow-soft sm:p-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_140px]">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <p className="text-sm font-extrabold text-yellow-900">Smart Input</p>
            <PbPrivateNotice />
          </div>
          <textarea
            data-smart-input-textarea="true"
            className="min-h-40 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[15px] leading-6 text-ink shadow-inner transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
            value={note}
            placeholder="고객 정보와 니즈를 자연어로 입력합니다."
            onChange={(e) => setSmartInputNote(e.target.value)}
          />
          {message === "gemini_rate_limit" ? (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-extrabold text-yellow-900">■ Gemini 무료 요청 한도를 초과했습니다. 내일 다시 시도해주세요.</p>
              <p className="text-xs font-bold text-yellow-800">
                오늘 Gemini 추정 사용량: {usageToday}/{geminiDailyLimit}회 · 추정 잔여 횟수: {Math.max(geminiDailyLimit - usageToday, 0)}회
              </p>
              <p className="text-sm font-extrabold text-yellow-900">■ Gemini 요청 한도 초과로 임시 추출 결과를 사용했습니다.</p>
            </div>
          ) : message ? (
            <p className={`mt-2 text-sm font-bold ${message.includes("실패") ? "text-red-700" : "text-yellow-900"}`}>{message}</p>
          ) : null}
          {message !== "gemini_rate_limit" ? (
            <p className="mt-2 text-xs font-bold text-yellow-800">
              오늘 Gemini 추정 사용량: {usageToday}/{geminiDailyLimit}회 · 추정 잔여 횟수: {Math.max(geminiDailyLimit - usageToday, 0)}회
            </p>
          ) : null}
        </div>
        <div className="grid content-start gap-2 lg:pt-10">
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
            onClick={() => setResetOpen(true)}
            className="min-h-11 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-extrabold text-red-700 transition hover:bg-red-50"
          >
            초기화
          </button>
        </div>
      </div>
      {resetOpen ? (
        <ConfirmModal
          icon={<Trash2 size={26} />}
          title="Smart Input 및 설문조사 초기화"
          body={`${selectedCustomerProfile.name || "현재 고객"} Smart Input과 설문조사 입력 내용이 모두 사라집니다. 정말 초기화하시겠습니까?`}
          cancelLabel="취소"
          confirmLabel="삭제"
          onCancel={() => setResetOpen(false)}
          onConfirm={resetAll}
        />
      ) : null}
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

function SummaryAnalysisCard({
  formData,
  riskResult,
  liquiditySummary,
  selectedCustomerProfile,
}: {
  formData: ReturnType<typeof useCustomerContext>["formData"];
  riskResult: ReturnType<typeof useCustomerContext>["riskResult"];
  liquiditySummary: ReturnType<typeof useCustomerContext>["liquiditySummary"];
  selectedCustomerProfile: ReturnType<typeof useCustomerContext>["selectedCustomerProfile"];
}) {
  const [riskGuideOpen, setRiskGuideOpen] = useState(false);

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
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-samsung">분석 및 요약</p>
            <h2 className="mt-1 flex flex-wrap items-baseline gap-2 text-xl font-bold text-navy">
              <span>고객 재무 현황 및 RRTTLLU 분석 요약</span>
              <span className="text-base font-extrabold text-samsung">({selectedCustomerProfile.name || "신규 고객"} 고객님)</span>
            </h2>
          </div>
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
  );
}

function HighlightedGuideText({ line }: { line: AdvisoryGuideLine }) {
  const highlights = (line.highlights ?? []).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!highlights.length) return <>{line.text}</>;

  const parts: React.ReactNode[] = [];
  let remaining = line.text;
  let key = 0;
  while (remaining) {
    const match = highlights
      .map((highlight) => ({ highlight, index: remaining.indexOf(highlight) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index || b.highlight.length - a.highlight.length)[0];
    if (!match) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (match.index > 0) parts.push(<span key={key++}>{remaining.slice(0, match.index)}</span>);
    parts.push(<strong key={key++} className="font-extrabold text-red-600">{match.highlight}</strong>);
    remaining = remaining.slice(match.index + match.highlight.length);
  }
  return <>{parts}</>;
}

function GuideLines({ lines }: { lines: AdvisoryGuideLine[] }) {
  const displayLines = lines.length ? lines : [{ text: "현재 입력된 정보 기준으로 특별한 유의사항이 감지되지 않았습니다." }];
  return (
    <div className="space-y-2">
      {displayLines.map((line, index) => (
        <p key={`${line.text}-${index}`} className="flex gap-2 text-sm font-semibold leading-6 text-slate-700">
          <span className="shrink-0 font-extrabold text-samsung">■</span>
          <span>
            <HighlightedGuideText line={line} />
          </span>
        </p>
      ))}
    </div>
  );
}

function AdvisoryGuideSection({
  title,
  lines,
  children,
}: {
  title: string;
  lines: AdvisoryGuideLine[];
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-base font-extrabold text-navy">{title}</h3>
      <div className="mt-3">
        <GuideLines lines={lines} />
      </div>
      {children}
    </section>
  );
}

function UniqueOtherReferenceSection({ value }: { value: string }) {
  const displayValue = value.trim() || "입력된 기타 참고 정보가 없습니다.";
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="text-base font-extrabold text-navy">[4] (참조) Unique Circumstances - 기타</h3>
      <p className="mt-2 text-xs font-bold leading-5 text-amber-700">
        AI 재분류나 요약 없이, Unique Circumstances의 Q. 기타 입력 내용을 PB 참고용으로 그대로 표시합니다.
      </p>
      <div className="mt-3 whitespace-pre-wrap rounded-lg border border-amber-100 bg-white px-4 py-3 text-sm font-semibold leading-6 text-slate-700">
        {displayValue}
      </div>
    </section>
  );
}

function AiConsultingGuideCard({
  guide,
  loading,
  error,
}: {
  guide: AdvisoryGuide;
  loading: boolean;
  error: string;
}) {
  const { formData, setAiGuidePbNote } = useCustomerContext();
  const checkpoints = guide.followUps.checkpoints.length
    ? guide.followUps.checkpoints
    : [
        { id: "followup-1", title: "월평균 잉여현금흐름" },
        { id: "followup-2", title: "향후 1년 내 확정 지출" },
      ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-samsung">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-normal text-slate-500">AI 상담 가이드</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              고객 입력값과 분석 결과를 바탕으로 PB 상담 시 참고할 가이드를 생성합니다.
            </p>
          </div>
        </div>
        <PbPrivateNotice />
      </div>
      {loading ? <p className="mt-4 rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-bold text-samsung">AI 상담 가이드를 생성하는 중입니다.</p> : null}
      {error ? <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}
      <div className="mt-4 grid gap-3">
        <AdvisoryGuideSection title="[1] 상충 정보 탐지" lines={guide.conflicts.lines} />
        <AdvisoryGuideSection title="[2] 추가 확인 필요" lines={guide.followUps.lines}>
          <div className="mt-4 rounded-lg border border-red-100 bg-white p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p className="text-sm font-extrabold text-navy">PB 확인 메모</p>
            </div>
            <div className="grid gap-2">
              {checkpoints.map((checkpoint) => (
                <label key={checkpoint.id} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[280px_minmax(0,1fr)] md:items-center">
                  <span className="whitespace-nowrap text-sm font-extrabold text-slate-700">{checkpoint.title}</span>
                  <input
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
                    value={formData.aiGuidePbNotes?.[checkpoint.id] ?? ""}
                    placeholder="상담 중 확인한 내용을 입력하세요."
                    onChange={(e) => setAiGuidePbNote(checkpoint.id, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
        </AdvisoryGuideSection>
        <AdvisoryGuideSection title="[3] 설명 방식 제안" lines={guide.explanation.lines} />
        <UniqueOtherReferenceSection value={formData.rrttllu.uniqueOther} />
      </div>
    </section>
  );
}

// ── 고객 성향 분석 탭 메인 컴포넌트 ────────────────────────────────────────
export default function CustomerAnalysisTab() {
  const {
    formData, liquiditySummary, riskResult,
    selectedCustomerProfile, selectedCustomer, internalJsonPayload,
    setFinancial, setRrttllu, setIrregularIncome, toggleNoIrregularIncome,
    setExpectedReturn, toggleExpectedReturnUnknown, toggleInvestmentExperience,
    toggleLegalConstraint,
  } = useCustomerContext();
  const [activeSubTab, setActiveSubTab] = useState<Tab1SubTab>("input");
  const [advisoryGuide, setAdvisoryGuide] = useState<AdvisoryGuide>(emptyAdvisoryGuide);
  const [advisoryGuideLoading, setAdvisoryGuideLoading] = useState(false);
  const [advisoryGuideError, setAdvisoryGuideError] = useState("");
  const [lastGuideSignature, setLastGuideSignature] = useState("");

  const advisoryGuidePayload = useMemo(() => ({
    customerId: selectedCustomer,
    profile: selectedCustomerProfile,
    smartInputNote: formData.smartInputNote,
    formData: {
      financial: formData.financial,
      rrttllu: formData.rrttllu,
    },
    riskResult,
    liquiditySummary,
    structuredJson: internalJsonPayload,
    uniqueOther: formData.rrttllu.uniqueOther,
    pbNotes: formData.aiGuidePbNotes,
    smartInputContext: {
      raw: formData.smartInputNote,
      reflectedUniqueOther: formData.rrttllu.uniqueOther,
      smartExtractedUniqueOther: formData.smartExtractedUniqueOther,
      reflectedPreferredAssets: formData.rrttllu.preferredAssets,
      reflectedAvoidedAssets: formData.rrttllu.avoidedAssets,
      reflectedExistingAssetPlan: formData.rrttllu.holdingOrDisposalPlan,
    },
  }), [formData.aiGuidePbNotes, formData.financial, formData.rrttllu, formData.smartInputNote, formData.smartExtractedUniqueOther, internalJsonPayload, liquiditySummary, riskResult, selectedCustomer, selectedCustomerProfile]);

  const advisoryGuideSignature = useMemo(() => JSON.stringify(advisoryGuidePayload), [advisoryGuidePayload]);

  useEffect(() => {
    const stored = window.localStorage.getItem(tab1SubTabStorageKey);
    if (stored === "input" || stored === "analysis" || stored === "guide") setActiveSubTab(stored);
  }, []);

  const selectSubTab = (tab: Tab1SubTab) => {
    setActiveSubTab(tab);
    window.localStorage.setItem(tab1SubTabStorageKey, tab);
  };

  useEffect(() => {
    if (activeSubTab !== "guide") return;
    if (lastGuideSignature === advisoryGuideSignature) {
      console.info("[Gemini Call Skip] advisory-guide cached signature", {
        customerId: selectedCustomer,
        signatureLength: advisoryGuideSignature.length,
      });
      return;
    }

    let cancelled = false;
    async function generateGuide() {
      setAdvisoryGuideLoading(true);
      setAdvisoryGuideError("");
      try {
        console.info("[Gemini Call Trigger] advisory-guide", {
          customerId: selectedCustomer,
          signatureLength: advisoryGuideSignature.length,
          smartInputLength: formData.smartInputNote.length,
          uniqueOtherLength: formData.rrttllu.uniqueOther.length,
        });
        const response = await fetch("/api/generate-advisory-guide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(advisoryGuidePayload),
        });
        const result = await response.json();
        if (!response.ok || !result?.ok) throw new Error(result?.error ?? "AI 상담 가이드 생성 실패");
        if (cancelled) return;
        setAdvisoryGuide(result.data ?? emptyAdvisoryGuide);
        setLastGuideSignature(advisoryGuideSignature);
      } catch (error) {
        console.error("AI advisory guide request failed", { error, advisoryGuidePayload });
        if (cancelled) return;
        setAdvisoryGuide(emptyAdvisoryGuide);
        setAdvisoryGuideError("AI 상담 가이드 생성에 실패했습니다. 입력 정보를 확인하거나 다시 시도해주세요.");
      } finally {
        if (!cancelled) setAdvisoryGuideLoading(false);
      }
    }

    void generateGuide();
    return () => { cancelled = true; };
  }, [activeSubTab, advisoryGuidePayload, advisoryGuideSignature, lastGuideSignature]);

  return (
    <div className="space-y-5">
      <div className="mx-auto flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-soft">
        {[
          { id: "input" as const, label: "고객 정보 입력", icon: <ClipboardList size={15} /> },
          { id: "analysis" as const, label: "성향 및 니즈 분석", icon: <BarChart3 size={15} /> },
          { id: "guide" as const, label: "AI 상담 가이드", icon: <Sparkles size={15} /> },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectSubTab(tab.id)}
            className={`min-w-[220px] shrink-0 rounded-md px-6 py-2.5 text-sm font-bold transition ${
              activeSubTab === tab.id
                ? "bg-samsung text-white shadow-sm"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            <span className="inline-flex items-center justify-center gap-2">
              {tab.icon}
              {tab.label}
            </span>
          </button>
        ))}
      </div>

      {activeSubTab === "input" ? (
        <>
      <SmartInputCard />
      <CustomerInfoCard />

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
          <div>
            <div className="question-card block rounded-lg border border-slate-200 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <span className="block text-[15px] font-bold leading-6 text-slate-800">Q. 기타</span>
                <PbPrivateNotice />
              </div>
              <textarea
                className="min-h-28 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-[15px] leading-6 text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
                value={formData.rrttllu.uniqueOther}
                placeholder="예. 투자 의사결정에 영향을 줄 수 있는 가족 상황, 선호 상담 방식 등"
                onChange={(e) => setRrttllu("uniqueOther", e.target.value)}
              />
            </div>
          </div>
        </CheckerboardGrid>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">선호 자산은 추천 시 우선 고려하고, 비선호 자산은 추천 후보에서 제외하거나 최대 비중 0% 제한 조건으로 저장됩니다.</div>
      </Panel>

      <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm font-semibold leading-6 text-slate-600 shadow-soft">민감 정보는 필수 입력이 아니며, 제공이 어려운 경우 대략적인 범위만 입력하셔도 됩니다.</p>
        </>
      ) : (
        activeSubTab === "analysis" ? (
        <>
          <CustomerInfoCard />
          <SummaryAnalysisCard
            formData={formData}
            riskResult={riskResult}
            liquiditySummary={liquiditySummary}
            selectedCustomerProfile={selectedCustomerProfile}
          />
        </>
        ) : (
        <>
          <AiConsultingGuideCard guide={advisoryGuide} loading={advisoryGuideLoading} error={advisoryGuideError} />
        </>
        )
      )}
    </div>
  );
}
