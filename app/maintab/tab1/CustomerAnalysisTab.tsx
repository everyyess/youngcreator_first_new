"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BarChart3, ClipboardList, Info, LockKeyhole, PieChart, ShieldCheck, Sparkles, Trash2, UserRound, WalletCards } from "lucide-react";
import { useCustomerContext } from "../CustomerContext";
import { fieldGroups, returnOptions, riskExperienceOptions } from "../CustomerContext";
import type { ConversationTurn, SmartExtractionPayload, StoredAdvisoryGuide } from "../CustomerContext";
import { Panel, TextField, TextAreaField, IncomeWithNoneField, ExpectedReturnField, ChoiceGroup, MultiChoiceGroup, CheckerboardGrid, ConfirmModal, MissingNotice, QuestionTitle, questionLabel } from "../ui";
import { preferenceBadgeClass, preferenceLabelFromScore } from "../riskPreference";
import {
  blankLiquidityEntry,
  formatLiquiditySummary,
  isLiquidityEntryFilled,
  liquidityPriorities,
  parseLiquidityEntries,
  serializeLiquidityEntries,
  type LiquidityEntry,
  type LiquidityKind,
} from "../liquidityFields";
import { geminiDailyUsageLimit, geminiUsageUpdatedEvent, incrementGeminiUsageToday, readGeminiUsageToday, writeGeminiUsageToday } from "@/lib/geminiUsage";

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

type AdvisoryGuideLine = { text: string; highlights?: string[]; memoItems?: string[] };
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

function normalizeAdvisoryGuide(value: unknown): AdvisoryGuide {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyAdvisoryGuide;
  const guide = value as Partial<AdvisoryGuide>;
  return {
    conflicts: { lines: Array.isArray(guide.conflicts?.lines) ? guide.conflicts.lines : [] },
    followUps: {
      lines: Array.isArray(guide.followUps?.lines) ? guide.followUps.lines : [],
      checkpoints: Array.isArray(guide.followUps?.checkpoints) ? guide.followUps.checkpoints : [],
    },
    explanation: { lines: Array.isArray(guide.explanation?.lines) ? guide.explanation.lines : [] },
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
const tab1SubTabStorageKey = "samsung-vvip-tab1-inner-tab";
const smartInputCachePrefix = "samsung-vvip-smart-input-cache";

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

function stringifySmartLiquidityPart(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const timing = record.timing ?? record.period ?? record.frequency ?? record.time ?? record.시기 ?? record.주기 ?? "";
  const purpose = record.purpose ?? record.goal ?? record.need ?? record.목적 ?? "";
  const amount = record.amount ?? record.money ?? record.금액 ?? "";
  return [timing, purpose, amount].filter((part) => typeof part === "string" && part.trim()).join(" ");
}

function normalizeSmartLiquidityField(value: unknown) {
  if (Array.isArray(value)) return value.map(stringifySmartLiquidityPart).filter(Boolean).join("\n");
  if (value && typeof value === "object") return stringifySmartLiquidityPart(value);
  return value;
}

function rerouteMedicalLiquidityToEmergency(rrttllu: ExtractionSection) {
  const emergencyEntries = parseLiquidityEntries(typeof rrttllu.emergencyReservePlan === "string" ? rrttllu.emergencyReservePlan : "", "emergency")
    .filter(isLiquidityEntryFilled);
  (["regularCashflowNeed", "lumpSumPlan"] as const).forEach((key) => {
    const kind = key === "regularCashflowNeed" ? "regular" : "lumpSum";
    const value = rrttllu[key];
    if (typeof value !== "string" || !value.trim()) return;
    const entries = parseLiquidityEntries(value, kind);
    const kept = entries.filter((entry) => !/의료비/.test(entry.purpose));
    const medical = entries.filter((entry) => /의료비/.test(entry.purpose));
    if (!medical.length) return;
    rrttllu[key] = serializeLiquidityEntries(kept);
    emergencyEntries.push(...medical.map((entry) => ({ ...entry, timing: "", customTiming: "" })));
  });
  if (emergencyEntries.length) rrttllu.emergencyReservePlan = serializeLiquidityEntries(emergencyEntries);
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

function isPbOpeningMentForUniqueOther(value: string) {
  const compact = value.replace(/\s+/g, "");
  return compact.includes("고객님의투자성향")
    && compact.includes("니즈를파악")
    && compact.includes("몇가지여쭤");
}

function mergeUniqueNotes(existing: unknown, notes: string[]) {
  const values = [
    ...(typeof existing === "string" ? existing.split(/\n/) : []),
    ...notes,
  ]
    .map((value) => value.trim())
    .filter((value) => !isPbOpeningMentForUniqueOther(value))
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
  (["regularCashflowNeed", "lumpSumPlan", "emergencyReservePlan"] as const).forEach((key) => {
    const normalized = normalizeSmartLiquidityField(rrttllu[key]);
    if (typeof normalized === "string" && normalized.trim()) rrttllu[key] = normalized;
    else if (Array.isArray(rrttllu[key]) || (rrttllu[key] && typeof rrttllu[key] === "object")) delete rrttllu[key];
  });
  rerouteMedicalLiquidityToEmergency(rrttllu);
  const mappedValues = [
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
    financial: financial as SmartExtractionPayload["financial"],
    rrttllu: rrttllu as SmartExtractionPayload["rrttllu"],
  };
}

// ── Editable customer fields ─────────────────────────────────────────────────
function EditableField({
  label, value, placeholder, widthClassName = "w-32", disabled = false, onChange,
}: {
  label: string; value: string; placeholder?: string; widthClassName?: string; disabled?: boolean; onChange: (value: string) => void;
}) {
  return (
    <label className={`block ${widthClassName}`}>
      <span className="mb-1 block text-xs font-bold text-samsung">[{label}]</span>
      <input
        className="h-10 min-w-0 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm font-bold text-navy transition placeholder:font-normal placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung disabled:bg-slate-100 disabled:text-slate-500"
        value={value}
        placeholder={placeholder ?? "입력 대기"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function GenderToggle({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="block w-24">
      <span className="mb-1 block text-xs font-bold text-samsung">[성별]</span>
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {["남", "여"].map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(value === option ? "" : option)}
            className={`h-10 text-sm font-bold transition ${
              value === option ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectField({
  label, value, placeholder, options, widthClassName = "w-24", onChange,
}: {
  label: string; value: string; placeholder?: string; options: string[]; widthClassName?: string; onChange: (value: string) => void;
}) {
  return (
    <label className={`block ${widthClassName}`}>
      <span className="mb-1 block text-xs font-bold text-samsung">[{label}]</span>
      <select
        className="h-10 min-w-0 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm font-bold text-navy transition hover:border-slate-300 focus:border-samsung"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder ?? "선택"}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function calculateKoreanAgeFromBirthDate(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!(digits.length === 6 || digits.length === 8)) return "";
  const now = new Date();
  const currentYear = now.getFullYear();
  const yy = digits.length === 8 ? Number(digits.slice(0, 4)) : Number(digits.slice(0, 2));
  const year = digits.length === 8 ? yy : (yy <= currentYear % 100 ? 2000 + yy : 1900 + yy);
  const month = Number(digits.slice(digits.length === 8 ? 4 : 2, digits.length === 8 ? 6 : 4));
  const day = Number(digits.slice(digits.length === 8 ? 6 : 4, digits.length === 8 ? 8 : 6));
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return "";
  let age = currentYear - year;
  const birthdayThisYear = new Date(currentYear, month - 1, day);
  if (now < birthdayThisYear) age -= 1;
  return age >= 0 && age < 130 ? String(age) : "";
}

function CustomerInfoCard() {
  const { selectedCustomerProfile, updateCustomerProfile } = useCustomerContext();
  const profile = selectedCustomerProfile;
  const birthDate = profile.birth_year ?? profile.birthYear;
  const calculatedAge = calculateKoreanAgeFromBirthDate(birthDate);

  useEffect(() => {
    if (calculatedAge && profile.age !== calculatedAge) updateCustomerProfile("age", calculatedAge);
    if (!birthDate.trim() && profile.age) updateCustomerProfile("age", "");
  }, [birthDate, calculatedAge, profile.age, updateCustomerProfile]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-soft sm:px-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
        <div className="flex min-w-28 items-center gap-2 pb-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-samsung">
            <UserRound size={18} />
          </div>
          <p className="text-base font-bold text-navy">고객 프로필</p>
        </div>
        <div className="ml-0 flex flex-wrap items-end gap-2 lg:ml-4 lg:flex-nowrap">
          <EditableField label="성명" value={profile.name} widthClassName="w-24 sm:w-28" placeholder="예. 홍길동" onChange={(v) => updateCustomerProfile("name", v)} />
          <GenderToggle value={profile.gender} onChange={(v) => updateCustomerProfile("gender", v)} />
          <div className="flex flex-wrap gap-2 lg:flex-nowrap">
            <EditableField label="생년월일" value={birthDate} widthClassName="w-24 sm:w-28" placeholder="예. 671018" onChange={(v) => updateCustomerProfile("birthYear", v.replace(/\D/g, "").slice(0, 8))} />
            <EditableField label="만 나이" value={birthDate.trim() ? calculatedAge : ""} widthClassName="w-20 sm:w-24" placeholder="입력 대기" disabled onChange={() => {}} />
          </div>
          <EditableField label="직업" value={profile.job} widthClassName="w-52 max-w-full xl:w-60" placeholder="예. 삼성증권 PB" onChange={(v) => updateCustomerProfile("job", v)} />
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

const liquidityKindMeta: Record<LiquidityKind, { label: string; purposePlaceholder: string; amountPlaceholder: string }> = {
  regular: { label: "향후 정기적인 현금흐름 필요", purposePlaceholder: "목적", amountPlaceholder: "금액" },
  lumpSum: { label: "향후 목돈 사용 계획", purposePlaceholder: "목적", amountPlaceholder: "금액" },
  emergency: { label: "향후 비상예비자금 확보 계획", purposePlaceholder: "목적", amountPlaceholder: "금액" },
};

function LiquidityNeedsEditor({
  regularValue,
  lumpSumValue,
  emergencyValue,
  onChange,
}: {
  regularValue: string;
  lumpSumValue: string;
  emergencyValue: string;
  onChange: (kind: LiquidityKind, value: string) => void;
}) {
  const entriesByKind: Record<LiquidityKind, LiquidityEntry[]> = {
    regular: parseLiquidityEntries(regularValue, "regular"),
    lumpSum: parseLiquidityEntries(lumpSumValue, "lumpSum"),
    emergency: parseLiquidityEntries(emergencyValue, "emergency"),
  };
  const usedPriorityCounts = [...entriesByKind.regular, ...entriesByKind.lumpSum, ...entriesByKind.emergency]
    .filter((entry) => entry.priority !== "-")
    .reduce<Record<string, number>>((acc, entry) => {
      acc[entry.priority] = (acc[entry.priority] ?? 0) + 1;
      return acc;
    }, {});

  const updateEntries = (kind: LiquidityKind, entries: LiquidityEntry[]) => onChange(kind, serializeLiquidityEntries(entries));
  const updateEntry = (kind: LiquidityKind, index: number, patch: Partial<LiquidityEntry>) => {
    updateEntries(kind, entriesByKind[kind].map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  };
  const hasCompleteEntry = (kind: LiquidityKind, entry: LiquidityEntry) => {
    const purpose = entry.purpose.trim();
    const timing = entry.timing.trim();
    const amount = entry.amount.trim();
    return kind === "emergency" ? Boolean(purpose && amount) : Boolean(purpose && timing && amount);
  };
  const hasPartialEntry = (kind: LiquidityKind, entry: LiquidityEntry) => {
    if (!isLiquidityEntryFilled(entry)) return false;
    return !hasCompleteEntry(kind, entry);
  };
  const allEntries = [
    ...entriesByKind.regular.map((entry) => ({ entry, kind: "regular" as const })),
    ...entriesByKind.lumpSum.map((entry) => ({ entry, kind: "lumpSum" as const })),
    ...entriesByKind.emergency.map((entry) => ({ entry, kind: "emergency" as const })),
  ];
  const filledEntries = allEntries.filter(({ entry }) => isLiquidityEntryFilled(entry));
  const rankedEntries = [1, 2, 3].map((rank) => {
    const found = allEntries.find(({ entry }) => entry.priority === String(rank));
    return found ? formatLiquiditySummary(serializeLiquidityEntries([found.entry]), found.kind) : "";
  });
  const missingPriorityWarnings = (() => {
    const hasRank = (rank: number) => rankedEntries[rank - 1].trim().length > 0;
    if (filledEntries.length >= 3) return [1, 2, 3].filter((rank) => !hasRank(rank)).map((rank) => `${rank}순위가 비어 있습니다. 다시 입력해주세요.`);
    if (!hasRank(1) && (hasRank(2) || hasRank(3))) return ["1순위가 비어 있습니다. 다시 입력해주세요."];
    if (hasRank(1) && !hasRank(2) && hasRank(3)) return ["2순위가 비어 있습니다. 다시 입력해주세요."];
    return [];
  })();

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {(Object.keys(entriesByKind) as LiquidityKind[]).map((kind) => {
        const meta = liquidityKindMeta[kind];
        const entries = entriesByKind[kind];
        const hasDuplicatePriority = entries.some((entry) => entry.priority !== "-" && usedPriorityCounts[entry.priority] > 1);
        const rowColumns = kind === "emergency"
          ? "grid-cols-[40px_minmax(0,1fr)_92px]"
          : "grid-cols-[40px_minmax(0,1fr)_78px_16px_92px]";
        const suffix = kind === "regular" ? "마다" : "후";
        const liquidityMissing = entries.some((entry) => hasPartialEntry(kind, entry));
        return (
          <div key={kind} className="question-card rounded-lg border border-slate-200 p-4">
            <QuestionTitle label={meta.label} missing={liquidityMissing} className="mb-2 text-[15px] font-bold leading-6 text-slate-800" />
            {hasDuplicatePriority ? <p className="mb-2 text-xs font-bold text-red-600">⚠️ 이미 사용 중인 순위입니다.</p> : null}
            <div className="grid gap-2">
              {entries.map((entry, index) => (
                <div key={entry.id} className={`grid items-center gap-2 ${rowColumns}`}>
                  <select className="h-10 w-10 min-w-0 rounded-lg border border-slate-200 bg-white px-1 text-center text-xs font-semibold text-navy" value={entry.priority} onChange={(e) => updateEntry(kind, index, { priority: e.target.value as LiquidityEntry["priority"] })}>
                    {liquidityPriorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                  </select>
                  <input className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink placeholder:text-slate-400" value={entry.purpose} placeholder={meta.purposePlaceholder} onChange={(e) => updateEntry(kind, index, { purpose: e.target.value })} />
                  {kind !== "emergency" ? (
                    <>
                      <input className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm text-ink placeholder:text-slate-400" value={entry.timing} placeholder={kind === "regular" ? "주기" : "시기"} onChange={(e) => updateEntry(kind, index, { timing: e.target.value, customTiming: "" })} />
                      <span className="whitespace-nowrap text-[11px] font-bold text-black">{suffix}</span>
                    </>
                  ) : null}
                  <input className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink placeholder:text-slate-400" value={entry.amount} placeholder={meta.amountPlaceholder} onChange={(e) => updateEntry(kind, index, { amount: e.target.value })} />
                </div>
              ))}
            </div>
            <button type="button" className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-extrabold text-blue-700 hover:bg-blue-100" onClick={() => updateEntries(kind, [...entries, blankLiquidityEntry(entries.length)])}>
              + 추가
            </button>
          </div>
        );
      })}
      <div className="question-card rounded-lg border border-slate-200 p-4">
        <div className="mb-3 text-[15px] font-bold leading-6 text-slate-800">🏆 유동성 우선순위</div>
        <div className="grid gap-2 text-sm font-bold text-slate-800">
          {["🥇", "🥈", "🥉"].map((medal, index) => (
            <div key={medal} className="rounded-lg bg-slate-50 px-3 py-2">
              <span className="mr-2">{medal}</span>
              <span>{rankedEntries[index] || "해당 없음"}</span>
            </div>
          ))}
        </div>
        {missingPriorityWarnings.length ? (
          <div className="mt-3 grid gap-1 text-xs font-bold text-red-600">
            {missingPriorityWarnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SmartInputStatusBadge({ message }: { message: string }) {
  if (!message) return null;
  const isError = /실패|거부|오류|지원하지|빈 오디오|권한/.test(message);
  return (
    <span className={`inline-flex w-fit items-center rounded-full border px-3 py-2 text-xs font-extrabold ${
      isError
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-sky-200 bg-sky-50 text-samsung"
    }`}>
      {message}
    </span>
  );
}

const supportedAudioExtensions = new Set(["mp3", "wav", "m4a", "webm"]);

function isSupportedAudioFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return supportedAudioExtensions.has(extension);
}

function isGeminiResourceExhausted(value: unknown) {
  const body = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return /RESOURCE_EXHAUSTED|rate_limit|quota|429/i.test(body);
}

function normalizeTranscriptText(text: string) {
  return text.replace(/\uD30C\uAD34\uB429\uB2C8\uB2E4/g, "\uD30C\uAE30\uB429\uB2C8\uB2E4").trim();
}

function normalizeTranscriptTurns(transcript: ConversationTurn[]) {
  return transcript.reduce<ConversationTurn[]>((merged, turn) => {
    const text = normalizeTranscriptText(turn.text ?? "");
    if (!text) return merged;
    const last = merged[merged.length - 1];
    if (last?.speaker === turn.speaker) {
      last.text = `${last.text.trim()} ${text}`.trim();
      return merged;
    }
    merged.push({ ...turn, text });
    return merged;
  }, []);
}

function geminiUsageLabel(count: number) {
  return `오늘 Gemini 추정 사용량: ${Math.min(geminiDailyUsageLimit, count)}/${geminiDailyUsageLimit}회 (추정치)`;
}

function transcriptToSmartInputText(transcript: ConversationTurn[], additionalMemo: string) {
  const transcriptText = transcript
    .map((turn) => `${turn.speaker}: ${turn.text.trim()}`)
    .filter((line) => line.replace(/^(PB|고객):\s*/, "").trim())
    .join("\n");
  const memo = additionalMemo.trim();
  return [transcriptText ? `[음성 상담 대화록]\n${transcriptText}` : "", memo ? `[추가 메모]\n${memo}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

function SmartInputCard() {
  const { applySmartExtraction, formData, selectedCustomer, selectedCustomerProfile, setSmartAdditionalMemo, setSmartInputNote, setSmartTranscript } = useCustomerContext();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [usageToday, setUsageToday] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceStatusCustomer, setVoiceStatusCustomer] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "paused" | "transcribing">("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const transcript = normalizeTranscriptTurns(formData.smartTranscript ?? []);
  const additionalMemo = formData.smartAdditionalMemo ?? "";
  const visibleVoiceStatus = voiceStatusCustomer === selectedCustomer ? voiceStatus : "";
  const extractCompleteMessage = message === "customer_extract_complete" ? "고객 정보 추출이 완료되었습니다." : "";

  const setCurrentCustomerVoiceStatus = (message: string) => {
    setVoiceStatusCustomer(selectedCustomer);
    setVoiceStatus(message);
  };

  const markGeminiLimitReached = () => {
    writeGeminiUsageToday(geminiDailyUsageLimit);
    setUsageToday(geminiDailyUsageLimit);
  };

  useEffect(() => {
    setUsageToday(readGeminiUsageToday());
    const updateUsage = () => setUsageToday(readGeminiUsageToday());
    window.addEventListener(geminiUsageUpdatedEvent, updateUsage);
    return () => window.removeEventListener(geminiUsageUpdatedEvent, updateUsage);
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const transcribeAudio = async (file: File, pendingMessage: string, doneMessage: string) => {
    if (!file.size) {
      setCurrentCustomerVoiceStatus("빈 오디오 파일입니다.");
      return false;
    }

    const form = new FormData();
    form.append("audio", file);
    setCurrentCustomerVoiceStatus(pendingMessage);
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
      });
      const result = await response.json().catch(() => null) as { success?: boolean; text?: string; transcript?: ConversationTurn[]; message?: string; error?: string; detail?: string; geminiUsed?: boolean } | null;
      const nextTranscript = Array.isArray(result?.transcript) ? result.transcript.filter((turn) => turn?.text?.trim()) : [];
      if (!response.ok || !result?.success || (!nextTranscript.length && !result.text?.trim())) {
        const message = result?.message ?? result?.error ?? "Azure STT 응답 실패";
        throw new Error(result?.detail && !message.includes(result.detail) ? `${message} / ${result.detail}` : message);
      }
      if (result.geminiUsed === true) setUsageToday(incrementGeminiUsageToday());
      const normalizedTranscript = normalizeTranscriptTurns(nextTranscript.length ? nextTranscript : [{ speaker: "\uACE0\uAC1D" as const, text: result.text?.trim() ?? "" }]);
      setSmartTranscript(normalizedTranscript);
      setSmartInputNote(transcriptToSmartInputText(normalizedTranscript, additionalMemo));
      setCurrentCustomerVoiceStatus(doneMessage);
      return true;
    } catch (error) {
      console.error("Audio transcription failed", error);
      if (isGeminiResourceExhausted(error instanceof Error ? error.message : error)) {
        markGeminiLimitReached();
      }
      setCurrentCustomerVoiceStatus(error instanceof Error && error.message ? error.message : "음성 변환 실패");
      return false;
    }
  };

  const handleAudioUpload = async (file: File | null) => {
    if (!file) return;
    if (!isSupportedAudioFile(file)) {
      setCurrentCustomerVoiceStatus("지원하지 않는 음성 파일 형식입니다. mp3, wav, m4a, webm 파일을 업로드해주세요.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadBusy(true);
    await transcribeAudio(file, "파일 음성 변환 중...", "파일 음성 변환 완료");
    setUploadBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const stopCurrentStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const startOrResumeRecording = async () => {
    if (recordingState === "paused" && recorderRef.current) {
      try {
        recorderRef.current.resume();
        setRecordingState("recording");
        setCurrentCustomerVoiceStatus("녹음 중...");
      } catch (error) {
        console.error("Recording resume failed", error);
        setCurrentCustomerVoiceStatus("녹음 재개 실패");
      }
      return;
    }

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCurrentCustomerVoiceStatus("이 브라우저에서는 녹음을 지원하지 않습니다.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        stopCurrentStream();
        if (!blob.size) {
          setCurrentCustomerVoiceStatus("빈 오디오 파일입니다.");
          setRecordingState("idle");
          return;
        }
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
        await transcribeAudio(file, "음성 변환 중...", "음성 변환 완료");
        recorderRef.current = null;
        setRecordingState("idle");
      };

      recorder.start();
      setRecordingState("recording");
      setCurrentCustomerVoiceStatus("녹음 중...");
    } catch (error) {
      console.error("Recording start failed", error);
      stopCurrentStream();
      setRecordingState("idle");
      const name = error instanceof DOMException ? error.name : "";
      setCurrentCustomerVoiceStatus(name === "NotAllowedError" ? "마이크 권한이 거부되었습니다." : "녹음 시작 실패");
    }
  };

  const pauseRecording = () => {
    try {
      if (!recorderRef.current || recorderRef.current.state !== "recording") throw new Error("recorder is not recording");
      recorderRef.current.pause();
      setRecordingState("paused");
      setCurrentCustomerVoiceStatus("녹음 일시중단");
    } catch (error) {
      console.error("Recording pause failed", error);
      setCurrentCustomerVoiceStatus("녹음 일시중단 실패");
    }
  };

  const stopRecording = () => {
    try {
      if (!recorderRef.current || recorderRef.current.state === "inactive") throw new Error("recorder is inactive");
      setRecordingState("transcribing");
      setCurrentCustomerVoiceStatus("음성 변환 중...");
      recorderRef.current.stop();
    } catch (error) {
      console.error("Recording stop failed", error);
      stopCurrentStream();
      recorderRef.current = null;
      setRecordingState("idle");
      setCurrentCustomerVoiceStatus("녹음 종료 실패");
    }
  };

  const extract = async () => {
    const normalizedTranscript = normalizeTranscriptTurns(formData.smartTranscript ?? []);
    const extractionNote = transcriptToSmartInputText(normalizedTranscript, formData.smartAdditionalMemo ?? "");
    console.log("Smart Input extract requested", {
      customerId: selectedCustomer,
      smartInput: extractionNote,
      smartInputLength: extractionNote.length,
      trimmedLength: extractionNote.trim().length,
    });
    if (!extractionNote.trim()) {
      setMessage("음성 상담 대화록 또는 추가 메모를 먼저 입력해주세요.");
      return;
    }
    const cacheKey = smartInputCacheKey(selectedCustomer);
    try {
      const cached = JSON.parse(window.localStorage.getItem(cacheKey) ?? "null") as { note?: string; result?: { data?: SmartExtractionEnvelope; source?: string; fallback?: boolean; fallbackReason?: string; retryDelay?: number; estimatedUsageToday?: number; estimatedRemainingToday?: number; quotaLimit?: number } } | null;
      if (cached?.note === extractionNote && cached.result?.data) {
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
        smartInputLength: extractionNote.length,
        estimatedUsageToday,
      });
      const response = await fetch("/api/extract-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: extractionNote, transcript: normalizedTranscript, additionalMemo: formData.smartAdditionalMemo, estimatedUsageToday }),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) {
        console.error("Smart Input extraction API returned an error", {
          status: response.status,
          result,
          customerId: selectedCustomer,
          smartInput: extractionNote,
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
      if (result.geminiUsed === true) {
        const nextUsage = incrementGeminiUsageToday();
        setUsageToday(nextUsage);
        setMessage("customer_extract_complete");
      } else if (result.fallbackReason === "rate_limit") {
        markGeminiLimitReached();
        setMessage("gemini_rate_limit");
      } else {
        setMessage("Mock Parser로 추출 가능한 항목을 반영했습니다.");
      }
      window.localStorage.setItem(cacheKey, JSON.stringify({
        note: extractionNote,
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
        failedSmartInput: extractionNote,
        failedSmartInputLength: extractionNote.length,
        failedTrimmedLength: extractionNote.trim().length,
      });
      if (isGeminiResourceExhausted(error instanceof Error ? error.message : error)) {
        markGeminiLimitReached();
        setMessage("gemini_rate_limit");
        return;
      }
      setMessage("추출에 실패했습니다. 직접 입력하거나 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    setMessage("");
    setSmartTranscript([]);
    setSmartAdditionalMemo("");
    setSmartInputNote("");
    setVoiceStatus("");
    setVoiceStatusCustomer(null);
    chunksRef.current = [];
    recorderRef.current = null;
    stopCurrentStream();
    setRecordingState("idle");
    setUploadBusy(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setResetOpen(false);
  };

  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 shadow-soft sm:p-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_132px]">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <p className="text-sm font-extrabold text-sky-900">Smart Input</p>
            <PbPrivateNotice />
            <SmartInputStatusBadge message={visibleVoiceStatus} />
            <SmartInputStatusBadge message={extractCompleteMessage} />
          </div>
          <div className="space-y-3 bg-sky-50">
            <div className="rounded-lg border border-sky-200 bg-white p-4">
              <p className="mb-3 text-sm font-extrabold text-navy">대화록</p>
              {transcript.length ? (
                <div className="space-y-3">
                  {transcript.map((turn, index) => (
                    <div key={`${turn.speaker}-${index}`} className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3">
                      <span className={`inline-flex h-7 w-11 items-center justify-center rounded-full text-xs font-extrabold ${
                        turn.speaker === "PB"
                          ? "border border-navy bg-white text-navy"
                          : "bg-navy text-white"
                      }`}>
                        {turn.speaker}
                      </span>
                      <p className="pt-0.5 text-[15px] leading-6 text-black">{turn.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-400">
                  음성 파일 업로드 또는 녹음을 완료하면 PB/고객 대화록이 표시됩니다.
                </p>
              )}
            </div>
            <div className="rounded-lg border border-sky-200 bg-white p-4">
              <label className="block">
                <span className="mb-2 block text-sm font-extrabold text-navy">추가 메모</span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[15px] leading-6 text-ink transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
                  value={additionalMemo}
                  placeholder="녹음 종료 후 추가 정보, 고객 성향, 주의점, 커뮤니케이션 방식 등을 입력하세요."
                  onChange={(e) => setSmartAdditionalMemo(e.target.value)}
                />
              </label>
            </div>
          </div>
          {message === "gemini_rate_limit" ? (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-extrabold text-sky-900">■ Gemini 무료 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.</p>
              <p className="text-xs font-bold text-sky-800">
                {geminiUsageLabel(usageToday)}
              </p>
            </div>
          ) : message && message !== "customer_extract_complete" ? (
            <p className={`mt-2 text-sm font-bold ${message.includes("실패") ? "text-red-700" : "text-sky-900"}`}>{message}</p>
          ) : null}
          {message !== "gemini_rate_limit" ? (
            <p className="mt-2 text-xs font-bold text-sky-800">
              {geminiUsageLabel(usageToday)}
            </p>
          ) : null}
        </div>
        <div className="grid content-start gap-1.5 lg:pt-10">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,.m4a,.webm,audio/mpeg,audio/wav,audio/mp4,audio/webm"
            className="hidden"
            onChange={(event) => { void handleAudioUpload(event.target.files?.[0] ?? null); }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadBusy || recordingState !== "idle"}
            className="min-h-9 rounded-lg border border-sky-300 bg-white px-2.5 py-1.5 text-xs font-extrabold text-samsung transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            음성 파일 업로드
          </button>
          <div className="rounded-lg border border-sky-200 bg-white px-2 py-1.5">
            <div className="flex items-center justify-between gap-1.5">
              <span className="whitespace-nowrap text-xs font-extrabold text-samsung">녹음</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="녹음 시작 또는 재개"
                  onClick={() => { void startOrResumeRecording(); }}
                  disabled={uploadBusy || recordingState === "recording" || recordingState === "transcribing"}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-sky-200 text-xs font-extrabold text-samsung transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ▶
                </button>
                <button
                  type="button"
                  aria-label="녹음 일시중단"
                  onClick={pauseRecording}
                  disabled={uploadBusy || recordingState !== "recording"}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-sky-200 text-xs font-extrabold text-samsung transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ||
                </button>
                <button
                  type="button"
                  aria-label="녹음 종료"
                  onClick={stopRecording}
                  disabled={uploadBusy || (recordingState !== "recording" && recordingState !== "paused")}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-sky-200 text-xs font-extrabold text-samsung transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ■
                </button>
              </div>
            </div>
          </div>
          <div className="grid gap-1.5">
            <button
              type="button"
              onClick={extract}
              disabled={loading}
              className="min-h-9 rounded-lg border border-yellow-300 bg-white px-2 py-1.5 text-xs font-extrabold text-yellow-900 transition hover:bg-yellow-100 disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? "추출 중" : "추출하기"}
            </button>
            <button
              type="button"
              onClick={() => setResetOpen(true)}
              className="min-h-9 rounded-lg border border-red-300 bg-white px-2 py-1.5 text-xs font-extrabold text-red-700 transition hover:bg-red-50"
            >
              초기화
            </button>
          </div>
        </div>
      </div>
      {resetOpen ? (
        <ConfirmModal
          icon={<Trash2 size={26} />}
          title="Smart Input 초기화"
          body={`${selectedCustomerProfile.name || "현재 고객"} Smart Input 대화록과 추가 메모를 초기화하시겠습니까?`}
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

const riskGradeGuide = [
  {
    range: "81~100점",
    level: "초고위험",
    detail: "1등급 - 초고위험 - 매우 높은 위험",
    color: "text-red-600",
    description: "시장평균 수익률을 훨씬 넘어서는 높은 수준의 투자수익을 추구하며, 자산가치의 변동에 따른 손실 위험을 적극적으로 수용합니다.",
  },
  {
    range: "61~80점",
    level: "고위험",
    detail: "2등급 - 고위험 - 높은 위험",
    color: "text-orange-600",
    description: "투자원금의 보전보다는 투자수익을 추구하며, 투자자금의 상당 부분을 위험자산에 투자합니다.",
  },
  {
    range: "41~60점",
    level: "중위험",
    detail: "3등급 - 중위험 - 보통 위험",
    color: "text-lime-600",
    description: "주식형과 채권형 상품에 적절하게 배분하여 투자하는 것을 선호하며, 상당히 높은 수익을 기대할 수 있다면 손실 위험을 감수합니다.",
  },
  {
    range: "21~40점",
    level: "저위험",
    detail: "4등급 - 저위험 - 낮은 위험",
    color: "text-green-600",
    description: "투자원금 손실 위험은 최소화하고, 이자·배당소득 중심의 안정적 투자를 목표로 하며, 높은 수익을 위해 단기적인 손실을 수용합니다.",
  },
  {
    range: "0~20점",
    level: "초저위험",
    detail: "5등급 - 초저위험 - 매우 낮은 위험",
    color: "text-blue-600",
    description: "예·적금 수준의 기대수익률을 가지고 있으며, 가급적이면 투자원금에 손실이 발생하는 것을 원하지 않습니다.",
  },
];

function summaryRiskGrade(score: number) {
  if (score >= 81) {
    return {
      level: "초고위험",
      detail: "1등급, 매우 높은 위험",
      color: riskGradeGuide[0].color,
      description: riskGradeGuide[0].description,
    };
  }
  if (score >= 61) {
    return {
      level: "고위험",
      detail: "2등급, 높은 위험",
      color: riskGradeGuide[1].color,
      description: riskGradeGuide[1].description,
    };
  }
  if (score >= 41) {
    return {
      level: "중위험",
      detail: "3등급, 보통 위험",
      color: riskGradeGuide[2].color,
      description: riskGradeGuide[2].description,
    };
  }
  if (score >= 21) {
    return {
      level: "저위험",
      detail: "4등급, 낮은 위험",
      color: riskGradeGuide[3].color,
      description: riskGradeGuide[3].description,
    };
  }
  return {
    level: "초저위험",
    detail: "5등급, 매우 낮은 위험",
    color: riskGradeGuide[4].color,
    description: riskGradeGuide[4].description,
  };
}

function SummaryRow({ label, children, missing = false }: { label: React.ReactNode; children: React.ReactNode; missing?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid sm:grid-cols-[210px_minmax(0,1fr)]">
      <div className="flex items-center bg-sky-100 px-4 py-3 text-sm font-bold text-samsung">
        <div className="flex flex-wrap items-center gap-2">
          <span className="contents">{label}</span>
          {missing ? <MissingNotice /> : null}
        </div>
      </div>
      <div className="px-4 py-3 text-sm font-semibold leading-6 text-navy">{children}</div>
    </div>
  );
}

function SummaryChips({ rows }: { rows: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
          <span className="rounded-md bg-sky-100 px-2.5 py-1 text-xs font-extrabold text-samsung">{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

function InlineMissingMark() {
  return <span className="text-xs font-extrabold text-red-600" aria-label="누락 주의">🚨</span>;
}

function InlineQuestionTitle({ label, missing = false, className = "" }: { label: string; missing?: boolean; className?: string }) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <span className="min-w-0 whitespace-nowrap">{questionLabel(label)}</span>
      {missing ? <InlineMissingMark /> : null}
    </span>
  );
}

function AssetValueInput({ label, value, placeholder, onChange, missing = false }: { label: string; value: string; placeholder: string; onChange: (value: string) => void; missing?: boolean }) {
  return (
    <label className="grid gap-2 sm:grid-cols-[max-content_108px] sm:items-center sm:justify-between">
      <InlineQuestionTitle label={label} missing={missing} className="text-[15px] font-bold leading-6 text-slate-800" />
      <input
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-right text-sm text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function CalculatedAssetValue({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-2">
      <span className="flex items-center gap-2 text-[15px] font-bold leading-6 text-slate-800">{icon}{label}</span>
      <span className="text-right text-[15px] text-ink">{value || "계산 대기"}</span>
    </div>
  );
}

function AssetCard({
  label,
  value,
  placeholder,
  onChange,
  missing = false,
  inputColumnClass = "sm:grid-cols-[minmax(0,1fr)_104px]",
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  missing?: boolean;
  inputColumnClass?: string;
}) {
  return (
    <label className={`question-card grid gap-2 rounded-lg border border-slate-200 px-3 py-2.5 sm:items-center ${inputColumnClass}`}>
      <InlineQuestionTitle label={label} missing={missing} className="text-[15px] font-bold leading-6 text-slate-800" />
      <input
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-right text-sm text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function GuidedAssetField({
  label,
  value,
  placeholder,
  guide,
  onChange,
  missing = false,
}: {
  label: string;
  value: string;
  placeholder: string;
  guide?: string;
  onChange: (value: string) => void;
  missing?: boolean;
}) {
  return (
    <label className="question-card grid gap-2 rounded-lg border border-slate-200 px-3 py-2.5 sm:grid-cols-[max-content_132px] sm:items-center sm:justify-between">
      <div>
        <InlineQuestionTitle label={label} missing={missing} className="text-[15px] font-bold leading-6 text-slate-800" />
        {guide ? <span className="mt-1 block whitespace-nowrap text-xs font-semibold leading-5 text-slate-400">{guide}</span> : null}
      </div>
      <input
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-right text-sm text-ink shadow-sm transition placeholder:text-slate-400 hover:border-slate-300 focus:border-samsung"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function AutoChoiceGroup({ label, description, options, value }: { label: string; description?: string; options: string[]; value: string }) {
  return (
    <div className="question-card rounded-lg border border-slate-200 p-4">
      <QuestionTitle label={label} missing={!value} className="text-[15px] font-bold leading-6 text-slate-800" />
      <p className="mt-2 text-xs font-extrabold text-samsung">위 자산 입력값 기준 자동 산출됩니다.</p>
      <div className={`mt-3 grid max-w-5xl gap-2.5 ${options.length >= 5 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2"}`}>
        {options.map((option) => {
          const selected = value === option;
          return (
            <div
              key={option}
              className={`flex min-h-12 cursor-default items-center rounded-lg border px-4 py-3 text-left text-[15px] font-semibold leading-6 ${selected ? "border-samsung bg-blue-100 text-blue-800" : "border-slate-200 bg-slate-100 text-slate-400"}`}
            >
              {option}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryAnalysisCard({
  formData,
  riskResult,
  selectedCustomerProfile,
}: {
  formData: ReturnType<typeof useCustomerContext>["formData"];
  riskResult: ReturnType<typeof useCustomerContext>["riskResult"];
  selectedCustomerProfile: ReturnType<typeof useCustomerContext>["selectedCustomerProfile"];
}) {
  const [riskGuideOpen, setRiskGuideOpen] = useState(false);

  const financial = formData.financial;
  const rrttllu = formData.rrttllu;
  const riskGrade = summaryRiskGrade(riskResult.score);
  const riskPreferenceLabel = preferenceLabelFromScore(riskResult.score);
  const returnRows: [string, string][] = [
    ["투자 목적", summaryValue(rrttllu.returnObjective)],
    ["기대수익률", rrttllu.expectedReturnUnknown ? "구체적인 수치는 모름" : summaryValue(rrttllu.expectedReturn)],
  ];
  const financialSummary: [string, string][] = [
    ["순자산", summaryValue(financial.totalAssets)],
    ["금융자산", summaryValue(financial.financialAssets)],
    ["부동산", summaryValue(financial.realEstate)],
    ["부채", summaryValue(financial.debt)],
    ["연 고정소득", summaryValue(financial.annualFixedIncome)],
    ["월 고정지출", summaryValue(financial.monthlyFixedExpense)],
    ["추가 투자 의향 자산", summaryValue(financial.investableAssets)],
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
    ["정기 현금흐름 필요", summaryValue(formatLiquiditySummary(rrttllu.regularCashflowNeed, "regular"))],
    ["목돈 사용 계획", summaryValue(formatLiquiditySummary(rrttllu.lumpSumPlan, "lumpSum"))],
    ["비상예비자금 계획", summaryValue(formatLiquiditySummary(rrttllu.emergencyReservePlan, "emergency"))],
  ];
  const blank = (value: string | string[]) => Array.isArray(value) ? value.length === 0 : !value.trim();
  const summaryMissing = {
    financial: [
      financial.existingInvestmentAssets,
      financial.cashAssets,
      financial.realEstate,
      financial.debt,
      financial.annualFixedIncome,
      financial.monthlyFixedExpense,
      financial.investableAssets,
      financial.irregularIncomeNone ? "없음" : financial.irregularIncome,
    ].some((value) => !value.trim()),
    return: !rrttllu.returnObjective.trim() || (!rrttllu.expectedReturnUnknown && !rrttllu.expectedReturn.trim()),
    risk: [
      rrttllu.investmentExperience,
      rrttllu.knowledgeLevel,
      rrttllu.derivativesExperience,
      rrttllu.financialAssetRatio,
      rrttllu.investmentAssetRatio,
      rrttllu.riskAttitude,
      rrttllu.lossResponse,
    ].some((value) => blank(value)),
    timeHorizon: !rrttllu.timeHorizon.trim(),
    tax: [rrttllu.giftingPlan, rrttllu.globalTaxImportance, rrttllu.recentGlobalTaxSubject, rrttllu.foreignStockTaxImportance].some((value) => !value.trim()),
    liquidity: !formatLiquiditySummary(rrttllu.regularCashflowNeed, "regular") || !formatLiquiditySummary(rrttllu.lumpSumPlan, "lumpSum") || !formatLiquiditySummary(rrttllu.emergencyReservePlan, "emergency"),
    legal: !rrttllu.legalConstraints.length || (rrttllu.legalConstraints.includes("기타") && !rrttllu.legalConstraintOther.trim()),
  };
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
          <SummaryRow label="고객 재무 현황" missing={summaryMissing.financial}><SummaryChips rows={financialSummary} /></SummaryRow>
          <SummaryRow label="Return" missing={summaryMissing.return}><SummaryChips rows={returnRows} /></SummaryRow>
          <SummaryRow
            missing={summaryMissing.risk}
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
              <span className={`${preferenceBadgeClass} ml-2 align-middle`}>{riskPreferenceLabel}</span>
              <p className="mt-2 font-semibold text-slate-950">{riskGrade.description}</p>
            </div>
          </SummaryRow>
          <SummaryRow label="Time Horizon" missing={summaryMissing.timeHorizon}><SummaryChips rows={[["투자 기간", summaryValue(rrttllu.timeHorizon)]]} /></SummaryRow>
          <SummaryRow label="Tax" missing={summaryMissing.tax}><SummaryChips rows={taxSummary} /></SummaryRow>
          <SummaryRow label="Liquidity" missing={summaryMissing.liquidity}><SummaryChips rows={liquidityRows} /></SummaryRow>
          <SummaryRow label="Legal" missing={summaryMissing.legal}><SummaryChips rows={legalRows} /></SummaryRow>
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
              <div className="space-y-3">
                {[
                  { label: "🔥 공격형", grades: riskGradeGuide.slice(0, 2), connector: "bracket" },
                  { label: "⚖️ 밸런스형", grades: riskGradeGuide.slice(2, 3), connector: "dash" },
                  { label: "🛡️ 안전형", grades: riskGradeGuide.slice(3, 5), connector: "bracket" },
                ].map((group) => (
                  <div key={group.label} className="grid grid-cols-[5.5rem_28px_1fr] items-center gap-3">
                    <span className={preferenceBadgeClass}>{group.label}</span>
                    <span className="relative flex h-full min-h-10 items-center justify-center">
                      {group.connector === "bracket" ? (
                        <span className="relative block h-full min-h-24 w-5">
                          <span className="absolute left-0 top-[25%] bottom-[25%] w-0.5 bg-[#1f2a5a]" />
                          <span className="absolute left-0 top-[25%] h-0.5 w-5 bg-[#1f2a5a]" />
                          <span className="absolute left-0 top-[75%] h-0.5 w-5 bg-[#1f2a5a]" />
                        </span>
                      ) : (
                        <span className="block h-0.5 w-5 bg-[#1f2a5a]" />
                      )}
                    </span>
                    <div className="grid gap-2">
                      {group.grades.map((grade) => (
                        <div key={grade.range} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6">
                          <span className="font-extrabold text-slate-950">{grade.range}</span>
                          <span className="px-2 text-slate-400">|</span>
                          <span className={`font-extrabold ${grade.color}`}>{grade.detail}</span>
                          <span className="px-2 text-slate-400">|</span>
                          <span className="font-semibold text-slate-950">{grade.description}</span>
                        </div>
                      ))}
                    </div>
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
      <h3 className="text-base font-extrabold text-navy">[4] (참조) Unique Circumstances</h3>
      <p className="mt-2 text-xs font-bold leading-5 text-amber-700">
        AI 재분류나 요약 없이, 고객의 추가 고려사항을 PB 참고용으로 그대로 표시합니다.
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
  notice,
}: {
  guide: AdvisoryGuide;
  loading: boolean;
  error: string;
  notice: string;
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
      {notice ? <p className="mt-4 rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-bold text-samsung">{notice}</p> : null}
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
    appMode, formData, riskResult,
    selectedCustomerProfile, selectedCustomer, internalJsonPayload,
    setFinancial, setRrttllu, setIrregularIncome, toggleNoIrregularIncome,
    setExpectedReturn, toggleExpectedReturnUnknown, toggleInvestmentExperience,
    toggleLegalConstraint, setAiAdvisoryGuide,
  } = useCustomerContext();
  const [activeSubTab, setActiveSubTab] = useState<Tab1SubTab>("input");
  const [advisoryGuideLoading, setAdvisoryGuideLoading] = useState(false);
  const [advisoryGuideError, setAdvisoryGuideError] = useState("");
  const [advisoryGuideNotice, setAdvisoryGuideNotice] = useState("");
  const advisoryGuide = useMemo(() => normalizeAdvisoryGuide(formData.aiAdvisoryGuide), [formData.aiAdvisoryGuide]);
  const advisoryGuideRrttllu = useMemo(() => ({
    ...formData.rrttllu,
    regularCashflowNeed: formatLiquiditySummary(formData.rrttllu.regularCashflowNeed, "regular"),
    lumpSumPlan: formatLiquiditySummary(formData.rrttllu.lumpSumPlan, "lumpSum"),
    emergencyReservePlan: formatLiquiditySummary(formData.rrttllu.emergencyReservePlan, "emergency"),
  }), [formData.rrttllu]);

  const advisoryGuidePayload = useMemo(() => ({
    customerId: selectedCustomer,
    profile: selectedCustomerProfile,
    smartInputNote: formData.smartInputNote,
    formData: {
      financial: formData.financial,
      rrttllu: advisoryGuideRrttllu,
    },
    riskResult,
    structuredJson: internalJsonPayload,
    uniqueOther: formData.rrttllu.uniqueOther,
    smartInputContext: {
      raw: transcriptToSmartInputText(normalizeTranscriptTurns(formData.smartTranscript ?? []), formData.smartAdditionalMemo ?? ""),
      transcript: normalizeTranscriptTurns(formData.smartTranscript ?? []),
      additionalMemo: formData.smartAdditionalMemo ?? "",
      reflectedUniqueOther: formData.rrttllu.uniqueOther,
      smartExtractedUniqueOther: formData.smartExtractedUniqueOther,
      reflectedExistingAssetPlan: formData.rrttllu.holdingOrDisposalPlan,
    },
  }), [formData.financial, advisoryGuideRrttllu, formData.smartInputNote, formData.smartTranscript, formData.smartAdditionalMemo, formData.smartExtractedUniqueOther, internalJsonPayload, riskResult, selectedCustomer, selectedCustomerProfile]);

  const advisoryGuidePayloadSignature = useMemo(() => stableStringify(advisoryGuidePayload), [advisoryGuidePayload]);

  const isBlank = (value: string | string[]) => Array.isArray(value) ? value.length === 0 : !value.trim();
  const financialMissing = {
    assetSummary: [formData.financial.existingInvestmentAssets, formData.financial.cashAssets, formData.financial.realEstate, formData.financial.debt].some((value) => !value.trim()),
    existingInvestmentAssets: !formData.financial.existingInvestmentAssets.trim(),
    cashAssets: !formData.financial.cashAssets.trim(),
    realEstate: !formData.financial.realEstate.trim(),
    debt: !formData.financial.debt.trim(),
    annualFixedIncome: !formData.financial.annualFixedIncome.trim(),
    monthlyFixedExpense: !formData.financial.monthlyFixedExpense.trim(),
    investableAssets: !formData.financial.investableAssets.trim(),
    irregularIncome: !formData.financial.irregularIncomeNone && !formData.financial.irregularIncome.trim(),
  };
  const rr = formData.rrttllu;
  const sectionMissing = {
    financial: Object.values(financialMissing).some(Boolean),
    return: !rr.returnObjective.trim() || (!rr.expectedReturnUnknown && !rr.expectedReturn.trim()),
    risk: [
      rr.investmentExperience,
      rr.knowledgeLevel,
      rr.derivativesExperience,
      rr.financialAssetRatio,
      rr.investmentAssetRatio,
      rr.riskAttitude,
      rr.lossResponse,
    ].some((value) => isBlank(value)),
    timeHorizon: !rr.timeHorizon.trim(),
    tax: [rr.giftingPlan, rr.globalTaxImportance, rr.recentGlobalTaxSubject, rr.foreignStockTaxImportance].some((value) => !value.trim()),
    liquidity: !formatLiquiditySummary(rr.regularCashflowNeed, "regular") || !formatLiquiditySummary(rr.lumpSumPlan, "lumpSum") || !formatLiquiditySummary(rr.emergencyReservePlan, "emergency"),
    legal: !rr.legalConstraints.length || (rr.legalConstraints.includes("기타") && !rr.legalConstraintOther.trim()),
  };

  useEffect(() => {
    const stored = window.localStorage.getItem(tab1SubTabStorageKey);
    if (stored === "input" || stored === "analysis" || (appMode === "pb" && stored === "guide")) setActiveSubTab(stored as Tab1SubTab);
  }, [appMode]);

  useEffect(() => {
    if (appMode === "customer" && activeSubTab === "guide") setActiveSubTab("input");
  }, [activeSubTab, appMode]);

  const selectSubTab = (tab: Tab1SubTab) => {
    setActiveSubTab(tab);
    window.localStorage.setItem(tab1SubTabStorageKey, tab);
  };

  const generateAdvisoryGuide = async () => {
    if (advisoryGuideLoading) return;
    if (formData.aiAdvisoryGuide && formData.aiGuidePayloadSignature === advisoryGuidePayloadSignature) {
      setAdvisoryGuideError("");
      setAdvisoryGuideNotice("입력값 변경이 없어 기존 AI 상담 가이드를 불러왔습니다.");
      return;
    }
    setAdvisoryGuideLoading(true);
    setAdvisoryGuideError("");
    setAdvisoryGuideNotice("");
    try {
      console.info("[Gemini Call Trigger] advisory-guide", {
        customerId: selectedCustomer,
        smartInputLength: formData.smartInputNote.length,
        uniqueOtherLength: formData.rrttllu.uniqueOther.length,
      });
      const response = await fetch("/api/generate-advisory-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(advisoryGuidePayload),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) throw new Error(result?.message ?? result?.error ?? "Gemini response failed");
      if (result.fallbackReason === "rate_limit" || isGeminiResourceExhausted(result)) {
        writeGeminiUsageToday(geminiDailyUsageLimit);
      }
      if (result.geminiUsed === true) incrementGeminiUsageToday();
      setAiAdvisoryGuide(
        normalizeAdvisoryGuide(result.data ?? emptyAdvisoryGuide) as StoredAdvisoryGuide,
        advisoryGuidePayloadSignature,
        new Date().toISOString(),
      );
      setAdvisoryGuideNotice("AI 상담 가이드 생성이 완료되었습니다. Tab1-3에서 확인해주세요.");
    } catch (error) {
      console.error("AI advisory guide request failed", { error, advisoryGuidePayload });
      if (isGeminiResourceExhausted(error instanceof Error ? error.message : error)) {
        writeGeminiUsageToday(geminiDailyUsageLimit);
      }
      setAdvisoryGuideError("AI 상담 가이드 생성에 실패했습니다. 입력 정보를 확인하거나 다시 시도해주세요.");
    } finally {
      setAdvisoryGuideLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div data-consultation-lock-exempt="true" className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-soft">
        {[
          { id: "input" as const, label: "고객 정보 입력", icon: <ClipboardList size={15} /> },
          { id: "analysis" as const, label: "성향 및 니즈 분석", icon: <BarChart3 size={15} /> },
          { id: "guide" as const, label: "AI 상담 가이드", icon: <Sparkles size={15} /> },
        ].filter((tab) => appMode === "pb" || tab.id !== "guide").map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectSubTab(tab.id)}
            className={`flex shrink-0 flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition ${
              activeSubTab === tab.id
                ? "bg-samsung text-white shadow-soft"
                : "text-slate-600 hover:bg-slate-100 hover:text-navy"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === "input" ? (
        <>
      {appMode === "pb" ? <SmartInputCard /> : null}

      {/* 기본 재무 정보 */}
      <Panel icon={<WalletCards size={18} />} eyebrow="기본 재무 정보" title="고객 재무 현황" note="※ 금액은 원화(KRW) 기준으로 입력해주세요.">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
          <div className="asset-summary-card rounded-lg border border-slate-200 bg-white p-3 shadow-soft">
            <QuestionTitle label="현재 자산 현황을 알려주세요." missing={financialMissing.assetSummary} className="text-sm font-bold text-slate-800" />
            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(230px,0.8fr)]">
              <div>
                <div className="question-card rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <InlineQuestionTitle label="금융자산" missing={financialMissing.existingInvestmentAssets || financialMissing.cashAssets} className="text-[15px] font-bold leading-6 text-slate-800" />
                    <span className="text-[15px] font-bold text-slate-700">{formData.financial.financialAssets || "계산 대기"}</span>
                  </div>
                  <div className="grid gap-2.5">
                    <AssetValueInput label="기존 투자자산*" value={formData.financial.existingInvestmentAssets} placeholder="예. 20억" missing={financialMissing.existingInvestmentAssets} onChange={(v) => setFinancial("existingInvestmentAssets", v)} />
                    <AssetValueInput label="현금성 자산**" value={formData.financial.cashAssets} placeholder="예. 8억" missing={financialMissing.cashAssets} onChange={(v) => setFinancial("cashAssets", v)} />
                  </div>
                </div>
                <p className="mt-2 whitespace-nowrap text-xs font-semibold leading-5 text-slate-400">
                  *투자자산: 주식, ETF, 펀드, 채권, 리츠(REITs), ELS 등<br />
                  **현금성 자산: 예·적금, CMA, MMF, RP 등
                </p>
              </div>
              <div className="grid content-start gap-3">
                <AssetCard label="부동산" value={formData.financial.realEstate} placeholder="예. 15억" missing={financialMissing.realEstate} onChange={(v) => setFinancial("realEstate", v)} />
                <AssetCard label="부채" value={formData.financial.debt} placeholder="예. 3억" missing={financialMissing.debt} onChange={(v) => setFinancial("debt", v)} />
                <CalculatedAssetValue label="순자산" value={formData.financial.totalAssets} icon={<span aria-hidden="true">💎</span>} />
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-soft">
            <div className="grid gap-2.5">
              <GuidedAssetField label="추가 투자 의향 자산" value={formData.financial.investableAssets} placeholder="예. 6억" guide="현금성 자산 범위 내에서 입력해주세요." missing={financialMissing.investableAssets} onChange={(v) => setFinancial("investableAssets", v)} />
              <AssetCard label="(가구 기준) 연 고정소득" value={formData.financial.annualFixedIncome} placeholder="예. 3억~5억" missing={financialMissing.annualFixedIncome} inputColumnClass="sm:grid-cols-[max-content_132px] sm:justify-between" onChange={(v) => setFinancial("annualFixedIncome", v)} />
              <AssetCard label="(가구 기준) 월 고정지출" value={formData.financial.monthlyFixedExpense} placeholder="예. 500만~1000만" missing={financialMissing.monthlyFixedExpense} inputColumnClass="sm:grid-cols-[max-content_132px] sm:justify-between" onChange={(v) => setFinancial("monthlyFixedExpense", v)} />
            </div>
          </div>
        </div>
        <p className="text-xs font-semibold leading-5 text-samsung">
          *기존 투자자산은 대략 입력해주세요. 실제 운용 자산은 Tab2 보유 종목 기준으로 자동 계산됩니다.
        </p>
        <div className="grid gap-3">
          <IncomeWithNoneField label="향후 예상되는 비정기 소득" value={formData.financial.irregularIncome} placeholder="예. 연 성과급 6~7억, 3년 내 스톡옵션 행사 20억, 부동산 매각 30억 예상" noneSelected={formData.financial.irregularIncomeNone} missing={financialMissing.irregularIncome} onChange={setIrregularIncome} onToggleNone={toggleNoIrregularIncome} />
        </div>
      </Panel>

      {/* ① Return */}
      <Panel icon={<BarChart3 size={18} />} eyebrow="RRTTLLU" title="① Return 목표 수익률">
        <CheckerboardGrid className="grid gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
          <ChoiceGroup label="투자 목적은 무엇인가요?" options={returnOptions} value={formData.rrttllu.returnObjective} missing={!formData.rrttllu.returnObjective.trim()} onChange={(v) => setRrttllu("returnObjective", v)} />
          <ExpectedReturnField value={formData.rrttllu.expectedReturn} unknownSelected={formData.rrttllu.expectedReturnUnknown} missing={!formData.rrttllu.expectedReturnUnknown && !formData.rrttllu.expectedReturn.trim()} onChange={setExpectedReturn} onToggleUnknown={toggleExpectedReturnUnknown} />
        </CheckerboardGrid>
      </Panel>

      {/* ② Risk */}
      <Panel icon={<ShieldCheck size={18} />} eyebrow="RRTTLLU" title="② Risk 위험 허용도">
        <CheckerboardGrid className="grid gap-4 xl:grid-cols-2" invert itemClassName={(index) => (index === 0 ? "xl:col-span-2" : "")}>
          <MultiChoiceGroup label="투자 경험이 있는 금융상품을 모두 선택해주세요." options={riskExperienceOptions} values={formData.rrttllu.investmentExperience} missing={!formData.rrttllu.investmentExperience.length} onToggle={toggleInvestmentExperience} />
          <ChoiceGroup label="투자 지식 수준은 어느 정도인가요?" options={fieldGroups.knowledge} value={formData.rrttllu.knowledgeLevel} missing={!formData.rrttllu.knowledgeLevel.trim()} onChange={(v) => setRrttllu("knowledgeLevel", v)} />
          <ChoiceGroup label="파생상품 투자 경험이 있으신가요?" description="파생상품: 파생상품, 원금비보장형 파생결합 증권, 파생상품펀드, 레버리지/인버스 ETF 등" options={fieldGroups.derivatives} value={formData.rrttllu.derivativesExperience} missing={!formData.rrttllu.derivativesExperience.trim()} onChange={(v) => setRrttllu("derivativesExperience", v)} />
          <AutoChoiceGroup label="순자산 중 금융자산의 비중" description="금융자산: 기존 투자자산 + 현금성 자산" options={fieldGroups.financialAssetRatio} value={formData.rrttllu.financialAssetRatio} />
          <AutoChoiceGroup label="금융자산 중 투자자산의 비중" description="투자자산: 주식, ETF, 펀드, 채권, 리츠(REITs), ELS 등" options={fieldGroups.investmentAssetRatio} value={formData.rrttllu.investmentAssetRatio} />
          <ChoiceGroup label="기대이익 및 기대손실 등을 고려한 위험에 대한 태도" options={fieldGroups.riskAttitude} value={formData.rrttllu.riskAttitude} missing={!formData.rrttllu.riskAttitude.trim()} optionGridClassName="grid-cols-1" onChange={(v) => setRrttllu("riskAttitude", v)} />
          <ChoiceGroup label="단기적으로 손실이 초과 발생할 때 대응" options={fieldGroups.lossResponse} value={formData.rrttllu.lossResponse} missing={!formData.rrttllu.lossResponse.trim()} onChange={(v) => setRrttllu("lossResponse", v)} />
        </CheckerboardGrid>
      </Panel>

      {/* ③ Time Horizon */}
      <Panel icon={<ClipboardList size={18} />} eyebrow="RRTTLLU" title="③ Time Horizon 투자 기간">
        <ChoiceGroup label="투자 가능한 기간을 선택해 주세요." options={fieldGroups.timeHorizon} value={formData.rrttllu.timeHorizon} missing={!formData.rrttllu.timeHorizon.trim()} onChange={(v) => setRrttllu("timeHorizon", v)} />
      </Panel>

      {/* ④ Tax */}
      <Panel icon={<PieChart size={18} />} eyebrow="RRTTLLU" title="④ Tax 세금 요인">
        <CheckerboardGrid className="tax-grid grid gap-4 lg:grid-cols-2">
          <ChoiceGroup label="자녀/가족 사전증여 계획" options={fieldGroups.giftingPlan} value={formData.rrttllu.giftingPlan} missing={!formData.rrttllu.giftingPlan.trim()} onChange={(v) => setRrttllu("giftingPlan", v)} />
          <ChoiceGroup label="금융소득종합과세 절감 중요도" options={fieldGroups.taxImportance} value={formData.rrttllu.globalTaxImportance} missing={!formData.rrttllu.globalTaxImportance.trim()} onChange={(v) => setRrttllu("globalTaxImportance", v)} />
          <ChoiceGroup label="최근 3년 내 금융소득종합과세 대상 여부" options={fieldGroups.recentTax} value={formData.rrttllu.recentGlobalTaxSubject} missing={!formData.rrttllu.recentGlobalTaxSubject.trim()} onChange={(v) => setRrttllu("recentGlobalTaxSubject", v)} />
          <ChoiceGroup label="해외주식 양도소득세 절감 중요도" options={fieldGroups.taxImportance} value={formData.rrttllu.foreignStockTaxImportance} missing={!formData.rrttllu.foreignStockTaxImportance.trim()} onChange={(v) => setRrttllu("foreignStockTaxImportance", v)} />
        </CheckerboardGrid>
      </Panel>

      {/* ⑤ Liquidity */}
      <Panel icon={<WalletCards size={18} />} eyebrow="RRTTLLU" title="⑤ Liquidity 유동성 필요 시기">
        <LiquidityNeedsEditor
          regularValue={formData.rrttllu.regularCashflowNeed}
          lumpSumValue={formData.rrttllu.lumpSumPlan}
          emergencyValue={formData.rrttllu.emergencyReservePlan}
          onChange={(kind, value) => {
            if (kind === "regular") setRrttllu("regularCashflowNeed", value);
            if (kind === "lumpSum") setRrttllu("lumpSumPlan", value);
            if (kind === "emergency") setRrttllu("emergencyReservePlan", value);
          }}
        />
      </Panel>

      {/* ⑥ Legal */}
      <Panel icon={<LockKeyhole size={18} />} eyebrow="RRTTLLU" title="⑥ Legal 법적 규제">
        <CheckerboardGrid className="grid gap-3">
          <MultiChoiceGroup label="투자 의사결정에 영향을 줄 수 있는 법적/제도적 제약" options={fieldGroups.legal} values={formData.rrttllu.legalConstraints} missing={!formData.rrttllu.legalConstraints.length} onToggle={toggleLegalConstraint} />
        </CheckerboardGrid>
        {formData.rrttllu.legalConstraints.includes("기타") ? (
          <CheckerboardGrid className="grid gap-3">
            <TextField label="기타 제약 직접 입력" value={formData.rrttllu.legalConstraintOther} placeholder="예. 내부 투자심의 승인 필요" missing={!formData.rrttllu.legalConstraintOther.trim()} onChange={(v) => setRrttllu("legalConstraintOther", v)} />
          </CheckerboardGrid>
        ) : null}
      </Panel>

      {/* ⑦ Unique */}
      {appMode === "pb" ? (
      <Panel
        icon={<Sparkles size={18} />}
        eyebrow="RRTTLLU"
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>⑦ Unique Circumstances 고객 고유 상황</span>
            <PbPrivateNotice />
            <button
              type="button"
              onClick={generateAdvisoryGuide}
              disabled={advisoryGuideLoading}
              className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-extrabold text-samsung shadow-sm transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {advisoryGuideLoading ? "AI 상담 가이드 생성 중..." : "AI 상담 가이드 생성"}
            </button>
          </span>
        }
      >
        {advisoryGuideNotice ? (
          <p className="mb-3 rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-bold text-samsung">{advisoryGuideNotice}</p>
        ) : null}
        <CheckerboardGrid className="grid gap-3">
          <div>
            <div className="question-card block rounded-lg border border-slate-200 p-4">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <QuestionTitle label="추가 고려사항" className="text-[15px] font-bold leading-6 text-slate-800" />
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
      </Panel>
      ) : null}

      <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm font-semibold leading-6 text-slate-600 shadow-soft">민감 정보는 필수 입력이 아니며, 제공이 어려운 경우 대략적인 범위만 입력하셔도 됩니다.</p>
        </>
      ) : (
        activeSubTab === "analysis" ? (
        <>
          <SummaryAnalysisCard
            formData={formData}
            riskResult={riskResult}
            selectedCustomerProfile={selectedCustomerProfile}
          />
        </>
        ) : (
        <>
          <AiConsultingGuideCard guide={advisoryGuide} loading={advisoryGuideLoading} error={advisoryGuideError} notice={advisoryGuideNotice} />
        </>
        )
      )}
    </div>
  );
}
