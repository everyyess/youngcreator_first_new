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
  } = useCustomerContext();
  const syncedActiveInnerTab = tab3AnalysisState.activeInnerTab;

  useEffect(() => {
    if (isVisibleInnerTab(syncedActiveInnerTab) && syncedActiveInnerTab !== activeInnerTab) {
      setActiveInnerTab(syncedActiveInnerTab);
    }
  }, [syncedActiveInnerTab, activeInnerTab]);

  const selectInnerTab = (tab: InnerTab) => {
    setActiveInnerTab(tab);
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
    if (rebalancingSellAssets.length === 0) return;
    const customerAtStart = selectedCustomerRef.current;
    const snapshot = rebalancingSellAssets;

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
      }
    }, 800);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebalancingSellAssets]);

  if (appMode === "customer") {
    return <BuySimulatorTab />;
  }

  return (
    <>
      <div data-consultation-lock-exempt="true" className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-soft">
        {innerTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-consultation-lock-exempt="true"
            onClick={() => selectInnerTab(tab.id)}
            className={`flex shrink-0 flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition ${activeInnerTab === tab.id ? "bg-[#2f2f9d] text-white shadow-soft" : "bg-[#F3F5F9] text-slate-600 hover:bg-slate-100 hover:text-navy"}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeInnerTab === "stock-rebalancing" && <BuySimulatorTab />}
      {activeInnerTab === "product-rebalancing" && <ProductMatchingTab />}
      {activeInnerTab === "rebalancing-history" && <RebalancingHistoryTab />}
    </>
  );
}
