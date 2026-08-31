import type { AppState, CustomerProfile } from "@/app/maintab/CustomerContext";

export type CustomerReportSection = {
  title: string;
  summary: string;
  bullets: string[];
};

function displayCustomerName(customer?: CustomerProfile | null) {
  return customer?.name || customer?.fallbackName || "선택 고객";
}

function fallbackText(value: string | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function buildCustomerReportSections(customer?: CustomerProfile | null, state?: AppState): {
  holdingIssues: CustomerReportSection;
  portfolioPerformance: CustomerReportSection;
} {
  const name = displayCustomerName(customer);
  const investmentAssets = fallbackText(state?.financial.existingInvestmentAssets, "기존 투자자산 미입력");
  const cashAssets = fallbackText(state?.financial.cashAssets, "현금성 자산 미입력");
  const riskLevel = state?.rrttllu.riskAttitude || "위험 성향 미입력";

  return {
    holdingIssues: {
      title: "고객별 보유 종목 주요 이슈",
      summary: name + " 고객의 보유 종목 이슈 요약 영역입니다.",
      bullets: [
        "보유 종목별 뉴스, 공시, 가격 변동 이슈는 다음 단계의 시장 API 연결 후 자동 반영됩니다.",
        "현재 입력된 투자자산: " + investmentAssets,
        "고객 위험 성향: " + riskLevel,
      ],
    },
    portfolioPerformance: {
      title: "고객별 포트폴리오 성과",
      summary: name + " 고객의 포트폴리오 성과 요약 영역입니다.",
      bullets: [
        "포트폴리오 수익률, 기여도, 리스크 지표는 다음 단계의 보유자산 데이터 연결 후 자동 반영됩니다.",
        "현금성 자산: " + cashAssets,
        "기존 투자자산: " + investmentAssets,
      ],
    },
  };
}
