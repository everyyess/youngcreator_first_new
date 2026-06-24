export type MarketCalendarEvent = {
  id: string;
  startsAt: string;
  date: string;
  time: string;
  market: string;
  title: string;
  importance: "high" | "medium" | "low";
};

type ForexFactoryEvent = {
  date?: string;
  time?: string;
  country?: string;
  title?: string;
  impact?: string;
};

const MARKET_LABELS: Record<string, string> = {
  AUD: "호주",
  CAD: "캐나다",
  CHF: "스위스",
  CNY: "중국",
  EUR: "유로존",
  GBP: "영국",
  JPY: "일본",
  NZD: "뉴질랜드",
  USD: "미국",
};

const TITLE_TRANSLATIONS: Record<string, string> = {
  "1-y Loan Prime Rate": "1년물 대출우대금리(LPR) 발표",
  "5-y Loan Prime Rate": "5년물 대출우대금리(LPR) 발표",
  "Credit Card Spending y/y": "신용카드 지출 증가율(y/y) 발표",
  "German Buba President Nagel Speaks": "독일 중앙은행(분데스방크) 총재 나겔 연설",
  "RBA Deputy Gov Hauser Speaks": "호주중앙은행(RBA) 하우저 부총재 연설",
  "Gov Board Member Martin Speaks": "스위스 중앙은행 마틴 이사 연설",
  "UBS Economic Expectations": "UBS 경제 기대지수 발표",
  "German ifo Business Climate": "독일 Ifo 기업환경지수 발표",
  "German 10-y Bond Auction": "독일 10년물 국채 입찰",
  "Gov Council Member Rogers Speaks": "캐나다 중앙은행 로저스 위원 연설",
  "MPC Member Breeden Speaks": "영란은행 브리든 위원 연설",
  "MPC Member Dhingra Speaks": "영란은행 딩그라 위원 연설",
  "MPC Member Pill Speaks": "영란은행 필 위원 연설",
  "ECB President Lagarde Speaks": "유럽중앙은행(ECB) 라가르드 총재 연설",
  "FOMC Member Waller Speaks": "FOMC 월러 위원 연설",
  "FOMC Member Goolsbee Speaks": "FOMC 굴스비 위원 연설",
  "FOMC Member Williams Speaks": "FOMC 윌리엄스 위원 연설",
  "FOMC Member Kashkari Speaks": "FOMC 카시카리 위원 연설",
  "BOC Gov Macklem Speaks": "캐나다 중앙은행 맥클럼 총재 연설",
  "BOC Summary of Deliberations": "캐나다 중앙은행 의사록 요약 공개",
  "BOJ Summary of Opinions": "일본은행(BOJ) 의견 요약 공개",
  "BOJ Core CPI y/y": "일본은행 근원 CPI 증가율(y/y) 발표",
  "SNB Quarterly Bulletin": "스위스 중앙은행 분기 보고서 공개",
  "ECB Economic Bulletin": "유럽중앙은행(ECB) 경제 보고서 공개",
  "Belgian NBB Business Climate": "벨기에 중앙은행 기업환경지수 발표",
  "Bank Stress Test Results": "은행 스트레스 테스트 결과 발표",
  "CPI m/m": "소비자물가지수(CPI) 전월비 발표",
  "CPI y/y": "소비자물가지수(CPI) 전년비 발표",
  "Core CPI m/m": "근원 소비자물가지수(CPI) 전월비 발표",
  "Core PCE Price Index m/m": "근원 PCE 물가지수 전월비 발표",
  "Median CPI y/y": "중앙값 CPI 전년비 발표",
  "Trimmed CPI y/y": "절사평균 CPI 전년비 발표",
  "Trimmed Mean CPI m/m": "절사평균 CPI 전월비 발표",
  "Common CPI y/y": "공통 CPI 전년비 발표",
  "Flash Manufacturing PMI": "제조업 PMI 예비치 발표",
  "Flash Services PMI": "서비스업 PMI 예비치 발표",
  "French Flash Manufacturing PMI": "프랑스 제조업 PMI 예비치 발표",
  "French Flash Services PMI": "프랑스 서비스업 PMI 예비치 발표",
  "German Flash Manufacturing PMI": "독일 제조업 PMI 예비치 발표",
  "German Flash Services PMI": "독일 서비스업 PMI 예비치 발표",
  "Consumer Confidence": "소비자신뢰지수 발표",
  "Current Account": "경상수지 발표",
  "New Home Sales": "신규주택판매 발표",
  "Crude Oil Inventories": "원유재고 발표",
  "Natural Gas Storage": "천연가스 재고 발표",
  "Employment Change": "고용 변화 발표",
  "Unemployment Rate": "실업률 발표",
  "Unemployment Claims": "신규 실업수당 청구건수 발표",
  "Final GDP q/q": "GDP 최종치(q/q) 발표",
  "Final GDP Price Index q/q": "GDP 물가지수 최종치(q/q) 발표",
  "Core Durable Goods Orders m/m": "근원 내구재 주문 전월비 발표",
  "Durable Goods Orders m/m": "내구재 주문 전월비 발표",
  "Personal Income m/m": "개인소득 전월비 발표",
  "Personal Spending m/m": "개인지출 전월비 발표",
  "Goods Trade Balance": "상품 무역수지 발표",
  "Prelim Wholesale Inventories m/m": "도매재고 예비치 전월비 발표",
  "Revised UoM Consumer Sentiment": "미시간대 소비자심리지수 수정치 발표",
  "Revised UoM Inflation Expectations": "미시간대 기대인플레이션 수정치 발표",
  "Tokyo Core CPI y/y": "도쿄 근원 CPI 전년비 발표",
};

const IMPORTANCE_RANK: Record<MarketCalendarEvent["importance"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function normalizeImportance(value: string | undefined): MarketCalendarEvent["importance"] {
  const text = (value ?? "").toLowerCase();
  if (text.includes("high")) return "high";
  if (text.includes("medium")) return "medium";
  return "low";
}

function toTimestamp(value: string | undefined) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(timestamp));
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(new Date(timestamp));
}

function translateMarket(value: string | undefined) {
  if (!value) return "글로벌";
  return MARKET_LABELS[value] ?? value;
}

function translateTitle(title: string | undefined, country: string | undefined) {
  if (!title) return "";
  const normalizedTitle = country && title.startsWith(`${country} `)
    ? title.slice(country.length + 1)
    : title;
  return TITLE_TRANSLATIONS[normalizedTitle] ?? TITLE_TRANSLATIONS[title] ?? normalizedTitle;
}

export async function fetchMarketCalendar(): Promise<MarketCalendarEvent[]> {
  const response = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
    next: { revalidate: 60 * 60 },
  });
  if (!response.ok) throw new Error(`Calendar fetch failed: ${response.status}`);

  const now = Date.now();
  const data = await response.json() as ForexFactoryEvent[];

  return data
    .map((item, index) => {
      const timestamp = toTimestamp(item.date);
      const importance = normalizeImportance(item.impact);
      return {
        item,
        index,
        timestamp,
        importance,
      };
    })
    .filter((entry) => entry.item.title && entry.timestamp != null && entry.timestamp >= now)
    .sort((a, b) => {
      const timeDiff = (a.timestamp ?? 0) - (b.timestamp ?? 0);
      if (timeDiff !== 0) return timeDiff;
      return IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance];
    })
    .slice(0, 15)
    .map(({ item, index, timestamp, importance }) => ({
      id: `${item.date ?? ""}-${item.country ?? ""}-${item.title ?? index}`,
      startsAt: new Date(timestamp ?? now).toISOString(),
      date: formatDate(timestamp ?? now),
      time: formatTime(timestamp ?? now),
      market: translateMarket(item.country),
      title: translateTitle(item.title, item.country),
      importance,
    }));
}
