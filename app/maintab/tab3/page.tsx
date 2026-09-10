"use client";

import { useEffect, useRef, useState } from "react";
import { History, PackageCheck, RefreshCcw } from "lucide-react";
import BuySimulatorTab from "../BuySimulatorTab";
import ProductMatchingTab from "../tab5/page";
import RebalancingHistoryTab from "../RebalancingHistoryTab";
import { useCustomerContext } from "../CustomerContext";
import { calcFinancialIncomeSummary, NEW_PORTFOLIO_INCOME_STORAGE_KEY, type AssetForIncomeCalc } from "../tab1/FinancialIncomeGauge";

type InnerTab = "stock-rebalancing" | "product-rebalancing" | "rebalancing-history";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "stock-rebalancing", label: "리밸런싱(주식)", icon: <RefreshCcw size={15} /> },
  { id: "product-rebalancing", label: "리밸런싱(상품)", icon: <PackageCheck size={15} /> },
  { id: "rebalancing-history", label: "리밸런싱 히스토리", icon: <History size={15} /> },
];

function isVisibleInnerTab(value: unknown): value is InnerTab {
  return value === "stock-rebalancing" || value === "product-rebalancing" || value === "rebalancing-history";
}

export default function Tab3Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("stock-rebalancing");
  const {
    appMode, tab3AnalysisState, updateTab3AnalysisState,
    rebalancingSellAssets, setRebalancingBuyAssets, setNewPortfolioAnalysisResult,
    confirmRebalancingBuy, saveTaxSummary, sellHistory, formData, selectedCustomer,
    setIsNewPortfolioAnalyzing,
  } = useCustomerContext();
  const syncedActiveInnerTab = tab3AnalysisState.activeInnerTab;

  // 구버전 고객 TAB5 북마크는 신형 TAB3의 상품 리밸런싱 화면으로 이어 준다.
  // URL로 탭을 지정해 들어온 경우를 기억해 두고, 아래 동기화 effect가 첫 저장값 복원으로
  // 이 선택을 덮어쓰지 않게 한다.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    const requestedInnerTab = new URLSearchParams(window.location.search).get("innerTab");
    if (isVisibleInnerTab(requestedInnerTab)) {
      deepLinkedRef.current = true;
      setActiveInnerTab(requestedInnerTab);
    }
  }, []);

  // PB가 탭을 옮겼을 때만 따라간다.
  // deps에 activeInnerTab을 넣고 매번 비교하면, 고객이 스스로 고른 탭이 곧바로
  // PB 값으로 되돌아가 자유 열람이 불가능해진다. 그래서 "동기화 값이 실제로 바뀐 순간"만
  // ref로 판별해 반영한다 — 그 사이 고객의 로컬 선택은 그대로 유지된다.
  const lastSyncedInnerTabRef = useRef<string | undefined>(syncedActiveInnerTab);
  useEffect(() => {
    if (syncedActiveInnerTab === lastSyncedInnerTabRef.current) return;
    // 저장값이 처음 복원되는 순간(undefined → 값)은 "PB가 탭을 옮김"이 아니다.
    // URL로 탭을 지정해 들어왔다면 그 선택을 존중하고, 복원값은 기준선으로만 삼는다.
    // (딥링크가 없으면 평소처럼 PB의 현재 탭을 따라 연다)
    const isInitialRestore = lastSyncedInnerTabRef.current === undefined;
    lastSyncedInnerTabRef.current = syncedActiveInnerTab;
    if (isInitialRestore && deepLinkedRef.current) return;
    if (isVisibleInnerTab(syncedActiveInnerTab)) setActiveInnerTab(syncedActiveInnerTab);
  }, [syncedActiveInnerTab]);

  const selectInnerTab = (tab: InnerTab) => {
    setActiveInnerTab(tab);
    // 고객 화면은 읽기 전용이다. 탭 전환은 자유롭게 하되 공유 상태에는 쓰지 않는다
    // (쓰면 고객 조작이 PB 화면까지 바꾼다).
    if (appMode === "customer") return;
    updateTab3AnalysisState({ activeInnerTab: tab }, { allowReadOnlyViewState: true });
  };

  // ── 신규 포트폴리오 실시간 재분석·세금 계산 ──────────────────────────────────
  // 탭3-1(주식 매수/매도)·탭3-2(상품/채권 편입) 어느 쪽에서 rebalancingSellAssets가 바뀌든
  // (두 탭은 조건부 렌더링이라 서로 언마운트되므로, 항상 마운트된 이 부모에서 감지해야 함)
  // "리밸런싱 확정" 버튼 없이 자동으로 시세 재분석 + 세금 요약 재계산·저장을 수행한다.
  // 800ms 디바운스로 연속 편집 중 불필요한 재분석을 줄인다.
  const sellHistoryRef = useRef(sellHistory);
  sellHistoryRef.current = sellHistory;
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const selectedCustomerRef = useRef(selectedCustomer);
  selectedCustomerRef.current = selectedCustomer;

  useEffect(() => {
    if (appMode === "customer") {
      setIsNewPortfolioAnalyzing(false);
      return;
    }
    if (rebalancingSellAssets.length === 0) {
      setIsNewPortfolioAnalyzing(false); // 포트폴리오가 비면 분석할 게 없으니 로딩 상태도 해제(끼임 방지)
      return;
    }
    const customerAtStart = selectedCustomerRef.current;
    const snapshot = rebalancingSellAssets;

    // 디바운스 대기 시작부터 "최신 반영 중" — TAB4가 이 값을 보고 로딩 표시를 띄운다.
    setIsNewPortfolioAnalyzing(true);

    const timer = setTimeout(async () => {
      try {
        const { runAnalysis } = await import("@/lib/portfolioLogic");
        const fd = formDataRef.current;
        const total = parseFloat(fd.financial.totalAssets.replace(/[^0-9.]/g, "")) || 0;
        const tm = total >= 5e9 ? 0.45 : total >= 3e9 ? 0.40 : total >= 1.2e9 ? 0.35 : 0.38;

        const result = await runAnalysis(snapshot, {
          tMarginal: tm,
          expectedInterestIncome: fd.rrttllu.expectedInterestIncome,
          expectedDividendIncome: fd.rrttllu.expectedDividendIncome,
        });
        // 재분석 대기 중 고객이 전환됐으면 결과를 버림 — 잘못된 고객에게 덮어쓰기 방지
        if (selectedCustomerRef.current !== customerAtStart || !result) return;

        setNewPortfolioAnalysisResult(result);
        setRebalancingBuyAssets(snapshot);
        confirmRebalancingBuy();

        const assetsForCalc: AssetForIncomeCalc[] = (result.enrichedAssets ?? [])
          .map((a) => {
            const isBond = a.productType === "국내채권" || a.productType === "해외채권";
            const resolvedName = a.name || (isBond ? (a.productType ?? "채권") : "");
            if (!resolvedName) return null;
            const interestRate = a.bond_yield != null && a.bond_yield > 0 ? a.bond_yield / 100 : undefined;
            const enriched = a as unknown as Record<string, unknown>;
            return {
              name: resolvedName,
              ticker: a.ticker ?? "",
              asset_class: a.asset_class,
              productType: a.productType,
              country: a.country,
              current_price: a.current_price,
              current_value: a.current_value,
              amount: a.amount,
              amount_type: a.amount_type,
              buy_price: isBond ? a.buy_price : undefined,
              dividendYield: enriched.dividendYield as number | undefined,
              trailingAnnualDividendRate: enriched.trailingAnnualDividendRate as number | undefined,
              calendarYtdDividendRate: enriched.calendarYtdDividendRate as number | undefined,
              interestRate,
              issuerCountry: enriched.issuerCountry as string | undefined,
              couponType: enriched.couponType as AssetForIncomeCalc["couponType"],
              isPerpetual: enriched.isPerpetual as boolean | undefined,
              maturityDate: enriched.maturityDate as string | undefined,
            } as AssetForIncomeCalc;
          })
          .filter((x): x is AssetForIncomeCalc => x !== null);

        // 매도로 실현된 손익(해외주식 양도소득세 대상)은 현재 보유 목록엔 안 남으므로 sellHistory에서 따로 가져온다.
        const realizedSales = sellHistoryRef.current.map((r) => ({
          name: r.name,
          productType: r.productType,
          realizedGain: r.realizedGain,
        }));
        const newTaxSummary = calcFinancialIncomeSummary(assetsForCalc, tm, realizedSales);
        try {
          localStorage.setItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY, JSON.stringify(newTaxSummary));
          window.dispatchEvent(new CustomEvent("new-financial-income-updated"));
        } catch {
          // localStorage 실패 무시
        }
        saveTaxSummary("new", newTaxSummary);
      } catch (err) {
        console.error("[Tab3Page] 신규 포트폴리오 실시간 재분석 오류:", err);
      } finally {
        setIsNewPortfolioAnalyzing(false);
      }
    }, 800);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, rebalancingSellAssets]);

  // 고객 화면도 PB 상담실과 완전히 같은 내부 탭 구조를 쓴다.
  // 리밸런싱 히스토리는 고객도 볼 수 있고(근거 입력란만 읽기 전용),
  // 「분석실로 이동」만 PB 분석실 진입 경로라 고객에게 노출하지 않는다.
  const isCustomer = appMode === "customer";

  return (
    <>
      <div data-consultation-lock-exempt="true" className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-soft">
        {innerTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-consultation-lock-exempt="true"
            onClick={() => selectInnerTab(tab.id)}
            className={`flex shrink-0 flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition ${activeInnerTab === tab.id ? "bg-[#2563eb] text-white shadow-soft" : "bg-[#F3F5F9] text-slate-600 hover:bg-slate-100 hover:text-navy"}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        {/* 분석실은 PB 전용 화면이라 고객 화면에서는 진입 버튼을 노출하지 않는다 */}
        {!isCustomer && (
          <button
            type="button"
            data-consultation-lock-exempt="true"
            onClick={() => {
              // "/analysis/screener"는 실제로 존재하는 라우트가 아니라 [tab]/page.tsx에서 매핑 실패로
              // "/analysis/tab1"로 서버 리다이렉트되는데, 그 과정에서 쿼리스트링이 버려진다 — 그래서
              // returnTab을 sessionStorage에만 의존하면 새 탭에서 유실될 수 있다. 처음부터 실제
              // 목적지(tab1=종목분석)로 직접 이동하고 returnTab을 쿼리로 실어 보낸다.
              sessionStorage.setItem("analysisReturnTab", "tab3");
              window.open("/analysis/tab1?returnTab=tab3", "_blank", "noopener,noreferrer");
            }}
            className="shrink-0 rounded-md border border-samsung/30 bg-samsung/5 px-3 py-2.5 text-xs font-bold text-samsung transition hover:bg-samsung/10"
          >
            분석실로 이동
          </button>
        )}
      </div>

      {activeInnerTab === "stock-rebalancing" && <BuySimulatorTab />}
      {activeInnerTab === "product-rebalancing" && <ProductMatchingTab />}
      {activeInnerTab === "rebalancing-history" && <RebalancingHistoryTab />}
    </>
  );
}
