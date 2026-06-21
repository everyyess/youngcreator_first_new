"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Home, PanelLeftClose, PanelRightClose, Search, Trash2 } from "lucide-react";
import {
  createInitialCustomerData,
  createInitialState,
  createNewCustomerProfile,
  customerRowsToStoredState,
  customerStorage,
  defaultCustomerProfiles,
  saveCustomerDataJsonOnly,
  saveCustomerProfileColumns,
  storeSelectedCustomerId,
  type AppState,
  type CustomerId,
  type CustomerProfile,
} from "../maintab/CustomerContext";
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
  type ActiveConsultation,
  type ConsultationSession,
} from "../consultationStore";

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

function customerDisplay(profile?: CustomerProfile | null) {
  const birth = customerBirth(profile ?? undefined);
  return `${customerName(profile ?? undefined)}${birth ? ` (${birth})` : ""}`;
}

function ageDisplay(age: string) {
  return age ? `만 ${age}세` : "입력 대기";
}

function buildSummarySnapshot(state?: AppState) {
  if (!state) return null;
  const { financial, rrttllu } = state;
  return {
    existingInvestmentAssets: financial.existingInvestmentAssets,
    cashAssets: financial.cashAssets,
    investableAssets: financial.investableAssets,
    returnObjective: rrttllu.returnObjective,
    expectedReturn: rrttllu.expectedReturnUnknown ? "모르겠음" : rrttllu.expectedReturn,
    timeHorizon: rrttllu.timeHorizon,
    regularCashflowNeed: formatLiquiditySummary(rrttllu.regularCashflowNeed, "regular"),
    lumpSumPlan: formatLiquiditySummary(rrttllu.lumpSumPlan, "lumpSum"),
    emergencyReservePlan: formatLiquiditySummary(rrttllu.emergencyReservePlan, "emergency"),
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

export default function HomePage() {
  const router = useRouter();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [customers, setCustomers] = useState<CustomerProfile[]>(defaultCustomerProfiles);
  const [customerData, setCustomerData] = useState<Record<CustomerId, AppState>>(() => createInitialCustomerData(defaultCustomerProfiles));
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

  const sessions = useMemo(() => allSessions(customerData), [customerData]);
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const selectedState = selectedCustomer ? customerData[selectedCustomer.id] : undefined;

  const loadCustomers = useCallback(async () => {
    const result = await customerStorage.selectRows();
    if (!result) {
      setStorageMessage("Supabase 환경변수가 없어 HOME 데이터를 불러오지 못했습니다.");
      return;
    }
    if (result.errorMessage) setStorageMessage(result.errorMessage);
    if (!result.rows.length) return;
    const stored = customerRowsToStoredState(result.rows);
    setCustomers(stored.customerProfiles);
    setCustomerData(stored.customerData);
    setSelectedCustomerId((current) => current || stored.customerProfiles[0]?.id || "");
  }, []);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

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
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    upsertSession({ ...session, ...patch });
  }, [sessions, upsertSession]);

  const deleteSession = (session: ConsultationSession) => {
    if (!window.confirm("정말로 삭제하시겠습니까?")) return;
    const state = customerData[session.customerId] ?? createInitialState();
    persistCustomerState(session.customerId, { ...state, consultationSessions: getCustomerSessions(state).filter((item) => item.id !== session.id) });
    if (expandedSessionId === session.id) setExpandedSessionId(null);
  };

  function startSession(session: ConsultationSession) {
    const activeSession = { ...session, status: "active" as const, updatedAt: new Date().toISOString() };
    upsertSession(activeSession);
    storeSelectedCustomerId(session.customerId);
    writeActiveConsultation({ sessionId: session.id, customerId: session.customerId, startedAt: new Date().toISOString(), returnPath: "/maintab/tab1" });
    router.push("/maintab/tab1");
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
  const today = todayDate();
  const upcoming = useMemo(() => [...sessions].filter((session) => session.status !== "completed" && session.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3), [sessions, today]);
  const recent = useMemo(() => [...sessions].filter((session) => session.status === "completed" || session.date < today).sort(sortSessionsNewest).slice(0, 3), [sessions, today]);
  const expandedSession = sessions.find((session) => session.id === expandedSessionId) ?? null;

  const openCreateForm = () => {
    if (!selectedCustomer) return;
    setDraftSession(createConsultationSession(selectedCustomer.id));
    setShowCreateForm(true);
  };

  const saveDraftSession = (start = false) => {
    if (!draftSession) return;
    upsertSession(draftSession);
    setExpandedSessionId(draftSession.id);
    setShowCreateForm(false);
    if (start) startSession(draftSession);
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
      saveCustomerProfileColumns(next).catch((error) => console.error("Failed to save customer profile", error));
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
    const result = await customerStorage.insertCustomer(profile, state, customers.length);
    if (!result.ok) {
      setStorageMessage(result.message);
      return;
    }
    setCustomers((prev) => [...prev, profile]);
    setCustomerData((prev) => ({ ...prev, [profile.id]: state }));
    setSelectedCustomerId(profile.id);
    storeSelectedCustomerId(profile.id);
    setNewCustomer(createNewCustomerProfile());
    setShowAddCustomerForm(false);
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_85%_65%_at_8%_0%,rgba(99,102,241,0.11),transparent_55%),radial-gradient(ellipse_65%_65%_at_98%_100%,rgba(59,130,246,0.18),transparent_55%),#f8fafc] p-4 text-slate-900">
      <div className="grid min-h-[calc(100vh-2rem)] gap-4 transition-all duration-300" style={{ gridTemplateColumns: `${leftOpen ? "255px" : "56px"} minmax(0, 1fr) ${rightOpen ? "240px" : "56px"}` }}>
        <aside className={`overflow-hidden rounded-2xl border border-white/70 bg-white/85 shadow-xl shadow-blue-900/5 backdrop-blur ${leftOpen ? "p-4" : "p-2"}`}>
          <PanelHeader open={leftOpen} title={`${tempPbName} PB님, 오늘도 힘내세요!`} side="left" onToggle={() => setLeftOpen((value) => !value)} />
          {leftOpen ? (
            <div className="grid gap-4">
              {storageMessage ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{storageMessage}</p> : null}
              <div className="grid grid-cols-[minmax(0,0.8fr)_104px] gap-2">
                <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
                  <Search size={16} className="text-slate-400" />
                  <input className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" placeholder="고객 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <button type="button" onClick={() => setShowAddCustomerForm((value) => !value)} className="whitespace-nowrap rounded-xl bg-blue-600 px-2 text-[11px] font-extrabold text-white hover:bg-blue-700">신규 고객 추가</button>
              </div>
              <div className="grid max-h-40 gap-1 overflow-y-auto pr-1">
                {filteredCustomers.map((customer) => (
                  <button key={customer.id} type="button" onClick={() => selectCustomer(customer.id)} className={`rounded-lg px-3 py-2 text-left text-sm font-bold transition ${customer.id === selectedCustomerId ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-blue-50"}`}>
                    {customerName(customer)} <span className="text-xs opacity-70">{customerBirth(customer)}</span>
                  </button>
                ))}
              </div>
              {showAddCustomerForm ? <CustomerProfileEditor profile={newCustomer} setProfile={setNewCustomer} onSave={addCustomer} onCancel={() => setShowAddCustomerForm(false)} /> : null}
              {selectedCustomer ? <SelectedCustomerInfo customer={selectedCustomer} onChange={updateProfile} onCreate={openCreateForm} /> : null}
              {showCreateForm && draftSession ? (
                <CreateSessionForm draft={draftSession} setDraft={(updater) => setDraftSession((prev) => prev ? updater(prev) : prev)} onCancel={() => setShowCreateForm(false)} onSave={() => saveDraftSession(false)} onStart={() => saveDraftSession(true)} />
              ) : null}
              <section>
                <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">상담 내역</p>
                <div className="grid gap-2">
                  {selectedSessions.length ? selectedSessions.map((session) => (
                    <SessionCard key={session.id} session={session} customer={selectedCustomer} expanded={expandedSessionId === session.id} onExpand={() => setExpandedSessionId(expandedSessionId === session.id ? null : session.id)} onDelete={() => deleteSession(session)} onUpdate={(patch) => updateSession(session.id, patch)} />
                  )) : <EmptyBox text="상담 내역이 없습니다." />}
                </div>
              </section>
            </div>
          ) : null}
        </aside>

        <section className="rounded-2xl border border-white/70 bg-white/75 p-6 shadow-xl shadow-blue-900/5 backdrop-blur">
          <div className="flex h-full min-h-[520px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70">
            <p className="text-lg font-extrabold text-slate-400">추후 구현할 예정입니다</p>
          </div>
        </section>

        <aside className={`overflow-hidden rounded-2xl border border-white/70 bg-white/85 shadow-xl shadow-blue-900/5 backdrop-blur ${rightOpen ? "p-4" : "p-2"}`}>
          <PanelHeader open={rightOpen} title="상담 일정" side="right" onToggle={() => setRightOpen((value) => !value)} />
          {rightOpen ? (
            <div className="grid gap-5">
              {activeConsultation ? (
                <button type="button" onClick={() => router.push(activeConsultation.returnPath || "/maintab/tab1")} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-3 text-xs font-extrabold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700">
                  <Home size={15} /> 상담 화면으로 돌아가기 <span className="font-mono">{formatTimer(elapsedSeconds)}</span>
                </button>
              ) : null}
              <SideSection title="곧 예정된 상담 일정" sessions={upcoming} customers={customers} expandedSessionId={expandedSessionId} setExpandedSessionId={setExpandedSessionId} deleteSession={deleteSession} />
              <SideSection title="최근 상담 내역" sessions={recent} customers={customers} expandedSessionId={expandedSessionId} setExpandedSessionId={setExpandedSessionId} deleteSession={deleteSession} />
            </div>
          ) : null}
        </aside>
      </div>
      {expandedSession ? (
        <SummaryModal
          session={expandedSession}
          customer={customers.find((customer) => customer.id === expandedSession.customerId)}
          sessions={sessions}
          onUpdate={(patch) => updateSession(expandedSession.id, patch)}
          onClose={() => setExpandedSessionId(null)}
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
    <section className="rounded-xl border border-blue-100 bg-blue-50/70 p-3">
      <p className="mb-3 text-sm font-extrabold text-blue-900">신규 고객 추가</p>
      <div className="grid gap-2">
        <ProfileInput label="성명" value={profile.name} placeholder="예. 홍길동" onChange={(value) => update({ name: value })} />
        <GenderToggle value={profile.gender} onChange={(gender) => update({ gender })} />
        <ProfileInput label="생년월일" value={birth} placeholder="예. 671018" onChange={(value) => update({ birthYear: value, birth_year: value })} />
        <div className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-500">{ageDisplay(profile.age)}</div>
        <ProfileInput label="직업" value={profile.job} placeholder="예. 삼성증권 PB" onChange={(value) => update({ job: value })} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-700">취소</button>
          <button type="button" onClick={onSave} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-blue-700">저장</button>
        </div>
      </div>
    </section>
  );
}

function SelectedCustomerInfo({ customer, onChange, onCreate }: { customer: CustomerProfile; onChange: (id: CustomerId, patch: Partial<CustomerProfile>) => void; onCreate: () => void }) {
  const birth = customer.birthYear || customer.birth_year || "";
  return (
    <section>
      <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">고객 정보</p>
      <div className="rounded-xl border border-slate-900 bg-white p-3 shadow-sm">
      <div className="grid gap-2">
        <div className="grid grid-cols-[minmax(0,1fr)_70px] gap-2">
          <ProfileInput label="성명" value={customer.name} placeholder="성명" compact onChange={(value) => onChange(customer.id, { name: value })} />
          <GenderToggle value={customer.gender} onChange={(gender) => onChange(customer.id, { gender })} />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2">
          <ProfileInput label="생년월일" value={birth} placeholder="생년월일" compact onChange={(value) => onChange(customer.id, { birthYear: value, birth_year: value })} />
          <div className="h-10 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs font-bold text-slate-500">{ageDisplay(customer.age)}</div>
        </div>
        <ProfileInput label="직업" value={customer.job} placeholder="직업" onChange={(value) => onChange(customer.id, { job: value })} />
        <button type="button" onClick={onCreate} className="min-h-12 rounded-lg bg-blue-600 px-3 text-xs font-extrabold text-white hover:bg-blue-700">신규 상담 일지 생성</button>
      </div>
      </div>
    </section>
  );
}

function GenderToggle({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
      {["남", "여"].map((option) => (
        <button key={option} type="button" onClick={() => onChange(option)} className={`h-8 rounded-md text-xs font-extrabold transition ${value === option ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-blue-50"}`}>
          {option}
        </button>
      ))}
    </div>
  );
}

function ProfileInput({ label, value, placeholder, onChange, compact = false }: { label: string; value: string; placeholder: string; onChange: (value: string) => void; compact?: boolean }) {
  return (
    <label className={`grid items-center gap-2 ${compact ? "grid-cols-[44px_minmax(0,1fr)]" : "grid-cols-[58px_minmax(0,1fr)]"}`}>
      <span className="text-xs font-extrabold text-slate-600">{label}</span>
      <input className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm placeholder:font-normal" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function CreateSessionForm({ draft, setDraft, onCancel, onSave, onStart }: { draft: ConsultationSession; setDraft: (updater: (prev: ConsultationSession) => ConsultationSession) => void; onCancel: () => void; onSave: () => void; onStart: () => void }) {
  return (
    <section className="rounded-xl border border-slate-900 bg-blue-50/70 p-3">
      <p className="mb-3 text-sm font-extrabold text-blue-900">신규 상담 생성</p>
      <div className="grid gap-2">
        <input className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm" placeholder="상담 제목" value={draft.title} onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))} />
        <input className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm" type="date" value={draft.date} onChange={(e) => setDraft((prev) => ({ ...prev, date: e.target.value }))} />
        <div className="grid grid-cols-[0.65fr_1fr_1.15fr] gap-2">
          <button type="button" onClick={onCancel} className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-extrabold text-slate-700">취소</button>
          <button type="button" onClick={onSave} className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-extrabold text-slate-700">임시저장</button>
          <button type="button" onClick={onStart} className="whitespace-nowrap rounded-lg bg-blue-600 px-2 py-2 text-xs font-extrabold text-white hover:bg-blue-700">상담 시작</button>
        </div>
      </div>
    </section>
  );
}

function SessionCard({ session, customer, onExpand, onDelete }: { session: ConsultationSession; customer?: CustomerProfile | null; expanded: boolean; onExpand: () => void; onDelete: () => void; onUpdate: (patch: Partial<ConsultationSession>) => void }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onExpand} className="min-w-0 text-left">
          <p className="truncate text-sm font-extrabold text-slate-900">{displaySessionTitle(session.title)}</p>
          <p className="mt-1 text-xs font-bold text-slate-500">{displayKoreanDate(session.date)} · {session.duration || "소요 시간 미입력"}</p>
          {customer ? <p className="mt-1 text-xs text-slate-400">{customerDisplay(customer)}</p> : null}
        </button>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={onDelete} className="rounded-lg bg-red-50 p-2 text-red-700 hover:bg-red-100"><Trash2 size={15} /></button>
        </div>
      </div>
    </article>
  );
}

function SummaryModal({ session, customer, sessions, onUpdate, onClose }: { session: ConsultationSession; customer?: CustomerProfile; sessions: ConsultationSession[]; onUpdate: (patch: Partial<ConsultationSession>) => void; onClose: () => void }) {
  const snapshot = sessionSummarySnapshot(session);
  const previous = previousSessionFor(session, sessions);
  const changes = snapshotChangeRows(snapshot, previous ? sessionSummarySnapshot(previous) : null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <section className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-blue-600">{customerDisplay(customer)}</p>
            <h1 className="mt-1 text-2xl font-black text-blue-950">{displaySessionTitle(session.title)}</h1>
            <p className="mt-1 text-sm font-bold text-slate-500">{displayKoreanDate(session.date)} · {session.duration || "소요 시간 미입력"}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-extrabold text-slate-600 hover:bg-slate-50">닫기</button>
        </div>
        <div className="mb-5 grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-blue-600">상담 제목</span>
            <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold" value={session.title} placeholder="상담 제목" onChange={(e) => onUpdate({ title: e.target.value })} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-blue-600">날짜</span>
            <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold" type="date" value={session.date} onChange={(e) => onUpdate({ date: e.target.value })} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-blue-600">소요 시간</span>
            <input className="h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold" value={session.duration} placeholder="소요 시간" onChange={(e) => onUpdate({ duration: e.target.value })} />
          </label>
        </div>
        {session.autoEnded ? <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-extrabold text-red-700">{session.autoEndedMessage || autoEndedMessage}</p> : null}
        <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
          <p className="mb-3 text-sm font-extrabold text-blue-900">변경 이력</p>
          {changes.length ? (
            <div className="grid gap-2">
              {changes.map((change) => (
                <p key={change.label} className="text-sm font-bold text-slate-700">
                  {change.label} {change.before} <span className="text-slate-400">→</span> <span className="font-black text-red-600">{change.after}</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="text-sm font-bold text-slate-500">{previous ? "직전 상담 대비 변경된 요약 항목이 없습니다." : "비교할 직전 상담 기록이 없습니다."}</p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-4 text-sm font-extrabold text-blue-900">성향 및 니즈 분석 요약</p>
          <div className="grid gap-2">
            {summaryRows(snapshot).map(([label, value]) => (
              <div key={label} className="grid gap-1 rounded-xl bg-slate-50 px-4 py-3 text-sm sm:grid-cols-[150px_minmax(0,1fr)]">
                <span className="font-extrabold text-slate-500">{label}</span>
                <span className="font-bold text-slate-800">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function SideSection({ title, sessions, customers, expandedSessionId, setExpandedSessionId, deleteSession }: { title: string; sessions: ConsultationSession[]; customers: CustomerProfile[]; expandedSessionId: string | null; setExpandedSessionId: (id: string | null) => void; deleteSession: (session: ConsultationSession) => void }) {
  return (
    <section>
      <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="grid gap-2">
        {sessions.length ? sessions.map((session) => {
          const customer = customers.find((item) => item.id === session.customerId);
          return (
            <SessionCard key={session.id} session={session} customer={customer} expanded={expandedSessionId === session.id} onExpand={() => setExpandedSessionId(expandedSessionId === session.id ? null : session.id)} onDelete={() => deleteSession(session)} onUpdate={() => {}} />
          );
        }) : <EmptyBox text="표시할 상담이 없습니다." />}
      </div>
    </section>
  );
}

function EmptyBox({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">{text}</div>;
}
