/**
 * 섹터 스캐너 관심 종목 — 시총 상위 기본 종목 외에 사용자가 직접 추가하는 종목.
 * localStorage에 보존되며, 섹터 스캐너와 AI 자동매매 유니버스에 모두 반영된다.
 */

export type CustomStock = {
  symbol: string;   // 야후 심볼 (국내: 005930.KS / 042700.KQ, 해외: AAPL)
  sectorId: string; // sectorMaster의 섹터 id
  market: "domestic" | "global";
  name?: string;    // 표시용 종목명 (자동 인식 시 채워짐)
};

const STORAGE_KEY = "sector-scanner-custom-stocks-v1";

export function loadCustomStocks(): CustomStock[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => s?.symbol && s?.sectorId && s?.market) : [];
  } catch {
    return [];
  }
}

export function saveCustomStocks(stocks: CustomStock[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stocks)); } catch {}
}

/** 스캐너 API용 extra 쿼리 파라미터 (SYMBOL:sectorId[:encodedName]) */
export function buildExtraParam(stocks: CustomStock[], market: "domestic" | "global"): string {
  return stocks
    .filter((s) => s.market === market)
    .map((s) => `${s.symbol}:${s.sectorId}${s.name ? `:${encodeURIComponent(s.name)}` : ""}`)
    .join(",");
}

/** 스캐너 fetch URL 생성 — 관심 종목 포함 */
export function scannerUrl(market: "domestic" | "global", stocks?: CustomStock[]): string {
  const extra = buildExtraParam(stocks ?? loadCustomStocks(), market);
  return `/api/sector-scanner?market=${market}${extra ? `&extra=${encodeURIComponent(extra)}` : ""}`;
}
