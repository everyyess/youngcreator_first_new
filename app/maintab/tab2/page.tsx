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

  const analysisRoomButton = (
    <button
      type="button"
      onClick={() => {
        // "/analysis/screener"는 실제 라우트가 아니라 [tab]/page.tsx에서 "/analysis/tab1"로 리다이렉트
        // 되며 쿼리스트링이 버려진다 — 처음부터 실제 목적지로 직접 이동한다(tab3/page.tsx와 동일 수정).
        sessionStorage.setItem("analysisReturnTab", "tab2");
        window.location.href = "/analysis/tab1?returnTab=tab2";
      }}
      className="flex items-center gap-2 rounded-lg border border-samsung/30 bg-samsung/5 px-4 py-2.5 text-sm font-bold text-samsung transition hover:bg-samsung/10"
    >
      분석실 이동
    </button>
  );

  return (
    <div className="space-y-5">
      <ExistingPortfolioTab rightSlot={analysisRoomButton} />
      {data
        ? <PortfolioDiagnosisSection data={data} />
        : <EmptyDataPrompt message="자산을 입력하고 분석 실행을 눌러주세요." />
      }
    </div>
  );
}