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
  saveCustomerDataJsonOnly,
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
  isPortfolioLoading,
  isInsightSessionReady,
}: {
  contextValue: CustomerContextValue;
  activeTopTab: AnalysisTopTab;
  urlSelectedStock: { ticker: string; name: string } | null;
  onCustomerChange: (customerId: CustomerId) => void;
  isPortfolioLoading: boolean;
  isInsightSessionReady: boolean;
}) {
  const router = useRouter();
  const [activeStockTab, setActiveStockTab] = useState<StockAnalysisTab>("technical");
  const [mountedStockTabs, setMountedStockTabs] = useState<Set<StockAnalysisTab>>(new Set(["technical"]));

  // 분석 고객의 보유 주식(분석 결과 + 포트폴리오 자산)을 티커 기준으로 중복 제거
  const stockHoldings = useMemo(() => {
    const merged = [
      ...(contextValue.analysisResult?.enrichedAssets ?? []),
      ...contextValue.portfolioAssets,
    ];
    const seen = new Set<string>();
    return merged.filter((asset) => {
      const ticker = asset.ticker?.trim();
      const assetType = `${asset.productType ?? ""} ${asset.asset_class ?? ""}`;
      if (!ticker || !assetType.includes("주식")) return false;
      const key = ticker.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [contextValue.analysisResult, contextValue.portfolioAssets]);
  const holdingTickerSignature = stockHoldings.map((asset) => asset.ticker).join("|");

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

  // 고객 또는 보유 종목이 바뀌어 현재 선택 종목이 보유 목록에 없으면 첫 보유 종목으로 맞춤
  useEffect(() => {
    if (!stockHoldings.length) return;
    setSharedStock((current) => {
      if (current && stockHoldings.some((asset) => asset.ticker === current.ticker)) return current;
      if (current && urlSelectedStock && current.ticker === urlSelectedStock.ticker) return current;
      const first = stockHoldings[0];
      return { ticker: first.ticker ?? "", name: first.name ?? "" };
    });
  }, [contextValue.selectedCustomer, holdingTickerSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectStockTab = (tab: StockAnalysisTab) => {
    setActiveStockTab(tab);
    setMountedStockTabs((prev) => new Set([...prev, tab]));
  };

  return (
    <CustomerContext.Provider value={contextValue}>
      <section className="flex flex-col gap-4">
        <div className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-soft">
          {analysisTopTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => router.push(tab.path)}
              className={[
                "flex min-h-11 shrink-0 flex-1 items-center justify-center rounded-md px-4 py-2.5 text-sm font-bold transition",
                activeTopTab === tab.id ? "bg-[#2f2f9d] text-white shadow-soft" : "bg-[#F3F5F9] text-slate-600 hover:bg-slate-100 hover:text-navy",
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
              <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.7fr)_minmax(0,2fr)]">
                <label className="space-y-2">
                  <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">분석 고객</span>
                  <select
                    value={contextValue.selectedCustomer}
                    onChange={(event) => onCustomerChange(event.target.value)}
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-[#2f2f9d] focus:ring-2 focus:ring-[#2f2f9d]/15"
                  >
                    {contextValue.customerProfiles.length === 0 ? <option value="">등록된 고객 없음</option> : null}
                    {contextValue.customerProfiles.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name || "이름 미입력"}{customer.birthYear ? ` · ${customer.birthYear}` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">보유 종목</span>
                    <span className="text-xs font-semibold text-slate-400">
                      {isPortfolioLoading ? "불러오는 중..." : `${stockHoldings.length}개`}
                    </span>
                  </div>
                  <div className="flex min-h-11 flex-wrap items-center gap-2">
                    {stockHoldings.map((asset) => {
                      const active = asset.ticker === sharedStock?.ticker;
                      return (
                        <button
                          key={asset.ticker}
                          type="button"
                          onClick={() => setSharedStock({ ticker: asset.ticker ?? "", name: asset.name ?? "" })}
                          className={[
                            "rounded-lg border px-3.5 py-2 text-left text-sm font-bold transition",
                            active
                              ? "border-[#2f2f9d] bg-[#2f2f9d] text-white shadow-sm"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:border-[#2f2f9d]/40 hover:bg-indigo-50",
                          ].join(" ")}
                        >
                          {asset.name}
                          <span className={`ml-1.5 text-[10px] font-medium ${active ? "text-indigo-200" : "text-slate-400"}`}>
                            {asset.ticker}
                          </span>
                        </button>
                      );
                    })}
                    {!isPortfolioLoading && stockHoldings.length === 0 ? (
                      <p className="text-sm font-semibold text-slate-400">분석 가능한 보유 주식이 없습니다.</p>
                    ) : null}
                  </div>
                </div>
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
                    activeStockTab === tab.id ? "bg-[#2f2f9d] text-white shadow-soft" : "bg-[#F3F5F9] text-slate-600 hover:bg-slate-100 hover:text-navy",
                  ].join(" ")}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {mountedStockTabs.has("technical") ? (
              <div className="space-y-5" style={{ display: activeStockTab === "technical" ? undefined : "none" }}>
                <TechnicalAnalysisTab selectedStock={sharedStock} onStockChange={setSharedStock} />
              </div>
            ) : null}
            {mountedStockTabs.has("fundamental") ? (
              <div className="space-y-5" style={{ display: activeStockTab === "fundamental" ? undefined : "none" }}>
                <FundamentalAnalysisTab selectedStock={sharedStock} onStockChange={setSharedStock} />
              </div>
            ) : null}
            {mountedStockTabs.has("dart") ? (
              <div className="space-y-5" style={{ display: activeStockTab === "dart" ? undefined : "none" }}>
                <DartAnalysisTab selectedStock={sharedStock} onStockChange={setSharedStock} />
              </div>
            ) : null}
          </div>
        ) : activeTopTab === "competitors" ? (
          <div className="project-ui-theme">
            <PeerAnalysisTab />
          </div>
        ) : activeTopTab === "insight" && !isInsightSessionReady ? (
          <section className="min-h-[320px] rounded-lg border border-slate-200 bg-white p-6 text-sm font-bold text-slate-400 shadow-soft">
            통합 인사이트용 Supabase 세션을 연결하는 중입니다.
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
          <PlaceholderContent label={analysisTopTabs.find((tab) => tab.id === activeTopTab)?.label ?? "선택한 탭"} />
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
  const loadedPortfolioRef = useRef(new Set<CustomerId>());

  useEffect(() => {
    let cancelled = false;
    pbAuthStore.ensureInsightSession()
      .catch(() => false)
      .finally(() => {
        if (!cancelled) setIsInsightSessionReady(true);
      });
    return () => { cancelled = true; };
  }, []);

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
    const nextState = {
      ...state,
      consultationSessions: sessions.map((session) => session.id === nextSession.id ? nextSession : session),
    };
    setCustomerData((prev) => ({ ...prev, [active.customerId]: nextState }));
    saveCustomerDataJsonOnly(active.customerId, nextState).catch((error) => console.error("Failed to save consultation session", error));
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
          isPortfolioLoading={isPortfolioLoading}
          isInsightSessionReady={isInsightSessionReady}
        />
      </div>
    </main>
  );
}
