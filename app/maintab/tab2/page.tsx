"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { useCustomerContext, type PortfolioAsset } from "../CustomerContext";
import { sectorToDomesticTicker, sectorToGlobalTicker } from "../sectorTickerMap";

type InnerTab = "holding" | "risk" | "fundamental" | "technical" | "supply" | "options" | "dart" | "rebalancing";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "holding", label: "보유 현황 및 진단", icon: <FolderOpen size={15} /> },
  { id: "risk", label: "분산 및 위험 분석", icon: <Activity size={15} /> },
  { id: "technical", label: "기술적 분석", icon: <GitBranch size={15} /> },
  { id: "options", label: "옵션 분석", icon: <BarChart2 size={15} /> },
  { id: "supply", label: "수급 분석", icon: <TrendingUp size={15} /> },
  { id: "fundamental", label: "외부자료 분석", icon: <BookOpen size={15} /> },
  { id: "dart", label: "공시 분석", icon: <Bell size={15} /> },
  { id: "rebalancing", label: "리밸런싱", icon: <RefreshCcw size={15} /> },
];

function dominantSector(assets: PortfolioAsset[]): string | null {
  const totals: Record<string, number> = {};
  for (const a of assets) {
    const s = a.sector;
    if (!s || s === "기타") continue;
    totals[s] = (totals[s] ?? 0) + (a.current_value ?? a.weight ?? 1);
  }
  const entries = Object.entries(totals);
  if (!entries.length) return null;
  return entries.sort((x, y) => y[1] - x[1])[0][0];
}

export default function Tab2Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("holding");
  const data = usePortfolioResult();
  const {
    appMode,
    analysisResult,
    rebalancingSellAssets,
    tab3AnalysisState,
    updateTab3AnalysisState,
  } = useCustomerContext();
  const router = useRouter();

  const goToTab3 = () => {
    // 리밸런싱(매도/유지) 탭과 동일 기준으로 베이스 자산 결정
    // rebalancingSellAssets는 raw 자산(sector 없음) → enrichedAssets에서 sector 보완
    const enriched = (analysisResult?.enrichedAssets ?? []) as PortfolioAsset[];
    const sectorMap = new Map(enriched.map(a => [`${a.name}::${a.ticker ?? ""}`, a.sector]));
    const rawBase = rebalancingSellAssets.length > 0 ? rebalancingSellAssets : enriched;
    const base = rawBase.map(a => ({
      ...a,
      sector: a.sector ?? sectorMap.get(`${a.name}::${a.ticker ?? ""}`),
    }));
    const held = base.filter((a) => a.name && !(a.amount_type === "quantity" && a.amount <= 0));

    const byPt = (types: string[]) =>
      held.filter((a) => types.includes((a.productType ?? a.asset_class ?? "").trim()));

    const domDomesticSector = dominantSector(byPt(["국내주식", "국내ETF"]));
    const domGlobalSector   = dominantSector(byPt(["해외주식", "해외ETF"]));

    // 섹터명 → API가 수용하는 ETF 티커로 변환
    const domesticTicker = sectorToDomesticTicker(domDomesticSector);
    const globalTicker   = sectorToGlobalTicker(domGlobalSector);

    if (domesticTicker || globalTicker) {
      updateTab3AnalysisState(
        {
          domestic: { ...tab3AnalysisState.domestic, lockedTicker: domesticTicker },
          global:   { ...tab3AnalysisState.global,   lockedTicker: globalTicker },
        },
        { allowReadOnlyViewState: true },
      );
    }

    router.push(appMode === "customer" ? "/customer-maintab/tab3" : "/maintab/tab3");
  };

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
        <div className="space-y-4">
          <SellSimulatorTab />
          <div className="flex items-center justify-end rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-soft">
            <button
              type="button"
              onClick={goToTab3}
              className="flex items-center gap-2 rounded-lg bg-[#2f2f9d] px-5 py-2 text-sm font-bold text-white shadow transition hover:bg-[#1e1e8a]"
            >
              리밸런싱 확정 → TAB3 반영
            </button>
          </div>
        </div>
      )}
    </>
  );
}
