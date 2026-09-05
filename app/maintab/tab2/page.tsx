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
      <ExistingPortfolioTab />
      {data
        ? <PortfolioDiagnosisSection data={data} />
        : <EmptyDataPrompt message="자산을 입력하고 분석 실행을 눌러주세요." />
      }
    </div>
  );
}