export type ExternalMarketBrief = {
  market: "us";
  reportDate: string;
  dataAsOf: string;
  headline: string;
  bullets: string[];
};

export async function fetchPreviousUsMarketBrief(reportDate: string): Promise<ExternalMarketBrief> {
  const dataAsOf = new Date().toISOString();

  return {
    market: "us",
    reportDate,
    dataAsOf,
    headline: "전일 미국 시황 요약",
    bullets: [
      "미국 주요 지수와 금리, 환율 흐름을 요약할 예정입니다.",
      "Alpha Vantage 연동 전까지는 자동 생성 파이프라인 검증용 본문을 표시합니다.",
      "실제 데이터 연결 시 지수 등락, 업종 강약, 주요 매크로 이벤트가 이 영역에 반영됩니다.",
    ],
  };
}
