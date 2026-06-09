/**
 * utils/financialRules.js
 *
 * 자산군(assetClass) × 상품유형(productType) × 투자국가(country)
 * → 벤치마크 티커 / 기본 리스크 계수 매핑 규칙 레이어
 *
 * quantEngine.js 가 이 모듈에 의존하여 벤치마크를 결정하고
 * 프록시 리스크 계수를 가져갑니다.
 */

// ── 1. 자산군 기본 벤치마크 ──────────────────────────────────────
export const ASSET_CLASS_BENCHMARK = {
  '국내주식': '^KS11',      // KOSPI 지수
  '해외주식': '^GSPC',      // S&P 500
  '국내채권': '114260.KS',  // KODEX 국고채10년 ETF
  '해외채권': 'TLT',        // iShares 20+ Year Treasury
  '금':       'GC=F',       // Gold Futures
  '리츠':     'VNQ',        // Vanguard Real Estate ETF
  '현금':     null,         // 무위험자산 대체 (Rf)
  '달러':     'KRW=X',      // USD/KRW 환율
};

// ── 2. 상품유형 우선 벤치마크 (자산군 무관하게 덮어쓰기) ──────────
export const PRODUCT_TYPE_BENCHMARK = {
  '암호화폐': 'BTC-USD',
};

// ── 3. 투자국가별 주식/ETF 벤치마크 ──────────────────────────────
export const COUNTRY_BENCHMARK = {
  '한국':  '^KS11',
  '미국':  '^GSPC',
  '일본':  '^N225',
  '중국':  '000001.SS',
  '유럽':  '^STOXX50E',
  '기타':  '^GSPC',     // 글로벌 대리
};

// ── 4. 자산군 기본 리스크 계수 ───────────────────────────────────
// annVol: 연환산 변동성, mdd: 최대낙폭, beta: 시장 베타, expRet: 연 기대수익률
export const ASSET_CLASS_RISK = {
  '국내주식': { annVol: 0.22, mdd: 0.30, beta: 1.10, expRet: 0.07 },
  '해외주식': { annVol: 0.18, mdd: 0.28, beta: 1.15, expRet: 0.08 },
  '국내채권': { annVol: 0.04, mdd: 0.06, beta: 0.02, expRet: 0.035 },
  '해외채권': { annVol: 0.08, mdd: 0.12, beta: -0.05, expRet: 0.04 },
  '금':       { annVol: 0.14, mdd: 0.20, beta: 0.05,  expRet: 0.05 },
  '리츠':     { annVol: 0.20, mdd: 0.27, beta: 0.60,  expRet: 0.06 },
  '현금':     { annVol: 0.005, mdd: 0.001, beta: 0.00, expRet: 0.035 },
  '달러':     { annVol: 0.08, mdd: 0.12,  beta: 0.00, expRet: 0.03 },
};

// ── 5. 상품유형별 리스크 오버라이드 ──────────────────────────────
// volMult: 자산군 annVol × 배율, 나머지 필드: 직접 덮어쓰기
export const PRODUCT_TYPE_RISK = {
  '암호화폐': { annVol: 0.72, mdd: 0.82, beta: 0.55,  expRet: 0.20 },
  '개별주식': { volMult: 1.20 },  // ETF 대비 개별 종목 변동성 +20%
  'ETF':      { volMult: 0.85 },  // 분산 효과로 변동성 -15%
  '채권':     { annVol: 0.06, mdd: 0.08, beta: 0.01,  expRet: 0.04 },
  '리츠':     { annVol: 0.20, mdd: 0.27, beta: 0.58,  expRet: 0.06 },
  '펀드':     { volMult: 0.90 },  // 펀드 분산 효과
  '현금':     { annVol: 0.005, mdd: 0.001, beta: 0.00, expRet: 0.035 },
  '외화':     { annVol: 0.10, mdd: 0.15,  beta: 0.00, expRet: 0.02 },
};

// ── 6. 스트레스 시나리오별 상품유형 추가 충격 ─────────────────────
// null 반환 시 quantEngine 기본 자산군 로직 사용
export const STRESS_PRODUCT_TYPE_SHOCK = {
  '암호화폐': {
    rateHike:  -0.35,  // 실질금리 상승 → 고위험 자산 급락
    commodity: -0.22,  // 채굴 에너지비용 상승
    fxUp200:   +0.08,  // USD 기반 → 원화 약세 시 원화 가치 상승 반영
    combined:  -0.55,
  },
};

// ── 7. 헬퍼 함수 ─────────────────────────────────────────────────

/**
 * 자산군 + 상품유형 + 투자국가 조합으로 최적 벤치마크 티커 반환
 * @param {string} assetClass
 * @param {string} productType
 * @param {string} country
 * @returns {string|null}
 */
export function getBenchmarkTicker(assetClass = '', productType = '', country = '') {
  // 상품유형 우선 (암호화폐 등)
  if (PRODUCT_TYPE_BENCHMARK[productType]) return PRODUCT_TYPE_BENCHMARK[productType];
  // 주식/ETF는 투자국가별 벤치마크 선택
  const isEquityLike = ['국내주식', '해외주식'].includes(assetClass);
  if (isEquityLike && country && COUNTRY_BENCHMARK[country]) return COUNTRY_BENCHMARK[country];
  // 자산군 기본 벤치마크
  return ASSET_CLASS_BENCHMARK[assetClass] ?? '^GSPC';
}

/**
 * 자산군 + 상품유형 기반 리스크 계수 반환
 * @param {string} assetClass
 * @param {string} productType
 * @returns {{ annVol: number, mdd: number, beta: number, expRet: number }}
 */
export function getRiskCoefficients(assetClass = '', productType = '') {
  const base = { ...(ASSET_CLASS_RISK[assetClass] ?? ASSET_CLASS_RISK['해외주식']) };
  const ov   = PRODUCT_TYPE_RISK[productType];
  if (!ov) return base;
  if (ov.volMult   !== undefined) base.annVol  = +(base.annVol * ov.volMult).toFixed(4);
  if (ov.annVol    !== undefined) base.annVol  = ov.annVol;
  if (ov.mdd       !== undefined) base.mdd     = ov.mdd;
  if (ov.beta      !== undefined) base.beta    = ov.beta;
  if (ov.expRet    !== undefined) base.expRet  = ov.expRet;
  return base;
}

/**
 * 상품유형 스트레스 충격값 조회 — null 반환 시 기본 자산군 로직 사용
 * @param {string} productType
 * @param {'rateHike'|'commodity'|'fxUp200'|'combined'} scenarioKey
 * @returns {number|null}
 */
export function getProductTypeStressShock(productType = '', scenarioKey = '') {
  return STRESS_PRODUCT_TYPE_SHOCK[productType]?.[scenarioKey] ?? null;
}
