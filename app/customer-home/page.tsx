"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Home, LogOut } from "lucide-react";
import { customerAuthStore, formatLoginTime, type CustomerSession } from "../authStore";
import {
  customerRowsToStoredState,
  customerStorage,
  loadAnalysisResult,
  loadNewAnalysisResult,
  loadPortfolioAssets,
  loadRebalancingState,
  storeSelectedCustomerId,
  type AppState,
  type CustomerProfile,
  type PortfolioAsset,
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
  writeActiveConsultation,
  type ActiveConsultation,
  type ConsultationSession,
} from "../consultationStore";

type PortfolioSnapshotRow = {
  name: string;
  assetClass: string;
  amount: number | null;
  buyPrice: number | null;
  currentPrice: number | null;
  returnPct: number | null;
  weight: number;
};

type SummarySnapshot = Record<string, unknown> & {
  portfolioTables?: {
    existing?: PortfolioSnapshotRow[];
    proposed?: PortfolioSnapshotRow[];
  };
};
type SummarySection = {
  title: string;
  risk?: boolean;
  items: Array<[string, string]>;
};

function customerName(profile?: CustomerProfile | null, session?: CustomerSession | null) {
  return profile?.name?.trim() || session?.name || "고객";
}

function customerBirth(profile?: CustomerProfile | null, session?: CustomerSession | null) {
  return (profile?.birth_year ?? profile?.birthYear ?? session?.birthDate ?? "").trim();
}

function customerDisplay(profile?: CustomerProfile | null, session?: CustomerSession | null) {
  const birth = customerBirth(profile, session);
  return `${customerName(profile, session)}${birth ? ` (${birth})` : ""}`;
}

function isUpcoming(session: ConsultationSession) {
  return session.status !== "completed" && session.date >= todayDate();
}

function sessionSnapshot(session?: ConsultationSession | null): SummarySnapshot | null {
  const snapshot = session?.summarySnapshot;
  return snapshot && typeof snapshot === "object" ? snapshot as SummarySnapshot : null;
}

function toFiniteSnapshotNumber(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function buildPortfolioSnapshotRows(assets: PortfolioAsset[]): PortfolioSnapshotRow[] {
  const values = assets.map((asset) => {
    const amount = toFiniteSnapshotNumber(asset.amount);
    const currentPrice = toFiniteSnapshotNumber(asset.current_price);
    const fallbackValue = amount > 0 && currentPrice > 0 ? amount * currentPrice : 0;
    return toFiniteSnapshotNumber(asset.current_value) || fallbackValue;
  });
  const total = values.reduce((sum, value) => sum + value, 0);
  return assets
    .map((asset, index) => {
      const amount = toFiniteSnapshotNumber(asset.amount);
      const buyPrice = toFiniteSnapshotNumber(asset.buy_price);
      const currentPrice = toFiniteSnapshotNumber(asset.current_price);
      const returnPct = buyPrice > 0 && currentPrice > 0 ? (currentPrice - buyPrice) / buyPrice : null;
      return {
        name: asset.name?.trim() || asset.ticker?.trim() || "-",
        assetClass: asset.asset_class || asset.productType || "-",
        amount: amount > 0 ? amount : null,
        buyPrice: buyPrice > 0 ? buyPrice : null,
        currentPrice: currentPrice > 0 ? currentPrice : null,
        returnPct,
        weight: total > 0 ? (values[index] ?? 0) / total : 0,
      };
    })
    .filter((row) => row.name !== "-")
    .slice(0, 25);
}

function hasPortfolioTableRows(tables?: SummarySnapshot["portfolioTables"] | null) {
  return Boolean((tables?.existing?.length ?? 0) > 0 || (tables?.proposed?.length ?? 0) > 0);
}

function valueAsText(value: unknown) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value);
}

function valueOrWaiting(value: unknown) {
  return valueAsText(value) || "입력 대기";
}

function durationLabel(session: ConsultationSession) {
  if (session.duration?.trim()) {
    return session.duration.includes("소요") ? session.duration : `${session.duration} 소요`;
  }
  if (session.durationSeconds && session.durationSeconds > 0) {
    const minutes = Math.max(1, Math.round(session.durationSeconds / 60));
    return `${minutes}분 소요`;
  }
  return "소요 시간 미입력";
}

function dayRelativeLabel(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((today - targetDay) / 86_400_000);

  if (diffDays === 0) return "오늘";
  if (diffDays > 0 && diffDays < 30) return `${diffDays}일 전`;
  if (diffDays > 0 && diffDays < 365) return `${Math.floor(diffDays / 30)}달 전`;
  if (diffDays > 0) return `${Math.floor(diffDays / 365)}년 전`;

  const daysLeft = Math.abs(diffDays);
  return daysLeft === 1 ? "내일" : `${daysLeft}일 후`;
}

function upcomingLabel(session: ConsultationSession, active?: ActiveConsultation | null) {
  if (session.status === "active" || active?.sessionId === session.id) return "✨ 상담 중이에요!";

  const target = new Date(session.date.includes("T") ? session.date : `${session.date}T00:00`);
  const diffMs = target.getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "✨ 상담 시간이 되었어요!";

  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return `✨ ${minutes}분 남았어요!`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `✨ ${hours}시간 남았어요!`;
  return `✨ ${Math.ceil(hours / 24)}일 남았어요!`;
}

function summarySections(snapshot?: SummarySnapshot | null): SummarySection[] {
  if (!snapshot) return [];
  return [
    {
      title: "고객 재무 현황",
      items: [
        ["순자산", valueAsText(snapshot.netAssets)],
        ["금융자산", valueAsText(snapshot.financialAssets)],
        ["부동산", valueAsText(snapshot.realEstate)],
        ["부채", valueAsText(snapshot.debt)],
        ["연 고정소득", valueAsText(snapshot.annualFixedIncome)],
        ["월 고정지출", valueAsText(snapshot.monthlyFixedExpense)],
        ["추가 투자 의향 자산", valueAsText(snapshot.investableAssets)],
        ["향후 예상되는 비정기 소득", valueAsText(snapshot.irregularIncome)],
      ],
    },
    {
      title: "Return",
      items: [
        ["투자 목적", valueAsText(snapshot.returnObjective)],
        ["기대수익률", valueAsText(snapshot.expectedReturn)],
      ],
    },
    {
      title: "Risk",
      risk: true,
      items: [
        ["", [valueAsText(snapshot.riskScore), valueAsText(snapshot.riskLevel)].filter(Boolean).join("/100 ")],
        ["", valueAsText(snapshot.riskInterpretation)],
      ],
    },
    { title: "Time Horizon", items: [["투자 기간", valueAsText(snapshot.timeHorizon)]] },
    {
      title: "Tax",
      items: [
        ["사전증여", valueAsText(snapshot.giftingPlan)],
        ["종합과세 절감", valueAsText(snapshot.globalTaxImportance)],
        ["최근 과세대상", valueAsText(snapshot.recentGlobalTaxSubject)],
        ["해외주식 절세", valueAsText(snapshot.foreignStockTaxImportance)],
      ],
    },
    {
      title: "Liquidity",
      items: [
        ["정기 현금흐름 필요", valueAsText(snapshot.regularCashflowNeed)],
        ["목돈 사용 계획", valueAsText(snapshot.lumpSumPlan)],
        ["비상예비자금 계획", valueAsText(snapshot.emergencyReservePlan)],
      ],
    },
    { title: "Legal", items: [["법적/제도적 제약", valueAsText(snapshot.legalConstraints)]] },
  ];
}

function previousSessionFor(session: ConsultationSession, sessions: ConsultationSession[]) {
  const currentTime = new Date(session.date.includes("T") ? session.date : `${session.date || todayDate()}T00:00`).getTime();
  return sessions
    .filter((item) => item.id !== session.id && item.status === "completed" && sessionSnapshot(item))
    .sort((a, b) => {
      const aTime = new Date(a.date.includes("T") ? a.date : `${a.date || todayDate()}T00:00`).getTime();
      const bTime = new Date(b.date.includes("T") ? b.date : `${b.date || todayDate()}T00:00`).getTime();
      const aBefore = Number.isFinite(aTime) && aTime <= currentTime;
      const bBefore = Number.isFinite(bTime) && bTime <= currentTime;
      if (aBefore !== bBefore) return aBefore ? -1 : 1;
      return `${b.date}${b.updatedAt}`.localeCompare(`${a.date}${a.updatedAt}`);
    })[0] ?? null;
}

function flatSummaryRows(snapshot?: SummarySnapshot | null) {
  return summarySections(snapshot)
    .flatMap((section) => section.items.map(([label, value]) => [label || section.title, value] as const))
    .filter(([, value]) => value && value !== "입력 대기");
}

function snapshotChangeRows(current: SummarySnapshot | null, previous: SummarySnapshot | null) {
  if (!current || !previous) return [];
  const previousMap = new Map(flatSummaryRows(previous));
  return flatSummaryRows(current)
    .map(([label, after]) => ({ label, before: previousMap.get(label) ?? "", after }))
    .filter((row) => row.before && row.before !== row.after);
}

export default function CustomerHomePage() {
  const router = useRouter();
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [active, setActive] = useState<ActiveConsultation | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [summarySession, setSummarySession] = useState<ConsultationSession | null>(null);

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
      writeActiveConsultation({
        sessionId: item.id,
        customerId: session.customerId,
        startedAt: item.updatedAt || new Date().toISOString(),
        returnPath: "/customer-maintab/tab1",
      });
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
              <h1 className="text-3xl font-black text-[#1428A0]">
                {customerName(profile, session)} 고객님, 환영합니다!
                <span className="ml-2 text-base font-extrabold text-slate-500">(담당 PB: {session.pbName || "담당 PB"})</span>
              </h1>
              <p className="mt-2 text-sm font-bold text-slate-500">마지막 로그인: {formatLoginTime(session.lastLoginAt)}</p>
              {customerBirth(profile, session) ? <p className="mt-1 text-sm font-bold text-slate-500">고객 정보: {customerDisplay(profile, session)}</p> : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {activeForCustomer ? (
                <button type="button" onClick={() => router.push(activeForCustomer.returnPath?.replace("/maintab", "/customer-maintab") || "/customer-maintab/tab1")} className="grid h-11 justify-items-center gap-0.5 rounded-xl bg-blue-600 px-3 text-xs font-extrabold text-white shadow-lg shadow-blue-600/20">
                  <span className="inline-flex items-center gap-1.5"><Home size={13} /> 상담 화면으로 돌아가기</span>
                  <span className="font-mono text-xs">{formatTimer(elapsedSeconds)}</span>
                </button>
              ) : null}
              <button type="button" onClick={logout} className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600">
                <LogOut size={16} /> 로그아웃
              </button>
            </div>
          </div>
          {message ? <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-extrabold text-red-700">{message}</p> : null}
        </section>

        <CustomerSessionSection title="곧 예정된 상담 일정" sessions={upcoming} onEnter={enterRoom} active={active} />
        <CustomerSessionSection title="최근 상담 내역" sessions={recent} onEnter={setSummarySession} recent />
      </div>

      {summarySession ? (
        <ConsultationSummaryModal
          session={summarySession}
          customer={profile}
          customerSession={session}
          sessions={sessions}
          onClose={() => setSummarySession(null)}
        />
      ) : null}
    </main>
  );
}

function CustomerSessionSection({
  title,
  sessions,
  onEnter,
  recent = false,
  active = null,
}: {
  title: string;
  sessions: ConsultationSession[];
  onEnter: (session: ConsultationSession) => void;
  recent?: boolean;
  active?: ActiveConsultation | null;
}) {
  const listClass = recent
    ? "mt-4 grid max-h-[430px] gap-4 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3"
    : "mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3";

  return (
    <section className="rounded-3xl border border-white/70 bg-white/90 p-6 shadow-xl shadow-blue-900/5 backdrop-blur">
      <h2 className="text-xl font-black text-blue-950">{title}</h2>
      <div className={listClass}>
        {sessions.length ? sessions.map((item) => {
          const cardContent = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {!recent ? <p className="mb-1 text-xs font-extrabold text-red-600">{upcomingLabel(item, active)}</p> : null}
                  <h3 className="truncate text-base font-black text-slate-950">{displaySessionTitle(item.title)}</h3>
                  <p className="mt-1 text-xs font-bold text-slate-500">{displayKoreanDate(item.date)}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">{durationLabel(item)} · {dayRelativeLabel(item.date)}</p>
                </div>
                <CalendarDays size={20} className="shrink-0 text-blue-500" />
              </div>
              {!recent ? (
                <button type="button" onClick={() => onEnter(item)} className="mt-4 h-10 w-full rounded-xl bg-blue-600 text-sm font-extrabold text-white hover:bg-blue-700">
                  상담실 입장
                </button>
              ) : null}
            </>
          );

          return recent ? (
            <button key={item.id} type="button" onClick={() => onEnter(item)} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40">
              {cardContent}
            </button>
          ) : (
            <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              {cardContent}
            </article>
          );
        }) : (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-400">
            표시할 상담 내역이 없습니다.
          </div>
        )}
      </div>
    </section>
  );
}

function ConsultationSummaryModal({
  session,
  customer,
  customerSession,
  sessions,
  onClose,
}: {
  session: ConsultationSession;
  customer?: CustomerProfile | null;
  customerSession?: CustomerSession | null;
  sessions: ConsultationSession[];
  onClose: () => void;
}) {
  const snapshot = sessionSnapshot(session);
  const [fallbackPortfolioTables, setFallbackPortfolioTables] = useState<SummarySnapshot["portfolioTables"] | null>(null);
  const portfolioTables = hasPortfolioTableRows(snapshot?.portfolioTables) ? snapshot?.portfolioTables : fallbackPortfolioTables ?? undefined;

  useEffect(() => {
    if (hasPortfolioTableRows(snapshot?.portfolioTables)) {
      setFallbackPortfolioTables(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      loadAnalysisResult(session.customerId),
      loadPortfolioAssets(session.customerId),
      loadRebalancingState(session.customerId),
      loadNewAnalysisResult(session.customerId),
    ]).then(([leftResult, portfolioAssets, rebalancing, rightResult]) => {
      if (cancelled) return;
      const leftResultRecord = leftResult as { enrichedAssets?: PortfolioAsset[] } | null;
      const rightResultRecord = rightResult as { enrichedAssets?: PortfolioAsset[] } | null;
      const existingAssets = Array.isArray(leftResultRecord?.enrichedAssets) && leftResultRecord.enrichedAssets.length > 0
        ? leftResultRecord.enrichedAssets
        : portfolioAssets;
      const remainingMap = new Map(existingAssets.map((asset) => [`${asset.name ?? ""}::${asset.ticker ?? ""}`, asset]));
      const remainingAssets = rebalancing.sellAssets.map((asset) => {
        const enriched = remainingMap.get(`${asset.name ?? ""}::${asset.ticker ?? ""}`);
        return {
          ...asset,
          current_price: enriched?.current_price ?? asset.current_price,
          current_value: enriched?.current_value ?? asset.current_value,
        };
      });
      const proposedAssets = Array.isArray(rightResultRecord?.enrichedAssets) && rightResultRecord.enrichedAssets.length > 0
        ? rightResultRecord.enrichedAssets
        : remainingAssets.filter((asset) => toFiniteSnapshotNumber(asset.amount) > 0);
      setFallbackPortfolioTables({
        existing: buildPortfolioSnapshotRows(existingAssets),
        proposed: buildPortfolioSnapshotRows(proposedAssets),
      });
    }).catch((error) => {
      console.error("Failed to load portfolio tables for customer session modal", error);
      if (!cancelled) setFallbackPortfolioTables(null);
    });
    return () => { cancelled = true; };
  }, [session.customerId, snapshot?.portfolioTables]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <section className="max-h-[88vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold text-blue-600">{customerDisplay(customer, customerSession)}</p>
            <h1 className="mt-1 text-3xl font-black text-blue-950">{displaySessionTitle(session.title)}</h1>
            <p className="mt-2 text-base font-bold text-slate-500">{displayKoreanDate(session.date)} <span className="text-slate-400">· {durationLabel(session)}</span></p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-base font-extrabold text-slate-600 hover:bg-slate-50">닫기</button>
        </div>

        <PortfolioTables tables={portfolioTables} />
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-5 text-lg font-extrabold text-blue-900">성향 및 니즈 분석 요약</p>
          <SummaryTable snapshot={snapshot} />
        </div>
      </section>
    </div>
  );
}

function formatSnapshotNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString("ko-KR");
}

function formatSnapshotPercent(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function PortfolioTables({ tables }: { tables?: SummarySnapshot["portfolioTables"] }) {
  const existing = tables?.existing ?? [];
  const proposed = tables?.proposed ?? [];
  if (!existing.length && !proposed.length) return null;
  return (
    <div className="mb-6 grid gap-5">
      {existing.length ? <PortfolioSnapshotTable title="기존 포트폴리오" rows={existing} /> : null}
      {proposed.length ? <PortfolioSnapshotTable title="신규 포트폴리오" rows={proposed} /> : null}
    </div>
  );
}

function PortfolioSnapshotTable({ title, rows }: { title: string; rows: PortfolioSnapshotRow[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-amber-200 px-4 py-3">
        <p className="text-base font-black text-amber-700">{title}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="bg-blue-900 text-left text-xs font-black text-white">
              <th className="px-3 py-3">종목명</th>
              <th className="px-3 py-3">자산군</th>
              <th className="px-3 py-3 text-right">수량</th>
              <th className="px-3 py-3 text-right">매입가</th>
              <th className="px-3 py-3 text-right">현재가</th>
              <th className="px-3 py-3 text-right">손익률</th>
              <th className="px-3 py-3 text-right">비중</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.name}-${index}`} className={index % 2 ? "bg-slate-50" : "bg-white"}>
                <td className="px-3 py-3 font-bold text-slate-900">{row.name}</td>
                <td className="px-3 py-3 font-bold text-slate-600">{row.assetClass}</td>
                <td className="px-3 py-3 text-right font-bold text-slate-800">{formatSnapshotNumber(row.amount)}</td>
                <td className="px-3 py-3 text-right font-bold text-slate-800">{formatSnapshotNumber(row.buyPrice)}</td>
                <td className="px-3 py-3 text-right font-bold text-slate-800">{formatSnapshotNumber(row.currentPrice)}</td>
                <td className={`px-3 py-3 text-right font-black ${row.returnPct == null ? "text-slate-400" : row.returnPct >= 0 ? "text-red-600" : "text-blue-700"}`}>
                  {formatSnapshotPercent(row.returnPct)}
                </td>
                <td className="px-3 py-3 text-right font-bold text-slate-800">{formatSnapshotPercent(row.weight, 1).replace("+", "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryTable({ snapshot }: { snapshot: SummarySnapshot | null }) {
  const sections = summarySections(snapshot);
  if (!sections.length) {
    return <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500">상담 종료 후 요약 내용을 확인할 수 있습니다.</p>;
  }

  return (
    <div className="grid gap-3">
      {sections.map((section) => (
        <div key={section.title} className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-[160px_minmax(0,1fr)]">
          <div className="flex items-center bg-sky-100 px-5 py-4">
            <span className="text-base font-black text-blue-900">{section.title}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3 px-5 py-4">
            {section.risk ? (
              <div className="grid gap-2">
                <p className="text-base font-black text-slate-950">{valueOrWaiting(section.items[0]?.[1])}</p>
                <p className="text-sm font-bold leading-6 text-slate-950">{valueOrWaiting(section.items[1]?.[1])}</p>
              </div>
            ) : (
              section.items.map(([label, value]) => (
                <span key={label} className="inline-flex items-center gap-2 text-base font-black text-slate-950">
                  <span className="rounded-lg bg-sky-100 px-3 py-1.5 text-blue-900">{label}</span>
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
