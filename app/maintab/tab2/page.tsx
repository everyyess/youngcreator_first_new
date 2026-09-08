"use client";
import ExistingPortfolioTab from "../tab1/ExistingPortfolioTab";
import {
  EmptyDataPrompt,
  PortfolioDiagnosisSection,
  usePortfolioResult,
} from "../PortfolioResultComponents";
import SellSimulatorTab from "../SellSimulatorTab";
import { useCustomerContext } from "../CustomerContext";

export default function Tab2Page() {
  const data = usePortfolioResult();
  const { appMode } = useCustomerContext();

  if (appMode === "customer") {
    return <SellSimulatorTab />;
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem("analysisReturnTab", "tab2");
            window.location.href = "/analysis/screener";
          }}
          className="rounded-lg border border-samsung/30 bg-samsung/5 px-3 py-1.5 text-xs font-bold text-samsung hover:bg-samsung/10"
        >
          분석실로 이동
        </button>
      </div>
      <ExistingPortfolioTab />
      {data
        ? <PortfolioDiagnosisSection data={data} />
        : <EmptyDataPrompt message="자산을 입력하고 분석 실행을 눌러주세요." />
      }
    </div>
  );
}