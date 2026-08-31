"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildHeaderAssetSummary, HeaderSummary } from "../maintab/MainTabShell";
import TechnicalAnalysisTab from "../maintab/tab2/TechnicalAnalysisTab";
import FundamentalAnalysisTab from "../maintab/tab2/FundamentalAnalysisTab";
import DartAnalysisTab from "../maintab/tab2/DartAnalysisTab";
import {
  CustomerContext,
  customerRowsToStoredState,
  customerRowsToUpdatedMap,
  customerStorage,
  createInitialState,
  createNewCustomerProfile,
  deriveCalculatedAppState,
  getStoredSelectedCustomerId,
  loadPortfolioAssets,
  saveCustomerDataJsonOnly,
  storeSelectedCustomerId,
  type AppState,
  type CustomerContextValue,
  type CustomerId,
  type CustomerProfile,
  type PortfolioAsset,
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

export type AnalysisTopTab = "stock" | "screener" | "competitors" | "insight" | "elbEls";
type StockAnalysisTab = "technical" | "fundamental" | "dart";

export const analysisTabSegments = ["tab1", "tab2", "tab3", "tab4", "tab5"] as const;

export type AnalysisTabSegment = (typeof analysisTabSegments)[number];

const analysisTopTabs: { id: AnalysisTopTab; label: string; path: `/analysis/${AnalysisTabSegment}` }[] = [
  { id: "stock", label: "종목 분석", path: "/analysis/tab1" },
  { id: "screener", label: "종목 보조지표 스크리너", path: "/analysis/tab2" },
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

function AnalysisTabs({ contextValue, activeTopTab }: { contextValue: CustomerContextValue; activeTopTab: AnalysisTopTab }) {
  const router = useRouter();
  const [activeStockTab, setActiveStockTab] = useState<StockAnalysisTab>("technical");
  const [mountedStockTabs, setMountedStockTabs] = useState<Set<StockAnalysisTab>>(new Set(["technical"]));

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

        {activeTopTab === "stock" ? (
          <div className="flex flex-col gap-4">
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
                <TechnicalAnalysisTab />
              </div>
            ) : null}
            {mountedStockTabs.has("fundamental") ? (
              <div className="space-y-5" style={{ display: activeStockTab === "fundamental" ? undefined : "none" }}>
                <FundamentalAnalysisTab />
              </div>
            ) : null}
            {mountedStockTabs.has("dart") ? (
              <div className="space-y-5" style={{ display: activeStockTab === "dart" ? undefined : "none" }}>
                <DartAnalysisTab />
              </div>
            ) : null}
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
  const [customerProfiles, setCustomerProfiles] = useState<CustomerProfile[]>([]);
  const [customerData, setCustomerData] = useState<Record<CustomerId, AppState>>({});
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerId>("");
  const [customerUpdatedAt, setCustomerUpdatedAt] = useState<Record<CustomerId, number>>({});
  const [portfolioAssetsMap, setPortfolioAssetsMap] = useState<Record<CustomerId, PortfolioAsset[]>>({});
  const [storageErrorMessage, setStorageErrorMessage] = useState("");
  const [activeConsultation, setActiveConsultation] = useState<ActiveConsultation | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const loadedPortfolioRef = useRef(new Set<CustomerId>());

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
    loadPortfolioAssets(selectedCustomer).then((assets) => {
      if (!cancelled) setPortfolioAssetsMap((prev) => ({ ...prev, [selectedCustomer]: assets }));
    }).catch(() => {
      loadedPortfolioRef.current.delete(selectedCustomer);
    });
    return () => { cancelled = true; };
  }, [selectedCustomer]);

  const fallbackCustomerProfile = useMemo(() => createNewCustomerProfile(), []);
  const selectedCustomerProfile = customerProfiles.find((customer) => customer.id === selectedCustomer) ?? customerProfiles[0];
  const currentCustomerProfile = selectedCustomerProfile ?? fallbackCustomerProfile;
  const formData = deriveCalculatedAppState(customerData[selectedCustomer] ?? customerData[selectedCustomerProfile?.id ?? ""] ?? createInitialState());
  const portfolioAssets = portfolioAssetsMap[selectedCustomer] ?? [];
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
  }) as CustomerContextValue, [currentCustomerProfile, customerProfiles, formData, portfolioAssets, selectedCustomer]);

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
        <AnalysisTabs contextValue={analysisContextValue} activeTopTab={initialTopTab} />
      </div>
    </main>
  );
}
