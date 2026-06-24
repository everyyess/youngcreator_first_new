/**
 * portfolioLogic.ts 가 부여하는 한글 섹터명 →
 * 각 상관관계 API(TICKERS_ORDERED)의 ETF 티커로 변환
 *
 * 국내: /api/etf-correlation-domestic-html  (KODEX 계열 .KS 티커)
 * 해외: /api/etf-correlation-html            (미국 ETF 티커)
 *
 * 섹터명이 매핑에 없으면 null 반환 → lockedTicker 미설정
 */

export const DOMESTIC_SECTOR_TO_TICKER: Record<string, string> = {
  "반도체":       "091160.KS",
  "바이오":       "143460.KS",
  "헬스케어":     "143460.KS",
  "방산":         "472870.KS",
  "금융":         "091170.KS",
  "IT/기술":      "475080.KS",   // AI·전력 (국내 기술주 대표)
  "로봇/기계":    "445290.KS",
  "로보틱스":     "445290.KS",
  "에너지/전력":  "441680.KS",   // 신재생에너지
  "소비재":       "228810.KS",   // 경기소비재
  "채권":         "114820.KS",   // 채권(단기)
  "시장":         "069500.KS",
  "2차전지":      "305720.KS",
  "자동차":       "091180.KS",
  "원자력":       "0098F0.KS",
  "자율주행":     "449170.KS",
  "조선":         "488290.KS",
  "건설":         "104530.KS",
  "에너지화학":   "117460.KS",
  "철강":         "117680.KS",
  "운송":         "140710.KS",
  "귀금속":       "132030.KS",
};

export const GLOBAL_SECTOR_TO_TICKER: Record<string, string> = {
  "반도체":       "SOXX",
  "바이오":       "ARKG",   // 바이오테크
  "헬스케어":     "ARKG",
  "방산":         "XAR",    // 방산·우주항공
  "금융":         "IPAY",   // 핀테크 (해외 금융 대표)
  "IT/기술":      "AIQ",    // AI·빅데이터
  "로봇/기계":    "BOTZ",
  "로보틱스":     "BOTZ",
  "에너지/전력":  "ICLN",   // 청정에너지
  "소비재":       "PAVE",   // 인프라 (가장 근접)
  "채권":         "AGG",    // 채권(종합)
  "시장":         "VTI",
  "2차전지":      "LIT",    // 2차전지·리튬
  "원자력":       "URA",
  "사이버보안":   "CIBR",
  "양자컴퓨팅":   "QTUM",
  "데이터센터":   "DTCR",
  "귀금속":       "GLD",
  "원유":         "USO",
};

/** 섹터명 → 국내 ETF 티커 (없으면 null) */
export function sectorToDomesticTicker(sector: string | null | undefined): string | null {
  if (!sector) return null;
  return DOMESTIC_SECTOR_TO_TICKER[sector] ?? null;
}

/** 섹터명 → 해외 ETF 티커 (없으면 null) */
export function sectorToGlobalTicker(sector: string | null | undefined): string | null {
  if (!sector) return null;
  return GLOBAL_SECTOR_TO_TICKER[sector] ?? null;
}
