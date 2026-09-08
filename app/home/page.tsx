"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Home, LogOut, PanelLeftClose, PanelRightClose, Search, Trash2 } from "lucide-react";
import MarketDashboard from "@/components/MarketDashboard";
import SodaPopLogoImage from "@/app/components/SodaPopLogoImage";
import type { MarketCalendarEvent } from "@/lib/calendarData";
import {
  createInitialState,
  createNewCustomerProfile,
  calculateRiskResult,
  customerRowsToStoredState,
  customerStorage,
  getStoredSelectedCustomerId,
  loadSharedMaintabUiState,
  saveCustomerDataJsonOnly,
  saveCustomerProfileColumns,
  storeSelectedCustomerId,
  type AppState,
  type CustomerOwnerScope,
  type CustomerId,
  type CustomerProfile,
  type RebalancingHistoryRecord,
} from "../maintab/CustomerContext";
import { PortfolioCompareTable } from "../maintab/RebalancingHistoryTab";
import { formatLiquiditySummary } from "../maintab/liquidityFields";
import {
  autoEndedMessage,
  consultationTimerEventName,
  createConsultationSession,
  displayKoreanDate,
  displaySessionTitle,
  finishSession,
  formatTimer,
  getCustomerSessions,
  getElapsedSeconds,
  maxConsultationSeconds,
  readActiveConsultation,
  sortSessionsNewest,
  todayDate,
  writeActiveConsultation,
  writePreRecordConsultation,
  type ActiveConsultation,
  type ConsultationSession,
} from "../consultationStore";
import { formatLoginTime, pbAuthStore, type PbSession } from "../authStore";

const tempPbName = "삼성";

function normalizeBirthDate(value: string) {
  return value.replace(/[^\d]/g, "").slice(0, 8);
}

function calculateAgeFromBirthDate(value: string) {
  const digits = normalizeBirthDate(value);
  if (digits.length !== 6 && digits.length !== 8) return "";
  const now = new Date();
  const yy = Number(digits.slice(0, 2));
  const year = digits.length === 8 ? Number(digits.slice(0, 4)) : yy > now.getFullYear() % 100 ? 1900 + yy : 2000 + yy;
  const month = Number(digits.slice(digits.length === 8 ? 4 : 2, digits.length === 8 ? 6 : 4));
  const day = Number(digits.slice(digits.length === 8 ? 6 : 4, digits.length === 8 ? 8 : 6));
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return "";
  let age = now.getFullYear() - year;
  const birthdayPassed = now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day);
  if (!birthdayPassed) age -= 1;
  return age >= 0 && age < 130 ? String(age) : "";
}

function customerName(profile?: CustomerProfile) {
  return profile?.name?.trim() || profile?.fallbackName || "신규 고객";
}

function customerBirth(profile?: CustomerProfile) {
  return (profile?.birth_year ?? profile?.birthYear ?? profile?.fallbackBirthYear ?? "").trim();
}

function sortCustomersByName(customers: CustomerProfile[]) {
  return [...customers].sort((a, b) => customerName(a).localeCompare(customerName(b), "ko-KR"));
}

function customerDisplay(profile?: CustomerProfile | null) {
  const birth = customerBirth(profile ?? undefined);
  return `${customerName(profile ?? undefined)}${birth ? ` (${birth})` : ""}`;
}

function ageDisplay(age: string) {
  return age ? `${age}세` : "대기";
}

function isFutureSession(session: ConsultationSession) {
  if (!session.date) return false;
  const time = new Date(session.date.includes("T") ? session.date : `${session.date}T00:00:00`).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function buildSummarySnapshot(state?: AppState) {
  if (!state) return null;
  const { financial, rrttllu } = state;
  const risk = calculateRiskResult(rrttllu);
  return {
    netAssets: financial.totalAssets,
    financialAssets: financial.financialAssets,
    realEstate: financial.realEstate,
    debt: financial.debt,
    annualFixedIncome: financial.annualFixedIncome,
    monthlyFixedExpense: financial.monthlyFixedExpense,
    irregularIncome: financial.irregularIncomeNone ? "없음" : financial.irregularIncome,
    existingInvestmentAssets: financial.existingInvestmentAssets,
    cashAssets: financial.cashAssets,
    investableAssets: financial.investableAssets,
    returnObjective: rrttllu.returnObjective,
    expectedReturn: rrttllu.expectedReturnUnknown ? "모르겠음" : rrttllu.expectedReturn,
    riskScore: risk.score,
    riskLevel: risk.level,
    riskInterpretation: risk.interpretation,
    timeHorizon: rrttllu.timeHorizon,
    giftingPlan: rrttllu.giftingPlan,
    globalTaxImportance: rrttllu.globalTaxImportance,
    recentGlobalTaxSubject: rrttllu.recentGlobalTaxSubject,
    foreignStockTaxImportance: rrttllu.foreignStockTaxImportance,
    regularCashflowNeed: formatLiquiditySummary(rrttllu.regularCashflowNeed, "regular"),
    lumpSumPlan: formatLiquiditySummary(rrttllu.lumpSumPlan, "lumpSum"),
    emergencyReservePlan: formatLiquiditySummary(rrttllu.emergencyReservePlan, "emergency"),
    legalConstraints: Array.isArray(rrttllu.legalConstraints) ? rrttllu.legalConstraints.join(", ") : "",
    uniqueOther: rrttllu.uniqueOther,
  };
}

type SummarySnapshot = NonNullable<ReturnType<typeof buildSummarySnapshot>>;

function summaryRows(snapshot?: SummarySnapshot | null) {
  if (!snapshot) return [["요약", "상담 종료 후 요약 내용을 확인할 수 있습니다."]] as [string, string][];
  return [
    ["기존 투자자산", snapshot.existingInvestmentAssets || "미입력"],
    ["현금성 자산", snapshot.cashAssets || "미입력"],
    ["추가 투자 의향", snapshot.investableAssets || "미입력"],
    ["투자 목적", snapshot.returnObjective || "미입력"],
    ["목표 수익률", snapshot.expectedReturn || "미입력"],
    ["투자 기간", snapshot.timeHorizon || "미입력"],
    ["정기 현금흐름 필요", snapshot.regularCashflowNeed || "미입력"],
    ["목돈 사용 계획", snapshot.lumpSumPlan || "미입력"],
    ["비상예비자금 계획", snapshot.emergencyReservePlan || "미입력"],
    ["고객 고유 상황", snapshot.uniqueOther || "미입력"],
  ] as [string, string][];
}

function valueOrWaiting(value?: string | number | null) {
  const text = value == null ? "" : String(value).trim();
  return text || "입력 대기";
}

function missingNotice(values: Array<string | number | null | undefined>) {
  return values.some((value) => valueOrWaiting(value) === "입력 대기");
}

function summarySections(snapshot?: SummarySnapshot | null) {
  if (!snapshot) return [];
  return [
    {
      title: "고객 재무 현황",
      missing: missingNotice([snapshot.netAssets, snapshot.financialAssets, snapshot.realEstate, snapshot.debt, snapshot.annualFixedIncome, snapshot.monthlyFixedExpense, snapshot.investableAssets, snapshot.irregularIncome]),
      items: [
        ["순자산", snapshot.netAssets],
        ["금융자산", snapshot.financialAssets],
        ["부동산", snapshot.realEstate],
        ["부채", snapshot.debt],
        ["연 고정소득", snapshot.annualFixedIncome],
        ["월 고정지출", snapshot.monthlyFixedExpense],
        ["추가 투자 의향 자산", snapshot.investableAssets],
        ["향후 예상되는 비정기 소득", snapshot.irregularIncome],
      ],
    },
    { title: "Return", missing: missingNotice([snapshot.returnObjective, snapshot.expectedReturn]), items: [["투자 목적", snapshot.returnObjective], ["기대수익률", snapshot.expectedReturn]] },
    {
      title: "Risk",
      missing: false,
      risk: true,
      items: [["", `${snapshot.riskScore}/100 ${snapshot.riskLevel}`], ["", snapshot.riskInterpretation]],
    },
    { title: "Time Horizon", missing: missingNotice([snapshot.timeHorizon]), items: [["투자 기간", snapshot.timeHorizon]] },
    {
      title: "Tax",
      missing: missingNotice([snapshot.giftingPlan, snapshot.globalTaxImportance, snapshot.recentGlobalTaxSubject, snapshot.foreignStockTaxImportance]),
      items: [["사전증여", snapshot.giftingPlan], ["종합과세 절감", snapshot.globalTaxImportance], ["최근 과세대상", snapshot.recentGlobalTaxSubject], ["해외주식 절세", snapshot.foreignStockTaxImportance]],
    },
    {
      title: "Liquidity",
      missing: missingNotice([snapshot.regularCashflowNeed, snapshot.lumpSumPlan, snapshot.emergencyReservePlan]),
      items: [["정기 현금흐름 필요", snapshot.regularCashflowNeed], ["목돈 사용 계획", snapshot.lumpSumPlan], ["비상예비자금 계획", snapshot.emergencyReservePlan]],
    },
    { title: "Legal", missing: missingNotice([snapshot.legalConstraints]), items: [["법적/제도적 제약", snapshot.legalConstraints]] },
  ];
}

function sessionSummarySnapshot(session: ConsultationSession): SummarySnapshot | null {
  const snapshot = session.summarySnapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  return snapshot as SummarySnapshot;
}

function previousSessionFor(session: ConsultationSession, sessions: ConsultationSession[]) {
  const currentTime = new Date(`${session.date || todayDate()}T00:00:00`).getTime();
  return sessions
    .filter((item) => item.customerId === session.customerId && item.id !== session.id && item.status === "completed" && sessionSummarySnapshot(item))
    .sort((a, b) => {
      const aTime = new Date(`${a.date || todayDate()}T00:00:00`).getTime();
      const bTime = new Date(`${b.date || todayDate()}T00:00:00`).getTime();
      const aBefore = Number.isFinite(aTime) && aTime <= currentTime;
      const bBefore = Number.isFinite(bTime) && bTime <= currentTime;
      if (aBefore !== bBefore) return aBefore ? -1 : 1;
      return `${b.date}${b.updatedAt}`.localeCompare(`${a.date}${a.updatedAt}`);
    })[0] ?? null;
}

function snapshotChangeRows(current: SummarySnapshot | null, previous: SummarySnapshot | null) {
  if (!current || !previous) return [];
  const rows = summaryRows(current);
  const previousMap = new Map(summaryRows(previous));
  return rows
    .map(([label, next]) => ({ label, before: previousMap.get(label) ?? "", after: next }))
    .filter((row) => row.before && row.before !== row.after && row.after !== "미입력");
}

function allSessions(customerData: Record<CustomerId, AppState>) {
  return Object.values(customerData).flatMap((state) => getCustomerSessions(state));
}

function sessionDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function splitSessionDateTime(value: string) {
  const [date = todayDate(), time = "09:00"] = (value || "").split("T");
  return { date: date || todayDate(), time: (time || "09:00").slice(0, 5) };
}

function combineSessionDateTime(date: string, time: string) {
  return `${date || todayDate()}T${(time || "09:00").slice(0, 5)}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function dateKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateKeyFromValue(value: string) {
  const date = sessionDateTime(value);
  return date ? dateKeyFromDate(date) : "";
}

function formatPopupDateTime(value: string) {
  const date = sessionDateTime(value);
  if (!date) return value;
  const period = date.getHours() < 12 ? "오전" : "오후";
  const hour = date.getHours() % 12 || 12;
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}. ${period} ${pad2(hour)}:${pad2(date.getMinutes())}`;
}

function pastRelativeLabel(value: string) {
  const date = sessionDateTime(value);
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return "";
  const now = new Date();
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) return "오늘";
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.floor(diffMs / dayMs));
  if (days < 30) return `${days}일 전`;
  const months = Math.max(1, Math.floor(days / 30));
  if (months < 12) return `${months}달 전`;
  return `${Math.max(1, Math.floor(months / 12))}년 전`;
}

function upcomingRelativeLabel(session: ConsultationSession) {
  if (session.status === "active") return "✨ 상담 중이에요!";
  if (session.status === "completed") return "";
  const date = sessionDateTime(session.date);
  if (!date) return "";
  const diffMs = date.getTime() - Date.now();
  if (diffMs < 0) return "✨ 상담 중이에요!";
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  if (diffMs < hourMs) return `✨ ${Math.max(1, Math.ceil(diffMs / (60 * 1000)))}분 남았어요!`;
  if (diffMs < dayMs) return `✨ ${Math.ceil(diffMs / hourMs)}시간 남았어요!`;
  return `✨ ${Math.ceil(diffMs / dayMs)}일 남았어요!`;
}

function durationWithSuffix(value: string) {
  const text = value.trim();
  if (!text) return "소요 시간 미입력";
  return text.endsWith("소요") ? text : `${text} 소요`;
}

const leftPanelInnerWidthClass = "w-full max-w-full";

export default function HomePage() {
  const router = useRouter();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [customerData, setCustomerData] = useState<Record<CustomerId, AppState>>({});
  const [selectedCustomerId, setSelectedCustomerId] = useState<CustomerId>("");
  const [query, setQuery] = useState("");
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showAddCustomerForm, setShowAddCustomerForm] = useState(false);
  const [draftSession, setDraftSession] = useState<ConsultationSession | null>(null);
  const [newCustomer, setNewCustomer] = useState<CustomerProfile>(() => createNewCustomerProfile());
  const [activeConsultation, setActiveConsultation] = useState<ActiveConsultation | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [storageMessage, setStorageMessage] = useState("");
  const [customerDeleteTarget, setCustomerDeleteTarget] = useState<CustomerProfile | null>(null);
  const [sessionDeleteTarget, setSessionDeleteTarget] = useState<ConsultationSession | null>(null);
  const [pbSession, setPbSession] = useState<PbSession | null>(null);
  const [marketCalendarEvents, setMarketCalendarEvents] = useState<MarketCalendarEvent[]>([]);

  const sessions = useMemo(() => allSessions(customerData), [customerData]);
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const selectedState = selectedCustomer ? customerData[selectedCustomer.id] : undefined;
  const selectedCustomerName = customerName(selectedCustomer ?? undefined);

  const getPbOwner = useCallback((): CustomerOwnerScope => {
    const session = pbAuthStore.readSession();
    return { pbId: session?.id, pbEmployeeId: session?.employeeId };
  }, []);

  const loadCustomers = useCallback(async () => {
    const session = pbAuthStore.readSession();
    setPbSession(session);
    const result = await customerStorage.selectRows({ pbId: session?.id, pbEmployeeId: session?.employeeId });
    if (!result) {
      setStorageMessage("Supabase 환경변수가 없어 HOME 데이터를 불러오지 못했습니다.");
      return;
    }
    if (result.errorMessage) setStorageMessage(result.errorMessage);
    if (!result.rows.length) {
      setCustomers([]);
      setCustomerData({});
      setSelectedCustomerId("");
      return;
    }
    const stored = customerRowsToStoredState(result.rows);
    setCustomers(sortCustomersByName(stored.customerProfiles));
    setCustomerData(stored.customerData);
    const storedSelected = getStoredSelectedCustomerId();
    setSelectedCustomerId((current) => {
      if (current && stored.customerProfiles.some((customer) => customer.id === current)) return current;
      if (storedSelected && stored.customerProfiles.some((customer) => customer.id === storedSelected)) return storedSelected;
      return stored.customerProfiles[0]?.id || "";
    });
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    let cancelled = false;
    async function loadMarketCalendar() {
      try {
        const response = await fetch("/api/market/calendar/all");
        const body = await response.json();
        if (!cancelled && response.ok && Array.isArray(body.data)) setMarketCalendarEvents(body.data);
      } catch {
        if (!cancelled) setMarketCalendarEvents([]);
      }
    }
    loadMarketCalendar();
    return () => { cancelled = true; };
  }, []);

  const logout = async () => {
    await pbAuthStore.logout();
    router.push("/");
  };

  const enterCustomerRoom = (path: "/analysis" | "/consultation") => {
    if (selectedCustomerId) storeSelectedCustomerId(selectedCustomerId);
    window.open(path, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    const syncActive = () => {
      const active = readActiveConsultation();
      setActiveConsultation(active);
      setElapsedSeconds(getElapsedSeconds(active));
    };
    syncActive();
    window.addEventListener(consultationTimerEventName, syncActive);
    window.addEventListener("storage", syncActive);
    const id = window.setInterval(() => {
      const active = readActiveConsultation();
      setActiveConsultation(active);
      const elapsed = getElapsedSeconds(active);
      setElapsedSeconds(elapsed);
      if (active && elapsed >= maxConsultationSeconds) finishActiveSession(true);
    }, 1000);
    return () => {
      window.removeEventListener(consultationTimerEventName, syncActive);
      window.removeEventListener("storage", syncActive);
      window.clearInterval(id);
    };
  }, [customerData]);

  const persistCustomerState = useCallback((customerId: CustomerId, nextState: AppState) => {
    setCustomerData((prev) => ({ ...prev, [customerId]: nextState }));
    saveCustomerDataJsonOnly(customerId, nextState).catch((error) => console.error("Failed to save customer data", error));
  }, []);

  const upsertSession = useCallback((session: ConsultationSession) => {
    const state = customerData[session.customerId] ?? createInitialState();
    const sessionsForCustomer = getCustomerSessions(state);
    const nextSession = {
      ...session,
      updatedAt: new Date().toISOString(),
    };
    const nextSessions = sessionsForCustomer.some((item) => item.id === nextSession.id)
      ? sessionsForCustomer.map((item) => item.id === nextSession.id ? nextSession : item)
      : [nextSession, ...sessionsForCustomer];
    persistCustomerState(session.customerId, { ...state, consultationSessions: nextSessions });
  }, [customerData, persistCustomerState]);

  const updateSession = useCallback((sessionId: string, patch: Partial<ConsultationSession>) => {
    setCustomerData((prev) => {
      for (const [customerId, state] of Object.entries(prev) as Array<[CustomerId, AppState]>) {
        const sessionsForCustomer = getCustomerSessions(state);
        if (!sessionsForCustomer.some((item) => item.id === sessionId)) continue;
        const nextSessions = sessionsForCustomer.map((item) => item.id === sessionId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item);
        const nextState = { ...state, consultationSessions: nextSessions };
        saveCustomerDataJsonOnly(customerId, nextState).catch((error) => console.error("Failed to save customer data", error));
        return { ...prev, [customerId]: nextState };
      }
      return prev;
    });
  }, []);

  const deleteSession = (session: ConsultationSession) => {
    setSessionDeleteTarget(session);
  };

  const confirmDeleteSession = () => {
    const session = sessionDeleteTarget;
    if (!session) return;
    const state = customerData[session.customerId] ?? createInitialState();
    persistCustomerState(session.customerId, { ...state, consultationSessions: getCustomerSessions(state).filter((item) => item.id !== session.id) });
    if (expandedSessionId === session.id) setExpandedSessionId(null);
    setSessionDeleteTarget(null);
  };

  const confirmDeleteCustomer = async () => {
    const target = customerDeleteTarget;
    if (!target) return;
    const result = await customerStorage.remove(target.id, getPbOwner());
    if (!result.ok) {
      setStorageMessage(result.message);
      return;
    }
    setCustomers((prev) => {
      const next = prev.filter((customer) => customer.id !== target.id);
      const nextSelected = next[0]?.id ?? "";
      setSelectedCustomerId(nextSelected);
      if (nextSelected) storeSelectedCustomerId(nextSelected);
      return next;
    });
    setCustomerData((prev) => {
      const next = { ...prev };
      delete next[target.id];
      return next;
    });
    if (expandedSession?.customerId === target.id) setExpandedSessionId(null);
    setCustomerDeleteTarget(null);
  };

  function startSession(session: ConsultationSession) {
    const activeSession = { ...session, status: "active" as const, updatedAt: new Date().toISOString() };
    upsertSession(activeSession);
    storeSelectedCustomerId(session.customerId);
    writePreRecordConsultation(null);
    writeActiveConsultation({ sessionId: session.id, customerId: session.customerId, startedAt: new Date().toISOString(), returnPath: "/consultation/tab1" });
    window.open("/consultation/tab1", "_blank", "noopener,noreferrer");
  }

  function preRecordSession(session: ConsultationSession) {
    const draftSession = { ...session, status: "draft" as const, updatedAt: new Date().toISOString() };
    upsertSession(draftSession);
    storeSelectedCustomerId(session.customerId);
    writeActiveConsultation(null);
    writePreRecordConsultation({ sessionId: session.id, customerId: session.customerId, returnPath: "/consultation/tab1" });
    window.open("/consultation/tab1", "_blank", "noopener,noreferrer");
  }

  function finishActiveSession(autoEnded = false) {
    const active = readActiveConsultation();
    if (!active) return;
    const state = customerData[active.customerId] ?? createInitialState();
    const sessionsForCustomer = getCustomerSessions(state);
    const seconds = autoEnded ? maxConsultationSeconds : getElapsedSeconds(active);
    const snapshot = buildSummarySnapshot(state);
    const nextSessions = sessionsForCustomer.map((session) => session.id === active.sessionId ? { ...finishSession(session, seconds, autoEnded), summarySnapshot: snapshot } : session);
    persistCustomerState(active.customerId, { ...state, consultationSessions: nextSessions });
    writeActiveConsultation(null);
  }

  const filteredCustomers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) => `${customerName(customer)} ${customerBirth(customer)}`.toLowerCase().includes(needle));
  }, [customers, query]);

  const selectedSessions = useMemo(() => sessions.filter((session) => session.customerId === selectedCustomerId).sort(sortSessionsNewest), [sessions, selectedCustomerId]);
  const upcoming = useMemo(() => [...sessions].filter((session) => session.status !== "completed" && isFutureSession(session)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3), [sessions]);
  const expandedSession = sessions.find((session) => session.id === expandedSessionId) ?? null;

  const openCreateForm = () => {
    if (!selectedCustomer) return;
    setDraftSession(createConsultationSession(selectedCustomer.id));
    setShowCreateForm(true);
  };

  const saveDraftSession = (mode: "save" | "preRecord" | "start" = "save") => {
    if (!draftSession) return;
    upsertSession(draftSession);
    setExpandedSessionId(draftSession.id);
    setShowCreateForm(false);
    if (mode === "preRecord") preRecordSession(draftSession);
    if (mode === "start") startSession(draftSession);
  };

  const selectCustomer = (id: CustomerId) => {
    setSelectedCustomerId(id);
    storeSelectedCustomerId(id);
  };

  const updateProfile = (customerId: CustomerId, patch: Partial<CustomerProfile>) => {
    setCustomers((prev) => prev.map((customer) => {
      if (customer.id !== customerId) return customer;
      const next = { ...customer, ...patch };
      if (patch.birthYear !== undefined || patch.birth_year !== undefined) {
        const birth = patch.birthYear ?? patch.birth_year ?? "";
        next.birthYear = birth;
        next.birth_year = birth;
        next.age = calculateAgeFromBirthDate(birth);
      }
      saveCustomerProfileColumns(next, getPbOwner()).catch((error) => console.error("Failed to save customer profile", error));
      return next;
    }));
  };

  const addCustomer = async () => {
    const birth = normalizeBirthDate(newCustomer.birthYear || newCustomer.birth_year || "");
    const profile = {
      ...newCustomer,
      birthYear: birth,
      birth_year: birth,
      age: calculateAgeFromBirthDate(birth),
      fallbackName: newCustomer.name || "신규 고객",
    };
    const state = createInitialState();
    const result = await customerStorage.insertCustomer(profile, state, customers.length, getPbOwner());
    if (!result.ok) {
      setStorageMessage(result.message);
      return;
    }
    setCustomers((prev) => sortCustomersByName([...prev, profile]));
    setCustomerData((prev) => ({ ...prev, [profile.id]: state }));
    setSelectedCustomerId(profile.id);
    storeSelectedCustomerId(profile.id);
    setNewCustomer(createNewCustomerProfile());
    setShowAddCustomerForm(false);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_85%_65%_at_8%_0%,rgba(99,102,241,0.11),transparent_55%),radial-gradient(ellipse_65%_65%_at_98%_100%,rgba(59,130,246,0.18),transparent_55%),#f8fafc] p-4 text-slate-900">
      <div className="grid min-h-[calc(100vh-2rem)] gap-4 transition-all duration-300" style={{ gridTemplateColumns: `${leftOpen ? "255px" : "56px"} minmax(0, 1fr) ${rightOpen ? "336px" : "56px"}` }}>
        <aside className={`box-border min-w-0 overflow-hidden rounded-2xl border border-white/70 bg-white/85 shadow-xl shadow-blue-900/5 backdrop-blur ${leftOpen ? "p-4" : "p-2"}`}>
          <div className="mb-4 flex items-start justify-between gap-2">
            {leftOpen ? (
              <div>
                <p className="text-base font-black text-blue-950">{pbSession?.name || tempPbName} PB님,</p>
                <p className="mt-1 text-sm font-extrabold text-blue-900">오늘도 힘내세요!</p>
                <p className="mt-1 whitespace-nowrap text-[11px] font-bold text-slate-400">마지막 로그인: {formatLoginTime(pbSession?.lastLoginAt)}</p>
              </div>
            ) : null}
            <button type="button" onClick={() => setLeftOpen((value) => !value)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:text-blue-700">
              {leftOpen ? <PanelLeftClose size={18} /> : <ChevronRight size={18} />}
            </button>
          </div>
          {leftOpen ? (
            <div className="grid w-full min-w-0 gap-4 overflow-x-hidden">
              {storageMessage ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{storageMessage}</p> : null}
              <button type="button" onClick={logout} className={`flex h-11 w-full min-w-0 ${leftPanelInnerWidthClass} items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600`}>
                <LogOut size={15} /> 로그아웃
              </button>
              <div className={`grid ${leftPanelInnerWidthClass} min-w-0 grid-cols-[minmax(0,1fr)_104px] gap-2 overflow-hidden`}>
                <label className="flex h-11 min-w-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2">
                  <Search size={14} className="shrink-0 text-slate-400" />
                  <input className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" placeholder="고객 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <button type="button" onClick={() => setShowAddCustomerForm((value) => !value)} className="min-w-0 whitespace-nowrap rounded-xl bg-blue-600 px-2 text-[11px] font-extrabold text-white hover:bg-blue-700">신규 고객 추가</button>
              </div>
              <div className={`grid ${leftPanelInnerWidthClass} max-h-[122px] min-w-0 gap-1 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>
                {filteredCustomers.map((customer) => (
                  <div
                    key={customer.id}
                    className={`grid min-w-0 gap-1 ${customer.id === selectedCustomerId ? "grid-cols-[minmax(0,1fr)_38px]" : "grid-cols-1"}`}
                  >
                    <button
                      type="button"
                      onClick={() => selectCustomer(customer.id)}
                      className={`min-w-0 rounded-lg px-3 py-2 text-left text-sm font-bold transition ${
                        customer.id === selectedCustomerId
                          ? "bg-blue-600 text-white"
                          : "bg-slate-50 text-slate-700 hover:bg-blue-50"
                      }`}
                    >
                      {customerName(customer)}{" "}
                      <span className="text-xs opacity-70">{customerBirth(customer)}</span>
                    </button>

                    {customer.id === selectedCustomerId ? (
                      <button
                        type="button"
                        aria-label={`${customerName(customer)} 고객 정보 삭제`}
                        title="고객 정보 삭제"
                        onClick={() => setCustomerDeleteTarget(customer)}
                        className="flex min-w-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 transition hover:bg-red-100"
                      >
                        <Trash2 size={15} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {showAddCustomerForm ? <CustomerProfileEditor profile={newCustomer} setProfile={setNewCustomer} onSave={addCustomer} onCancel={() => setShowAddCustomerForm(false)} /> : null}
              {selectedCustomer ? <SelectedCustomerInfo customer={selectedCustomer} onChange={updateProfile} /> : null}
              <section className={`${leftPanelInnerWidthClass} min-w-0 overflow-hidden`}>
                <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">[{selectedCustomerName} 고객] 과거 상담 내역</p>
                <div className="grid max-h-[440px] min-w-0 gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {selectedSessions.filter((session) => session.status === "completed" || !isFutureSession(session)).length ? selectedSessions.filter((session) => session.status === "completed" || !isFutureSession(session)).map((session) => (
                    <SessionCard key={session.id} session={session} customer={selectedCustomer} expanded={expandedSessionId === session.id} onExpand={() => setExpandedSessionId(expandedSessionId === session.id ? null : session.id)} onDelete={() => deleteSession(session)} onUpdate={(patch) => updateSession(session.id, patch)} onPreRecord={() => preRecordSession(session)} onStart={() => startSession(session)} />
                  )) : <EmptyBox text="상담 내역이 없습니다." />}
                </div>
              </section>
            </div>
          ) : null}
        </aside>

        <section className="flex flex-col min-w-0 max-w-full overflow-hidden rounded-2xl border border-white/70 bg-white/75 p-4 shadow-xl shadow-blue-900/5 backdrop-blur">
          <MarketDashboard selectedCustomer={selectedCustomer} selectedState={selectedState} customers={customers} customerData={customerData} pbName={pbSession?.name || tempPbName} pbId={pbSession?.id} pbEmployeeId={pbSession?.employeeId} />
        </section>

        <aside className={`overflow-hidden rounded-2xl border border-white/70 bg-white/85 shadow-xl shadow-blue-900/5 backdrop-blur ${rightOpen ? "p-4" : "p-2"}`}>
          <div className="mb-4 flex items-start justify-between gap-2">
            <button type="button" onClick={() => setRightOpen((value) => !value)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:text-blue-700">
              {rightOpen ? <PanelRightClose size={18} /> : <ChevronLeft size={18} />}
            </button>
            {rightOpen ? <SodaPopLogoImage variant="stacked" className="h-auto w-24" /> : null}
          </div>
          {rightOpen ? (
            <div className="grid gap-5 [&>p:first-of-type]:hidden">
              <p className="text-sm font-extrabold text-blue-900">상담 일정</p>
              {activeConsultation ? (
                <button type="button" onClick={() => router.push(activeConsultation.returnPath || "/consultation/tab1")} className="grid justify-items-center gap-1 rounded-xl bg-blue-600 px-3 py-3 text-xs font-extrabold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700">
                  <span className="inline-flex items-center gap-1"><Home size={15} /> 상담 화면으로 돌아가기</span>
                  <span className="font-mono">{formatTimer(elapsedSeconds)}</span>
                </button>
              ) : null}
              <div className="relative">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => enterCustomerRoom("/analysis")}
                  className="h-12 rounded-xl bg-blue-600 px-3 text-base font-extrabold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                >
                  분석실 입장
                </button>

                <button
                  type="button"
                  onClick={openCreateForm}
                  className="h-12 rounded-xl border border-blue-200 bg-blue-50 px-3 text-base font-extrabold text-blue-700 transition hover:bg-blue-100"
                >
                  상담실 입장
                </button>
              </div>
            </div>
            <SideSection title="[전체 고객] 곧 예정된 상담 일정" sessions={upcoming} customers={customers} expandedSessionId={expandedSessionId} setExpandedSessionId={setExpandedSessionId} deleteSession={deleteSession} preRecordSession={preRecordSession} startSession={startSession} />
              <RightPanelCalendar sessions={sessions} customers={customers} marketEvents={marketCalendarEvents} />
            </div>
          ) : null}
        </aside>
      </div>
      {showCreateForm && draftSession ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-md">
            <CreateSessionForm
              customerName={selectedCustomerName}
              draft={draftSession}
              setDraft={(updater) => setDraftSession((prev) => prev ? updater(prev) : prev)}
              onCancel={() => setShowCreateForm(false)}
              onReserve={() => saveDraftSession("save")}
              onStart={() => saveDraftSession("start")}
            />
          </div>
        </div>
      ) : null}
      {expandedSession ? (
        <SummaryModal
          session={expandedSession}
          customer={customers.find((customer) => customer.id === expandedSession.customerId)}
          sessions={sessions}
          onUpdate={(patch) => updateSession(expandedSession.id, patch)}
          onPreRecord={() => preRecordSession(expandedSession)}
          onStart={() => startSession(expandedSession)}
          onClose={() => setExpandedSessionId(null)}
        />
      ) : null}
      {customerDeleteTarget ? (
        <DeleteConfirmModal
          title="고객 정보 삭제"
          body={`${customerName(customerDeleteTarget)}님의 모든 정보가 사라집니다. 정말 삭제하시겠습니까?`}
          onCancel={() => setCustomerDeleteTarget(null)}
          onConfirm={confirmDeleteCustomer}
        />
      ) : null}
      {sessionDeleteTarget ? (
        <DeleteConfirmModal
          title="상담 내역 삭제"
          body={`${customerName(customers.find((customer) => customer.id === sessionDeleteTarget.customerId))}님의 ${displayKoreanDate(sessionDeleteTarget.date)} 상담 내역이 사라집니다. 정말 삭제하시겠습니까?`}
          onCancel={() => setSessionDeleteTarget(null)}
          onConfirm={confirmDeleteSession}
        />
      ) : null}
    </main>
  );
}

function PanelHeader({ open, title, side, onToggle }: { open: boolean; title: string; side: "left" | "right"; onToggle: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      {open ? <p className="text-sm font-extrabold text-blue-900">{title}</p> : null}
      <button type="button" onClick={onToggle} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:text-blue-700">
        {open ? (side === "left" ? <PanelLeftClose size={18} /> : <PanelRightClose size={18} />) : (side === "left" ? <ChevronRight size={18} /> : <ChevronLeft size={18} />)}
      </button>
    </div>
  );
}

function CustomerProfileEditor({ profile, setProfile, onSave, onCancel }: { profile: CustomerProfile; setProfile: (profile: CustomerProfile) => void; onSave: () => void; onCancel: () => void }) {
  const birth = profile.birthYear || profile.birth_year || "";
  const update = (patch: Partial<CustomerProfile>) => {
    const next = { ...profile, ...patch };
    if (patch.birthYear !== undefined || patch.birth_year !== undefined) {
      const normalized = normalizeBirthDate(patch.birthYear ?? patch.birth_year ?? "");
      next.birthYear = normalized;
      next.birth_year = normalized;
      next.age = calculateAgeFromBirthDate(normalized);
    }
    setProfile(next);
  };
  return (
    <section className="box-border min-w-0 max-w-full overflow-hidden">
      <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">신규 고객 추가</p>
      <div className={`box-border ${leftPanelInnerWidthClass} overflow-hidden rounded-xl border border-slate-900 bg-white p-3 shadow-sm`}>
      <div className="grid min-w-0 gap-2 overflow-hidden">
        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_62px] gap-1.5 overflow-hidden">
          <ProfileInput label="성명" value={profile.name} placeholder="성명" required compact narrowLabel onChange={(value) => update({ name: value })} />
          <GenderToggle value={profile.gender} onChange={(gender) => update({ gender })} />
        </div>
        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_48px] gap-2 overflow-hidden">
          <ProfileInput label="생년월일" value={birth} placeholder="생년월일" required compact onChange={(value) => update({ birthYear: value, birth_year: value })} />
          <div className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-bold text-slate-500">{ageDisplay(profile.age)}</div>
        </div>
        <ProfileInput label="직업" value={profile.job} placeholder="예. 삼성증권 PB" onChange={(value) => update({ job: value })} />
        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <button type="button" onClick={onCancel} className="min-w-0 truncate rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-extrabold text-slate-700">취소</button>
          <button type="button" onClick={onSave} className="min-w-0 truncate rounded-lg bg-blue-600 px-2 py-2 text-xs font-extrabold text-white hover:bg-blue-700">저장</button>
        </div>
      </div>
      </div>
    </section>
  );
}

function SelectedCustomerInfo({ customer, onChange }: { customer: CustomerProfile; onChange: (id: CustomerId, patch: Partial<CustomerProfile>) => void }) {
  const birth = customer.birthYear || customer.birth_year || "";
  return (
    <section className="box-border min-w-0 max-w-full overflow-hidden">
      <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">고객 정보</p>
      <div className={`box-border ${leftPanelInnerWidthClass} overflow-hidden rounded-xl border border-slate-900 bg-white p-3 shadow-sm`}>
      <div className="grid min-w-0 gap-2 overflow-hidden">
        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_62px] gap-1.5 overflow-hidden">
          <ProfileInput label="성명" value={customer.name} placeholder="성명" required compact narrowLabel onChange={(value) => onChange(customer.id, { name: value })} />
          <GenderToggle value={customer.gender} onChange={(gender) => onChange(customer.id, { gender })} />
        </div>
        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_48px] gap-2 overflow-hidden">
          <ProfileInput label="생년월일" value={birth} placeholder="생년월일" required compact onChange={(value) => onChange(customer.id, { birthYear: value, birth_year: value })} />
          <div className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-bold text-slate-500">{ageDisplay(customer.age)}</div>
        </div>
        <ProfileInput label="직업" value={customer.job} placeholder="직업" onChange={(value) => onChange(customer.id, { job: value })} />
      </div>
      </div>
    </section>
  );
}

function GenderToggle({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid h-10 w-full min-w-0 grid-cols-2 gap-0.5 rounded-lg bg-slate-100 p-1">
      {["남", "여"].map((option) => (
        <button key={option} type="button" onClick={() => onChange(option)} className={`h-8 rounded-md text-xs font-extrabold transition ${value === option ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-blue-50"}`}>
          {option}
        </button>
      ))}
    </div>
  );
}

function ProfileInput({ label, value, placeholder, onChange, compact = false, narrowLabel = false, required = false }: { label: string; value: string; placeholder: string; onChange: (value: string) => void; compact?: boolean; narrowLabel?: boolean; required?: boolean }) {
  const isRequiredEmpty = required && !value.trim();
  return (
    <label className={`grid w-full min-w-0 items-center gap-2 ${narrowLabel ? "grid-cols-[42px_minmax(0,1fr)]" : compact ? "grid-cols-[58px_minmax(0,1fr)]" : "grid-cols-[58px_minmax(0,1fr)]"}`}>
      <span className="min-w-0 overflow-hidden whitespace-nowrap text-xs font-extrabold text-slate-600">{label}{required ? <span className="ml-0.5 text-red-600">*</span> : null}</span>
      <input className={`h-10 w-full min-w-0 rounded-lg border bg-white px-3 text-sm placeholder:font-normal ${isRequiredEmpty ? "border-red-400" : "border-slate-200"}`} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function CreateSessionForm({ customerName, draft, setDraft, onCancel, onReserve, onStart }: { customerName: string; draft: ConsultationSession; setDraft: (updater: (prev: ConsultationSession) => ConsultationSession) => void; onCancel: () => void; onReserve: () => void; onStart: () => void }) {
  const { date, time } = splitSessionDateTime(draft.date);
  return (
    <section className="box-border w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-slate-900 bg-blue-50/70 p-3">
      <p className="mb-3 text-sm font-extrabold text-blue-900">{customerName} 고객님 상담 예약</p>
      <div className="grid min-w-0 gap-2">
        <input className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm" placeholder="상담 제목" value={draft.title} onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))} />
        <div className="grid min-w-0 gap-1.5">
          <div className="grid min-h-[76px] gap-1 rounded-lg border border-slate-200 bg-white p-2">
            <input className="h-7 min-w-0 bg-transparent text-xs font-bold outline-none" type="date" value={date} onChange={(e) => setDraft((prev) => ({ ...prev, date: combineSessionDateTime(e.target.value, splitSessionDateTime(prev.date).time) }))} />
            <input className="h-7 min-w-0 bg-transparent text-xs font-bold outline-none" type="time" value={time} onChange={(e) => setDraft((prev) => ({ ...prev, date: combineSessionDateTime(splitSessionDateTime(prev.date).date, e.target.value) }))} />
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onReserve}
            className="min-w-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-xs font-extrabold text-blue-700 transition hover:bg-blue-100"
          >
            상담 사전 예약
          </button>

          <button
            type="button"
            onClick={onStart}
            className="min-w-0 rounded-lg bg-blue-600 px-3 py-3 text-xs font-extrabold text-white transition hover:bg-blue-700"
          >
            바로 상담 시작
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50"
          >
            취소
          </button>
        </div>
      </div>
    </section>
  );
}

function SessionCard({ session, customer, expanded, onExpand, onDelete, onPreRecord, onStart }: { session: ConsultationSession; customer?: CustomerProfile | null; expanded: boolean; onExpand: () => void; onDelete: () => void; onUpdate: (patch: Partial<ConsultationSession>) => void; onPreRecord?: () => void; onStart?: () => void }) {
  const upcomingLabel = upcomingRelativeLabel(session);
  const pastLabel = pastRelativeLabel(session.date);
  return (
    <article className="box-border w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <button type="button" onClick={onExpand} className="min-w-0 flex-1 overflow-hidden text-left">
          {upcomingLabel ? <p className="mb-1 text-xs font-extrabold text-red-600">{upcomingLabel}</p> : null}
          <p className="truncate text-sm font-extrabold text-slate-900">{displaySessionTitle(session.title)}</p>
          <div className="mt-1 grid gap-0.5 text-xs font-bold">
            {displayKoreanDate(session.date)}
            <span className="text-slate-400">{durationWithSuffix(session.duration)}{pastLabel ? ` · ${pastLabel}` : ""}</span>
          </div>
          {customer ? <p className="mt-1 text-xs text-slate-400">{customerDisplay(customer)}</p> : null}
        </button>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={onDelete} className="shrink-0 rounded-lg bg-red-50 p-2 text-red-700 hover:bg-red-100"><Trash2 size={15} /></button>
        </div>
      </div>
    </article>
  );
}

function SummaryModal({ session, customer, sessions, onUpdate, onPreRecord, onStart, onClose }: { session: ConsultationSession; customer?: CustomerProfile; sessions: ConsultationSession[]; onUpdate: (patch: Partial<ConsultationSession>) => void; onPreRecord: () => void; onStart: () => void; onClose: () => void }) {
  const snapshot = sessionSummarySnapshot(session);
  const dateTimeValue = session.date.includes("T") ? session.date : `${session.date || todayDate()}T00:00`;

  // "기존 포트폴리오" 단순 표 대신, 상담실 TAB3-3(리밸런싱 히스토리)의 "포트폴리오 전후 비교"와 같은 표를
  // 그대로 재사용한다(성향 및 니즈 분석 요약은 그대로 유지) — 리밸런싱 기록은 consultationId로 이 상담
  // 세션과 연결돼 있어(rebalancingHistoryUtils.ts), 그 기록을 찾아서 넘긴다.
  const [compareRecord, setCompareRecord] = useState<RebalancingHistoryRecord | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setCompareRecord(undefined);
    loadSharedMaintabUiState(session.customerId).then((state) => {
      if (cancelled) return;
      const record = (state.tab3?.rebalancingHistory ?? []).find((r) => r.consultationId === session.id) ?? null;
      setCompareRecord(record);
    }).catch((error) => {
      console.error("Failed to load rebalancing history for session modal", error);
      if (!cancelled) setCompareRecord(null);
    });
    return () => { cancelled = true; };
  }, [session.customerId, session.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <section className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-blue-600">{customerDisplay(customer)}</p>
            <h1 className="mt-1 text-2xl font-black text-blue-950">{displaySessionTitle(session.title)}</h1>
            <p className="mt-1 text-sm font-bold text-slate-500">{displayKoreanDate(session.date)} <span className="text-slate-400">· {session.duration || "소요 시간 미입력"}</span></p>
          </div>
          <div className="flex flex-wrap gap-2">
            {session.status === "draft" ? (
              <>
                <button type="button" onClick={onPreRecord} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-extrabold text-blue-700 hover:bg-blue-100">사전 기록</button>
                <button type="button" onClick={onStart} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-extrabold text-white hover:bg-blue-700">상담 시작</button>
              </>
            ) : null}
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-600 hover:bg-slate-50">닫기</button>
          </div>
        </div>
        <div className="mb-5 grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-blue-600">상담 제목 수정</span>
            <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold" value={session.title} placeholder="상담 제목" onChange={(e) => onUpdate({ title: e.target.value })} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-blue-600">날짜 및 시간 수정</span>
            <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold" type="datetime-local" value={dateTimeValue} onChange={(e) => onUpdate({ date: e.target.value })} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-blue-600">소요 시간 수정</span>
            <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold" value={session.duration} placeholder="소요 시간" onChange={(e) => onUpdate({ duration: e.target.value })} />
          </label>
        </div>
        {session.autoEnded ? <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-extrabold text-red-700">{session.autoEndedMessage || autoEndedMessage}</p> : null}
        {compareRecord === undefined ? (
          <p className="mb-5 text-sm font-semibold text-slate-400">포트폴리오 비교 데이터를 불러오는 중…</p>
        ) : compareRecord ? (
          <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="mb-3 text-sm font-extrabold text-blue-900">포트폴리오 전후 비교</p>
            <PortfolioCompareTable record={compareRecord} />
          </div>
        ) : (
          <p className="mb-5 text-sm font-semibold text-slate-400">이 상담에 연결된 리밸런싱 기록이 없습니다.</p>
        )}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-4 text-sm font-extrabold text-blue-900">성향 및 니즈 분석 요약</p>
          <SummaryTable snapshot={snapshot} />
        </div>
      </section>
    </div>
  );
}

function SummaryTable({ snapshot }: { snapshot: SummarySnapshot | null }) {
  const sections = summarySections(snapshot);
  if (!sections.length) {
    return <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500">상담 종료 후 요약 내용을 확인할 수 있습니다.</p>;
  }
  return (
    <div className="grid gap-2">
      {sections.map((section) => (
        <div key={section.title} className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-[120px_minmax(0,1fr)]">
          <div className="flex items-center bg-sky-100 px-3 py-3">
            <span className="text-xs font-black text-blue-900">{section.title}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2.5">
            {section.risk ? (
              <div className="grid gap-2">
                <p className="text-xs font-black text-slate-950">{valueOrWaiting(section.items[0]?.[1])}</p>
                <p className="text-xs font-bold leading-5 text-slate-950">{valueOrWaiting(section.items[1]?.[1])}</p>
              </div>
            ) : (
              section.items.map(([label, value]) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-xs font-black text-slate-950">
                  <span className="rounded-lg bg-sky-100 px-2 py-1 text-blue-900">{label}</span>
                  <span>{valueOrWaiting(value)}</span>
                </span>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SideSection({ title, sessions, customers, expandedSessionId, setExpandedSessionId, deleteSession, preRecordSession, startSession }: { title: string; sessions: ConsultationSession[]; customers: CustomerProfile[]; expandedSessionId: string | null; setExpandedSessionId: (id: string | null) => void; deleteSession: (session: ConsultationSession) => void; preRecordSession: (session: ConsultationSession) => void; startSession: (session: ConsultationSession) => void }) {
  return (
    <section>
      <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="grid gap-2">
        {sessions.length ? sessions.map((session) => {
          const customer = customers.find((item) => item.id === session.customerId);
          return (
            <SessionCard key={session.id} session={session} customer={customer} expanded={expandedSessionId === session.id} onExpand={() => setExpandedSessionId(expandedSessionId === session.id ? null : session.id)} onDelete={() => deleteSession(session)} onUpdate={() => {}} onPreRecord={() => preRecordSession(session)} onStart={() => startSession(session)} />
          );
        }) : <EmptyBox text="표시할 상담이 없습니다." />}
      </div>
    </section>
  );
}

type ConsultationCalendarItem = { id: string; time: string; text: string };
type MarketCalendarItem = { id: string; time: string; market: string; title: string; importance: MarketCalendarEvent["importance"] };

function formatCalendarItemTime(value: string) {
  const date = sessionDateTime(value);
  if (!date) return value;
  return `(${pad2(date.getHours())}:${pad2(date.getMinutes())})`;
}

function rightPanelMarketTitle(event: MarketCalendarEvent) {
  if (event.market === "유로존") return event.title;
  if (event.title.startsWith(event.market)) return event.title;
  return `${event.market} ${event.title}`;
}

// MarketCalendarEvent.market은 lib/calendarData.ts의 MARKET_LABELS로 이미 번역된 한글 국가/지역명이라
// (원본 통화코드가 아님) 그 한글명 기준으로 ISO 3166-1 국가코드를 매핑한다.
// 유니코드 국기 이모지(🇳🇿 등)는 Windows 기본 폰트(Segoe UI Emoji)가 조합 글리프를 지원 안 해서
// "NZ" 같은 원문 알파벳 두 글자로 그대로 노출되는 문제가 있었다(2026-09 발견) — 실제 국기 이미지를
// 써야 OS·브라우저 상관없이 항상 국기 모양으로 보인다.
const MARKET_FLAG_CODE: Record<string, string> = {
  호주: "au", 캐나다: "ca", 스위스: "ch", 중국: "cn", 유로존: "eu",
  영국: "gb", 일본: "jp", 뉴질랜드: "nz", 미국: "us",
};
function MarketFlag({ market }: { market: string }) {
  const code = MARKET_FLAG_CODE[market];
  if (!code) return <span className="mr-1 text-[10px] font-black text-amber-400">🌐</span>;
  return (
    <img
      src={`https://flagcdn.com/w20/${code}.png`}
      alt={market}
      className="mr-1.5 inline-block h-3 w-4 rounded-[2px] object-cover align-middle"
    />
  );
}

function RightPanelCalendar({ sessions, customers, marketEvents }: { sessions: ConsultationSession[]; customers: CustomerProfile[]; marketEvents: MarketCalendarEvent[] }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(() => dateKeyFromDate(new Date()));

  const consultationByDate = useMemo(() => {
    const map = new Map<string, ConsultationSession[]>();
    sessions.forEach((session) => {
      const key = dateKeyFromValue(session.date);
      if (!key) return;
      map.set(key, [...(map.get(key) ?? []), session]);
    });
    return map;
  }, [sessions]);

  const marketByDate = useMemo(() => {
    const map = new Map<string, MarketCalendarEvent[]>();
    marketEvents.forEach((event) => {
      const key = dateKeyFromValue(event.startsAt);
      if (!key) return;
      map.set(key, [...(map.get(key) ?? []), event]);
    });
    return map;
  }, [marketEvents]);

  const monthCells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - startOffset + 1;
      if (day < 1 || day > daysInMonth) return null;
      const date = new Date(viewYear, viewMonth, day);
      return {
        day,
        key: dateKeyFromDate(date),
      };
    });
  }, [viewMonth, viewYear]);

  const selectedConsultationItems = useMemo<ConsultationCalendarItem[]>(() => {
    if (!selectedDateKey) return [];
    return (consultationByDate.get(selectedDateKey) ?? [])
      .map((session) => {
        const customer = customers.find((item) => item.id === session.customerId);
        return {
          id: `consultation-${session.id}`,
          time: formatCalendarItemTime(session.date),
          text: `${customerDisplay(customer)} 상담 일정`,
        };
      })
      .sort((a, b) => a.time.localeCompare(b.time, "ko-KR"));
  }, [consultationByDate, customers, selectedDateKey]);

  const selectedMarketItems = useMemo<MarketCalendarItem[]>(() => {
    if (!selectedDateKey) return [];
    return (marketByDate.get(selectedDateKey) ?? [])
      .map((event) => ({
        id: `market-${event.id}`,
        time: formatCalendarItemTime(event.startsAt),
        market: event.market,
        title: rightPanelMarketTitle(event),
        importance: event.importance,
      }))
      .sort((a, b) => a.time.localeCompare(b.time, "ko-KR"));
  }, [marketByDate, selectedDateKey]);

  const moveMonth = (offset: number) => {
    const next = new Date(viewYear, viewMonth + offset, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">전체 일정 캘린더</p>
        <CalendarDays size={17} className="text-blue-600" />
      </div>
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <select
            className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-sm font-extrabold text-slate-700"
            value={viewYear}
            onChange={(event) => setViewYear(Number(event.target.value))}
          >
            {Array.from({ length: 7 }, (_, index) => today.getFullYear() - 3 + index).map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          <button type="button" onClick={() => moveMonth(-1)} className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-600 hover:bg-blue-50">‹</button>
          <p className="min-w-0 flex-1 text-center text-base font-black text-blue-950">{viewMonth + 1}월</p>
          <button type="button" onClick={() => moveMonth(1)} className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-600 hover:bg-blue-50">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-black text-slate-400">
          {["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="mt-1.5 grid grid-cols-7 gap-1.5">
          {monthCells.map((cell, index) => {
            const hasConsultation = cell ? consultationByDate.has(cell.key) : false;
            const hasMarket = cell ? marketByDate.has(cell.key) : false;
            const isToday = cell?.key === dateKeyFromDate(today);
            const isSelected = cell?.key === selectedDateKey;
            return (
              <button
                key={cell?.key ?? `empty-${index}`}
                type="button"
                disabled={!cell}
                onClick={() => cell && setSelectedDateKey(cell.key)}
                className={`relative h-11 rounded-lg text-sm font-extrabold transition ${cell ? "bg-slate-50 text-slate-700 hover:bg-blue-50" : "bg-transparent"} ${isToday ? "ring-2 ring-blue-500" : ""} ${isSelected ? "border-2 border-slate-950" : ""}`}
              >
                {cell?.day ?? ""}
                {cell ? (
                  <span className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-1">
                    {hasConsultation ? <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> : null}
                    {hasMarket ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs font-bold text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> 상담 일정</span>
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> 주요 일정</span>
        </div>

        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-black text-slate-400">{selectedDateKey ? selectedDateKey.replaceAll("-", ".") : "날짜를 선택해주세요"}</p>

          {/* 상담 일정과 주요 일정을 각자 독립된 칸으로 분리 — 예전엔 두 종류를 한 목록에 섞어서
              max-h-[140px] 하나로 스크롤했기 때문에, 상담 일정이 많으면 주요 일정을 보려고 그 안에서
              또 스크롤해야 하는 번거로움이 있었다(2026-09 리디자인). 이제 각자 자기 칸 안에서만
              스크롤되고, 서로의 항목 수에 영향받지 않는다. */}
          <div className="grid gap-2">
            <div className="rounded-xl bg-blue-50/60 p-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-black text-blue-700">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> 상담 일정
                {selectedConsultationItems.length > 0 && <span className="text-blue-400">{selectedConsultationItems.length}건</span>}
              </p>
              {!selectedDateKey ? (
                <p className="px-1 py-1 text-xs font-bold text-slate-400">날짜를 선택하면 표시됩니다.</p>
              ) : selectedConsultationItems.length ? (
                <div className="grid max-h-[210px] gap-1 overflow-y-auto pr-1">
                  {selectedConsultationItems.map((item) => (
                    <p key={item.id} className="break-keep rounded-lg bg-white px-2.5 py-1.5 text-xs font-extrabold leading-5 text-blue-900 shadow-sm">
                      <span className="text-blue-400">{item.time}</span> {item.text}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="px-1 py-1 text-xs font-bold text-slate-400">일정이 없습니다.</p>
              )}
            </div>

            <div className="rounded-xl bg-amber-50/60 p-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-black text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> 주요 일정
                {selectedMarketItems.length > 0 && <span className="text-amber-500">{selectedMarketItems.length}건</span>}
              </p>
              {!selectedDateKey ? (
                <p className="px-1 py-1 text-xs font-bold text-slate-400">날짜를 선택하면 표시됩니다.</p>
              ) : selectedMarketItems.length ? (
                <div className="grid max-h-[210px] gap-1 overflow-y-auto pr-1">
                  {selectedMarketItems.map((item) => (
                    <p
                      key={item.id}
                      className={`break-keep rounded-lg bg-white px-2.5 py-1.5 text-xs leading-5 shadow-sm ${item.importance === "high" ? "font-extrabold text-amber-900" : "font-bold text-amber-800"}`}
                    >
                      <MarketFlag market={item.market} />
                      <span className="text-amber-500">{item.time}</span> {item.title}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="px-1 py-1 text-xs font-bold text-slate-400">일정이 없습니다.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EmptyBox({ text }: { text: string }) {
  return <div className="box-border w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">{text}</div>;
}

function DeleteConfirmModal({ title, body, onCancel, onConfirm }: { title: string; body: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 px-4">
      <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700">
            <Trash2 size={22} />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-950">{title}</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{body}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-extrabold text-slate-700 hover:bg-slate-50">취소</button>
          <button type="button" onClick={onConfirm} className="rounded-xl bg-red-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-red-700">삭제</button>
        </div>
      </section>
    </div>
  );
}


