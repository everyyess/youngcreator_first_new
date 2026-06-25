"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Globe, RefreshCcw, ScatterChart } from "lucide-react";
import CorrelationGlobalTab from "./CorrelationGlobalTab";
import CorrelationDomesticTab from "./CorrelationDomesticTab";
import BuySimulatorTab from "../BuySimulatorTab";
import { useCustomerContext, type PortfolioAsset } from "../CustomerContext";
import { sectorToDomesticTicker, sectorToGlobalTicker } from "../sectorTickerMap";

type InnerTab = "correlation-domestic" | "correlation-global" | "rebalancing";

const innerTabs: { id: InnerTab; label: string; icon: React.ReactNode }[] = [
  { id: "correlation-domestic", label: "상관관계 분석(국내)", icon: <ScatterChart size={15} /> },
  { id: "correlation-global", label: "상관관계 분석(해외)", icon: <Globe size={15} /> },
  { id: "rebalancing", label: "리밸런싱", icon: <RefreshCcw size={15} /> },
];

function dominantSector(assets: PortfolioAsset[]): string | null {
  const sectorValues: Record<string, number> = {};
  for (const a of assets) {
    const s = a.sector;
    if (!s || s === "기타") continue;
    const val = a.current_value ?? a.weight ?? 1;
    sectorValues[s] = (sectorValues[s] ?? 0) + val;
  }
  const entries = Object.entries(sectorValues);
  if (!entries.length) return null;
  return entries.sort((x, y) => y[1] - x[1])[0][0];
}

export default function Tab3Page() {
  const [activeInnerTab, setActiveInnerTab] = useState<InnerTab>("correlation-domestic");
  const {
    appMode,
    tab3AnalysisState,
    updateTab3AnalysisState,
    analysisResult,
    rebalancingSellAssets,
    selectedCustomer,
  } = useCustomerContext();

  // Ref로 최신 tab3AnalysisState를 읽되 의존성 배열에서 제외 (무한 루프 방지)
  const tab3StateRef = useRef(tab3AnalysisState);
  useEffect(() => { tab3StateRef.current = tab3AnalysisState; });

  // TAB2 리밸런싱(매도/유지) 탭과 동일한 기준으로 베이스 자산 결정
  // rebalancingSellAssets는 raw 자산(sector 없음)이므로 enrichedAssets에서 sector를 보완
  const baseAssets = useMemo(() => {
    const enriched = analysisResult?.enrichedAssets ?? [];
    if (rebalancingSellAssets.length > 0) {
      const sectorMap = new Map(enriched.map(a => [`${a.name}::${a.ticker ?? ""}`, a.sector]));
      return rebalancingSellAssets.map(a => ({
        ...a,
        sector: a.sector ?? sectorMap.get(`${a.name}::${a.ticker ?? ""}`),
      }));
    }
    return enriched;
  }, [analysisResult?.enrichedAssets, rebalancingSellAssets]);

  // 국내/해외 지배 섹터 계산 (현재가 기준 비중)
  const { autoLockedDomestic, autoLockedGlobal } = useMemo(() => {
    const heldAssets = baseAssets.filter(
      (a) => a.name && !(a.amount_type === "quantity" && a.amount <= 0)
    );
    const domestic = heldAssets.filter((a) => {
      const pt = (a.productType ?? a.asset_class ?? "").trim();
      return pt === "국내주식" || pt === "국내ETF";
    });
    const global = heldAssets.filter((a) => {
      const pt = (a.productType ?? a.asset_class ?? "").trim();
      return pt === "해외주식" || pt === "해외ETF";
    });
    return { autoLockedDomestic: dominantSector(domestic), autoLockedGlobal: dominantSector(global) };
  }, [baseAssets]);

  // 고객·포트폴리오 변경 시 지배 섹터를 자동 고정 (섹터명 → ETF 티커 변환 후 주입)
  useEffect(() => {
    const domesticTicker = sectorToDomesticTicker(autoLockedDomestic);
    const globalTicker   = sectorToGlobalTicker(autoLockedGlobal);
    if (!domesticTicker && !globalTicker) return;
    const cur = tab3StateRef.current;
    updateTab3AnalysisState(
      {
        domestic: { ...cur.domestic, lockedTicker: domesticTicker },
        global:   { ...cur.global,   lockedTicker: globalTicker },
      },
      { allowReadOnlyViewState: true }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer, autoLockedDomestic, autoLockedGlobal]);

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
            className={`flex shrink-0 flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition ${
              activeInnerTab === tab.id
                ? "bg-[#2f2f9d] text-white shadow-soft"
                : "bg-[#F3F5F9] text-slate-600 hover:bg-slate-100 hover:text-navy"
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

      {activeInnerTab === "rebalancing" && <BuySimulatorTab />}
    </>
  );
}
