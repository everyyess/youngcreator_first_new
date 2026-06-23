"use client";

import { useEffect, useState } from "react";
import { ScatterChart, Globe, RefreshCcw } from "lucide-react";
import CorrelationGlobalTab from "./CorrelationGlobalTab";
import CorrelationDomesticTab from "./CorrelationDomesticTab";
import BuySimulatorTab from "../BuySimulatorTab";
import { useCustomerContext } from "../CustomerContext";

// ─── Sub-tab 정의 ─────────────────────────────────────────────────────────────

type InnerTab = "correlation-domestic" | "correlation-global" | "rebalancing";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "correlation-domestic", label: "상관관계 분석(국내)", icon: <ScatterChart size={15} /> },
  { id: "correlation-global",   label: "상관관계 분석(해외)", icon: <Globe size={15} /> },
  { id: "rebalancing",          label: "리밸런싱(매수)",       icon: <RefreshCcw size={15} /> },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Tab3Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("correlation-domestic");

  const { tab3AnalysisState, updateTab3AnalysisState } = useCustomerContext();

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
    updateTab3AnalysisState({ activeInnerTab: tab });
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
      {activeInnerTab === "correlation-domestic" && (
        <CorrelationDomesticTab
          savedState={tab3AnalysisState.domestic}
          onStateChange={(domestic) => updateTab3AnalysisState({ domestic })}
        />
      )}

      {activeInnerTab === "correlation-global" && (
        <CorrelationGlobalTab
          savedState={tab3AnalysisState.global}
          onStateChange={(global) => updateTab3AnalysisState({ global })}
        />
      )}

      {activeInnerTab === "rebalancing" && <BuySimulatorTab />}
    </>
  );
}
