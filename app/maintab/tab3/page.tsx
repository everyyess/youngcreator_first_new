"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe, RefreshCcw, ScatterChart } from "lucide-react";
import CorrelationGlobalTab from "./CorrelationGlobalTab";
import CorrelationDomesticTab from "./CorrelationDomesticTab";
import RebalancingPortfolioInput from "../RebalancingPortfolioInput";
import { useCustomerContext } from "../CustomerContext";
import { parseKoreanNumber } from "@/lib/portfolioLogic";
import {
  calcFinancialIncomeSummary,
  NEW_PORTFOLIO_INCOME_STORAGE_KEY,
  type AssetForIncomeCalc,
} from "../tab1/FinancialIncomeGauge";

type InnerTab = "correlation-domestic" | "correlation-global" | "rebalancing";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "correlation-domestic", label: "상관관계 분석(국내)", icon: <ScatterChart size={15} /> },
  { id: "correlation-global", label: "상관관계 분석(해외)", icon: <Globe size={15} /> },
  { id: "rebalancing", label: "리밸런싱(매수)", icon: <RefreshCcw size={15} /> },
];

const rebalancingCopy = {
  sectionTitle: "자산 입력 및 생성 실행",
  sectionBadge: "리밸런싱 편입 관리",
  noticeBanner:
    "TAB2 리밸런싱에서 편출 결정된 포트폴리오를 불러왔습니다. 편입(매수)할 종목을 추가하세요. 이 페이지의 변경사항은 TAB2 리밸런싱 또는 보유 현황 및 진단 페이지에 반영되지 않습니다.",
  confirmSuccessMessage:
    "신규 포트폴리오 생성이 완료되었습니다. TAB4 포트폴리오 비교 페이지에서 결과를 확인하세요.",
};

function isBondProduct(productType?: string) {
  return productType === "국내채권" || productType === "해외채권";
}

export default function Tab3Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("correlation-domestic");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const {
    formData,
    rebalancingSellAssets,
    rebalancingBuyAssets,
    setRebalancingBuyAssets,
    confirmRebalancingBuy,
    resetRebalancingBuySummary,
    setNewPortfolioAnalysisResult,
    tab3AnalysisState,
    updateTab3AnalysisState,
    saveTaxSummary,
    portfolioAssets,
    analysisResult,
    appMode,
  } = useCustomerContext();

  useEffect(() => {
    if (
      tab3AnalysisState.activeInnerTab === "correlation-domestic" ||
      tab3AnalysisState.activeInnerTab === "correlation-global" ||
      tab3AnalysisState.activeInnerTab === "rebalancing"
    ) {
      setActiveInnerTab(tab3AnalysisState.activeInnerTab);
    }
  }, [tab3AnalysisState.activeInnerTab]);

  const selectInnerTab = (tab: InnerTab) => {
    setActiveInnerTab(tab);
    updateTab3AnalysisState({ activeInnerTab: tab }, { allowReadOnlyViewState: true });
  };

  const tMarginal = useMemo(() => {
    const income = parseKoreanNumber(formData.financial.annualFixedIncome ?? "");
    if (income > 1_000_000_000) return 0.45;
    if (income > 500_000_000) return 0.42;
    if (income > 300_000_000) return 0.4;
    if (income > 150_000_000) return 0.38;
    if (income > 88_000_000) return 0.35;
    if (income > 50_000_000) return 0.24;
    if (income > 14_000_000) return 0.15;
    return 0.06;
  }, [formData.financial.annualFixedIncome]);

  const handleConfirmBuy = useCallback(async () => {
    if (!rebalancingBuyAssets.length) return;
    setIsAnalyzing(true);
    try {
      const { runAnalysis } = await import("@/lib/portfolioLogic");
      const result = await runAnalysis(rebalancingBuyAssets, {
        tMarginal,
        expectedInterestIncome: formData.rrttllu.expectedInterestIncome,
        expectedDividendIncome: formData.rrttllu.expectedDividendIncome,
      });

      if (!result) return;

      confirmRebalancingBuy();
      setNewPortfolioAnalysisResult(result);

      try {
        localStorage.setItem("new-portfolio-assets-v1", JSON.stringify(rebalancingBuyAssets));
        window.dispatchEvent(new CustomEvent("portfolio-result-updated"));
      } catch {}

      const assetsForCalc: AssetForIncomeCalc[] = (result.enrichedAssets ?? [])
        .map((asset) => {
          const isBond = isBondProduct(asset.productType);
          const resolvedName = asset.name || (isBond ? (asset.productType ?? "채권") : "");
          if (!resolvedName) return null;
          const enriched = asset as unknown as Record<string, unknown>;
          const interestRate = asset.bond_yield != null && asset.bond_yield > 0 ? asset.bond_yield / 100 : undefined;
          return {
            name: resolvedName,
            ticker: asset.ticker ?? "",
            asset_class: asset.asset_class,
            productType: asset.productType,
            country: asset.country,
            current_price: asset.current_price,
            current_value: asset.current_value,
            amount: asset.amount,
            amount_type: asset.amount_type,
            buy_price: isBond ? asset.buy_price : undefined,
            dividendYield: enriched.dividendYield as number | undefined,
            interestRate,
          } as AssetForIncomeCalc;
        })
        .filter((asset): asset is AssetForIncomeCalc => asset !== null);

      if (!assetsForCalc.length) return;

      const originalEnrichedMap = new Map(
        (analysisResult?.enrichedAssets ?? []).map((asset) => [
          `${asset.name ?? ""}::${asset.ticker ?? ""}`,
          asset as Record<string, unknown>,
        ]),
      );
      const keepSet = new Set(rebalancingSellAssets.map((asset) => `${asset.name ?? ""}::${asset.ticker ?? ""}`));
      const soldAssets = portfolioAssets.filter((asset) => !keepSet.has(`${asset.name ?? ""}::${asset.ticker ?? ""}`));

      const soldAssetsForCalc: AssetForIncomeCalc[] = soldAssets
        .map((asset) => {
          const isBond = isBondProduct(asset.productType);
          const resolvedName = asset.name || (isBond ? (asset.productType ?? "채권") : "");
          if (!resolvedName) return null;
          const key = `${asset.name ?? ""}::${asset.ticker ?? ""}`;
          const enriched = originalEnrichedMap.get(key);
          return {
            name: resolvedName,
            ticker: asset.ticker ?? "",
            asset_class: asset.asset_class,
            productType: asset.productType,
            country: asset.country,
            current_price: (enriched?.current_price as number | undefined) ?? asset.current_price,
            current_value: (enriched?.current_value as number | undefined) ?? asset.current_value,
            amount: asset.amount,
            amount_type: asset.amount_type,
            buy_price: asset.buy_price,
            dividendYield: undefined,
            interestRate: undefined,
          } as AssetForIncomeCalc;
        })
        .filter((asset): asset is AssetForIncomeCalc => asset !== null);

      const originalAmountMap = new Map(portfolioAssets.map((asset) => [`${asset.name ?? ""}::${asset.ticker ?? ""}`, asset]));
      const partiallySoldAssetsForCalc: AssetForIncomeCalc[] = rebalancingSellAssets
        .map((asset) => {
          if (asset.amount_type !== "quantity") return null;
          if (isBondProduct(asset.productType)) return null;
          const resolvedName = asset.name || "";
          if (!resolvedName) return null;
          const key = `${asset.name ?? ""}::${asset.ticker ?? ""}`;
          const original = originalAmountMap.get(key);
          const enriched = originalEnrichedMap.get(key);
          if (!original || original.amount_type !== "quantity" || original.buy_price == null) return null;
          const soldAmount = original.amount - asset.amount;
          if (soldAmount <= 0) return null;
          return {
            name: resolvedName,
            ticker: asset.ticker ?? "",
            asset_class: asset.asset_class,
            productType: asset.productType,
            country: asset.country,
            current_price: (enriched?.current_price as number | undefined) ?? asset.current_price,
            current_value: undefined,
            amount: soldAmount,
            amount_type: "quantity" as const,
            buy_price: original.buy_price,
            dividendYield: undefined,
            interestRate: undefined,
          } as AssetForIncomeCalc;
        })
        .filter((asset): asset is AssetForIncomeCalc => asset !== null);

      const combinedAssetsForCalc = [...soldAssetsForCalc, ...partiallySoldAssetsForCalc, ...assetsForCalc];
      const newTaxSummary = calcFinancialIncomeSummary(combinedAssetsForCalc, tMarginal);
      try {
        localStorage.setItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY, JSON.stringify(newTaxSummary));
        window.dispatchEvent(new CustomEvent("new-financial-income-updated"));
      } catch {}
      saveTaxSummary("new", newTaxSummary);
    } catch (err) {
      console.error("[Tab3] 신규 포트폴리오 분석 실패:", err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    analysisResult,
    confirmRebalancingBuy,
    formData.rrttllu,
    portfolioAssets,
    rebalancingBuyAssets,
    rebalancingSellAssets,
    saveTaxSummary,
    setNewPortfolioAnalysisResult,
    tMarginal,
  ]);

  if (appMode === "customer") {
    return (
      <RebalancingPortfolioInput
        assets={rebalancingBuyAssets}
        seedAssets={rebalancingSellAssets}
        onAssetsChange={setRebalancingBuyAssets}
        onConfirm={handleConfirmBuy}
        onReset={resetRebalancingBuySummary}
        isConfirming={isAnalyzing}
        {...rebalancingCopy}
      />
    );
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
            className={`flex shrink-0 flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition ${
              activeInnerTab === tab.id
                ? "bg-[#2f2f9d] text-white shadow-soft"
                : "text-slate-600 hover:bg-slate-100 hover:text-navy"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeInnerTab === "correlation-domestic" && (
        <CorrelationDomesticTab
          savedState={tab3AnalysisState.domestic}
          onStateChange={(domestic) => updateTab3AnalysisState({ domestic }, { allowReadOnlyViewState: true })}
        />
      )}

      {activeInnerTab === "correlation-global" && (
        <CorrelationGlobalTab
          savedState={tab3AnalysisState.global}
          onStateChange={(global) => updateTab3AnalysisState({ global }, { allowReadOnlyViewState: true })}
        />
      )}

      {activeInnerTab === "rebalancing" && (
        <RebalancingPortfolioInput
          assets={rebalancingBuyAssets}
          seedAssets={rebalancingSellAssets}
          onAssetsChange={setRebalancingBuyAssets}
          onConfirm={handleConfirmBuy}
          onReset={resetRebalancingBuySummary}
          isConfirming={isAnalyzing}
          {...rebalancingCopy}
        />
      )}
    </>
  );
}
