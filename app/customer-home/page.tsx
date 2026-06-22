"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Home, LogOut, Trash2 } from "lucide-react";
import { customerAuthStore, formatLoginTime, type CustomerSession } from "../authStore";
import {
  customerRowsToStoredState,
  customerStorage,
  storeSelectedCustomerId,
  type AppState,
  type CustomerId,
  type CustomerProfile,
} from "../maintab/CustomerContext";
import {
  displayKoreanDate,
  displaySessionTitle,
  formatTimer,
  getCustomerSessions,
  getElapsedSeconds,
  readActiveConsultation,
  sortSessionsNewest,
  todayDate,
  type ActiveConsultation,
  type ConsultationSession,
} from "../consultationStore";

function customerName(profile?: CustomerProfile | null, session?: CustomerSession | null) {
  return profile?.name?.trim() || session?.name || "고객";
}

function customerBirth(profile?: CustomerProfile | null) {
  return (profile?.birth_year ?? profile?.birthYear ?? "").trim();
}

function isUpcoming(session: ConsultationSession) {
  return session.status !== "completed" && session.date >= todayDate();
}

export default function CustomerHomePage() {
  const router = useRouter();
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [active, setActive] = useState<ActiveConsultation | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const current = customerAuthStore.readSession();
    setSession(current);
    if (!current) return;
    const rows = await customerStorage.selectRows();
    const stored = rows ? customerRowsToStoredState(rows.rows) : null;
    const foundProfile = stored?.customerProfiles.find((item) => item.id === current.customerId) ?? null;
    setProfile(foundProfile);
    setState(current.customerId ? stored?.customerData[current.customerId] ?? null : null);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const syncActive = () => {
      const current = readActiveConsultation();
      setActive(current);
      setElapsedSeconds(getElapsedSeconds(current));
    };
    syncActive();
    const id = window.setInterval(syncActive, 1000);
    window.addEventListener("storage", syncActive);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", syncActive);
    };
  }, []);

  const sessions = useMemo(() => getCustomerSessions(state), [state]);
  const upcoming = useMemo(() => sessions.filter(isUpcoming).sort((a, b) => a.date.localeCompare(b.date)), [sessions]);
  const recent = useMemo(() => sessions.filter((item) => !isUpcoming(item)).sort(sortSessionsNewest), [sessions]);
  const activeForCustomer = active && session && active.customerId === session.customerId ? active : null;

  const logout = async () => {
    await customerAuthStore.logout();
    router.push("/");
  };

  const enterRoom = (item: ConsultationSession) => {
    setMessage("");
    if (!session) return;
    if (item.status !== "active" && (!active || active.customerId !== session.customerId || active.sessionId !== item.id)) {
      setMessage("상담 준비 중입니다. 담당 PB가 상담을 시작하면 입장할 수 있습니다.");
      return;
    }
    storeSelectedCustomerId(session.customerId);
    if (!active || active.customerId !== session.customerId || active.sessionId !== item.id) {
      window.localStorage.setItem("samsung-vvip-active-consultation-session-v1", JSON.stringify({
        sessionId: item.id,
        customerId: session.customerId,
        startedAt: item.updatedAt || new Date().toISOString(),
        returnPath: "/customer-maintab/tab1",
      }));
    }
    router.push("/customer-maintab/tab1");
  };

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <section className="rounded-2xl bg-white p-8 text-center shadow-xl">
          <p className="text-lg font-black text-slate-900">고객 로그인이 필요합니다.</p>
          <button type="button" onClick={() => router.push("/")} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white">로그인 화면으로 이동</button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_85%_65%_at_8%_0%,rgba(99,102,241,0.11),transparent_55%),radial-gradient(ellipse_65%_65%_at_98%_100%,rgba(59,130,246,0.18),transparent_55%),#f8fafc] p-5 text-slate-900">
      <div className="mx-auto grid max-w-6xl gap-6">
        <section className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-xl shadow-blue-900/5 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-blue-950">
                {customerName(profile, session)} 고객님, 환영합니다!
                <span className="ml-2 text-base font-extrabold text-slate-500">(담당 PB: {session.pbName || "담당 PB"})</span>
              </h1>
              <p className="mt-2 text-sm font-bold text-slate-500">마지막 로그인: {formatLoginTime(session.lastLoginAt)}</p>
              {customerBirth(profile) ? <p className="mt-1 text-sm font-bold text-slate-500">고객 정보: {customerName(profile, session)} ({customerBirth(profile)})</p> : null}
            </div>
            <button type="button" onClick={logout} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600">
              <LogOut size={16} /> 로그아웃
            </button>
            {activeForCustomer ? (
              <button type="button" onClick={() => router.push(activeForCustomer.returnPath?.replace("/maintab", "/customer-maintab") || "/customer-maintab/tab1")} className="grid justify-items-center gap-1 rounded-xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-blue-600/20">
                <span className="inline-flex items-center gap-2"><Home size={16} /> 상담 화면으로 돌아가기</span>
                <span className="font-mono">{formatTimer(elapsedSeconds)}</span>
              </button>
            ) : null}
          </div>
          {message ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-extrabold text-red-700">{message}</p> : null}
        </section>

        <CustomerSessionSection title="곧 예정된 상담 일정" sessions={upcoming} onEnter={enterRoom} />
        <CustomerSessionSection title="최근 상담 내역" sessions={recent} onEnter={enterRoom} recent />
      </div>
    </main>
  );
}

function CustomerSessionSection({ title, sessions, onEnter, recent = false }: { title: string; sessions: ConsultationSession[]; onEnter: (session: ConsultationSession) => void; recent?: boolean }) {
  return (
    <section className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-xl shadow-blue-900/5 backdrop-blur">
      <h2 className="text-xl font-black text-blue-950">{title}</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sessions.length ? sessions.map((session) => (
          <article key={session.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">{displayKoreanDate(session.date)}</p>
                <h3 className="mt-1 truncate text-base font-black text-slate-950">{displaySessionTitle(session.title)}</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">{session.duration || (recent ? "소요 시간 미입력" : "상담 예정")}</p>
              </div>
              <CalendarDays size={20} className="shrink-0 text-blue-500" />
            </div>
            {recent ? (
              <button type="button" disabled className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-extrabold text-slate-400">
                <Trash2 size={15} /> 종료된 상담
              </button>
            ) : (
              <button type="button" onClick={() => onEnter(session)} className="mt-4 h-10 w-full rounded-xl bg-blue-600 text-sm font-extrabold text-white hover:bg-blue-700">
                상담실 입장
              </button>
            )}
          </article>
        )) : (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">
            표시할 상담 내역이 없습니다.
          </div>
        )}
      </div>
    </section>
  );
}
