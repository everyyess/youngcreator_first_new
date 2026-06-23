import YahooFinance from "yahoo-finance2";

export type HeatmapItem = {
  symbol: string;
  name: string;
  sector: string;
  changePercent: number;
  weight: number;
};

const LARGE_CAP_TICKERS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "GOOGL",
  "META",
  "AMZN",
  "AVGO",
  "TSLA",
  "LLY",
  "JPM",
  "V",
  "UNH",
  "XOM",
  "MA",
  "JNJ",
  "WMT",
  "PG",
  "COST",
  "ORCL",
  "HD",
  "BAC",
  "NFLX",
  "AMD",
  "KO",
  "PEP",
  "MRK",
  "CVX",
  "ABBV",
  "CRM",
  "MCD",
];

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toSector(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "Other";
}

export async function fetchMarketHeatmap(): Promise<HeatmapItem[]> {
  const results = await Promise.allSettled(
    LARGE_CAP_TICKERS.map(async (symbol) => {
      const quote = await yahooFinance.quote(symbol);
      const data = quote as Record<string, unknown>;
      const marketCap = toNumber(data.marketCap);
      const changePercent = toNumber(data.regularMarketChangePercent);
      if (marketCap == null || changePercent == null) return null;

      return {
        symbol,
        name: typeof data.shortName === "string" ? data.shortName : symbol,
        sector: toSector(data.sector),
        changePercent,
        weight: marketCap,
      };
    }),
  );

  return results
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter((item): item is HeatmapItem => item != null)
    .sort((a, b) => b.weight - a.weight);
}
