"use client";

import { useState } from "react";
import { Activity, BarChart2, Bell, BookOpen, FolderOpen, GitBranch, RefreshCcw, TrendingUp } from "lucide-react";
import ExistingPortfolioTab from "../tab1/ExistingPortfolioTab";
import {
  DistributionAndRiskSection,
  EmptyDataPrompt,
  HoldingAndDiagnosisSection,
  usePortfolioResult,
} from "../PortfolioResultComponents";
import TechnicalAnalysisTab from "./TechnicalAnalysisTab";
import OptionAnalysisTab from "./OptionAnalysisTab";
import SupplyDemandAnalysis from "./SupplyDemandAnalysisTab";
import DartAnalysisTab from "./DartAnalysisTab";
import FundamentalAnalysisTab from "./FundamentalAnalysisTab";
import SellSimulatorTab from "../SellSimulatorTab";
import { useCustomerContext } from "../CustomerContext";

type InnerTab = "holding" | "risk" | "fundamental" | "technical" | "supply" | "options" | "dart" | "rebalancing";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "holding", label: "보유 현황 및 진단", icon: <FolderOpen size={15} /> },
  { id: "risk", label: "분산 및 위험 분석", icon: <Activity size={15} /> },
  { id: "technical", label: "기술적 분석", icon: <GitBranch size={15} /> },
  { id: "supply", label: "수급 분석", icon: <TrendingUp size={15} /> },
  { id: "options", label: "옵션 분석", icon: <BarChart2 size={15} /> },
  { id: "fundamental", label: "외부자료 분석", icon: <BookOpen size={15} /> },
  { id: "dart", label: "공시 분석", icon: <Bell size={15} /> },
  { id: "rebalancing", label: "리밸런싱(매도/유지)", icon: <RefreshCcw size={15} /> },
];

export default function Tab2Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("holding");
  const data = usePortfolioResult();
  const { appMode } = useCustomerContext();

  const selectInnerTab = (tab: InnerTab) => {
    setActiveInnerTab(tab);
  };

  if (appMode === "customer") {
    return <SellSimulatorTab />;
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

      {activeInnerTab === "fundamental" && (
        <div className="space-y-5">
          <FundamentalAnalysisTab />
        </div>
      )}

      {activeInnerTab === "technical" && (
        <div className="space-y-5">
          <TechnicalAnalysisTab />
        </div>
      )}

      {activeInnerTab === "supply" && (
        <div className="space-y-5">
          <SupplyDemandAnalysis />
        </div>
      )}

      {activeInnerTab === "options" && (
        <div className="space-y-5">
          <OptionAnalysisTab />
        </div>
      )}

      {activeInnerTab === "dart" && (
        <div className="space-y-5">
          <DartAnalysisTab />
        </div>
      )}

      {activeInnerTab === "rebalancing" && (
        <SellSimulatorTab />
      )}
    </>
  );
}
