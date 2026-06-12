"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ScatterChart, Globe, RefreshCcw } from "lucide-react";
import CorrelationGlobalTab from "./CorrelationGlobalTab";
import CorrelationDomesticTab from "./CorrelationDomesticTab";
import RebalancingPortfolioInput from "../RebalancingPortfolioInput";
import { useCustomerContext } from "../CustomerContext";
import { parseKoreanNumber } from "@/lib/portfolioLogic";

// ─── Sub-tab 정의 ─────────────────────────────────────────────────────────────

type InnerTab = "correlation-domestic" | "correlation-global" | "rebalancing";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "correlation-domestic", label: "상관관계 분석(국내)", icon: <ScatterChart size={15} /> },
  { id: "correlation-global",   label: "상관관계 분석(해외)", icon: <Globe size={15} /> },
  { id: "rebalancing",          label: "리밸런싱(매수)",       icon: <RefreshCcw size={15} /> },
];

const STORAGE_KEY = "samsung-vvip-tab3-inner-tab";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Tab3Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("correlation-domestic");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const {
    formData,
    rebalancingSellAssets,
    rebalancingBuyAssets,
    setRebalancingBuyAssets,
    setNewPortfolioAnalysisResult,
  } = useCustomerContext();

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "correlation-domestic" || stored === "correlation-global" || stored === "rebalancing") {
      setActiveInnerTab(stored);
    }
  }, []);

  const selectInnerTab = (tab: InnerTab) => {
    setActiveInnerTab(tab);
    window.localStorage.setItem(STORAGE_KEY, tab);
  };

  // 탭 2-1과 동일한 한계세율 추정 로직
  const tMarginal = useMemo(() => {
    const total = parseKoreanNumber(formData.financial.totalAssets);
    if (total >= 5e9) return 0.45;
    if (total >= 3e9) return 0.40;
    if (total >= 1.2e9) return 0.35;
    return 0.38;
  }, [formData.financial.totalAssets]);

  // 리밸런싱 매수 확정 → 신규 포트폴리오 정량 분석 실행
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
      if (result) {
        setNewPortfolioAnalysisResult(result);
      }
    } catch (err) {
      console.error("[Tab3] 신규 포트폴리오 분석 실패:", err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [rebalancingBuyAssets, tMarginal, formData.rrttllu, setNewPortfolioAnalysisResult]);

  return (
    <>
      {/* 서브 탭 내비게이션 바 */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-soft overflow-x-auto">
        {innerTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
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

      {/* 서브 탭 콘텐츠 */}
      {activeInnerTab === "correlation-domestic" && (
        <CorrelationDomesticTab />
      )}

      {activeInnerTab === "correlation-global" && (
        <CorrelationGlobalTab />
      )}

      {activeInnerTab === "rebalancing" && (
        <RebalancingPortfolioInput
          assets={rebalancingBuyAssets}
          seedAssets={rebalancingSellAssets}
          onAssetsChange={setRebalancingBuyAssets}
          onConfirm={handleConfirmBuy}
          isConfirming={isAnalyzing}
          sectionTitle="자산 입력 및 분석 실행"
          sectionBadge="리밸런싱 편입 관리"
          noticeBanner="TAB2 리밸런싱에서 편출 결정된 포트폴리오를 불러왔습니다. 편입(매수)할 종목을 추가하세요. 이 페이지의 변경사항은 TAB2 리밸런싱 또는 보유 현황 및 진단 페이지에 반영되지 않습니다."
          confirmSuccessMessage="신규 포트폴리오 분석이 완료되었습니다. TAB5 포트폴리오 비교 페이지에서 결과를 확인하세요."
        />
      )}
    </>
  );
}
