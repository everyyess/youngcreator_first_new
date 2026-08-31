"use client";

import { useEffect, useState } from "react";
import { PackageCheck, RefreshCcw } from "lucide-react";
import BuySimulatorTab from "../BuySimulatorTab";
import ProductMatchingTab from "../tab5/page";
import { useCustomerContext } from "../CustomerContext";

type InnerTab = "stock-rebalancing" | "product-rebalancing";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "stock-rebalancing", label: "리밸런싱(주식)", icon: <RefreshCcw size={15} /> },
  { id: "product-rebalancing", label: "리밸런싱(상품)", icon: <PackageCheck size={15} /> },
];

function isVisibleInnerTab(value: unknown): value is InnerTab {
  return value === "stock-rebalancing" || value === "product-rebalancing";
}

export default function Tab3Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("stock-rebalancing");
  const { appMode, tab3AnalysisState, updateTab3AnalysisState } = useCustomerContext();
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
    </>
  );
}
