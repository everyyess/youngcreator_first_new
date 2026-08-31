"use client";

import { useEffect, useState } from "react";
import { Activity, FolderOpen } from "lucide-react";
import ExistingPortfolioTab from "../tab1/ExistingPortfolioTab";
import {
  DistributionAndRiskSection,
  EmptyDataPrompt,
  HoldingAndDiagnosisSection,
  usePortfolioResult,
} from "../PortfolioResultComponents";
import SellSimulatorTab from "../SellSimulatorTab";
import { useCustomerContext } from "../CustomerContext";

type InnerTab = "holding" | "risk";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "holding", label: "보유 현황 및 진단", icon: <FolderOpen size={15} /> },
  { id: "risk", label: "분산 및 위험 분석", icon: <Activity size={15} /> },
];

function isVisibleInnerTab(value: unknown): value is InnerTab {
  return value === "holding" || value === "risk";
}

export default function Tab2Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("holding");
  const data = usePortfolioResult();
  const { appMode, sharedUiState, updateSharedUiState } = useCustomerContext();
  const syncedActiveInnerTab = sharedUiState.tab2?.activeInnerTab;

  useEffect(() => {
    if (isVisibleInnerTab(syncedActiveInnerTab) && syncedActiveInnerTab !== activeInnerTab) {
      setActiveInnerTab(syncedActiveInnerTab);
    }
  }, [syncedActiveInnerTab, activeInnerTab]);

  const selectInnerTab = (tab: InnerTab) => {
    setActiveInnerTab(tab);
    if (appMode === "pb") updateSharedUiState({ tab2: { activeInnerTab: tab } });
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
            className={`flex shrink-0 flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition ${activeInnerTab === tab.id ? "bg-[#2f2f9d] text-white shadow-soft" : "bg-[#F3F5F9] text-slate-600 hover:bg-slate-100 hover:text-navy"}`}
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
    </>
  );
}
