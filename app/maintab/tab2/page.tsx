"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart2, FolderOpen, GitBranch, RefreshCcw } from "lucide-react";
import ExistingPortfolioTab from "../tab1/ExistingPortfolioTab";
import {
  DistributionAndRiskSection,
  EmptyDataPrompt,
  HoldingAndDiagnosisSection,
  usePortfolioResult,
} from "../PortfolioResultComponents";
import TechnicalAnalysisTab from "./TechnicalAnalysisTab";
import OptionAnalysisTab from "./OptionAnalysisTab";
import RebalancingPortfolioInput from "../RebalancingPortfolioInput";
import { useCustomerContext } from "../CustomerContext";
import {
  calcFinancialIncomeSummary,
  NEW_PORTFOLIO_INCOME_STORAGE_KEY,
  type AssetForIncomeCalc,
} from "../tab1/FinancialIncomeGauge";
import { parseKoreanNumber } from "@/lib/portfolioLogic";

// ─── Sub-tab 정의 ─────────────────────────────────────────────────────────────

type InnerTab = "holding" | "risk" | "technical" | "options" | "rebalancing";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "holding",     label: "보유 현황 및 진단",  icon: <FolderOpen size={15} /> },
  { id: "risk",        label: "분산 및 위험 분석",  icon: <Activity size={15} /> },
  { id: "technical",   label: "기술적 분석",        icon: <GitBranch size={15} /> },
  { id: "options",     label: "옵션 분석",          icon: <BarChart2 size={15} /> },
  { id: "rebalancing", label: "리밸런싱(매도/유지)", icon: <RefreshCcw size={15} /> },
];

const STORAGE_KEY = "samsung-vvip-tab2-inner-tab";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Tab2Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("holding");
  const data = usePortfolioResult();
  const {
    portfolioAssets,
    rebalancingSellAssets,
    setRebalancingSellAssets,
    confirmRebalancingSell,
    analysisResult,
    formData,
  } = useCustomerContext();

  const tMarginal = useMemo(() => {
    const total = parseKoreanNumber(formData.financial.totalAssets);
    if (total >= 5e9) return 0.45;
    if (total >= 3e9) return 0.40;
    if (total >= 1.2e9) return 0.35;
    return 0.38;
  }, [formData.financial.totalAssets]);

  const handleConfirmSell = () => {
    confirmRebalancingSell();

    const enrichedMap = new Map(
      (analysisResult?.enrichedAssets ?? []).map(e => [
        `${e.name ?? ""}::${e.ticker ?? ""}`, e as Record<string, unknown>
      ])
    );

    const assetsForCalc: AssetForIncomeCalc[] = rebalancingSellAssets
      .map((a) => {
        const isBond = a.productType === "국내채권" || a.productType === "해외채권";
        const resolvedName = a.name || (isBond ? (a.productType ?? "채권") : "");
        if (!resolvedName) return null;
        const key = `${a.name ?? ""}::${a.ticker ?? ""}`;
        const enriched = enrichedMap.get(key);
        const interestRate = a.bond_yield != null && a.bond_yield > 0 ? a.bond_yield / 100 : undefined;
        return {
          name: resolvedName,
          ticker: a.ticker ?? "",
          asset_class: a.asset_class,
          productType: a.productType,
          country: a.country,
          current_price: (enriched?.current_price as number | undefined) ?? a.current_price,
          current_value: (enriched?.current_value as number | undefined) ?? a.current_value,
          amount: a.amount,
          amount_type: a.amount_type,
          buy_price: a.buy_price,
          dividendYield: enriched?.dividendYield as number | undefined,
          interestRate,
        } as AssetForIncomeCalc;
      })
      .filter((x): x is AssetForIncomeCalc => x !== null);

    if (assetsForCalc.length > 0) {
      const summary = calcFinancialIncomeSummary(assetsForCalc, tMarginal);
      try {
        localStorage.setItem(NEW_PORTFOLIO_INCOME_STORAGE_KEY, JSON.stringify(summary));
        window.dispatchEvent(new CustomEvent("new-financial-income-updated"));
      } catch {}
    }
  };

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "holding" || stored === "risk" || stored === "technical" || stored === "options" || stored === "rebalancing") {
      setActiveInnerTab(stored);
    }
  }, []);

  const selectInnerTab = (tab: InnerTab) => {
    setActiveInnerTab(tab);
    window.localStorage.setItem(STORAGE_KEY, tab);
  };

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
      {activeInnerTab === "holding" && (
        <div className="space-y-5">
          <ExistingPortfolioTab />
          {data && <HoldingAndDiagnosisSection data={data} />}
        </div>
      )}

      {activeInnerTab === "risk" && (
        <div className="space-y-5">
          {data
            ? <DistributionAndRiskSection data={data} />
            : <EmptyDataPrompt message="'보유 현황 및 진단' 탭에서 자산을 입력하고 분석 실행을 눌러주세요." />
          }
        </div>
      )}

      {activeInnerTab === "technical" && (
        <div className="space-y-5">
          <TechnicalAnalysisTab />
        </div>
      )}

      {activeInnerTab === "options" && (
        <div className="space-y-5">
          <OptionAnalysisTab />
        </div>
      )}

      {activeInnerTab === "rebalancing" && (
        <RebalancingPortfolioInput
          assets={rebalancingSellAssets}
          seedAssets={portfolioAssets}
          onAssetsChange={setRebalancingSellAssets}
          onConfirm={handleConfirmSell}
          sectionTitle="자산 입력 및 분석 실행"
          sectionBadge="리밸런싱 편출 관리"
          noticeBanner="보유 현황 및 진단 페이지의 포트폴리오를 불러왔습니다. 편출(매도)할 종목을 삭제하거나 수량을 조정하세요. 이 페이지의 변경사항은 보유 현황 및 진단 페이지에 반영되지 않습니다."
          confirmSuccessMessage="편출 목록이 확정되었습니다. TAB3 리밸런싱(매수) 페이지에서 편입할 종목을 추가하세요."
        />
      )}
    </>
  );
}
