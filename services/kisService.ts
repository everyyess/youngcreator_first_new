export type DomesticMarketBrief = {
  market: "kr";
  reportDate: string;
  dataAsOf: string;
  headline: string;
  bullets: string[];
};

export async function fetchTodayKoreanMarketBrief(reportDate: string): Promise<DomesticMarketBrief> {
  const dataAsOf = new Date().toISOString();

  return {
    market: "kr",
    reportDate,
    dataAsOf,
    headline: "당일 국내 시황 요약",
    bullets: [
      "국내 주요 지수와 업종 흐름을 요약할 예정입니다.",
      "KIS 연동 전까지는 자동 생성 파이프라인 검증용 본문을 표시합니다.",
      "실제 데이터 연결 시 장 마감 데이터 확인 후 즉시 생성되며, 누락 시 제한적으로 재시도합니다.",
    ],
  };
}
