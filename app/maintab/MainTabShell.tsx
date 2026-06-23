"use client";

import { type DragEvent, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { Home, Trash2 } from "lucide-react";
import {
  CustomerContext,
  type AppState, type ChangeEntry, type CustomerId, type CustomerProfile, type CustomerRow,
  type CustomerUpdatedMap, type FinancialInfo, type HeaderAssetSummaryState, type PortfolioAnalysisResult,
  type PortfolioAsset, type RiskResult, type RrttlluInfo, type Tab3AnalysisState,
  type SmartExtractionPayload, type StoredAdvisoryGuide, type StoredCustomerState,
  type SellRecord, type ConfirmedPairItem, type PbOrderRow, type BuySimTickerItem,
  buildStructuredJsonPayload, calculateRiskResult,
  completion, customerRowsToStoredState, customerRowsToUpdatedMap, customerStorage,
  customerTabLabel, defaultCustomerProfiles, createInitialCustomerData, createInitialState, deriveCalculatedAppState,
  createNewCustomerProfile, EMPTY_PORTFOLIO_ASSET, expectedReturnDisplay, fieldGroups,
  formatChangeDate, formatUpdatedAt, getStoredSelectedCustomerId, irregularIncomeDisplay,
  loadAnalysisResult, loadPortfolioAssets, savePortfolioAssets,
  loadRebalancingState, saveRebalancingState, saveRebalancingBuyAssets,
  loadSellHistory, saveSellHistory,
  loadNewAnalysisResult, saveNewAnalysisResult,
  loadTaxSummaries, saveTaxSummaryToDb,
  loadProductSelections, saveProductSelections,
  loadTab3AnalysisState, saveTab3AnalysisState,
  noLegalConstraint, noneExperience, nullableText, parseKrwAmount, riskExperienceOptions,
  returnOptions, saveCustomerDataJsonOnly, saveCustomerProfileColumns,
  selectedCustomerStorageKey, storeSelectedCustomerId, workspaceTabs,
  supabase,
} from "./CustomerContext";
import { FINANCIAL_INCOME_STORAGE_KEY, NEW_PORTFOLIO_INCOME_STORAGE_KEY } from "./tab1/FinancialIncomeGauge";
import { CustomerViewContext, CONSULTATION_ENDED_STORAGE_KEY } from "./CustomerViewContext";
import { formatLiquiditySummary, normalizeLiquidityValue } from "./liquidityFields";
import {
  consultationTimerEventName,
  finishSession,
  formatTimer,
  getCustomerSessions,
  getElapsedSeconds,
  maxConsultationSeconds,
  readActiveConsultation,
  readCompletedConsultation,
  writeActiveConsultation,
  writeCompletedConsultation,
  type ActiveConsultation,
  type CompletedConsultation,
} from "../consultationStore";

const PORTFOLIO_RESULT_STORAGE_KEY = "portfolio-result-v1";

const pbTabPaths: Record<string, string> = {
  profile:   "/maintab/tab1",
  existing:  "/maintab/tab2",
  create:    "/maintab/tab3",
  compare:   "/maintab/tab4",
  recommend: "/maintab/tab5",
};

const customerTabPaths: Record<string, string> = {
  profile:   "/customer-maintab/tab1",
  existing:  "/customer-maintab/tab2",
  create:    "/customer-maintab/tab3",
  compare:   "/customer-maintab/tab4",
  recommend: "/customer-maintab/tab5",
};

function toFiniteNumber(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function portfolioCurrentValue(asset: PortfolioAsset) {
  const currentValue = toFiniteNumber(asset.current_value);
  if (currentValue > 0) return currentValue;
  const amount = toFiniteNumber(asset.amount);
  if (asset.amount_type === "value") return amount;
  // 채권은 현재가가 없으므로 매수단가로 평가
  const isBond = asset.productType === '국내채권' || asset.productType === '해외채권';
  const price = isBond ? toFiniteNumber(asset.buy_price) : toFiniteNumber(asset.current_price);
  return amount * price;
}

function portfolioBuyCost(asset: PortfolioAsset) {
  const amount = toFiniteNumber(asset.amount);
  if (asset.amount_type === "value") return amount;
  return amount * toFiniteNumber(asset.buy_price);
}

function sumPortfolioCurrentValue(assets: PortfolioAsset[]) {
  return assets.reduce((sum, asset) => sum + portfolioCurrentValue(asset), 0);
}

function sumPortfolioBuyCost(assets: PortfolioAsset[]) {
  return assets.reduce((sum, asset) => sum + portfolioBuyCost(asset), 0);
}

function formatHeaderKrw(value: number) {
  if (!Number.isFinite(value)) return "0억";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 100000000) {
    const eok = abs / 100000000;
    return `${sign}${Number.isInteger(eok) ? eok.toFixed(0) : eok.toFixed(1)}억`;
  }
  if (abs >= 10000) {
    const man = abs / 10000;
    return `${sign}${Number.isInteger(man) ? man.toFixed(0) : man.toFixed(0)}만`;
  }
  return `${sign}${Math.round(abs).toLocaleString("ko-KR")}원`;
}

function buildHeaderAssetSummary(financial: FinancialInfo, summary: HeaderAssetSummaryState, assets: PortfolioAsset[]) {
  // 추가 투자 의향 = TAB 1 입력 원본 b 값 (기획서 수식 b = financial.investableAssets)
  // 매도/매수 시뮬레이션 단계와 무관하게 고정 — 파생 잔여액(b+(a-d))이 아닌 고객 선언값을 표시
  const baseAdditionalAssets = parseKrwAmount(financial.investableAssets) ?? 0;
  const additionalAssets = formatHeaderKrw(baseAdditionalAssets);

  // 운용 자산 = 최신 확정 단계 값 우선 (매수 완료 > 매도 완료 > 현재 평가액)
  const operatingAssets = formatHeaderKrw(
    summary.confirmedOperatingAssetsAfterBuy ??
    summary.confirmedOperatingAssetsAfterSell ??
    sumPortfolioCurrentValue(assets),
  );

  return { operatingAssets, additionalAssets };
}

function buildConsultationSummarySnapshot(state: AppState) {
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


export default function MainTabShell({ children, appMode = "pb" }: { children: React.ReactNode; appMode?: "pb" | "customer" }) {
  const router = useRouter();
  const tabPaths = appMode === "customer" ? customerTabPaths : pbTabPaths;

  const currentSegment = useSelectedLayoutSegment();

  const [customerProfiles, setCustomerProfiles] = useState<CustomerProfile[]>(defaultCustomerProfiles);
  const [customerData, setCustomerData] = useState<Record<CustomerId, AppState>>(() => createInitialCustomerData(defaultCustomerProfiles));
  // ── SSR 안전 초기값: 서버·클라이언트 모두 동일한 기본 고객 ID로 시작 ─────────
  // 레이지 이니셜라이저 내부에서 localStorage를 참조하면 SSR HTML과 클라이언트
  // 첫 렌더 값이 달라 Hydration failed 에러가 발생한다.
  // 실제 복원은 마운트 후 useEffect(isMounted 플래그)에서 안전하게 처리한다.
  const [isMounted, setIsMounted] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerId>(defaultCustomerProfiles[0].id);
  const [activeConsultation, setActiveConsultation] = useState<ActiveConsultation | null>(null);
  const [activeConsultationElapsedSeconds, setActiveConsultationElapsedSeconds] = useState(0);
  const [completedConsultation, setCompletedConsultation] = useState<CompletedConsultation | null>(null);
  const [editLockDialogOpen, setEditLockDialogOpen] = useState(false);
  const [showCustomerTabs, setShowCustomerTabs] = useState(false);
  const [draggedCustomerId, setDraggedCustomerId] = useState<CustomerId | null>(null);
  const [customerDropIndex, setCustomerDropIndex] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [persistedCustomerIds, setPersistedCustomerIds] = useState<CustomerId[]>([]);
  const [customerUpdatedAt, setCustomerUpdatedAt] = useState<CustomerUpdatedMap>({});
  const [dirtyCustomerData, setDirtyCustomerData] = useState<Record<CustomerId, boolean>>({});
  const [storageErrorMessage, setStorageErrorMessage] = useState("");
  const [analysisRequested, setAnalysisRequested] = useState(false);
  const [confirmedRiskResult, setConfirmedRiskResult] = useState<RiskResult | null>(null);
  const [lastAnalysisSnapshot, setLastAnalysisSnapshot] = useState<ReturnType<typeof buildStructuredJsonPayload> | null>(null);
  const [changeHistory, setChangeHistory] = useState<ChangeEntry[]>([]);
  const [changeHistoryExpanded, setChangeHistoryExpanded] = useState(false);
  const isCustomerView = appMode === "customer";
  const [consultationEnded, setConsultationEnded] = useState(false);
  const formData = deriveCalculatedAppState(customerData[selectedCustomer] ?? createInitialState());
  const selectedConsultationSessions = getCustomerSessions(formData);
  const latestConsultationSession = [...selectedConsultationSessions].sort((a, b) => `${b.updatedAt}${b.date}`.localeCompare(`${a.updatedAt}${a.date}`))[0] ?? null;
  const activeConsultationForSelected = activeConsultation?.customerId === selectedCustomer ? activeConsultation : null;
  const completedConsultationForSelected = completedConsultation?.customerId === selectedCustomer ? completedConsultation : null;
  const isConsultationReadOnly = !activeConsultationForSelected && (
    latestConsultationSession?.status === "completed" ||
    Boolean(completedConsultationForSelected)
  );
  const displayedConsultationElapsedSeconds = activeConsultation
    ? activeConsultationElapsedSeconds
    : completedConsultationForSelected
      ? completedConsultationForSelected.elapsedSeconds
    : latestConsultationSession?.status === "completed"
      ? latestConsultationSession.durationSeconds ?? 0
      : activeConsultationElapsedSeconds;

  // ── 포트폴리오 전역 상태 — Tab 1의 customerData Map 패턴과 동일 구조 ──────
  // Map keyed by customerId: 고객 전환 시 절대 삭제하지 않음 (읽는 key만 변경)
  const [portfolioAssetsMap, setPortfolioAssetsMap] = useState<Record<CustomerId, PortfolioAsset[]>>({});
  const [portfolioLoadedMap, setPortfolioLoadedMap] = useState<Record<CustomerId, boolean>>({});
  const [dirtyPortfolioMap, setDirtyPortfolioMap] = useState<Record<CustomerId, boolean>>({});
  const [analysisResultMap, setAnalysisResultMap] = useState<Record<CustomerId, PortfolioAnalysisResult | null>>({});
  const portfolioLoadedRef = useRef(new Set<CustomerId>()); // 중복 로드 방지 (렌더 독립적)

  // ── 리밸런싱 파이프라인 상태 Maps (고객별 격리) ────────────────────────────
  const [rebalancingSellMap, setRebalancingSellMap] = useState<Record<CustomerId, PortfolioAsset[]>>({});
  const [rebalancingBuyMap, setRebalancingBuyMap] = useState<Record<CustomerId, PortfolioAsset[]>>({});
  const [newPortfolioAnalysisResultMap, setNewPortfolioAnalysisResultMap] = useState<Record<CustomerId, PortfolioAnalysisResult | null>>({});
  const [rebalancingLoadedMap, setRebalancingLoadedMap] = useState<Record<CustomerId, boolean>>({});
  const [rebalancingDirtyMap, setRebalancingDirtyMap] = useState<Record<CustomerId, boolean>>({});
  const [tab3AnalysisStateMap, setTab3AnalysisStateMap] = useState<Record<CustomerId, Tab3AnalysisState>>({});

  // ── Tab 5 상품 선택 Maps (고객별 격리) ───────────────────────────────────
  const [productSelectionsMap, setProductSelectionsMap] = useState<Record<CustomerId, string[]>>({});
  const [productSelectionsLoadedMap, setProductSelectionsLoadedMap] = useState<Record<CustomerId, boolean>>({});
  const [productSelectionsDirtyMap, setProductSelectionsDirtyMap] = useState<Record<CustomerId, boolean>>({});

  // ── TAB2-5 매도 시뮬레이터 이력 Maps (고객별 격리, Supabase 영속) ──────────
  const [sellHistoryMap, setSellHistoryMap] = useState<Record<CustomerId, SellRecord[]>>({});
  const [sellHistoryDirtyMap, setSellHistoryDirtyMap] = useState<Record<CustomerId, boolean>>({});

  // ── TAB 3-1/3-2 확정 조합 Maps (고객별 격리, 탭 전환 보존) ──────────────────
  const [confirmedDomesticPairMap, setConfirmedDomesticPairMap] = useState<Record<CustomerId, ConfirmedPairItem[]>>({});
  const [confirmedGlobalPairMap, setConfirmedGlobalPairMap] = useState<Record<CustomerId, ConfirmedPairItem[]>>({});
  // ── TAB 3-3 투자금 조정 테이블 영속 Maps (고객별 격리, 탭 전환 보존) ──────────
  const [buySimPersistedStateMap, setBuySimPersistedStateMap] = useState<
    Record<CustomerId, { items: BuySimTickerItem[]; sig: string }>
  >({});
  // ── TAB 3-3 PB 직접 매수 주문 Maps (고객별 격리, 탭 전환 보존) ───────────────
  const [pbOrderRowsMap, setPbOrderRowsMap] = useState<Record<CustomerId, PbOrderRow[]>>({});

  // ── 원자적 읽기용 Ref — async 콜백 / 비동기 파이프라인에서 stale closure 없이 최신 상태 참조
  // React 상태 업데이트는 배치 처리되어 다음 렌더까지 pending 상태이므로,
  // 매 렌더에서 .current를 동기 갱신하면 항상 최신 커밋 값을 보장한다.
  const portfolioAssetsMapRef = useRef<Record<CustomerId, PortfolioAsset[]>>({});
  const rebalancingSellMapRef = useRef<Record<CustomerId, PortfolioAsset[]>>({});
  const rebalancingBuyMapRef = useRef<Record<CustomerId, PortfolioAsset[]>>({});
  const tab3AnalysisStateMapRef = useRef<Record<CustomerId, Tab3AnalysisState>>({});
  const sellHistoryMapRef = useRef<Record<CustomerId, SellRecord[]>>({});
  const selectedCustomerRef = useRef<CustomerId>(selectedCustomer);
  const isConsultationReadOnlyRef = useRef(false);

  // 파생값 — 공개 인터페이스는 Tab 1의 formData/riskResult 패턴과 동일
  const portfolioAssets = portfolioAssetsMap[selectedCustomer] ?? [];
  const isPortfolioLoaded = portfolioLoadedMap[selectedCustomer] ?? false;
  const analysisResult = analysisResultMap[selectedCustomer] ?? null;
  const rebalancingSellAssets = rebalancingSellMap[selectedCustomer] ?? [];
  const rebalancingBuyAssets = rebalancingBuyMap[selectedCustomer] ?? [];
  const newPortfolioAnalysisResult = newPortfolioAnalysisResultMap[selectedCustomer] ?? null;
  const tab3AnalysisState = tab3AnalysisStateMap[selectedCustomer] ?? {};
  const productSelectedIds = productSelectionsMap[selectedCustomer] ?? [];
  const sellHistory = sellHistoryMap[selectedCustomer] ?? [];
  const confirmedDomesticPair = confirmedDomesticPairMap[selectedCustomer] ?? null;
  const confirmedGlobalPair = confirmedGlobalPairMap[selectedCustomer] ?? null;
  const buySimTickerItems = buySimPersistedStateMap[selectedCustomer]?.items ?? [];
  const buySimConfirmedSig = buySimPersistedStateMap[selectedCustomer]?.sig ?? '';
  const pbOrderRows = pbOrderRowsMap[selectedCustomer] ?? [];

  // Ref 동기화 — 렌더마다 최신 커밋 값 기록 (useEffect 없이 동기 할당)
  // 이를 통해 async 콜백이 stale 클로저 없이 항상 최신 상태를 읽을 수 있다
  portfolioAssetsMapRef.current = portfolioAssetsMap;
  rebalancingSellMapRef.current = rebalancingSellMap;
  rebalancingBuyMapRef.current = rebalancingBuyMap;
  tab3AnalysisStateMapRef.current = tab3AnalysisStateMap;
  sellHistoryMapRef.current = sellHistoryMap;
  selectedCustomerRef.current = selectedCustomer;
  isConsultationReadOnlyRef.current = isConsultationReadOnly;

  const selectedCustomerProfile = customerProfiles.find((c) => c.id === selectedCustomer) ?? customerProfiles[0];

  const finishActiveConsultation = useCallback((autoEnded = false) => {
    const active = activeConsultation ?? readActiveConsultation();
    if (!active) return;
    const seconds = autoEnded ? maxConsultationSeconds : getElapsedSeconds(active);
    const state = customerData[active.customerId] ?? createInitialState();
    const sessions = getCustomerSessions(state);
    if (!sessions.some((session) => session.id === active.sessionId)) {
      writeActiveConsultation(null);
      setActiveConsultation(null);
      setActiveConsultationElapsedSeconds(0);
      return;
    }
    const snapshot = buildConsultationSummarySnapshot(state);
    const nextSessions = sessions.map((session) => session.id === active.sessionId ? { ...finishSession(session, seconds, autoEnded), summarySnapshot: snapshot } : session);
    const nextState = deriveCalculatedAppState({ ...state, consultationSessions: nextSessions });
    setCustomerData((prev) => ({ ...prev, [active.customerId]: nextState }));
    saveCustomerDataJsonOnly(active.customerId, nextState).catch((error) => console.error("Failed to save consultation duration", error));
    const completed = {
      sessionId: active.sessionId,
      customerId: active.customerId,
      elapsedSeconds: seconds,
      completedAt: new Date().toISOString(),
    };
    writeCompletedConsultation(completed);
    setCompletedConsultation(completed);
    writeActiveConsultation(null);
    window.localStorage.setItem(CONSULTATION_ENDED_STORAGE_KEY, "1");
    setConsultationEnded(true);
    setActiveConsultation(null);
    setActiveConsultationElapsedSeconds(seconds);
  }, [activeConsultation, customerData]);

  const resumeLatestConsultation = useCallback(() => {
    const state = customerData[selectedCustomer] ?? createInitialState();
    const sessions = getCustomerSessions(state);
    const target = [...sessions].sort((a, b) => `${b.updatedAt}${b.date}`.localeCompare(`${a.updatedAt}${a.date}`))[0];
    if (!target) return;
    const resumed = { ...target, status: "active" as const, updatedAt: new Date().toISOString() };
    const nextSessions = sessions.map((session) => session.id === target.id ? resumed : session);
    const nextState = deriveCalculatedAppState({ ...state, consultationSessions: nextSessions });
    setCustomerData((prev) => ({ ...prev, [selectedCustomer]: nextState }));
    saveCustomerDataJsonOnly(selectedCustomer, nextState).catch((error) => console.error("Failed to resume consultation", error));
    storeSelectedCustomerId(selectedCustomer);
    const resumedElapsedSeconds = Math.max(0, Math.min(maxConsultationSeconds, target.durationSeconds ?? 0));
    const resumedActive = {
      sessionId: target.id,
      customerId: selectedCustomer,
      startedAt: new Date(Date.now() - resumedElapsedSeconds * 1000).toISOString(),
      returnPath: `/maintab/${currentSegment ?? "tab1"}`,
    };
    window.localStorage.removeItem(CONSULTATION_ENDED_STORAGE_KEY);
    setConsultationEnded(false);
    writeCompletedConsultation(null);
    setCompletedConsultation(null);
    writeActiveConsultation(resumedActive);
    setActiveConsultation(resumedActive);
    setActiveConsultationElapsedSeconds(resumedElapsedSeconds);
  }, [customerData, currentSegment, selectedCustomer]);

  const requestConsultationResume = useCallback(() => {
    setEditLockDialogOpen(true);
  }, []);

  const canEditConsultation = useCallback(() => {
    if (!isConsultationReadOnlyRef.current) return true;
    setEditLockDialogOpen(true);
    return false;
  }, []);

  useEffect(() => {
    const syncActive = () => {
      const active = readActiveConsultation();
      const completed = readCompletedConsultation();
      setActiveConsultation(active);
      setCompletedConsultation(completed);
      setActiveConsultationElapsedSeconds(getElapsedSeconds(active));
    };
    syncActive();
    window.addEventListener(consultationTimerEventName, syncActive);
    window.addEventListener("storage", syncActive);
    return () => {
      window.removeEventListener(consultationTimerEventName, syncActive);
      window.removeEventListener("storage", syncActive);
    };
  }, []);

  useEffect(() => {
    const syncEnded = () => {
      setConsultationEnded(!!window.localStorage.getItem(CONSULTATION_ENDED_STORAGE_KEY));
    };
    syncEnded();
    window.addEventListener("storage", syncEnded);
    return () => window.removeEventListener("storage", syncEnded);
  }, []);

  // ── Supabase Realtime 실시간 동기화 (고객 뷰 전용) ──────────────────────────
  useEffect(() => {
    if (appMode !== "customer" || !supabase) return;

    // 포트폴리오·리밸런싱 데이터 재로드 (세금 요약 제외 — tax_summaries 별도 구독)
    const reloadRebalancingForCustomer = (customerId: CustomerId) => {
      Promise.all([
        loadPortfolioAssets(customerId),
        loadRebalancingState(customerId),
        loadNewAnalysisResult(customerId),
        loadTab3AnalysisState(customerId),
        loadSellHistory(customerId),
      ]).then(([assets, rebalancing, newResult, tab3State, sellHistoryRows]) => {
        setPortfolioAssetsMap(prev => ({ ...prev, [customerId]: assets }));
        setRebalancingSellMap(prev => ({ ...prev, [customerId]: rebalancing.sellAssets }));
        setRebalancingBuyMap(prev => ({ ...prev, [customerId]: rebalancing.buyAssets }));
        setNewPortfolioAnalysisResultMap(prev => ({ ...prev, [customerId]: newResult as PortfolioAnalysisResult | null }));
        setTab3AnalysisStateMap(prev => ({ ...prev, [customerId]: tab3State }));
        setSellHistoryMap(prev => ({ ...prev, [customerId]: sellHistoryRows }));
        if (typeof window !== "undefined") {
          const buyAssets = rebalancing.buyAssets as unknown[];
          try {
            if (buyAssets?.length > 0) localStorage.setItem("new-portfolio-assets-v1", JSON.stringify(buyAssets));
            else localStorage.removeItem("new-portfolio-assets-v1");
          } catch {}
        }
      });
    };

    // 세금 요약 재로드 → localStorage 갱신 → CustomEvent → Tab4 자동 반영
    // 탭2-1 "분석 실행" 또는 탭3-3 "리밸런싱 확정" 후 tax_summaries 저장 완료 시점에만 실행
    const reloadTaxForCustomer = (customerId: CustomerId) => {
      loadTaxSummaries(customerId).then(({ currentSummary, newSummary }) => {
        if (typeof window === "undefined") return;
        if (currentSummary) {
          try { localStorage.setItem(FINANCIAL_INCOME_STORAGE_KEY, JSON.stringify(currentSummary)); window.dispatchEvent(new CustomEvent("financial-income-updated")); } catch {}
        } else {
          try { localStorage.removeItem(FINANCIAL_INCOME_STORAGE_KEY); window.dispatchEvent(new CustomEvent("financial-income-updated")); } catch {}
        }
        if (newSummary) {
          try { localStorage.setItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY, JSON.stringify(newSummary)); window.dispatchEvent(new CustomEvent("new-financial-income-updated")); } catch {}
        } else {
          try { localStorage.removeItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY); window.dispatchEvent(new CustomEvent("new-financial-income-updated")); } catch {}
        }
      });
    };

    const getCustomerId = (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) =>
      ((payload.new ?? payload.old)?.customer_id) as CustomerId | undefined;

    const channel = supabase
      .channel("customer-view-realtime")
      .on(
        "postgres_changes" as any,
        { event: "UPDATE", schema: "public", table: "customers" },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new as CustomerRow;
          if (!row.id) return;
          const customerId = row.id as CustomerId;
          const singleState = customerRowsToStoredState([row]);
          if (singleState.customerProfiles.length > 0) {
            setCustomerProfiles(prev => prev.map(p => p.id === customerId ? singleState.customerProfiles[0] : p));
            setCustomerData(prev => ({ ...prev, [customerId]: singleState.customerData[customerId] }));
            setCustomerUpdatedAt(prev => ({
              ...prev,
              [customerId]: row.updated_at ? new Date(row.updated_at as string).getTime() : Date.now(),
            }));
          }
        },
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "rebalancing_state" },
        (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          const cid = getCustomerId(payload);
          if (cid) reloadRebalancingForCustomer(cid);
        },
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "new_analysis_results" },
        (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          const cid = getCustomerId(payload);
          if (cid) reloadRebalancingForCustomer(cid);
        },
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "tax_summaries" },
        (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          const cid = getCustomerId(payload);
          if (cid) reloadTaxForCustomer(cid);
        },
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "product_selections" },
        (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          const cid = getCustomerId(payload);
          if (!cid) return;
          loadProductSelections(cid).then(productIds => {
            setProductSelectionsMap(prev => ({ ...prev, [cid]: productIds }));
          });
        },
      )
      .subscribe();

    return () => { supabase!.removeChannel(channel); };
  }, [appMode]);

  useEffect(() => {
    if (!activeConsultation) return;
    const tick = () => {
      const elapsed = getElapsedSeconds(activeConsultation);
      setActiveConsultationElapsedSeconds(elapsed);
      if (elapsed >= maxConsultationSeconds) finishActiveConsultation(true);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [activeConsultation, finishActiveConsultation]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const selectedRows = await customerStorage.selectRows();
      if (cancelled) return;
      if (!selectedRows) { setStorageErrorMessage("Supabase 환경변수가 설정되지 않아 고객 데이터를 불러올 수 없습니다."); setStorageReady(true); return; }
      if (selectedRows.errorMessage) {
        setStorageErrorMessage(selectedRows.errorMessage);
        setCustomerProfiles(defaultCustomerProfiles);
        setCustomerData(createInitialCustomerData(defaultCustomerProfiles));
        setSelectedCustomer(defaultCustomerProfiles[0].id);
        setStorageReady(true);
        return;
      }
      let rows = selectedRows.rows;
      if (!rows.length) {
        setIsSeeding(true);
        const defaultState: StoredCustomerState = { customerProfiles: defaultCustomerProfiles, customerData: createInitialCustomerData(defaultCustomerProfiles), selectedCustomer: defaultCustomerProfiles[0].id };
        const seedResult = await customerStorage.insertDefaults(defaultState);
        if (cancelled) return;
        if (!seedResult.ok) { setStorageErrorMessage(seedResult.message); setIsSeeding(false); setStorageReady(true); return; }
        const seededRows = await customerStorage.selectRows();
        if (cancelled) return;
        if (!seededRows || seededRows.errorMessage) { setStorageErrorMessage(seededRows?.errorMessage ?? "재조회 실패"); setIsSeeding(false); setStorageReady(true); return; }
        rows = seededRows.rows;
      }
      const storedState = rows.length ? customerRowsToStoredState(rows) : null;
      if (storedState) {
        const storedId = getStoredSelectedCustomerId();
        const nextId = storedId && storedState.customerProfiles.some((p) => p.id === storedId) ? storedId : storedState.selectedCustomer;
        setCustomerProfiles(storedState.customerProfiles);
        setCustomerData(storedState.customerData);
        setSelectedCustomer(nextId);
        storeSelectedCustomerId(nextId);
        setPersistedCustomerIds(rows.map((r) => r.id));
        setCustomerUpdatedAt(customerRowsToUpdatedMap(rows));
      }
      setIsSeeding(false);
      setStorageErrorMessage("");
      setStorageReady(true);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── [마운트 후 localStorage 복원] 하이드레이션 안전 파이프라인 ────────────────
  // 선언 순서가 포트폴리오 로드 useEffect보다 앞에 있어야 한다:
  //   이 effect → isMounted = true + selectedCustomer = storedId (setState 예약)
  //   포트폴리오 로드 effect → isMounted = false 감지 → 즉시 return (스킵)
  //   React 배치 후 리렌더 → isMounted = true, selectedCustomer = storedId 확정
  //   포트폴리오 로드 effect 재실행 → 올바른 고객 ID로 DB 로드 시작
  useEffect(() => {
    setIsMounted(true);
    const storedId = getStoredSelectedCustomerId();
    if (storedId) setSelectedCustomer(storedId);
  }, []); // mount only — deps 없음, localStorage는 이 안에서만 접근

  // ── 고객 전환 시 포트폴리오 1회 레이지 로드 — Tab 1의 초기 load()와 동일 구조
  // Map에 영구 보관하므로 고객 전환 시 데이터를 절대 삭제하지 않는다
  useEffect(() => {
    if (!isMounted) return; // 마운트 전 스킵 — localStorage 복원(setSelectedCustomer) 대기
    const customerId = selectedCustomer;
    if (portfolioLoadedRef.current.has(customerId)) return; // 이미 로드됨 — 스킵
    portfolioLoadedRef.current.add(customerId); // 중복 로드 방지 선점
    let cancelled = false;

    Promise.all([
      loadPortfolioAssets(customerId),
      loadAnalysisResult(customerId),
      loadRebalancingState(customerId),
      loadNewAnalysisResult(customerId),
      loadTab3AnalysisState(customerId),
      loadTaxSummaries(customerId),
      loadProductSelections(customerId),
      loadSellHistory(customerId),
    ]).then(([assets, result, rebalancing, newResult, tab3State, taxSummaries, productIds, sellHistoryRows]) => {
      if (cancelled) {
        portfolioLoadedRef.current.delete(customerId); // 취소 시 재시도 가능하도록 반환
        return;
      }
      setPortfolioAssetsMap(prev => ({ ...prev, [customerId]: assets }));
      setAnalysisResultMap(prev => ({ ...prev, [customerId]: result as PortfolioAnalysisResult | null }));
      setPortfolioLoadedMap(prev => ({ ...prev, [customerId]: true }));

      setRebalancingSellMap(prev => ({ ...prev, [customerId]: rebalancing.sellAssets }));
      setRebalancingBuyMap(prev => ({ ...prev, [customerId]: rebalancing.buyAssets }));
      setNewPortfolioAnalysisResultMap(prev => ({ ...prev, [customerId]: newResult as PortfolioAnalysisResult | null }));
      setTab3AnalysisStateMap(prev => ({ ...prev, [customerId]: tab3State }));
      setRebalancingLoadedMap(prev => ({ ...prev, [customerId]: true }));

      setSellHistoryMap(prev => ({ ...prev, [customerId]: sellHistoryRows }));

      setProductSelectionsMap(prev => ({ ...prev, [customerId]: productIds }));
      setProductSelectionsLoadedMap(prev => ({ ...prev, [customerId]: true }));

      // 세금 요약 + 신규 포트폴리오 자산 → localStorage 복원 (고객별 격리)
      // ※ 이벤트보다 먼저 localStorage를 기록해야 PensionTaxPanel이 올바른 데이터를 읽음
      const { currentSummary, newSummary } = taxSummaries;
      if (typeof window !== 'undefined') {
        // 신규 포트폴리오 자산 복원 (PensionTaxPanel → new-portfolio-assets-v1)
        const buyAssets = rebalancing.buyAssets as unknown[];
        try {
          if (buyAssets?.length > 0) {
            localStorage.setItem("new-portfolio-assets-v1", JSON.stringify(buyAssets));
          } else {
            localStorage.removeItem("new-portfolio-assets-v1");
          }
        } catch {}

        if (currentSummary) {
          try {
            localStorage.setItem(FINANCIAL_INCOME_STORAGE_KEY, JSON.stringify(currentSummary));
            window.dispatchEvent(new CustomEvent("financial-income-updated"));
          } catch {}
        } else {
          try { localStorage.removeItem(FINANCIAL_INCOME_STORAGE_KEY); } catch {}
        }
        if (newSummary) {
          try {
            localStorage.setItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY, JSON.stringify(newSummary));
            window.dispatchEvent(new CustomEvent("new-financial-income-updated"));
          } catch {}
        } else {
          try {
            localStorage.removeItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY);
            window.dispatchEvent(new CustomEvent("new-financial-income-updated"));
          } catch {}
        }
      }
    });

    return () => { cancelled = true; };
  }, [selectedCustomer, isMounted]); // isMounted 포함: 마운트 후 올바른 고객 ID로 첫 로드 보장

  // ── 고객 전환 또는 분석 결과 변경 시 localStorage 동기화 ─────────────────────
  // usePortfolioResult 훅이 localStorage에서 읽으므로, 선택 고객의 결과를 항상 반영해야 한다
  useEffect(() => {
    if (!isMounted) return;
    const result = analysisResultMap[selectedCustomer] ?? null;
    if (typeof window === "undefined") return;
    try {
      if (result) {
        localStorage.setItem(PORTFOLIO_RESULT_STORAGE_KEY, JSON.stringify(result));
      } else {
        localStorage.removeItem(PORTFOLIO_RESULT_STORAGE_KEY);
      }
      window.dispatchEvent(new CustomEvent("portfolio-result-updated"));
    } catch {}
  }, [selectedCustomer, analysisResultMap, isMounted]);

  // ── 리밸런싱 상태 변경 즉시 저장 (매도→rebalancing_state, 매수→new_analysis_results 분리 저장)
  useEffect(() => {
    if (!rebalancingLoadedMap[selectedCustomer]) return;
    if (!rebalancingDirtyMap[selectedCustomer]) return;

    const customerId = selectedCustomer;
    const sell = rebalancingSellMap[customerId] ?? [];
    const buy = rebalancingBuyMap[customerId] ?? [];
    void Promise.all([
      saveRebalancingState(customerId, sell),      // TAB2 매도 → rebalancing_state
      saveRebalancingBuyAssets(customerId, buy),   // TAB3 매수 → new_analysis_results
    ]).then(() => {
      setRebalancingDirtyMap(prev => ({ ...prev, [customerId]: false }));
    });
  }, [rebalancingSellMap, rebalancingBuyMap, rebalancingLoadedMap, rebalancingDirtyMap, selectedCustomer]);

  // ── Tab 5 상품 선택 변경 즉시 저장 ─────────────────────────────────────────
  useEffect(() => {
    if (!productSelectionsLoadedMap[selectedCustomer]) return;
    if (!productSelectionsDirtyMap[selectedCustomer]) return;

    const customerId = selectedCustomer;
    const ids = productSelectionsMap[customerId] ?? [];
    void saveProductSelections(customerId, ids).then(() => {
      setProductSelectionsDirtyMap(prev => ({ ...prev, [customerId]: false }));
    });
  }, [productSelectionsMap, productSelectionsLoadedMap, productSelectionsDirtyMap, selectedCustomer]);

  // ── TAB2-5 매도 이력 변경 즉시 저장 → rebalancing_state.sell_history ────────
  useEffect(() => {
    if (!rebalancingLoadedMap[selectedCustomer]) return; // 로드 완료 후에만 저장
    if (!sellHistoryDirtyMap[selectedCustomer]) return;

    const customerId = selectedCustomer;
    const history = sellHistoryMap[customerId] ?? [];
    void saveSellHistory(customerId, history).then(() => {
      setSellHistoryDirtyMap(prev => ({ ...prev, [customerId]: false }));
    });
  }, [sellHistoryMap, sellHistoryDirtyMap, rebalancingLoadedMap, selectedCustomer]);

  // ── 자산 변경 즉시 저장 — Tab 1의 saveCustomerDataJsonOnly 패턴과 완전히 동일
  // debounce 없음: 변경 즉시 저장하여 고객 전환 전에 항상 DB 반영 완료
  useEffect(() => {
    if (!portfolioLoadedMap[selectedCustomer]) return;
    if (!dirtyPortfolioMap[selectedCustomer]) return;

    const customerId = selectedCustomer;
    const assets = portfolioAssetsMap[customerId] ?? [];

    void savePortfolioAssets(customerId, assets)
      .then(() => {
        setDirtyPortfolioMap(prev => ({ ...prev, [customerId]: false }));
      })
      .catch((error) => {
        const detail = error && typeof error === "object"
          ? {
              message: (error as { message?: unknown }).message,
              code: (error as { code?: unknown }).code,
              details: (error as { details?: unknown }).details,
              hint: (error as { hint?: unknown }).hint,
            }
          : error;
        console.error("Failed to save portfolio assets", {
          customerId,
          assetCount: assets.length,
          error: detail,
        });
      });
  }, [portfolioAssetsMap, portfolioLoadedMap, dirtyPortfolioMap, selectedCustomer]);

  // ── 포트폴리오 행 조작 함수 — Tab 1의 setFinancial/setRrttllu 패턴과 동일 ──
  const addPortfolioRow = () => {
    if (!canEditConsultation()) return;
    setPortfolioAssetsMap(prev => ({
      ...prev,
      [selectedCustomer]: [...(prev[selectedCustomer] ?? []), { ...EMPTY_PORTFOLIO_ASSET, owner_customer_id: selectedCustomer }],
    }));
    setDirtyPortfolioMap(prev => ({ ...prev, [selectedCustomer]: true }));
  };
  const bulkAddPortfolioRows = (rows: Partial<PortfolioAsset>[]) => {
    setPortfolioAssetsMap(prev => ({
      ...prev,
      [selectedCustomer]: [
        ...(prev[selectedCustomer] ?? []),
        ...rows.map(r => ({ ...EMPTY_PORTFOLIO_ASSET, owner_customer_id: selectedCustomer, ...r })),
      ],
    }));
    setDirtyPortfolioMap(prev => ({ ...prev, [selectedCustomer]: true }));
  };
  const removePortfolioRow = (index: number) => {
    if (!canEditConsultation()) return;
    setPortfolioAssetsMap(prev => ({
      ...prev,
      [selectedCustomer]: (prev[selectedCustomer] ?? []).filter((_, i) => i !== index),
    }));
    setDirtyPortfolioMap(prev => ({ ...prev, [selectedCustomer]: true }));
  };
  const updatePortfolioRow = (index: number, patch: Partial<PortfolioAsset>) => {
    if (!canEditConsultation()) return;
    setPortfolioAssetsMap(prev => ({
      ...prev,
      [selectedCustomer]: (prev[selectedCustomer] ?? []).map((a, i) => (i === index ? { ...a, ...patch } : a)),
    }));
    setDirtyPortfolioMap(prev => ({ ...prev, [selectedCustomer]: true }));
  };
  const setPortfolioDirty = (dirty: boolean) => {
    if (!canEditConsultation()) return;
    setDirtyPortfolioMap(prev => ({ ...prev, [selectedCustomer]: dirty }));
  };
  const setAnalysisResult = (result: PortfolioAnalysisResult | null) => {
    if (!canEditConsultation()) return;
    setAnalysisResultMap(prev => ({ ...prev, [selectedCustomer]: result }));
  };

  // ── 리밸런싱 파이프라인 액션 ─────────────────────────────────────────────
  //
  // [레이스 컨디션 해결 전략]
  // 1. useCallback(fn, []) — stable identity: 매 렌더에서 새 함수가 생성되지 않으므로
  //    하위 컴포넌트가 stale 클로저를 캡처하는 타이밍 버그 원천 차단.
  // 2. Ref 읽기 — setterFn 내부에서 selectedCustomer / 자산 맵을 Ref로 읽으므로
  //    "분석 실행 async 대기 중 사용자가 자산을 편집 → pushToRebalancingSell이 편집 전
  //    스냅샷을 복사" 하는 stale closure 버그 제거.
  // 3. 함수형 setter(prev => ...) — React가 최신 prev 상태를 보장하므로
  //    연속 호출 시에도 덮어쓰기 없이 순서가 보장됨.
  //
  const updateHeaderAssetSummary = useCallback((cid: CustomerId, updater: (current: HeaderAssetSummaryState) => HeaderAssetSummaryState) => {
    setCustomerUpdatedAt((prev) => ({ ...prev, [cid]: Date.now() }));
    setDirtyCustomerData((prev) => ({ ...prev, [cid]: true }));
    setCustomerData((prev) => {
      const current = prev[cid] ?? createInitialState();
      return {
        ...prev,
        [cid]: {
          ...current,
          headerAssetSummary: updater(current.headerAssetSummary ?? createInitialState().headerAssetSummary),
        },
      };
    });
  }, []);

  const pushToRebalancingSell = useCallback(() => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    const snap = (portfolioAssetsMapRef.current[cid] ?? []).map(a => ({ ...a }));
    setRebalancingSellMap(prev => ({ ...prev, [cid]: snap }));
    setRebalancingDirtyMap(prev => ({ ...prev, [cid]: true }));
  }, []); // stable — Ref 기반, 의존성 없음

  const setRebalancingSellAssets = useCallback((assets: PortfolioAsset[]) => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    setRebalancingSellMap(prev => ({ ...prev, [cid]: assets }));
    setRebalancingDirtyMap(prev => ({ ...prev, [cid]: true }));
  }, []); // stable

  const confirmRebalancingSell = useCallback(() => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    const snap = (rebalancingSellMapRef.current[cid] ?? []).map(a => ({ ...a }));
    const confirmedOperatingAssetsAfterSell = sumPortfolioCurrentValue(snap);
    // 매도 확정 시 매도 후 잔여 자산을 TAB3 매수 초기값으로 복사
    setRebalancingBuyMap(prev => ({ ...prev, [cid]: snap.map(a => ({ ...a })) }));
    setRebalancingDirtyMap(prev => ({ ...prev, [cid]: true }));
    updateHeaderAssetSummary(cid, (current) => ({ ...current, confirmedOperatingAssetsAfterSell, confirmedOperatingAssetsAfterBuy: null, confirmedBuyAmount: null }));
  }, []); // stable — Ref 기반, 의존성 없음
  const resetRebalancingSellSummary = useCallback(() => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    updateHeaderAssetSummary(cid, (current) => ({ ...current, confirmedOperatingAssetsAfterSell: null, confirmedOperatingAssetsAfterBuy: null, confirmedBuyAmount: null }));
  }, [updateHeaderAssetSummary]);

  const setRebalancingBuyAssets = useCallback((assets: PortfolioAsset[]) => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    setRebalancingBuyMap(prev => ({ ...prev, [cid]: assets }));
    setRebalancingDirtyMap(prev => ({ ...prev, [cid]: true }));
  }, []); // stable

  const confirmRebalancingBuy = useCallback(() => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    const confirmedOperatingAssetsAfterBuy = sumPortfolioCurrentValue(rebalancingBuyMapRef.current[cid] ?? []);
    updateHeaderAssetSummary(cid, (current) => ({ ...current, confirmedOperatingAssetsAfterBuy, confirmedBuyAmount: null }));
  }, [updateHeaderAssetSummary]);

  const resetRebalancingBuySummary = useCallback(() => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    updateHeaderAssetSummary(cid, (current) => ({ ...current, confirmedOperatingAssetsAfterBuy: null, confirmedBuyAmount: null }));
  }, [updateHeaderAssetSummary]);

  const addBuyCost = useCallback((cost: number) => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    updateHeaderAssetSummary(cid, (current) => ({
      ...current,
      confirmedBuyAmount: (current.confirmedBuyAmount ?? 0) + cost,
    }));
  }, [updateHeaderAssetSummary]);

  const setNewPortfolioAnalysisResult = useCallback((result: PortfolioAnalysisResult | null) => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    setNewPortfolioAnalysisResultMap(prev => ({ ...prev, [cid]: result }));
    void saveNewAnalysisResult(cid, result); // 분석 완료 즉시 저장 (더티 플래그 없음)
  }, []); // stable

  const updateTab3AnalysisState = useCallback((patch: Partial<Tab3AnalysisState>, options?: { allowReadOnlyViewState?: boolean }) => {
    if (isConsultationReadOnlyRef.current && !options?.allowReadOnlyViewState) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    const nextState = { ...(tab3AnalysisStateMapRef.current[cid] ?? {}), ...patch };
    setTab3AnalysisStateMap(prev => ({ ...prev, [cid]: nextState }));
    void saveTab3AnalysisState(cid, nextState);
  }, []); // stable

  const setProductSelectedIds = useCallback((ids: string[]) => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    setProductSelectionsMap(prev => ({ ...prev, [cid]: ids }));
    setProductSelectionsDirtyMap(prev => ({ ...prev, [cid]: true }));
  }, []); // stable

  const saveTaxSummaryFn = useCallback((type: 'current' | 'new', summary: unknown) => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    void saveTaxSummaryToDb(cid, type, summary);
  }, []); // stable

  // ── TAB2-5 매도 시뮬레이터 callbacks ───────────────────────────────────────
  const addSellRecord = useCallback((record: SellRecord) => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;

    // ─ 1. sellHistory 누적 — functional setter로 React가 보장하는 최신 prev 사용
    // prev 기반으로 nextHistory를 파생시켜 rapid sell 시 기록 유실 방지
    let capturedNextHistory: SellRecord[] = [];
    setSellHistoryMap(prev => {
      capturedNextHistory = [...(prev[cid] ?? []), record];
      return { ...prev, [cid]: capturedNextHistory };
    });
    setSellHistoryDirtyMap(prev => ({ ...prev, [cid]: true }));

    // ─ 2. rebalancingSellAssets 수량 차감 (Infinite Sell 차단) ─────────────
    // 비어 있으면 원본 portfolioAssets 복사 → 첫 매도 시 자동 초기화
    const currentSell = rebalancingSellMapRef.current[cid] ?? [];
    const baseSell = currentSell.length > 0
      ? currentSell
      : (portfolioAssetsMapRef.current[cid] ?? []).map(a => ({ ...a }));

    const nextSell = baseSell.map((a) => {
      // quantity 타입 & name 일치 종목만 차감 (ticker 없는 종목 대비 name 매칭)
      if (a.amount_type !== "quantity" || a.name !== record.name) return a;
      return { ...a, amount: Math.max(0, a.amount - record.sellQty) };
    });
    setRebalancingSellMap(prev => ({ ...prev, [cid]: nextSell }));
    setRebalancingDirtyMap(prev => ({ ...prev, [cid]: true })); // TAB3/TAB4 파이프라인 반영

    // ─ 3. 기획서 수식 c = a − 누적매도금액; 헤더 가용자금(d) 연산 기반 ────────
    // capturedNextHistory는 setSellHistoryMap의 setter 내에서 동기 파생된 최신값
    const portfolioTotal = sumPortfolioCurrentValue(portfolioAssetsMapRef.current[cid] ?? []);
    // capturedNextHistory가 빈 경우(첫 렌더 race) fallback으로 ref 기반 계산
    const historyForCalc = capturedNextHistory.length > 0
      ? capturedNextHistory
      : [...(sellHistoryMapRef.current[cid] ?? []), record];
    const totalSoldValue = historyForCalc.reduce((s, r) => s + r.sellPrice * r.sellQty, 0);
    const c = Math.max(0, portfolioTotal - totalSoldValue);
    updateHeaderAssetSummary(cid, (current) => ({
      ...current,
      confirmedOperatingAssetsAfterSell: c,
      confirmedOperatingAssetsAfterBuy: null,
      confirmedBuyAmount: null,
    }));
  }, [updateHeaderAssetSummary]); // stable — 모든 읽기는 Ref 기반

  const clearSellHistory = useCallback(() => {
    if (isConsultationReadOnlyRef.current) { setEditLockDialogOpen(true); return; }
    const cid = selectedCustomerRef.current;
    setSellHistoryMap(prev => ({ ...prev, [cid]: [] }));
    setSellHistoryDirtyMap(prev => ({ ...prev, [cid]: true }));

    // rebalancingSellAssets → 원본 portfolioAssets로 롤백
    const originalAssets = (portfolioAssetsMapRef.current[cid] ?? []).map(a => ({ ...a }));
    setRebalancingSellMap(prev => ({ ...prev, [cid]: originalAssets }));
    setRebalancingDirtyMap(prev => ({ ...prev, [cid]: true }));
    updateHeaderAssetSummary(cid, (current) => ({
      ...current,
      confirmedOperatingAssetsAfterSell: null,
      confirmedOperatingAssetsAfterBuy: null,
      confirmedBuyAmount: null,
    }));
  }, [updateHeaderAssetSummary]); // stable

  const setConfirmedDomesticPair = useCallback((pair: ConfirmedPairItem[] | null) => {
    const cid = selectedCustomerRef.current;
    setConfirmedDomesticPairMap(prev => {
      if (!pair) { const next = { ...prev }; delete next[cid]; return next; }
      return { ...prev, [cid]: [...pair] };
    });
  }, []);

  const setConfirmedGlobalPair = useCallback((pair: ConfirmedPairItem[] | null) => {
    const cid = selectedCustomerRef.current;
    setConfirmedGlobalPairMap(prev => {
      if (!pair) { const next = { ...prev }; delete next[cid]; return next; }
      return { ...prev, [cid]: [...pair] };
    });
  }, []);

  const setBuySimPersistedState = useCallback((items: BuySimTickerItem[], sig: string) => {
    const cid = selectedCustomerRef.current;
    setBuySimPersistedStateMap(prev => ({ ...prev, [cid]: { items, sig } }));
  }, []);

  const setPbOrderRows = useCallback((rows: PbOrderRow[]) => {
    const cid = selectedCustomerRef.current;
    setPbOrderRowsMap(prev => ({ ...prev, [cid]: rows }));
  }, []);

  const riskResult = useMemo(() => calculateRiskResult(formData.rrttllu), [formData.rrttllu]);

  // Buying Power = b + cashFromSales - confirmedBuyAmount (기획서 표준 수식)
  // b = TAB1 investableAssets | cashFromSales = a - c (매도 대금)
  // a = 최초 포트폴리오 평가총액 | c = 매도 확정 후 잔여자산 총액
  const availableInvestmentFunds = useMemo(() => {
    const b = parseKrwAmount(formData.financial.investableAssets) ?? 0;
    const c = formData.headerAssetSummary?.confirmedOperatingAssetsAfterSell ?? null;
    const buySpent = formData.headerAssetSummary?.confirmedBuyAmount ?? 0;

    // 매도 시뮬레이션 미진행: cashFromSales = 0 → Buying Power = b - buySpent
    if (c === null) return b > 0 ? b - buySpent : null;

    // 매도 시뮬레이션 완료: Buying Power = b + (a - c) - buySpent
    // 포트폴리오 미로드 시 a = 0 → cashFromSales 음수 오염 방지 — b - buySpent만 반환
    if (!isPortfolioLoaded) return b > 0 ? b - buySpent : null;
    const a = sumPortfolioCurrentValue(portfolioAssets);
    if (!Number.isFinite(a) || a <= 0) return b > 0 ? b - buySpent : null;
    const d = b + (a - c) - buySpent;
    return Number.isFinite(d) ? d : null;
  }, [formData.headerAssetSummary, formData.financial.investableAssets, portfolioAssets, isPortfolioLoaded]);

  const financialCompletion = useMemo(() => completion([
    formData.financial.existingInvestmentAssets, formData.financial.cashAssets, formData.financial.realEstate,
    formData.financial.debt, formData.financial.annualFixedIncome,
    formData.financial.irregularIncomeNone ? "없음" : formData.financial.irregularIncome,
    formData.financial.investableAssets,
    formData.financial.monthlyFixedExpense,
  ]), [formData.financial]);

  const rrttlluCompletion = useMemo(() => {
    const r = formData.rrttllu;
    return completion([r.returnObjective, r.expectedReturnUnknown ? "unknown" : r.expectedReturn, r.investmentExperience.length ? "selected" : "", r.knowledgeLevel, r.derivativesExperience, r.financialAssetRatio, r.investmentAssetRatio, r.riskAttitude, r.lossResponse, r.timeHorizon, r.expectedInterestIncome, r.expectedDividendIncome, r.giftingPlan, r.globalTaxImportance, r.recentGlobalTaxSubject, r.foreignStockTaxImportance, formatLiquiditySummary(r.regularCashflowNeed, "regular"), formatLiquiditySummary(r.lumpSumPlan, "lumpSum"), formatLiquiditySummary(r.emergencyReservePlan, "emergency"), r.legalConstraints.length ? "selected" : "", r.preferredAssets, r.avoidedAssets, r.holdingOrDisposalPlan, r.uniqueOther]);
  }, [formData.rrttllu]);

  const internalJsonPayload = useMemo(() => buildStructuredJsonPayload(formData, confirmedRiskResult ?? riskResult, selectedCustomerProfile), [confirmedRiskResult, formData, riskResult, selectedCustomerProfile]);
  const warnings = internalJsonPayload.rrttllu.warnings;
  const customerDataJsonPayload = useMemo(() => ({ appState: formData, analysis: { riskResult, internalJsonPayload, financialCompletion, rrttlluCompletion } }), [financialCompletion, formData, internalJsonPayload, riskResult, rrttlluCompletion]);
  const headerAssetSummary = useMemo(
    () => buildHeaderAssetSummary(formData.financial, formData.headerAssetSummary, portfolioAssets),
    [formData.financial, formData.headerAssetSummary, portfolioAssets],
  );

  useEffect(() => {
    if (!storageReady || isSeeding || !persistedCustomerIds.includes(selectedCustomer)) return;
    if (!dirtyCustomerData[selectedCustomer]) return;
    void saveCustomerDataJsonOnly(selectedCustomer, customerDataJsonPayload).then((r) => {
      if (!r.ok) setStorageErrorMessage(r.message);
      else {
        setDirtyCustomerData((prev) => ({ ...prev, [selectedCustomer]: false }));
        setStorageErrorMessage("");
      }
    });
  }, [customerDataJsonPayload, dirtyCustomerData, isSeeding, persistedCustomerIds, selectedCustomer, storageReady]);

  const markUpdated = (id: CustomerId, ts = Date.now()) => setCustomerUpdatedAt((prev) => ({ ...prev, [id]: ts }));

  const setFormData = (updater: (current: AppState) => AppState) => {
    if (!canEditConsultation()) return;
    markUpdated(selectedCustomer);
    setDirtyCustomerData((prev) => ({ ...prev, [selectedCustomer]: true }));
    setCustomerData((prev) => ({ ...prev, [selectedCustomer]: deriveCalculatedAppState(updater(prev[selectedCustomer] ?? createInitialState())) }));
  };

  const selectCustomer = (id: CustomerId) => {
    // dirty 플래그는 per-customer Map으로 관리 — 전환 시 별도 소거 불필요
    setSelectedCustomer(id); storeSelectedCustomerId(id);
    setAnalysisRequested(false); setConfirmedRiskResult(null); setLastAnalysisSnapshot(null);
    setChangeHistory([]); setChangeHistoryExpanded(false);
  };

  const resetSelectedCustomer = () => {
    if (!canEditConsultation()) return;
    if (window.confirm("현재 고객만 초기화하시겠습니까?")) {
      markUpdated(selectedCustomer);
      setDirtyCustomerData((prev) => ({ ...prev, [selectedCustomer]: true }));
      setCustomerData((prev) => ({ ...prev, [selectedCustomer]: createInitialState() }));
    } else if (window.confirm("전체 고객을 초기화하시겠습니까?")) {
      const ts = Date.now();
      setCustomerUpdatedAt(Object.fromEntries(customerProfiles.map((p) => [p.id, ts])));
      setDirtyCustomerData(Object.fromEntries(customerProfiles.map((p) => [p.id, true])));
      setCustomerData(createInitialCustomerData(customerProfiles));
      setSelectedCustomer(customerProfiles[0]?.id ?? defaultCustomerProfiles[0].id);
    }
    setAnalysisRequested(false); setConfirmedRiskResult(null); setLastAnalysisSnapshot(null);
    setChangeHistory([]); setChangeHistoryExpanded(false);
  };

  const resetSelectedCustomerInputs = () => {
    if (!canEditConsultation()) return;
    markUpdated(selectedCustomer);
    setDirtyCustomerData((prev) => ({ ...prev, [selectedCustomer]: true }));
    setCustomerData((prev) => ({ ...prev, [selectedCustomer]: createInitialState() }));
    setAnalysisRequested(false); setConfirmedRiskResult(null); setLastAnalysisSnapshot(null);
    setChangeHistory([]); setChangeHistoryExpanded(false);
  };

  const addCustomer = () => {
    const profile = createNewCustomerProfile();
    const newState = createInitialState();
    setCustomerProfiles((prev) => [...prev, profile]);
    setCustomerData((prev) => ({ ...prev, [profile.id]: newState }));
    markUpdated(profile.id);
    void customerStorage.insertCustomer(profile, newState, customerProfiles.length).then((r) => {
      if (!r.ok) setStorageErrorMessage(r.message);
      else { setPersistedCustomerIds((prev) => (prev.includes(profile.id) ? prev : [...prev, profile.id])); setStorageErrorMessage(""); }
    });
    selectCustomer(profile.id);
  };

  const reorderCustomer = (dropIndex: number) => {
    if (!draggedCustomerId) return;
    const srcIdx = customerProfiles.findIndex((p) => p.id === draggedCustomerId);
    if (srcIdx < 0) return;
    const next = [...customerProfiles];
    const [moved] = next.splice(srcIdx, 1);
    const adjusted = srcIdx < dropIndex ? dropIndex - 1 : dropIndex;
    next.splice(Math.max(0, Math.min(adjusted, next.length)), 0, moved);
    const ordered = next.map((profile, index) => ({ ...profile, sort_order: index }));
    setCustomerProfiles(ordered);
    void customerStorage.saveSortOrders(ordered).then((r) => {
      if (!r.ok) setStorageErrorMessage(r.message);
      else setStorageErrorMessage("");
    });
    setDraggedCustomerId(null); setCustomerDropIndex(null);
  };

  const deleteSelectedCustomer = () => {
    const remaining = customerProfiles.filter((p) => p.id !== selectedCustomer);
    const nextProfiles = remaining.length ? remaining : [createNewCustomerProfile()];
    const nextId = nextProfiles[0].id;
    setCustomerProfiles(nextProfiles);
    setCustomerData((prev) => { const next = { ...prev }; delete next[selectedCustomer]; if (!next[nextId]) next[nextId] = createInitialState(); return next; });
    const deletedId = selectedCustomer;
    void customerStorage.remove(deletedId).then((r) => {
      if (!r.ok) setStorageErrorMessage(r.message);
      else {
        setPersistedCustomerIds((prev) => prev.filter((id) => id !== deletedId));
        setCustomerUpdatedAt((prev) => { const next = { ...prev }; delete next[deletedId]; return next; });
        // 삭제된 고객의 포트폴리오 Map 항목 정리
        setPortfolioAssetsMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setPortfolioLoadedMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setDirtyPortfolioMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setAnalysisResultMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setRebalancingSellMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setRebalancingBuyMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setNewPortfolioAnalysisResultMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setTab3AnalysisStateMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setRebalancingLoadedMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setRebalancingDirtyMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setProductSelectionsMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setProductSelectionsLoadedMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setProductSelectionsDirtyMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setSellHistoryMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        setSellHistoryDirtyMap(prev => { const next = { ...prev }; delete next[deletedId]; return next; });
        portfolioLoadedRef.current.delete(deletedId);
        setStorageErrorMessage("");
      }
    });
    selectCustomer(nextId); setDeleteConfirmOpen(false);
  };

  const updateCustomerField = (customerId: CustomerId, field: keyof Pick<CustomerProfile, "name" | "gender" | "birth_year" | "age" | "job">, value: string) => {
    const idx = customerProfiles.findIndex((p) => p.id === customerId);
    const current = customerProfiles[idx];
    if (!current) return;
    const updated: CustomerProfile = { ...current, [field]: value, birthYear: field === "birth_year" ? value : current.birthYear, birth_year: field === "birth_year" ? value : current.birth_year, sort_order: idx };
    setCustomerProfiles(customerProfiles.map((p) => (p.id === customerId ? updated : p)));
    markUpdated(updated.id);
    if (!storageReady || isSeeding) return;
    void saveCustomerProfileColumns(updated).then((r) => {
      if (!r.ok) setStorageErrorMessage(r.message);
      else { setPersistedCustomerIds((prev) => (prev.includes(updated.id) ? prev : [...prev, updated.id])); setStorageErrorMessage(""); }
    });
  };

  const updateCustomerProfile = (key: keyof Omit<CustomerProfile, "id">, value: string) => {
    if (!canEditConsultation()) return;
    const field = key === "birthYear" ? "birth_year" : key;
    if (field === "name" || field === "gender" || field === "birth_year" || field === "age" || field === "job") updateCustomerField(selectedCustomer, field, value);
  };

  const hasExtractedText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  const mergeExtractedText = <T extends object>(base: T, patch: Partial<T>, keys: (keyof T)[]) => {
    const next = { ...base };
    keys.forEach((key) => {
      const value = patch[key];
      if (hasExtractedText(value)) (next as Record<keyof T, unknown>)[key] = value;
    });
    return next;
  };

  const uniqueOtherMeaningKey = (value: string) => {
    const compact = value.replace(/\s+/g, "");
    if (/크게흔들리지않|민감하지않|예민하지않/.test(compact)) return "market-stable";
    if (/빠르지않|급하지않|속도가빠르지않/.test(compact)) return "not-fast-decision";
    if (/시장뉴스|단기이슈|뉴스.*민감|민감.*뉴스|민감하게반응/.test(compact)) return "market-sensitivity";
    if (/의사결정.*빠|빠른편|성격.*급|급함|속도가빠/.test(compact)) return "fast-decision";
    if (/배우자|가족.*의사결정|의사결정.*영향력/.test(compact)) return "family-influence";
    if (/질문.*많|충분한설명|설명.*선호|납득/.test(compact)) return "explanation-preference";
    if (/꼼꼼|의심|객관적근거|근거중시/.test(compact)) return "evidence-seeking";
    if (/부모님|부모관련|고령부모/.test(compact)) return "parent-related";
    if (/포트폴리오.*부진|벤치마크.*낮|수익률.*훼손|망가진/.test(compact)) return "portfolio-underperformance";
    if (/급등주|과도한레버리지|레버리지.*손실|손실경험/.test(compact)) return "aggressive-loss-experience";
    if (/모니터링|관리시간|본업이바빠|주도주편입/.test(compact)) return "monitoring-time";
    if (/기존PB|PB서비스|불만족/.test(compact)) return "pb-experience";
    return compact.replace(/[^\p{Script=Hangul}a-zA-Z0-9]/gu, "").slice(0, 32);
  };

  const isPbOpeningMentForUniqueOther = (value: string) => {
    const compact = value.replace(/\s+/g, "");
    return compact.includes("고객님의투자성향")
      && compact.includes("니즈를파악")
      && compact.includes("몇가지여쭤");
  };

  const mergeUniqueOther = (existing: string, incoming: string) => {
    const values = [
      ...incoming.split(/\n/),
      ...existing.split(/\n/),
    ].map((value) => value.trim()).filter((value) => !isPbOpeningMentForUniqueOther(value)).filter(Boolean);
    const byMeaning = new Map<string, string>();
    values.forEach((value) => {
      const key = uniqueOtherMeaningKey(value);
      if (!byMeaning.has(key)) byMeaning.set(key, value);
    });
    return Array.from(byMeaning.values()).join("\n");
  };

  const applySmartExtraction = (payload: SmartExtractionPayload) => {
    if (!canEditConsultation()) return;
    markUpdated(selectedCustomer);
    setDirtyCustomerData((prev) => ({ ...prev, [selectedCustomer]: true }));
    setCustomerData((prev) => {
      const current = prev[selectedCustomer] ?? createInitialState();
      const financialPatch = payload.financial ?? {};
      const rrttlluPatch = payload.rrttllu ?? {};
      const financial = mergeExtractedText(current.financial, financialPatch, [
        "existingInvestmentAssets", "cashAssets", "realEstate", "debt", "annualFixedIncome", "irregularIncome", "investableAssets", "monthlyFixedExpense",
      ]);
      if (financialPatch.irregularIncomeNone === true) {
        financial.irregularIncomeNone = true;
        financial.irregularIncome = "";
      } else if (hasExtractedText(financialPatch.irregularIncome)) {
        financial.irregularIncomeNone = false;
      }

      const rrttllu = mergeExtractedText(current.rrttllu, rrttlluPatch, [
        "returnObjective", "expectedReturn", "knowledgeLevel", "derivativesExperience", "financialAssetRatio",
        "investmentAssetRatio", "riskAttitude", "lossResponse", "timeHorizon", "giftingPlan", "globalTaxImportance",
        "recentGlobalTaxSubject", "foreignStockTaxImportance", "regularCashflowNeed", "lumpSumPlan",
        "emergencyReservePlan", "legalConstraintOther", "preferredAssets", "avoidedAssets", "holdingOrDisposalPlan",
      ]);
      if (hasExtractedText(rrttlluPatch.regularCashflowNeed)) {
        rrttllu.regularCashflowNeed = normalizeLiquidityValue(rrttllu.regularCashflowNeed, "regular");
      }
      if (hasExtractedText(rrttlluPatch.lumpSumPlan)) {
        rrttllu.lumpSumPlan = normalizeLiquidityValue(rrttllu.lumpSumPlan, "lumpSum");
      }
      if (hasExtractedText(rrttlluPatch.emergencyReservePlan)) {
        rrttllu.emergencyReservePlan = normalizeLiquidityValue(rrttllu.emergencyReservePlan, "emergency");
      }
      const manualUniqueOther = current.uniqueOtherManual ?? "";
      const nextSmartUniqueOther = hasExtractedText(rrttlluPatch.uniqueOther) ? rrttlluPatch.uniqueOther : "";
      rrttllu.uniqueOther = nextSmartUniqueOther
        ? mergeUniqueOther(manualUniqueOther, nextSmartUniqueOther)
        : manualUniqueOther;
      if (Array.isArray(rrttlluPatch.investmentExperience) && rrttlluPatch.investmentExperience.length) {
        rrttllu.investmentExperience = rrttlluPatch.investmentExperience;
      }
      if (Array.isArray(rrttlluPatch.legalConstraints) && rrttlluPatch.legalConstraints.length) {
        rrttllu.legalConstraints = rrttlluPatch.legalConstraints;
      }
      if (rrttlluPatch.expectedReturnUnknown === true) {
        rrttllu.expectedReturnUnknown = true;
        rrttllu.expectedReturn = "";
      } else if (hasExtractedText(rrttlluPatch.expectedReturn)) {
        rrttllu.expectedReturnUnknown = false;
      }
      return { ...prev, [selectedCustomer]: deriveCalculatedAppState({ ...current, financial, rrttllu, smartExtractedUniqueOther: nextSmartUniqueOther }) };
    });
  };

  const setFinancial = (key: keyof FinancialInfo, value: string) => {
    if (!canEditConsultation()) return;
    setFormData((prev) => deriveCalculatedAppState({ ...prev, financial: { ...prev.financial, [key]: value } }));
  };
  const setRrttllu = (key: keyof RrttlluInfo, value: string) => {
    if (!canEditConsultation()) return;
    setFormData((prev) => (
    key === "uniqueOther"
      ? { ...prev, uniqueOtherManual: value, smartExtractedUniqueOther: "", rrttllu: { ...prev.rrttllu, uniqueOther: value } }
      : { ...prev, rrttllu: { ...prev.rrttllu, [key]: value } }
    ));
  };
  const setSmartInputNote = (value: string) => {
    if (!canEditConsultation()) return;
    setFormData((prev) => ({ ...prev, smartInputNote: value }));
  };
  const setSmartTranscript = (value: AppState["smartTranscript"]) => {
    if (!canEditConsultation()) return;
    setFormData((prev) => ({ ...prev, smartTranscript: value }));
  };
  const setSmartAdditionalMemo = (value: string) => {
    if (!canEditConsultation()) return;
    setFormData((prev) => ({ ...prev, smartAdditionalMemo: value }));
  };
  const setAiGuidePbNote = (checkpointId: string, value: string) => {
    if (!canEditConsultation()) return;
    setFormData((prev) => ({
    ...prev,
    aiGuidePbNotes: { ...(prev.aiGuidePbNotes ?? {}), [checkpointId]: value },
    }));
  };
  const setAiAdvisoryGuide = (guide: StoredAdvisoryGuide | null, payloadSignature = "", generatedAt = "") => {
    if (!canEditConsultation()) return;
    setFormData((prev) => ({
    ...prev,
    aiAdvisoryGuide: guide,
    aiGuidePayloadSignature: payloadSignature,
    aiGuideGeneratedAt: generatedAt,
    }));
  };
  const setIrregularIncome = (value: string) => {
    if (!canEditConsultation()) return;
    setFormData((prev) => ({ ...prev, financial: { ...prev.financial, irregularIncome: value, irregularIncomeNone: false } }));
  };
  const toggleNoIrregularIncome = () => {
    if (!canEditConsultation()) return;
    setFormData((prev) => ({ ...prev, financial: { ...prev.financial, irregularIncome: "", irregularIncomeNone: !prev.financial.irregularIncomeNone } }));
  };
  const setExpectedReturn = (value: string) => {
    if (!canEditConsultation()) return;
    setFormData((prev) => ({ ...prev, rrttllu: { ...prev.rrttllu, expectedReturn: value, expectedReturnUnknown: false } }));
  };
  const toggleExpectedReturnUnknown = () => {
    if (!canEditConsultation()) return;
    setFormData((prev) => ({ ...prev, rrttllu: { ...prev.rrttllu, expectedReturn: "", expectedReturnUnknown: !prev.rrttllu.expectedReturnUnknown } }));
  };

  const toggleInvestmentExperience = (option: string) => {
    if (!canEditConsultation()) return;
    setFormData((prev) => {
    const current = prev.rrttllu.investmentExperience;
    const next = option === noneExperience ? (current.includes(option) ? [] : [option]) : current.includes(option) ? current.filter((x) => x !== option) : [...current.filter((x) => x !== noneExperience), option];
    return { ...prev, rrttllu: { ...prev.rrttllu, investmentExperience: next } };
    });
  };

  const toggleLegalConstraint = (option: string) => {
    if (!canEditConsultation()) return;
    setFormData((prev) => {
    const current = prev.rrttllu.legalConstraints;
    const next = option === noLegalConstraint ? (current.includes(option) ? [] : [option]) : current.includes(option) ? current.filter((x) => x !== option) : [...current.filter((x) => x !== noLegalConstraint), option];
    return { ...prev, rrttllu: { ...prev.rrttllu, legalConstraints: next, legalConstraintOther: next.includes("기타") ? prev.rrttllu.legalConstraintOther : "" } };
    });
  };

  const analyzeRrttllu = () => {
    if (!canEditConsultation()) return;
    const latestPayload = buildStructuredJsonPayload(formData, riskResult);
    const changes = lastAnalysisSnapshot ? diffPayload(lastAnalysisSnapshot, latestPayload) : [];
    setAnalysisRequested(true); setConfirmedRiskResult(riskResult); setLastAnalysisSnapshot(latestPayload);
    setChangeHistory(changes); setChangeHistoryExpanded(false);
  };

  const isEditableElement = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest("[data-consultation-lock-exempt='true']")) return false;
    return Boolean(target.closest("input, textarea, select, button, a, [role='button'], [contenteditable='true']"));
  };

  const handleLockedInteraction = (event: SyntheticEvent<HTMLElement>) => {
    if (!isConsultationReadOnly || !isEditableElement(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setEditLockDialogOpen(true);
  };

  const contextValue = {
    appMode,
    formData, selectedCustomerProfile, customerProfiles, selectedCustomer,
    riskResult, financialCompletion, rrttlluCompletion, internalJsonPayload, warnings,
    analysisRequested, confirmedRiskResult, changeHistory, changeHistoryExpanded,
    setFinancial, setRrttllu, setIrregularIncome, toggleNoIrregularIncome, setExpectedReturn,
    toggleExpectedReturnUnknown, toggleInvestmentExperience, toggleLegalConstraint, setSmartInputNote, setSmartTranscript, setSmartAdditionalMemo, setAiGuidePbNote, setAiAdvisoryGuide,
    analyzeRrttllu, resetSelectedCustomer, resetSelectedCustomerInputs, applySmartExtraction,
    updateCustomerProfile, finishActiveConsultation, resumeLatestConsultation, activeConsultation, activeConsultationElapsedSeconds: displayedConsultationElapsedSeconds, isConsultationReadOnly, requestConsultationResume, setChangeHistoryExpanded,
    // 포트폴리오 전역 상태
    portfolioAssets, isPortfolioLoaded, analysisResult,
    addPortfolioRow, bulkAddPortfolioRows, removePortfolioRow, updatePortfolioRow, setAnalysisResult, setPortfolioDirty,
    // 리밸런싱 파이프라인
    rebalancingSellAssets, rebalancingBuyAssets, newPortfolioAnalysisResult, tab3AnalysisState,
    pushToRebalancingSell, setRebalancingSellAssets, confirmRebalancingSell, resetRebalancingSellSummary,
    confirmRebalancingBuy, resetRebalancingBuySummary, addBuyCost, setRebalancingBuyAssets, setNewPortfolioAnalysisResult, updateTab3AnalysisState,
    // Tab 5 상품 선택 (고객별 Supabase 영속)
    productSelectedIds, setProductSelectedIds,
    // 세금 요약 저장 (Tab 2/3 → Supabase → Tab 4 복원)
    saveTaxSummary: saveTaxSummaryFn,
    // TAB2-5 매도 시뮬레이터 전역 영속 (탭 전환 후에도 이력 유지)
    sellHistory, addSellRecord, clearSellHistory, availableInvestmentFunds,
    // TAB 3-1/3-2 확정 조합 (고객별 격리, 불변성 유지)
    confirmedDomesticPair, confirmedGlobalPair, setConfirmedDomesticPair, setConfirmedGlobalPair,
    // TAB 3-3 투자금 조정 테이블 영속 (고객별 격리, 탭 전환 보존)
    buySimTickerItems, buySimConfirmedSig, setBuySimPersistedState,
    // TAB 3-3 PB 직접 매수 (고객별 격리, 탭 전환 보존)
    pbOrderRows, setPbOrderRows,
  };

  return (
    <CustomerViewContext.Provider value={{ isCustomerView, consultationEnded }}>
      <CustomerContext.Provider value={contextValue}>
        <main className="min-h-screen px-5 py-6 text-ink lg:px-8">
          <div className="mx-auto flex max-w-[1680px] flex-col gap-5">
            <HeaderSummary
              currentCustomer={selectedCustomerProfile}
              recentUpdatedAt={customerUpdatedAt[selectedCustomer] ?? 0}
              assetSummary={headerAssetSummary}
              storageErrorMessage={storageErrorMessage}
              activeConsultation={activeConsultation}
              elapsedSeconds={displayedConsultationElapsedSeconds}
              mode={appMode}
              onHome={() => router.push(appMode === "customer" ? "/customer-home" : "/home")}
              onFinish={() => finishActiveConsultation(false)}
              onResume={resumeLatestConsultation}
            />
            <div className="flex flex-col gap-5 xl:flex-row">
              <TabStrip onNavigate={(id) => router.push(tabPaths[id])} />
              <section
                className="min-w-0 flex-1"
                onClickCapture={handleLockedInteraction}
                onPointerDownCapture={handleLockedInteraction}
                onKeyDownCapture={handleLockedInteraction}
                onBeforeInputCapture={handleLockedInteraction}
                onPasteCapture={handleLockedInteraction}
                onChangeCapture={handleLockedInteraction}
              >
                <div className="flex flex-col gap-5">
                  {children}
                </div>
              </section>
            </div>
          </div>
          {editLockDialogOpen ? (
            <ConsultationEditLockDialog
              mode={appMode}
              onCancel={() => setEditLockDialogOpen(false)}
              onResume={() => {
                if (appMode !== "pb") return;
                setEditLockDialogOpen(false);
                resumeLatestConsultation();
              }}
            />
          ) : null}
          {deleteConfirmOpen ? (
            <DeleteCustomerDialog
              customerLabel={selectedCustomerProfile ? customerTabLabel(selectedCustomerProfile) : "현재 고객"}
              onCancel={() => setDeleteConfirmOpen(false)}
              onDelete={deleteSelectedCustomer}
            />
          ) : null}
        </main>
      </CustomerContext.Provider>
    </CustomerViewContext.Provider>
  );
}

const segmentToTab: Record<string, string> = {
  tab1: "profile",
  tab2: "existing",
  tab3: "create",
  tab4: "compare",
  tab5: "recommend",
};

function HeaderSummary({
  currentCustomer, recentUpdatedAt, assetSummary, storageErrorMessage,
  activeConsultation, elapsedSeconds, mode, onHome, onFinish, onResume,
}: {
  currentCustomer?: CustomerProfile;
  recentUpdatedAt: number;
  assetSummary: { operatingAssets: string; additionalAssets: string };
  storageErrorMessage: string;
  activeConsultation: ActiveConsultation | null;
  elapsedSeconds: number;
  mode: "pb" | "customer";
  onHome: () => void;
  onFinish: () => void;
  onResume: () => void;
}) {
  const gender = currentCustomer?.gender?.trim() || "-";
  const age = currentCustomer?.age?.trim() || "-";
  const job = currentCustomer?.job?.trim() || "-";
  const valueClassName = "text-sky-500";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-base font-extrabold text-slate-900">
            현재 상담 고객: <span className="text-samsung">{currentCustomer ? customerTabLabel(currentCustomer) : "선택 대기"}</span>
          </p>
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[13px] font-bold text-slate-600">
            <span>성별 <span className={valueClassName}>{gender}</span></span>
            <span className="text-slate-300">|</span>
            <span>연령 <span className={valueClassName}>{age === "-" ? "-" : `만 ${age}세`}</span></span>
            <span className="text-slate-300">|</span>
            <span>직업 <span className={valueClassName}>{job}</span></span>
          </p>
          <p className="mt-1 text-[13px] font-extrabold text-slate-600">
            운용 자산 <span className={valueClassName}>{assetSummary.operatingAssets}</span>
            <span className="px-1 text-slate-400">|</span>
            추가 투자 의향 <span className={valueClassName}>{assetSummary.additionalAssets}</span>
          </p>
          <p className="mt-1 text-xs font-bold text-slate-400">{formatUpdatedAt(recentUpdatedAt)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={onHome} aria-label="HOME" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-extrabold text-navy transition hover:border-blue-200 hover:bg-blue-50">
            <Home size={17} /> HOME
          </button>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 font-mono text-sm font-extrabold text-blue-800">
            {formatTimer(elapsedSeconds)}
          </div>
          {mode === "pb" ? (
            <>
          <button type="button" onClick={onFinish} disabled={!activeConsultation} className="h-10 rounded-lg bg-red-600 px-3 text-sm font-extrabold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
            상담 종료
          </button>
            </>
          ) : null}
          {mode === "pb" ? (
          <button type="button" onClick={onResume} disabled={Boolean(activeConsultation)} className="h-10 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-extrabold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400">
            상담 재개
          </button>
          ) : null}
        </div>
      </div>
      {storageErrorMessage ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{storageErrorMessage}</div> : null}
    </section>
  );
}

function TabStrip({ onNavigate }: { onNavigate: (id: string) => void }) {
  const segment = useSelectedLayoutSegment();
  const activeTab = (segment ? segmentToTab[segment] : null) ?? "profile";

  return (
    <nav data-consultation-lock-exempt="true" className="grid shrink-0 gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-soft sm:grid-cols-2 xl:w-56 xl:grid-cols-1 xl:self-start xl:sticky xl:top-6">
      {workspaceTabs.map((tab, index) => (
        <button
          key={tab.id} type="button" data-consultation-lock-exempt={tab.id === "create" ? "true" : undefined} onClick={() => onNavigate(tab.id)}
          className={`min-h-11 rounded-lg px-3 py-2 text-left transition ${activeTab === tab.id ? "bg-[#2f2f9d] text-white shadow-soft" : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-navy"}`}
        >
          <span className="block text-sm font-bold tracking-normal">{index + 1}. {tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

function CustomerSelector({
  customers, selectedCustomer, showCustomers, onToggleSearch, onSelectCustomer, onAddCustomer,
  onRequestDelete, onDragStartCustomer, draggedCustomerId, dropIndex, onSetDropIndex,
  onDropCustomer, recentUpdatedAt, assetSummary, storageErrorMessage,
}: {
  customers: CustomerProfile[]; selectedCustomer: CustomerId; showCustomers: boolean;
  onToggleSearch: () => void; onSelectCustomer: (id: CustomerId) => void; onAddCustomer: () => void;
  onRequestDelete: () => void; onDragStartCustomer: (id: CustomerId | null) => void;
  draggedCustomerId: CustomerId | null; dropIndex: number | null;
  onSetDropIndex: (i: number | null) => void; onDropCustomer: (i: number) => void;
  recentUpdatedAt: number; assetSummary: { operatingAssets: string; additionalAssets: string }; storageErrorMessage: string;
}) {
  const currentCustomer = customers.find((c) => c.id === selectedCustomer);
  const [isDraggingTab, setIsDraggingTab] = useState(false);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-soft">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 flex-wrap gap-2">
          <button type="button" onClick={onToggleSearch} className={`min-h-11 rounded-lg px-4 py-2 text-left text-sm font-bold transition ${showCustomers ? "bg-[#2f2f9d] text-white" : "bg-slate-50 text-navy hover:bg-slate-100"}`}>고객명 검색</button>
          <button type="button" onClick={onAddCustomer} className="min-h-11 rounded-lg bg-samsung px-4 py-2 text-left text-sm font-bold text-white transition hover:bg-[#1b35bd]">고객 추가</button>
        </div>
        <div className="customer-current-summary grid grid-cols-[minmax(0,auto)_auto] content-start items-center justify-end gap-x-2 gap-y-1 self-start text-right">
          <p className="text-sm font-bold text-slate-600">현재 상담 고객: <span className="text-samsung">{currentCustomer ? customerTabLabel(currentCustomer) : "선택 대기"}</span></p>
          <button type="button" onClick={onRequestDelete} aria-label="현재 고객 삭제" className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 transition hover:border-red-300 hover:bg-red-100"><Trash2 size={17} /></button>
          <p className="col-span-2 text-[13px] font-extrabold text-slate-600">
            운용 자산 <span className="text-samsung">{assetSummary.operatingAssets}</span>
            <span className="px-1 text-slate-400">|</span>
            추가 투자 의향 <span className="text-samsung">{assetSummary.additionalAssets}</span>
          </p>
          <p className="col-span-2 text-xs font-bold text-slate-400">{formatUpdatedAt(recentUpdatedAt)}</p>
        </div>
      </div>
      {storageErrorMessage ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{storageErrorMessage}</div> : null}
      {showCustomers ? (
        <div className="mt-3 flex items-stretch overflow-x-auto pb-1" onDragLeave={(e) => { if (e.currentTarget === e.target) onSetDropIndex(null); }}>
          {customers.map((customer, index) => (
            <CustomerTabDragItem key={customer.id} customer={customer} index={index} selected={selectedCustomer === customer.id} dragging={draggedCustomerId === customer.id} dropBefore={dropIndex === index}
              onSelect={() => { if (!isDraggingTab) onSelectCustomer(customer.id); }}
              onDragStart={(e) => { setIsDraggingTab(true); onDragStartCustomer(customer.id); onSetDropIndex(index); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", customer.id); }}
              onDragOverIndex={onSetDropIndex} onDropIndex={onDropCustomer}
              onDragEnd={() => { onDragStartCustomer(null); onSetDropIndex(null); window.setTimeout(() => setIsDraggingTab(false), 0); }}
            />
          ))}
          <CustomerDropIndicator index={customers.length} active={dropIndex === customers.length} onDragOverIndex={onSetDropIndex} onDropIndex={onDropCustomer} />
        </div>
      ) : null}
    </section>
  );
}

function CustomerTabDragItem({ customer, index, selected, dragging, dropBefore, onSelect, onDragStart, onDragOverIndex, onDropIndex, onDragEnd }: {
  customer: CustomerProfile; index: number; selected: boolean; dragging: boolean; dropBefore: boolean;
  onSelect: () => void; onDragStart: (e: DragEvent<HTMLButtonElement>) => void;
  onDragOverIndex: (i: number | null) => void; onDropIndex: (i: number) => void; onDragEnd: () => void;
}) {
  return (
    <div className="flex shrink-0 items-stretch">
      <CustomerDropIndicator index={index} active={dropBefore} onDragOverIndex={onDragOverIndex} onDropIndex={onDropIndex} />
      <button type="button" draggable onClick={onSelect} onDragStart={onDragStart}
        onDragOver={(e) => { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); onDragOverIndex(e.clientX < rect.left + rect.width / 2 ? index : index + 1); }}
        onDrop={(e) => { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); onDropIndex(e.clientX < rect.left + rect.width / 2 ? index : index + 1); }}
        onDragEnd={onDragEnd}
        className={`min-h-11 shrink-0 rounded-lg border px-4 py-2 text-sm font-bold transition ${selected ? "border-samsung bg-blue-50 text-samsung" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"} ${dragging ? "opacity-45" : "opacity-100"}`}
      >
        {customerTabLabel(customer)}
      </button>
    </div>
  );
}

function CustomerDropIndicator({ index, active, onDragOverIndex, onDropIndex }: { index: number; active: boolean; onDragOverIndex: (i: number | null) => void; onDropIndex: (i: number) => void }) {
  return (
    <div className="flex w-3 shrink-0 items-center justify-center" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOverIndex(index); }} onDrop={(e) => { e.preventDefault(); onDropIndex(index); }}>
      <span className={`h-9 w-0.5 rounded-full transition ${active ? "bg-samsung opacity-100" : "bg-transparent opacity-0"}`} />
    </div>
  );
}

function ConsultationEditLockDialog({ mode, onCancel, onResume }: { mode: "pb" | "customer"; onCancel: () => void; onResume: () => void }) {
  const canResume = mode === "pb";
  if (!canResume) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-soft">
          <h2 className="text-lg font-extrabold text-navy">상담 종료</h2>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-600">
            상담이 종료되었습니다. 담당 PB에게 상담 재개를 요청해주세요.
          </p>
          <div className="mt-6">
            <button type="button" onClick={onCancel} className="min-h-11 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700">확인</button>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="text-lg font-extrabold text-navy">수정 제한</h2>
        <p className="mt-3 text-sm font-bold leading-6 text-slate-600">
          수정하려면 '상담 재개' 버튼을 눌러주세요.
        </p>
        {!canResume ? (
          <p className="mt-2 text-xs font-bold text-red-600">상담 재개는 담당 PB만 수행할 수 있습니다.</p>
        ) : null}
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50">취소</button>
          <button type="button" onClick={onResume} disabled={!canResume} className="min-h-11 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">상담 재개</button>
        </div>
      </section>
    </div>
  );
}

function DeleteCustomerDialog({ customerLabel, onCancel, onDelete }: { customerLabel: string; onCancel: () => void; onDelete: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700"><Trash2 size={20} /></div>
          <div>
            <h2 className="text-lg font-bold text-navy">고객 정보 삭제</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{customerLabel} 고객 정보가 모두 사라집니다. 정말 삭제하시겠습니까?</p>
          </div>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50">취소</button>
          <button type="button" onClick={onDelete} className="min-h-11 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700">삭제</button>
        </div>
      </section>
    </div>
  );
}

// ── Diff Helper ─────────────────────────────────────────────────────────────
function diffPayload(previous: ReturnType<typeof buildStructuredJsonPayload>, latest: ReturnType<typeof buildStructuredJsonPayload>): ChangeEntry[] {
  const now = Date.now();
  const flattenPayload = (p: ReturnType<typeof buildStructuredJsonPayload>) => [
    ["asset_summary", "자산 요약", p.basic_financial_info.asset_summary],
    ["annual_fixed_income", "연 고정소득", p.basic_financial_info.annual_fixed_income],
    ["return_objective", "투자 목적", p.rrttllu.return.objective],
    ["risk_score", "Risk 점수", `${p.rrttllu.risk.score}점`],
    ["risk_level", "위험등급", p.rrttllu.risk.level],
    ["investment_period", "투자 기간", p.rrttllu.time_horizon.investment_period],
    ["preferred_assets", "선호 자산", p.rrttllu.unique_circumstances.preferred_assets.raw_input],
    ["avoided_assets", "비선호 자산", p.rrttllu.unique_circumstances.avoided_assets.raw_input],
  ] as const;
  const prevMap = Object.fromEntries(flattenPayload(previous).map(([k, , v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "미입력")]));
  return flattenPayload(latest)
    .map(([key, label, v]) => ({ key, label, value: Array.isArray(v) ? v.join(", ") : (v ?? "미입력") }))
    .filter((f) => prevMap[f.key] !== f.value)
    .map((f, i) => ({ label: f.label, before: prevMap[f.key] ?? "미입력", after: f.value, changedAt: now - i }))
    .sort((a, b) => b.changedAt - a.changedAt);
}
