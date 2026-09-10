"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { buildHeaderAssetSummary, HeaderSummary } from "../maintab/MainTabShell";
import TechnicalAnalysisTab from "../maintab/tab2/TechnicalAnalysisTab";
import FundamentalAnalysisTab from "../maintab/tab2/FundamentalAnalysisTab";
import DartAnalysisTab from "../maintab/tab2/DartAnalysisTab";
import StockScreenerTab from "../maintab/tab2/StockScreenerTab";
import {
  CustomerContext,
  customerRowsToStoredState,
  customerRowsToUpdatedMap,
  customerStorage,
  createInitialState,
  createNewCustomerProfile,
  deriveCalculatedAppState,
  getStoredSelectedCustomerId,
  loadAnalysisResult,
  loadPortfolioAssets,
  loadSharedMaintabUiState,
  updateConsultationSessionsOnly,
  saveSharedMaintabUiState,
  storeSelectedCustomerId,
  type AppState,
  type CustomerContextValue,
  type CustomerId,
  type CustomerProfile,
  type PortfolioAsset,
  type PortfolioAnalysisResult,
  type SharedMaintabUiState,
} from "../maintab/CustomerContext";
import { pbAuthStore } from "../authStore";
import {
  consultationTimerEventName,
  finishSession,
  getCustomerSessions,
  getElapsedSeconds,
  readActiveConsultation,
  writeActiveConsultation,
  type ActiveConsultation,
} from "../consultationStore";
import { BackgroundEngineProvider } from "./integratedInsight/BackgroundEngineContext";

const ElbElsSimulator = dynamic(() => import("@/components/ElbElsSimulator"), {
  ssr: false,
  loading: () => (
    <section className="min-h-[320px] rounded-lg border border-slate-200 bg-white p-6 text-sm font-bold text-slate-400 shadow-soft">
      ELB·ELS 시뮬레이터를 불러오는 중입니다.
    </section>
  ),
});

const PeerAnalysisTab = dynamic(() => import("./PeerAnalysisTab"), { ssr: false });
const IntegratedInsight = dynamic(() => import("./integratedInsight/IntegratedInsight"), { ssr: false });

const PORTFOLIO_RESULT_STORAGE_KEY = "portfolio-result-v1";

export type AnalysisTopTab = "stock" | "screener" | "competitors" | "insight" | "elbEls";
type StockAnalysisTab = "technical" | "fundamental" | "dart";

export const analysisTabSegments = ["tab1", "tab2", "tab3", "tab4", "tab5"] as const;

export type AnalysisTabSegment = (typeof analysisTabSegments)[number];

const analysisTopTabs: { id: AnalysisTopTab; label: string; path: `/analysis/${AnalysisTabSegment}` }[] = [
  { id: "stock", label: "종목 분석", path: "/analysis/tab1" },
  { id: "screener", label: "종목 지표 스크리너", path: "/analysis/tab2" },
  { id: "competitors", label: "경쟁사 분석", path: "/analysis/tab3" },
  { id: "insight", label: "통합 인사이트", path: "/analysis/tab4" },
  { id: "elbEls", label: "ELB·ELS 시뮬레이터", path: "/analysis/tab5" },
];

export const analysisTabBySegment: Record<AnalysisTabSegment, AnalysisTopTab> = {
  tab1: "stock",
  tab2: "screener",
  tab3: "competitors",
  tab4: "insight",
  tab5: "elbEls",
};

export function isAnalysisTabSegment(segment: string): segment is AnalysisTabSegment {
  return analysisTabSegments.includes(segment as AnalysisTabSegment);
}

const stockAnalysisTabs: { id: StockAnalysisTab; label: string }[] = [
  { id: "technical", label: "기술적 분석" },
  { id: "fundamental", label: "외부자료 분석" },
  { id: "dart", label: "공시 분석" },
];

function PlaceholderContent({ label }: { label: string }) {
  return (
    <section className="min-h-[320px] rounded-lg border border-dashed border-slate-200 bg-white/70 p-6 text-sm font-bold text-slate-400 shadow-soft">
      {label} 기능은 추후 구현 예정입니다.
    </section>
  );
}

function AnalysisTabs({
  contextValue,
  activeTopTab,
  urlSelectedStock,
  onCustomerChange,
  isInsightSessionReady,
  insightSessionError,
  onRetryInsightSession,
}: {
  contextValue: CustomerContextValue;
  activeTopTab: AnalysisTopTab;
  urlSelectedStock: { ticker: string; name: string } | null;
  onCustomerChange: (customerId: CustomerId) => void;
  isInsightSessionReady: boolean;
  insightSessionError: "no-supabase-config" | "no-session" | "sync-failed" | null;
  onRetryInsightSession: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // "상담으로 돌아가기" 버튼이 어느 탭으로 돌아갈지 — sessionStorage에만 의존했는데, "분석실로 이동"
  // 버튼을 window.open(..., "noopener")으로 새 탭에 열면 noopener가 opener와의 연결을 끊어서
  // sessionStorage가 새 탭으로 안 넘어간다(2026-09 발견·수정) — URL 쿼리(returnTab)를 우선 소스로 쓰고,
  // sessionStorage는 (noopener 없이 여는 다른 진입점을 위한) 하위 호환 폴백으로 유지한다.
  const urlReturnTab = searchParams.get("returnTab");
  const [activeStockTab, setActiveStockTab] = useState<StockAnalysisTab>("technical");
  const [mountedStockTabs, setMountedStockTabs] = useState<Set<StockAnalysisTab>>(new Set(["technical"]));

  // 종목분석·외부자료분석·공시분석 세 탭이 공유하는 "현재 선택된 종목".
  // useState 초기값 계산 함수 안에서 sessionStorage를 즉시 읽어, 렌더링 첫 순간부터
  // 값이 채워진 채로 시작함(이후 useEffect 실행 순서 경쟁으로 인한 초기화 방지).
  const [sharedStock, setSharedStock] = useState<{ ticker: string; name: string } | null>(() => {
    if (urlSelectedStock) return urlSelectedStock;
    if (typeof window !== "undefined") {
      const savedTicker = sessionStorage.getItem("screenerSelectedTicker");
      const savedName = sessionStorage.getItem("screenerSelectedName");
      if (savedTicker && savedName) return { ticker: savedTicker, name: savedName };
    }
    return null;
  });

  useEffect(() => {
    if (urlSelectedStock) setSharedStock(urlSelectedStock);
  }, [urlSelectedStock]);

  // 분석 고객이 실제로 바뀌면 공유 종목을 비워, 각 분석 탭이 새 고객의 보유 종목에서 다시 고르게 함.
  // 최초 고객 로딩(빈 값 -> 고객 id)이나 스크리너/URL로 들어온 선택은 건드리지 않음.
  const previousCustomerRef = useRef(contextValue.selectedCustomer);
  useEffect(() => {
    const previous = previousCustomerRef.current;
    previousCustomerRef.current = contextValue.selectedCustomer;
    if (!previous || previous === contextValue.selectedCustomer) return;
    setSharedStock(null);
  }, [contextValue.selectedCustomer]);

  const selectStockTab = (tab: StockAnalysisTab) => {
    setActiveStockTab(tab);
    setMountedStockTabs((prev) => new Set([...prev, tab]));
  };

  const returnToConsultation = () => {
    const stored = typeof window !== "undefined" ? sessionStorage.getItem("analysisReturnTab") : null;
    const target = urlReturnTab || stored || "tab1";
    router.push(`/consultation/${target}`);
  };
  const returnButton = (
    <button
      type="button"
      onClick={returnToConsultation}
      className="flex min-h-10 shrink-0 items-center justify-center rounded-md border border-samsung/30 bg-samsung/5 px-3 py-2 text-xs font-bold text-samsung transition hover:bg-samsung/10"
    >
      상담으로 돌아가기
    </button>
  );

  return (
    <CustomerContext.Provider value={contextValue}>
    <section className="flex flex-col gap-4">
    {/* 종목분석 탭(활성 시 "분석 고객" 칸 오른쪽에 붙임)이 아닌 다른 탭에 있을 때의 대체 위치 —
        여기서만 안 보이면 스크리너·경쟁사분석 등으로 이동했을 때 돌아가기 버튼이 아예 사라진다. */}
    {returnButton && activeTopTab !== "stock" && (
      <div className="flex justify-end">{returnButton}</div>
    )}
    <div className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-soft">
      {analysisTopTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => router.push(tab.path)}
              className={[
                "flex min-h-11 shrink-0 flex-1 items-center justify-center rounded-md px-4 py-2.5 text-sm font-bold transition",
                activeTopTab === tab.id ? "bg-[#2563eb] text-white shadow-soft" : "bg-[#F3F5F9] text-slate-600 hover:bg-slate-100 hover:text-navy",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTopTab === "screener" ? (
          <StockScreenerTab />
        ) : activeTopTab === "stock" ? (
          <div className="flex flex-col gap-4">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft lg:p-5">
              <div className="flex flex-wrap items-end gap-4">
                <label className="min-w-[240px] flex-1 space-y-2 lg:flex-none lg:basis-[0.7fr]">
                  <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">분석 고객</span>
                  <select
                    value={contextValue.selectedCustomer}
                    onChange={(event) => onCustomerChange(event.target.value)}
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15"
                  >
                    {contextValue.customerProfiles.length === 0 ? <option value="">등록된 고객 없음</option> : null}
                    {contextValue.customerProfiles.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name || "이름 미입력"}{customer.birthYear ? ` · ${customer.birthYear}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <div className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-soft">
              {stockAnalysisTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => selectStockTab(tab.id)}
                  className={[
                    "flex min-h-10 shrink-0 flex-1 items-center justify-center rounded-md px-4 py-2 text-sm font-bold transition",
                    activeStockTab === tab.id ? "bg-[#2563eb] text-white shadow-soft" : "bg-[#F3F5F9] text-slate-600 hover:bg-slate-100 hover:text-navy",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              ))}
              {returnButton}
            </div>

            {mountedStockTabs.has("technical") ? (
              <div className="space-y-5" style={{ display: activeStockTab === "technical" ? undefined : "none" }}>
                <TechnicalAnalysisTab key={contextValue.selectedCustomer} selectedStock={sharedStock} onStockChange={setSharedStock} />
              </div>
            ) : null}
            {mountedStockTabs.has("fundamental") ? (
              <div className="space-y-5" style={{ display: activeStockTab === "fundamental" ? undefined : "none" }}>
                <FundamentalAnalysisTab key={contextValue.selectedCustomer} selectedStock={sharedStock} onStockChange={setSharedStock} />
              </div>
            ) : null}
            {mountedStockTabs.has("dart") ? (
              <div className="space-y-5" style={{ display: activeStockTab === "dart" ? undefined : "none" }}>
                <DartAnalysisTab key={contextValue.selectedCustomer} selectedStock={sharedStock} onStockChange={setSharedStock} />
              </div>
            ) : null}
          </div>
        ) : activeTopTab === "competitors" ? (
          <div className="project-ui-theme">
            <PeerAnalysisTab />
          </div>
        ) : activeTopTab === "insight" && !isInsightSessionReady ? (
          <section className="min-h-[320px] rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
            {insightSessionError ? (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm font-bold text-slate-700">
                  통합 인사이트용 Supabase 세션을 연결하지 못했습니다.
                </p>
                <p className="text-xs leading-5 text-slate-500">
                  {insightSessionError === "no-session"
                    ? "로그인 세션이 만료되었습니다. 다시 로그인하면 통합 인사이트를 사용할 수 있습니다. (종목 분석·경쟁사·ELB/ELS 탭은 그대로 이용 가능합니다.)"
                    : insightSessionError === "no-supabase-config"
                      ? "이 배포에 Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)가 없습니다. Vercel 환경변수 설정 후 재배포가 필요합니다."
                      : "서버 세션 동기화에 실패했습니다. 잠시 후 다시 시도해 주세요."}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onRetryInsightSession}
                    className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
                  >
                    다시 시도
                  </button>
                  {insightSessionError === "no-session" ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await pbAuthStore.logout();
                        const returnTo = window.location.pathname + window.location.search;
                        router.replace(`/?role=pb&reason=session-expired&returnTo=${encodeURIComponent(returnTo)}`);
                      }}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                    >
                      다시 로그인
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm font-bold text-slate-400">통합 인사이트용 Supabase 세션을 연결하는 중입니다.</p>
            )}
          </section>
        ) : activeTopTab === "insight" ? (
          <BackgroundEngineProvider>
            <div className="project-ui-theme flex flex-col gap-4">
              <IntegratedInsight />
            </div>
          </BackgroundEngineProvider>
        ) : activeTopTab === "elbEls" ? (
          <div className="project-ui-theme">
            <ElbElsSimulator />
          </div>
        ) : (
          <PlaceholderContent label={analysisTopTabs.find((tab) => tab.id === activeTopTab)?.label ?? "선택된 탭"} />
        )}
      </section>
    </CustomerContext.Provider>
  );
}

export default function AnalysisPageClient({ initialTopTab }: { initialTopTab: AnalysisTopTab }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTicker = searchParams.get("ticker");
  const urlName = searchParams.get("name");

  const [customerProfiles, setCustomerProfiles] = useState<CustomerProfile[]>([]);
  const [customerData, setCustomerData] = useState<Record<CustomerId, AppState>>({});
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerId>("");
  const [customerUpdatedAt, setCustomerUpdatedAt] = useState<Record<CustomerId, number>>({});
  const [portfolioAssetsMap, setPortfolioAssetsMap] = useState<Record<CustomerId, PortfolioAsset[]>>({});
  const [analysisResultMap, setAnalysisResultMap] = useState<Record<CustomerId, PortfolioAnalysisResult | null>>({});
  const [storageErrorMessage, setStorageErrorMessage] = useState("");
  const [activeConsultation, setActiveConsultation] = useState<ActiveConsultation | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sharedUiState, setSharedUiState] = useState<SharedMaintabUiState>({ tab2: { activeInnerTab: "peer" }, tab4: { activeInnerTab: "insight" } });
  const [isInsightSessionReady, setIsInsightSessionReady] = useState(false);
  // 통합 인사이트 세션 연결 실패 사유 — null이면 정상/시도중, 값이 있으면 인사이트 탭에만 안내를 띄운다.
  const [insightSessionError, setInsightSessionError] =
    useState<"no-supabase-config" | "no-session" | "sync-failed" | null>(null);
  const [insightRetryTick, setInsightRetryTick] = useState(0);
  const loadedPortfolioRef = useRef(new Set<CustomerId>());

  useEffect(() => {
    let cancelled = false;
    setInsightSessionError(null);
    pbAuthStore.ensureInsightSession()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setIsInsightSessionReady(true);
          setInsightSessionError(null);
          return;
        }

        // PB 로그인 자체가 없으면(로컬 세션도 없음) 로그인 화면으로 보낸다.
        // 그 외(설정 누락·서버 동기화 실패·Supabase 세션 만료)에는 분석실에서 쫓아내지 않는다 —
        // 종목 분석·경쟁사·ELB/ELS 탭은 이 세션이 없어도 동작하고, 통합 인사이트 탭에만 안내를 띄운다.
        // (예전엔 무조건 logout + 로그인 리다이렉트라, Vercel에서 분석실 입장 자체가 막혔다.)
        if (!pbAuthStore.readSession()) {
          const returnTo = window.location.pathname + window.location.search;
          router.replace(`/?role=pb&reason=session-expired&returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }
        setIsInsightSessionReady(false);
        setInsightSessionError(result.reason);
      })
      .catch(() => {
        if (!cancelled) setInsightSessionError("sync-failed");
      });
    return () => { cancelled = true; };
  }, [router, insightRetryTick]);

  // 연결 실패 시 한 번 자동 재시도 (Vercel 콜드스타트 등 일시적 실패 흡수)
  useEffect(() => {
    if (!insightSessionError || insightRetryTick > 0) return;
    const timer = window.setTimeout(() => setInsightRetryTick(1), 2500);
    return () => window.clearTimeout(timer);
  }, [insightSessionError, insightRetryTick]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const session = pbAuthStore.readSession();
      const selectedRows = await customerStorage.selectRows({ pbId: session?.id, pbEmployeeId: session?.employeeId });
      if (cancelled) return;
      if (!selectedRows) {
        setStorageErrorMessage("Supabase 환경변수가 없어 고객 데이터를 불러오지 못했습니다.");
        return;
      }
      if (selectedRows.errorMessage) setStorageErrorMessage(selectedRows.errorMessage);
      if (!selectedRows.rows.length) {
        setCustomerProfiles([]);
        setCustomerData({});
        setSelectedCustomer("");
        setCustomerUpdatedAt({});
        return;
      }
      const storedState = customerRowsToStoredState(selectedRows.rows);
      const storedId = getStoredSelectedCustomerId();
      const nextId = storedId && storedState.customerProfiles.some((profile) => profile.id === storedId) ? storedId : storedState.selectedCustomer;
      setCustomerProfiles(storedState.customerProfiles);
      setCustomerData(storedState.customerData);
      setSelectedCustomer(nextId);
      setCustomerUpdatedAt(customerRowsToUpdatedMap(selectedRows.rows));
      if (nextId) storeSelectedCustomerId(nextId);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const syncActive = () => {
      const active = readActiveConsultation();
      setActiveConsultation(active);
      setElapsedSeconds(getElapsedSeconds(active));
    };
    syncActive();
    window.addEventListener(consultationTimerEventName, syncActive);
    window.addEventListener("storage", syncActive);
    const interval = window.setInterval(syncActive, 1000);
    return () => {
      window.removeEventListener(consultationTimerEventName, syncActive);
      window.removeEventListener("storage", syncActive);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedCustomer || loadedPortfolioRef.current.has(selectedCustomer)) return;
    loadedPortfolioRef.current.add(selectedCustomer);
    let cancelled = false;
    Promise.all([
      loadPortfolioAssets(selectedCustomer),
      loadAnalysisResult(selectedCustomer),
    ]).then(([assets, result]) => {
      if (cancelled) return;
      setPortfolioAssetsMap((prev) => ({ ...prev, [selectedCustomer]: assets }));
      setAnalysisResultMap((prev) => ({
        ...prev,
        [selectedCustomer]: result as PortfolioAnalysisResult | null,
      }));
    }).catch(() => {
      loadedPortfolioRef.current.delete(selectedCustomer);
    });
    return () => { cancelled = true; };
  }, [selectedCustomer]);

  // 고객 전환 또는 분석 결과 변경 시 localStorage 동기화.
  // usePortfolioResult()가 `analysisResult ?? localStorage` 순으로 읽으므로,
  // 선택 고객의 결과가 없을 때 이전 고객 결과가 남아 노출되는 것을 막는다.
  // (MainTabShell이 상담 화면에서 하는 동기화와 동일한 처리)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const result = analysisResultMap[selectedCustomer] ?? null;
    try {
      if (result) {
        localStorage.setItem(PORTFOLIO_RESULT_STORAGE_KEY, JSON.stringify(result));
      } else {
        localStorage.removeItem(PORTFOLIO_RESULT_STORAGE_KEY);
      }
      window.dispatchEvent(new CustomEvent("portfolio-result-updated"));
    } catch {}
  }, [selectedCustomer, analysisResultMap]);

  useEffect(() => {
    if (!selectedCustomer) return;
    let cancelled = false;
    loadSharedMaintabUiState(selectedCustomer).then((state) => {
      if (!cancelled) setSharedUiState({ ...state, tab2: { ...state.tab2, activeInnerTab: "peer" }, tab4: { ...state.tab4, activeInnerTab: "insight" } });
    });
    return () => { cancelled = true; };
  }, [selectedCustomer]);

  const updateSharedUiState = useCallback((patch: SharedMaintabUiState) => {
    setSharedUiState((previous) => {
      const next = {
        ...previous,
        ...patch,
        tab2: patch.tab2 ? { ...previous.tab2, ...patch.tab2 } : previous.tab2,
        tab4: patch.tab4 ? { ...previous.tab4, ...patch.tab4 } : previous.tab4,
      };
      if (selectedCustomer) void saveSharedMaintabUiState(selectedCustomer, next);
      return next;
    });
  }, [selectedCustomer]);

  const fallbackCustomerProfile = useMemo(() => createNewCustomerProfile(), []);
  const selectedCustomerProfile = customerProfiles.find((customer) => customer.id === selectedCustomer) ?? customerProfiles[0];
  const currentCustomerProfile = selectedCustomerProfile ?? fallbackCustomerProfile;
  const formData = deriveCalculatedAppState(customerData[selectedCustomer] ?? customerData[selectedCustomerProfile?.id ?? ""] ?? createInitialState());
  const portfolioAssets = portfolioAssetsMap[selectedCustomer] ?? [];
  const analysisResult = analysisResultMap[selectedCustomer] ?? null;
  const isPortfolioLoading = Boolean(selectedCustomer) && !Object.prototype.hasOwnProperty.call(portfolioAssetsMap, selectedCustomer);
  const assetSummary = useMemo(
    () => buildHeaderAssetSummary(formData.financial, formData.headerAssetSummary, portfolioAssets, null),
    [formData.financial, formData.headerAssetSummary, portfolioAssets],
  );
  const analysisContextValue = useMemo(() => ({
    appMode: "pb",
    formData,
    selectedCustomerProfile: currentCustomerProfile,
    customerProfiles,
    selectedCustomer,
    portfolioAssets,
    isPortfolioLoaded: !isPortfolioLoading,
    analysisResult,
    sharedUiState,
    updateSharedUiState,
  }) as CustomerContextValue, [analysisResult, currentCustomerProfile, customerProfiles, formData, isPortfolioLoading, portfolioAssets, selectedCustomer, sharedUiState, updateSharedUiState]);

  const selectCustomer = (customerId: CustomerId) => {
    setSelectedCustomer(customerId);
    if (customerId) storeSelectedCustomerId(customerId);
  };

  const finishActiveConsultation = () => {
    const active = activeConsultation ?? readActiveConsultation();
    if (!active) return;
    const state = customerData[active.customerId];
    if (!state) return;
    const sessions = getCustomerSessions(state);
    const target = sessions.find((session) => session.id === active.sessionId);
    if (!target) return;
    const nextSession = finishSession(target, elapsedSeconds, false);
    const applyFinish = (current: AppState) =>
      getCustomerSessions(current).map((session) => session.id === nextSession.id ? nextSession : session);
    setCustomerData((prev) => ({ ...prev, [active.customerId]: { ...state, consultationSessions: applyFinish(state) } }));
    // 분석실이 열린 시점의 사본을 통째로 저장하면 그 사이 상담실에서 저장한 AI 상담 가이드·
    // 음성 대화록이 덮여 사라진다 — 최신 행 기준으로 세션 목록만 갱신한다.
    void updateConsultationSessionsOnly(active.customerId, applyFinish).then((result) => {
      if (!result.ok) console.error("Failed to save consultation session", result.message);
    });
    writeActiveConsultation(null);
    setActiveConsultation(null);
    setElapsedSeconds(0);
  };

  return (
    <main className="min-h-screen bg-[#F7F8FC] px-5 py-6 text-ink lg:px-8" style={{ backgroundColor: "#F7F8FC" }}>
      <div className="mx-auto flex max-w-[1680px] flex-col gap-5">
        <HeaderSummary
          currentCustomer={selectedCustomerProfile}
          recentUpdatedAt={customerUpdatedAt[selectedCustomer] ?? 0}
          assetSummary={assetSummary}
          storageErrorMessage={storageErrorMessage}
          activeConsultation={activeConsultation}
          elapsedSeconds={elapsedSeconds}
          mode="pb"
          isPreRecordMode={false}
          onHome={() => router.push("/home")}
          onFinish={finishActiveConsultation}
          onResume={() => router.push(activeConsultation?.returnPath || "/consultation/tab1")}
        />
        <AnalysisTabs
          contextValue={analysisContextValue}
          activeTopTab={initialTopTab}
          urlSelectedStock={urlTicker && urlName ? { ticker: urlTicker, name: urlName } : null}
          onCustomerChange={selectCustomer}
          isInsightSessionReady={isInsightSessionReady}
          insightSessionError={insightSessionError}
          onRetryInsightSession={() => setInsightRetryTick((tick) => tick + 1)}
        />
      </div>
    </main>
  );
}
