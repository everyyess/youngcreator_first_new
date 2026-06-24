export type HeatmapItem = {
  symbol: string;
  name: string;
  sector: string;
  changePercent: number;
  weight: number;
};

// Initial Finviz-style sample set. Data shape is isolated so it can be replaced with a live provider later.
export const heatmapItems: HeatmapItem[] = [
  { symbol: "NVDA", name: "NVIDIA", sector: "Technology", changePercent: 2.95, weight: 20 },
  { symbol: "MSFT", name: "Microsoft", sector: "Technology", changePercent: 0.13, weight: 17 },
  { symbol: "AAPL", name: "Apple", sector: "Technology", changePercent: 0.7, weight: 16 },
  { symbol: "AVGO", name: "Broadcom", sector: "Technology", changePercent: 2.35, weight: 8 },
  { symbol: "AMD", name: "AMD", sector: "Technology", changePercent: 1.21, weight: 4 },
  { symbol: "QCOM", name: "Qualcomm", sector: "Technology", changePercent: 1.1, weight: 3 },
  { symbol: "MU", name: "Micron", sector: "Technology", changePercent: 1.86, weight: 2 },
  { symbol: "ORCL", name: "Oracle", sector: "Technology", changePercent: 0.41, weight: 4 },
  { symbol: "PLTR", name: "Palantir", sector: "Technology", changePercent: -1.65, weight: 2 },
  { symbol: "GOOGL", name: "Alphabet", sector: "Communication", changePercent: 1.17, weight: 13 },
  { symbol: "META", name: "Meta", sector: "Communication", changePercent: 1.7, weight: 7 },
  { symbol: "NFLX", name: "Netflix", sector: "Communication", changePercent: -0.55, weight: 4 },
  { symbol: "DIS", name: "Disney", sector: "Communication", changePercent: 0.42, weight: 2 },
  { symbol: "TMUS", name: "T-Mobile", sector: "Communication", changePercent: -0.2, weight: 2 },
  { symbol: "AMZN", name: "Amazon", sector: "Consumer Cyclical", changePercent: 2.9, weight: 11 },
  { symbol: "TSLA", name: "Tesla", sector: "Consumer Cyclical", changePercent: 1.04, weight: 6 },
  { symbol: "HD", name: "Home Depot", sector: "Consumer Cyclical", changePercent: 0.21, weight: 3 },
  { symbol: "MCD", name: "McDonald's", sector: "Consumer Cyclical", changePercent: -1.84, weight: 2 },
  { symbol: "NKE", name: "Nike", sector: "Consumer Cyclical", changePercent: -0.9, weight: 1 },
  { symbol: "JPM", name: "JPMorgan", sector: "Financial", changePercent: -0.58, weight: 7 },
  { symbol: "BAC", name: "Bank of America", sector: "Financial", changePercent: -0.73, weight: 5 },
  { symbol: "BRK-B", name: "Berkshire", sector: "Financial", changePercent: -0.37, weight: 6 },
  { symbol: "V", name: "Visa", sector: "Financial", changePercent: 0.33, weight: 5 },
  { symbol: "MA", name: "Mastercard", sector: "Financial", changePercent: 0.21, weight: 4 },
  { symbol: "AXP", name: "American Express", sector: "Financial", changePercent: -0.35, weight: 2 },
  { symbol: "WFC", name: "Wells Fargo", sector: "Financial", changePercent: -0.9, weight: 2 },
  { symbol: "LLY", name: "Eli Lilly", sector: "Healthcare", changePercent: -1.21, weight: 8 },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare", changePercent: -2.48, weight: 5 },
  { symbol: "UNH", name: "UnitedHealth", sector: "Healthcare", changePercent: -0.36, weight: 5 },
  { symbol: "ABBV", name: "AbbVie", sector: "Healthcare", changePercent: -2.14, weight: 3 },
  { symbol: "PFE", name: "Pfizer", sector: "Healthcare", changePercent: -2.74, weight: 2 },
  { symbol: "MRK", name: "Merck", sector: "Healthcare", changePercent: -1.36, weight: 2 },
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy", changePercent: -2.08, weight: 5 },
  { symbol: "CVX", name: "Chevron", sector: "Energy", changePercent: -2.22, weight: 4 },
  { symbol: "COP", name: "ConocoPhillips", sector: "Energy", changePercent: -3.12, weight: 2 },
  { symbol: "WMT", name: "Walmart", sector: "Consumer Defensive", changePercent: -0.8, weight: 6 },
  { symbol: "COST", name: "Costco", sector: "Consumer Defensive", changePercent: -1.46, weight: 4 },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer Defensive", changePercent: -0.12, weight: 4 },
  { symbol: "PEP", name: "PepsiCo", sector: "Consumer Defensive", changePercent: -0.3, weight: 2 },
  { symbol: "KO", name: "Coca-Cola", sector: "Consumer Defensive", changePercent: 0.18, weight: 2 },
  { symbol: "CAT", name: "Caterpillar", sector: "Industrial", changePercent: 3.13, weight: 4 },
  { symbol: "GE", name: "GE Aerospace", sector: "Industrial", changePercent: 0.17, weight: 4 },
  { symbol: "BA", name: "Boeing", sector: "Industrial", changePercent: -1.29, weight: 2 },
  { symbol: "RTX", name: "RTX", sector: "Industrial", changePercent: -3.62, weight: 2 },
  { symbol: "NEE", name: "NextEra Energy", sector: "Utilities", changePercent: 1.19, weight: 3 },
  { symbol: "SO", name: "Southern", sector: "Utilities", changePercent: 0.4, weight: 2 },
  { symbol: "LIN", name: "Linde", sector: "Basic Materials", changePercent: -0.72, weight: 3 },
  { symbol: "FCX", name: "Freeport-McMoRan", sector: "Basic Materials", changePercent: 1.15, weight: 1 },
];
