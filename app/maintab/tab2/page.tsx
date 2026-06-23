"use client";

import { useEffect, useState } from "react";
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

// ─── Sub-tab 정의 ─────────────────────────────────────────────────────────────

type InnerTab = "holding" | "risk" | "fundamental" | "technical" | "supply" | "options" | "dart" | "rebalancing";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "holding",     label: "보유 현황 및 진단",  icon: <FolderOpen size={15} /> },
  { id: "risk",        label: "분산 및 위험 분석",  icon: <Activity size={15} /> },
  { id: "technical",   label: "기술적 분석",        icon: <GitBranch size={15} /> },
  { id: "supply",      label: "수급 분석",          icon: <TrendingUp size={15} /> },
  { id: "options",     label: "옵션 분석",          icon: <BarChart2 size={15} /> },
  { id: "fundamental", label: "외부자료 분석",       icon: <BookOpen size={15} /> },
  { id: "dart",        label: "공시 분석",           icon: <Bell size={15} /> },
  { id: "rebalancing", label: "리밸런싱(매도/유지)", icon: <RefreshCcw size={15} /> },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

const TAB2_SUBTAB_KEY = "tab2-active-subtab";

const VALID_TABS: InnerTab[] = ["holding", "risk", "fundamental", "technical", "supply", "options", "dart", "rebalancing"];

export default function Tab2Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("holding");

  useEffect(() => {
    const stored = localStorage.getItem(TAB2_SUBTAB_KEY);
    if ((VALID_TABS as string[]).includes(stored ?? "")) {
      setActiveInnerTab(stored as InnerTab);
    }
  }, []);
  const data = usePortfolioResult();

  const selectInnerTab = (tab: InnerTab) => {
    setActiveInnerTab(tab);
    localStorage.setItem(TAB2_SUBTAB_KEY, tab);
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
