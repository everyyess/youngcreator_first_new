import YahooFinance from "yahoo-finance2";

export type MarketIndexItem = {
  symbol: string;
  name: string;
  value: number | null;
  change: number | null;
  changePercent: number | null;
  sparkline: number[];
  basis: string;
  asOf: string | null;
};

const INDEX_TICKERS = [
  { symbol: "^KS11", name: "KOSPI" },
  { symbol: "^KQ11", name: "KOSDAQ" },
  { symbol: "^IXIC", name: "NASDAQ" },
  { symbol: "^GSPC", name: "S&P500" },
  { symbol: "^SOX", name: "SOX" },
  { symbol: "KRW=X", name: "원/달러" },
  { symbol: "^TNX", name: "미국 10년물" },
];

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toIsoTime(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "number") {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function formatBasis(marketState: unknown, asOf: string | null, timezone: unknown) {
  const state = typeof marketState === "string" ? marketState : "";
  const timeZone = typeof timezone === "string" ? timezone : "Asia/Seoul";
  const time = asOf
    ? new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(asOf))
    : "";
  if (state === "REGULAR") return "실시간";
  if (state.includes("POST") || state === "CLOSED") return time ? `${time} 종가` : "전일 종가";
  if (state.includes("PRE")) return time ? `${time} 개장 전` : "개장 전";
  return time ? `${time} 기준` : "기준 미확인";
}

export async function fetchMarketIndices(): Promise<MarketIndexItem[]> {
  const results = await Promise.allSettled(
    INDEX_TICKERS.map(async (item) => {
      const quote = await yahooFinance.quote(item.symbol);
      const chart = await yahooFinance.chart(item.symbol, {
        period1: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        interval: "1d",
      });
      const data = quote as Record<string, unknown>;
      const asOf = toIsoTime(data.regularMarketTime);
      return {
        symbol: item.symbol,
        name: item.name,
        value: toNumber(data.regularMarketPrice),
        change: toNumber(data.regularMarketChange),
        changePercent: toNumber(data.regularMarketChangePercent),
        basis: formatBasis(data.marketState, asOf, data.exchangeTimezoneName),
        asOf,
        sparkline: (chart.quotes ?? [])
          .map((point) => toNumber((point as Record<string, unknown>).close))
          .filter((value): value is number => value != null),
      };
    }),
  );

  return results.map((result, index) => {
    const fallback = INDEX_TICKERS[index];
    if (result.status === "fulfilled") return result.value;
    return {
      symbol: fallback.symbol,
      name: fallback.name,
      value: null,
      change: null,
      changePercent: null,
      sparkline: [],
      basis: "조회 실패",
      asOf: null,
    };
  });
}
