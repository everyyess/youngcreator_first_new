/**
 * quantEngine.js
 * 금융·세무 정량 연산 전담 유틸 모듈
 *
 * - UI 라이브러리 의존성 없는 순수 JS 함수
 * - page.tsx 등 외부에서 t_marginal(한계세율)을 매개변수로 수신
 * - 해외주식/ETF/금·원자재: Yahoo Finance v8 API 실 연동 (3개년 월별 시계열)
 * - 국내채권·환율·부동산: 가상 시세 반환 비동기 Mock API
 */

import { getBenchmarkTicker, getRiskCoefficients, getProductTypeStressShock } from './financialRules.js';

// ============================================================
// 1. 글로벌 상수
// ============================================================

const RISK_FREE_RATE = 0.035;           // 무위험수익률 3.5%
const FEE_RATE = 0.0025;                // 수수료 0.25%
const TAX_RATE_GENERAL = 0.154;         // 일반 금융소득세 15.4%
const TAX_RATE_ISA_EXCESS = 0.099;      // ISA 초과분 세율 9.9%
const ISA_TAX_FREE_LIMIT = 2_000_000;   // ISA 비과세 한도 200만 원
const FOREIGN_STOCK_TAX_RATE = 0.22;    // 해외주식 양도세율 22%
const FOREIGN_STOCK_DEDUCTION = 2_500_000; // 해외주식 양도세 기본공제 250만 원
const FINANCIAL_INCOME_THRESHOLD = 20_000_000; // 금융소득종합과세 기준 2,000만 원
const HHI_WARNING_THRESHOLD = 0.20;    // 단일 종목 20% 초과 시 경고
const VAR_CONFIDENCE = 0.95;           // VaR 신뢰수준 95%

// ============================================================
// 1-b. 자산별 역사적 리스크 팩터 프록시 매트릭스
//      Yahoo Finance 실 데이터 수집 불가 시 대리 적용
// ============================================================

const ASSET_RISK_PROXY_TABLE = [
  { keywords: ['삼성전자'],
    annVol: 0.22, mdd: 0.35, beta: 1.15 },
  { keywords: ['TIGER 미국나스닥', '미국나스닥100', 'QQQ', 'QQQM'],
    annVol: 0.18, mdd: 0.28, beta: 1.30 },
  { keywords: ['NVDA', 'NVIDIA'],
    annVol: 0.45, mdd: 0.52, beta: 1.85 },
  { keywords: ['국고채 03500', '03500-2903', 'KTB03500'],
    annVol: 0.04, mdd: 0.06, beta: 0.02 },
  { keywords: ['SK하이닉스', 'SK이노베이션'],
    annVol: 0.28, mdd: 0.40, beta: 1.30 },
  { keywords: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META'],
    annVol: 0.25, mdd: 0.35, beta: 1.10 },
  { keywords: ['TSLA'],
    annVol: 0.55, mdd: 0.65, beta: 1.70 },
  { keywords: ['AMD'],
    annVol: 0.50, mdd: 0.60, beta: 1.80 },
  { keywords: ['SPY', 'IVV', 'VOO', 'TIGER 미국S&P', 'S&P500'],
    annVol: 0.16, mdd: 0.24, beta: 1.00 },
  { keywords: ['TLT', 'AGG', 'BND', '미국채 20년', '장기채'],
    annVol: 0.10, mdd: 0.20, beta: -0.08 },
  { keywords: ['GLD', 'IAU', '금ETF', 'GOLD'],
    annVol: 0.14, mdd: 0.20, beta: 0.05 },
  { keywords: ['VNQ', 'IYR', '리츠', 'REITs', 'REIT'],
    annVol: 0.18, mdd: 0.25, beta: 0.60 },
  { keywords: ['MMF', 'CMA', '발행어음', '파킹', 'MMDA'],
    annVol: 0.005, mdd: 0.001, beta: 0.00 },
];

// ============================================================
// 2. 표준 자산군·테마·과세 유형 열거값
// ============================================================

export const ASSET_CLASS = Object.freeze({
  DOMESTIC_STOCK: '국내주식',
  FOREIGN_STOCK:  '해외주식',
  DOMESTIC_BOND:  '국내채권',
  FOREIGN_BOND:   '해외채권',
  GOLD:           '금',
  REITS:          '리츠',
  CASH:           '현금',
  DOLLAR:         '달러',
  CRYPTO:         '암호화폐',
});

export const THEME = Object.freeze({
  TECH:          '기술주',
  SEMICONDUCTOR: '반도체주',
  FINANCIAL:     '금융주',
  HEALTHCARE:    '헬스케어주',
  ENERGY:        '에너지주',
  CONSUMER:      '소비재주',
  INDUSTRIALS:   '산업재주',
  ETF:           'ETF',
  OTHER:         '기타',
});

export const TAX_TYPE = Object.freeze({
  DIRECT_STOCK:   'Direct_Stock',   // 직접 주식 투자 (양도소득세 대상)
  INDIRECT_FUND:  'Indirect_Fund',  // 펀드/ETF (배당·이자 차익 과세)
  FIXED_INCOME:   'Fixed_Income',   // 채권·예금 (이자소득세 14% + 지방세)
});

// 자산 키워드 → 표준 자산군 매핑 테이블
const ASSET_MAPPING_TABLE = [
  // 국내주식 – 반도체
  { keywords: ['삼성전자', 'SK하이닉스', 'SK이노베이션', '반도체', 'DRAM', 'NAND'],
    assetClass: ASSET_CLASS.DOMESTIC_STOCK, taxType: TAX_TYPE.DIRECT_STOCK, theme: THEME.SEMICONDUCTOR },
  // 국내주식 – 기술/플랫폼
  { keywords: ['카카오', 'NAVER', '네이버', '카카오뱅크', '카카오페이', 'IT주', '기술주', '플랫폼'],
    assetClass: ASSET_CLASS.DOMESTIC_STOCK, taxType: TAX_TYPE.DIRECT_STOCK, theme: THEME.TECH },
  // 국내주식 – 금융
  { keywords: ['KB금융', '신한지주', '하나금융', '우리금융', '삼성화재', '금융주', '보험주'],
    assetClass: ASSET_CLASS.DOMESTIC_STOCK, taxType: TAX_TYPE.DIRECT_STOCK, theme: THEME.FINANCIAL },
  // 국내주식 – 일반
  { keywords: ['KOSPI', 'KOSDAQ', '코스피', '코스닥', '국내주식', '한국주식', '국장', 'KRX'],
    assetClass: ASSET_CLASS.DOMESTIC_STOCK, taxType: TAX_TYPE.DIRECT_STOCK, theme: THEME.OTHER },
  // 해외주식 – 기술
  { keywords: ['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'NFLX', 'AMD',
               '미국주식', '해외주식', '빅테크', 'S&P500', 'S&P 500', 'Magnificent 7'],
    assetClass: ASSET_CLASS.FOREIGN_STOCK, taxType: TAX_TYPE.DIRECT_STOCK, theme: THEME.TECH },
  // 해외주식 – ETF (국내상장 해외ETF + 채권형 ETF 포함)
  // 채권형 ETF(TLT/SHY/IEF/BND/AGG/LQD 등)는 거래소 상장 상품이므로 ETF로 분류 (BOND row 우선순위보다 먼저 매칭)
  { keywords: ['QQQ', 'SPY', 'IVV', 'VOO', 'VTI', 'SCHD', 'JEPI', 'GDX', '미국 ETF', '해외 ETF',
               'TIGER', 'KODEX', 'KINDEX', 'ARIRANG', 'HANARO', 'ACE', 'SOL',
               '나스닥', 'S&P', 'MSCI', '미국나스닥', '미국S&P',
               'TLT', 'SHY', 'IEF', 'BND', 'AGG', 'LQD', 'HYG', 'VCIT', 'VCSH', 'BSV',
               '114260', '148070', '157450'],
    assetClass: ASSET_CLASS.FOREIGN_STOCK, taxType: TAX_TYPE.INDIRECT_FUND, theme: THEME.ETF },
  // 국내채권 (실물 채권 — 거래소 비상장)
  { keywords: ['국채', '국고채', '회사채', '국내채권', '한국채권', 'KTB', '통화안정채', '통안채'],
    assetClass: ASSET_CLASS.DOMESTIC_BOND, taxType: TAX_TYPE.FIXED_INCOME, theme: THEME.OTHER },
  // 해외채권 (실물 채권 — 거래소 비상장)
  { keywords: ['미국채', '해외채권', '달러채권', 'US Treasury', 'USD Bond'],
    assetClass: ASSET_CLASS.FOREIGN_BOND, taxType: TAX_TYPE.FIXED_INCOME, theme: THEME.OTHER },
  // 금·원자재
  { keywords: ['금', 'GOLD', 'GLD', 'IAU', '골드', '원자재', '귀금속', 'Commodity', '원유', 'USO', 'DJP'],
    assetClass: ASSET_CLASS.GOLD, taxType: TAX_TYPE.INDIRECT_FUND, theme: THEME.OTHER },
  // 리츠
  { keywords: ['리츠', 'REITs', 'REIT', 'VNQ', 'IYR', 'SCHH', '부동산펀드', '리테일리츠', '물류리츠'],
    assetClass: ASSET_CLASS.REITS, taxType: TAX_TYPE.INDIRECT_FUND, theme: THEME.OTHER },
  // 현금성
  { keywords: ['현금', 'MMF', 'CMA', '예금', '적금', '파킹통장', '단기채', '발행어음', '예적금'],
    assetClass: ASSET_CLASS.CASH, taxType: TAX_TYPE.FIXED_INCOME, theme: THEME.OTHER },
  // 달러·외화
  { keywords: ['달러', 'USD', '달러화', '달러예금', '외화예금', 'FX', '환율', 'Dollar'],
    assetClass: ASSET_CLASS.DOLLAR, taxType: TAX_TYPE.FIXED_INCOME, theme: THEME.OTHER },
  // 암호화폐 (초고위험 대안자산)
  { keywords: ['비트코인', 'BTC', 'ETH', '이더리움', '암호화폐', 'Crypto', 'COIN', '코인', 'USDT', 'SOL', 'XRP', '리플'],
    assetClass: ASSET_CLASS.CRYPTO, taxType: TAX_TYPE.DIRECT_STOCK, theme: THEME.OTHER },
];

// 자산군별 기본 프록시 (ASSET_MAPPING_TABLE 이후 ASSET_CLASS 참조 가능)
const ASSET_CLASS_PROXY_DEFAULT = {
  [ASSET_CLASS.DOMESTIC_STOCK]: { annVol: 0.22, mdd: 0.30, beta: 1.10 },
  [ASSET_CLASS.FOREIGN_STOCK]:  { annVol: 0.20, mdd: 0.30, beta: 1.20 },
  [ASSET_CLASS.DOMESTIC_BOND]:  { annVol: 0.04, mdd: 0.06, beta: 0.02 },
  [ASSET_CLASS.FOREIGN_BOND]:   { annVol: 0.08, mdd: 0.12, beta: -0.05 },
  [ASSET_CLASS.GOLD]:           { annVol: 0.14, mdd: 0.20, beta: 0.05 },
  [ASSET_CLASS.REITS]:          { annVol: 0.18, mdd: 0.25, beta: 0.60 },
  [ASSET_CLASS.CASH]:           { annVol: 0.01, mdd: 0.00, beta: 0.00 },
  [ASSET_CLASS.DOLLAR]:         { annVol: 0.08, mdd: 0.12, beta: 0.00 },
  [ASSET_CLASS.CRYPTO]:         { annVol: 0.72, mdd: 0.82, beta: 0.55 },
};

/**
 * 자산명·자산군 기반 리스크 팩터 프록시 반환
 * @param {string} name       종목명 또는 티커
 * @param {string} assetClass ASSET_CLASS 값
 * @returns {{ annVol: number, mdd: number, beta: number }}
 */
export function getAssetProxy(name = '', assetClass = '', productType = '') {
  const upper = (name + ' ' + assetClass).toUpperCase();
  for (const row of ASSET_RISK_PROXY_TABLE) {
    for (const kw of row.keywords) {
      if (upper.includes(kw.toUpperCase())) {
        return { annVol: row.annVol, mdd: row.mdd, beta: row.beta };
      }
    }
  }
  // productType 기반 financialRules 우선 조회
  if (productType) {
    const rc = getRiskCoefficients(assetClass, productType);
    return { annVol: rc.annVol, mdd: rc.mdd, beta: rc.beta };
  }
  return ASSET_CLASS_PROXY_DEFAULT[assetClass]
    ?? { annVol: 0.18, mdd: 0.25, beta: 1.00 };
}

/** Box-Muller 변환: 표준정규분포 N(0,1) 난수 생성 */
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * 연환산 변동성 기반 현실적 월별 수익률 시계열 생성 (프록시 대체용)
 * @param {number} annVol    연환산 변동성 소수 (예: 0.22)
 * @param {number} annReturn 연환산 기대수익률 소수 (기본 0.06)
 * @param {number} length    생성 월 수 (기본 35)
 * @returns {number[]}
 */
export function buildProxyMonthlyReturns(annVol, annReturn = 0.06, length = 35) {
  const monthlyVol  = annVol / Math.sqrt(12);
  const monthlyMean = annReturn / 12;
  return Array.from({ length }, () => monthlyMean + randn() * monthlyVol);
}

// ============================================================
// 3. 데이터 소스 – 해외자산: Yahoo Finance v8 실 API 연동
// ============================================================

/**
 * 내부 프록시 API를 통해 Yahoo Finance 3개년 월봉 시계열 수집.
 * ticker 가 유효한 형식(영문·숫자·특수문자)이면 name 해석 없이 직접 조회.
 *
 * @param {string} assetNameOrTicker  티커 우선, 없으면 한글/영문 자산명
 * @returns {Promise<{ticker:string, dates:string[], closes:number[], returns:number[]}|null>}
 */
export async function fetchYahooFinanceHistory(assetNameOrTicker) {
  if (!assetNameOrTicker?.trim()) return null;

  const url = `/api/proxy-finance?assetName=${encodeURIComponent(assetNameOrTicker.trim())}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const ticker = json.ticker ?? assetNameOrTicker;
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp ?? [];
    const rawCloses  =
      result.indicators?.adjclose?.[0]?.adjclose ??
      result.indicators?.quote?.[0]?.close ?? [];

    const pairs = timestamps
      .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 7), close: rawCloses[i] }))
      .filter(p => p.close != null && !Number.isNaN(p.close));

    const returns = pairs.slice(1).map((p, i) => (p.close - pairs[i].close) / pairs[i].close);

    return { ticker, dates: pairs.map(p => p.date), closes: pairs.map(p => p.close), returns };
  } catch (err) {
    console.warn(`[quantEngine] Yahoo Finance 연동 실패 (${assetName}):`, err?.message);
    return null;
  }
}

// ============================================================
// 4. 데이터 소스 – 국내자산: 비동기 Mock API
// ============================================================

/**
 * 국내채권 가상 시세 Mock
 * @param {string} keyword  예: '국채 3년', '회사채 AA', 'KTB'
 * @returns {Promise<{ticker:string, dates:string[], closes:number[], returns:number[], yieldRate:number}>}
 */
export async function fetchDomesticBondMock(keyword) {
  await _delay(120 + Math.random() * 80);

  const baseYield = keyword.includes('국채') || keyword.includes('KTB')
    ? 0.035
    : keyword.includes('회사채')
      ? 0.050
      : 0.040;

  return _buildMockTimeSeries(keyword, baseYield / 12, 0.002, { yieldRate: baseYield });
}

/**
 * 환율(USD/KRW) 가상 시세 Mock
 * @param {string} pair  예: 'USD/KRW', '달러', 'Dollar'
 * @returns {Promise<{ticker:string, dates:string[], closes:number[], returns:number[]}>}
 */
export async function fetchFxRateMock(pair) {
  await _delay(100 + Math.random() * 60);

  const baseRate  = 1320;
  const dates     = [];
  const closes    = [];
  const returns   = [];
  let rate        = baseRate;
  const now       = new Date();

  for (let i = 36; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dates.push(d.toISOString().slice(0, 7));
    const delta = (Math.random() - 0.5) * 35;
    if (i < 36) returns.push(delta / rate);
    rate = Math.min(1550, Math.max(1050, rate + delta));
    closes.push(+rate.toFixed(2));
  }

  return { ticker: pair, dates, closes, returns };
}

/**
 * 부동산 가상 시세 Mock
 * @param {string} keyword  예: '아파트', '상업용부동산', '오피스텔'
 * @returns {Promise<{ticker:string, dates:string[], closes:number[], returns:number[]}>}
 */
export async function fetchRealEstateMock(keyword) {
  await _delay(150 + Math.random() * 100);

  const annualReturn = keyword.includes('아파트') ? 0.050
    : keyword.includes('상업용')                  ? 0.042
    : 0.030;

  return _buildMockTimeSeries(keyword, annualReturn / 12, 0.012);
}

// 내부 헬퍼: 일정 평균 수익률을 가진 월별 시계열 생성
function _buildMockTimeSeries(ticker, monthlyMean, noise, extra = {}) {
  const dates   = [];
  const closes  = [];
  const returns = [];
  let price     = 100;
  const now     = new Date();

  for (let i = 36; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dates.push(d.toISOString().slice(0, 7));
    const r = monthlyMean + (Math.random() - 0.5) * noise * 2;
    if (i < 36) returns.push(r);
    price *= (1 + r);
    closes.push(+price.toFixed(4));
  }

  return { ticker, dates, closes, returns, ...extra };
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 5. 자산 분류 및 태깅
// ============================================================

/**
 * 자산 키워드/티커로 표준 자산군·세부 테마·과세 유형 자동 분류
 * @param {string} keyword
 * @returns {{ assetClass: string, theme: string, taxType: string }}
 */
export function classifyAsset(keyword) {
  const upper = keyword.toUpperCase().trim();
  for (const row of ASSET_MAPPING_TABLE) {
    for (const kw of row.keywords) {
      if (upper.includes(kw.toUpperCase())) {
        return { assetClass: row.assetClass, theme: row.theme, taxType: row.taxType };
      }
    }
  }
  // 분류 불명 시 해외주식 Direct_Stock 기본값
  return { assetClass: ASSET_CLASS.FOREIGN_STOCK, theme: THEME.OTHER, taxType: TAX_TYPE.DIRECT_STOCK };
}

/**
 * 포트폴리오 자산 배열에 분류 태그 일괄 부착
 * @param {Array<{name:string, weight:number, value?:number, gain?:number}>} assets
 * @returns {Array<{name:string, weight:number, value?:number, gain?:number, assetClass:string, theme:string, taxType:string}>}
 */
export function tagPortfolioAssets(assets) {
  return assets.map(asset => ({ ...asset, ...classifyAsset(asset.name) }));
}

// ============================================================
// 6. 데이터 수집 오케스트레이터
// ============================================================

const TICKER_VALID_RE = /^[\w.\-=^]+$/;

/**
 * 자산 유형에 따라 실 API 또는 Mock을 자동 선택하여 월별 수익률 시계열 반환.
 * ticker 가 유효한 형식이면 한글 name 대신 ticker 로 Yahoo Finance 직접 조회.
 * ticker/name 이 비어있거나 조회 실패 시 프록시 시계열로 안전하게 마스킹.
 *
 * @param {string} name        종목명 (fallback 용)
 * @param {string} assetClass
 * @param {string} [productType]
 * @param {string} [ticker]    Yahoo Finance 티커 (유효 시 우선 사용)
 * @returns {Promise<number[]>}
 */
// 자산군별 기본 티커 (명칭/티커 미입력 시 대표 벤치마크로 폴백)
const DEFAULT_TICKER_BY_CLASS = {
  [ASSET_CLASS.GOLD]:   'GC=F',
  [ASSET_CLASS.REITS]:  'VNQ',
  [ASSET_CLASS.CRYPTO]: 'BTC-USD',
  [ASSET_CLASS.DOLLAR]: 'KRW=X',
};

export async function fetchAssetReturns(name, assetClass, productType = '', ticker = '') {
  const resolvedTicker = ticker?.trim() && TICKER_VALID_RE.test(ticker.trim())
    ? ticker.trim()
    : null;

  // 암호화폐: assetClass 또는 productType 기준 모두 처리
  if (productType === '암호화폐' || assetClass === ASSET_CLASS.CRYPTO) {
    const cryptoQuery = resolvedTicker ?? 'BTC-USD';
    const rc = getRiskCoefficients(ASSET_CLASS.CRYPTO, '암호화폐');
    try {
      const data = await fetchYahooFinanceHistory(cryptoQuery);
      if (data?.returns?.length >= 6) return filterFinite(data.returns);
    } catch { /* fallthrough */ }
    return buildProxyMonthlyReturns(rc.annVol, rc.expRet ?? 0.15, 35);
  }

  // 외화/달러
  if (assetClass === ASSET_CLASS.DOLLAR || productType === '외화') {
    try {
      const d = await fetchFxRateMock((resolvedTicker ?? name) || 'USD/KRW');
      return filterFinite(d.returns);
    } catch {
      return buildProxyMonthlyReturns(0.08, 0.02, 35);
    }
  }

  // 채권·현금·예적금
  // 실물 국내채권 → 114260.KS(KODEX 국고채10년) 프록시, 실물 해외채권 → TLT 프록시 시계열 우선 사용
  if (
    assetClass === ASSET_CLASS.DOMESTIC_BOND ||
    assetClass === ASSET_CLASS.FOREIGN_BOND ||
    assetClass === ASSET_CLASS.CASH ||
    productType === '국내채권' || productType === '해외채권' || productType === '예적금/현금'
  ) {
    const isBond = assetClass === ASSET_CLASS.DOMESTIC_BOND || assetClass === ASSET_CLASS.FOREIGN_BOND ||
                   productType === '국내채권' || productType === '해외채권';
    if (isBond) {
      const proxyTicker = (assetClass === ASSET_CLASS.FOREIGN_BOND || productType === '해외채권')
        ? 'TLT' : '114260.KS';
      try {
        const data = await fetchYahooFinanceHistory(proxyTicker);
        if (data?.returns?.length >= 6) return filterFinite(data.returns);
      } catch { /* fallthrough */ }
    }
    try {
      const d = await fetchDomesticBondMock(name || '예금');
      return filterFinite(d.returns);
    } catch {
      return buildProxyMonthlyReturns(0.04, 0.035, 35);
    }
  }

  // 금·리츠: 기본 대표 티커 사용 (미입력 시 대체)
  const defaultTicker = DEFAULT_TICKER_BY_CLASS[assetClass];
  const yahooQuery = resolvedTicker ?? defaultTicker ?? (name || null);

  if (yahooQuery) {
    try {
      const data = await fetchYahooFinanceHistory(yahooQuery);
      if (data?.returns?.length >= 6) return filterFinite(data.returns);
    } catch { /* fallthrough to proxy */ }
  }

  // 국내주식 또는 Yahoo 실패 → financialRules 기반 프록시 시계열 (NaN 0건 보장)
  const proxy = getAssetProxy(resolvedTicker ?? name ?? '', assetClass, productType);
  const rc    = getRiskCoefficients(assetClass, productType);
  return buildProxyMonthlyReturns(
    safeNum(proxy.annVol, 0.18),
    safeNum(rc.expRet, 0.06),
    35
  );
}

// ============================================================
// 7. 기초 통계 유틸
// ============================================================

/** NaN · Infinity를 안전한 수치로 대체 */
function safeNum(v, fallback = 0) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;
}

/** NaN/Infinity를 배열에서 제거 */
function filterFinite(arr) {
  return arr.filter(v => typeof v === 'number' && Number.isFinite(v));
}

export function mean(arr) {
  const a = filterFinite(arr);
  if (!a.length) return 0;
  return a.reduce((s, v) => s + v, 0) / a.length;
}

export function variance(arr) {
  const a = filterFinite(arr);
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1);
}

export function stdDev(arr) {
  return Math.sqrt(variance(arr));
}

export function covariance(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  return a.slice(0, n).reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / (n - 1);
}

export function correlation(a, b) {
  const sa = stdDev(a);
  const sb = stdDev(b);
  if (sa === 0 || sb === 0) return 0;
  return covariance(a, b) / (sa * sb);
}

/**
 * 하방 편차 (Downside Deviation)
 * @param {number[]} returns
 * @param {number}   targetReturn  기준 수익률 (기본 0)
 */
export function downsideDeviation(returns, targetReturn = 0) {
  const negSq = returns
    .filter(r => r < targetReturn)
    .map(r => (r - targetReturn) ** 2);
  if (!negSq.length) return 0;
  return Math.sqrt(negSq.reduce((s, v) => s + v, 0) / returns.length);
}

/**
 * 최대낙폭 (MDD)
 * @param {number[]} returns 월별 수익률 시계열
 * @returns {number} 낙폭 비율 (0~1)
 */
export function maximumDrawdown(returns) {
  let peak  = 1;
  let value = 1;
  let mdd   = 0;
  for (const r of returns) {
    value *= 1 + r;
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

/**
 * 정규분포 역함수 근사 (Beasley-Springer-Moro)
 * @param {number} p  확률 (0~1)
 */
export function normalInverse(p) {
  const a = [2.515517, 0.802853, 0.010328];
  const b = [1.432788, 0.189269, 0.001308];
  const t = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
  const num = a[0] + a[1] * t + a[2] * t * t;
  const den = 1 + b[0] * t + b[1] * t * t + b[2] * t * t * t;
  const x   = t - num / den;
  return p < 0.5 ? -x : x;
}

// ============================================================
// 8. 포트폴리오 합산 수익률
// ============================================================

/**
 * 비중 가중 포트폴리오 월별 수익률 생성
 * @param {Array<{returns:number[], weight:number}>} assets
 * @returns {number[]}
 */
export function portfolioReturns(assets) {
  const maxLen = Math.max(0, ...assets.map(a => a.returns.length));
  if (!maxLen) return [];
  return Array.from({ length: maxLen }, (_, i) =>
    assets.reduce((sum, a) => {
      const r = a.returns[i];
      const w = a.weight ?? 0;
      // NaN/Infinity인 수익률은 0으로 처리(해당 자산 비중만큼 무위험자산 준용)
      return sum + (Number.isFinite(r) ? r : 0) * w;
    }, 0)
  );
}

// ============================================================
// 9. 그룹 1: 성과 및 효율성 지표
// ============================================================

/**
 * 수수료(0.25%) 차감 후 t_marginal 세후 기대수익률
 * @param {number} annualReturn  세전 연간 기대수익률 (소수)
 * @param {number} t_marginal   한계세율 (소수, page.tsx에서 수신)
 * @returns {number}
 */
export function afterTaxExpectedReturn(annualReturn, t_marginal) {
  const afterFee = annualReturn - FEE_RATE;
  return afterFee * (1 - t_marginal);
}

/**
 * 샤프 지수 (무위험 3.5%, 월별→연환산)
 * @param {number[]} monthlyReturns
 * @returns {number}
 */
export function sharpeRatio(monthlyReturns) {
  if (!monthlyReturns.length) return 0;
  const annRet = mean(monthlyReturns) * 12;
  const annVol = stdDev(monthlyReturns) * Math.sqrt(12);
  if (annVol === 0) return 0;
  return (annRet - RISK_FREE_RATE) / annVol;
}

/**
 * 소티노 비율 (하방 편차 기반)
 * @param {number[]} monthlyReturns
 * @returns {number}
 */
export function sortinoRatio(monthlyReturns) {
  if (!monthlyReturns.length) return 0;
  const annRet     = mean(monthlyReturns) * 12;
  const monthlyRf  = RISK_FREE_RATE / 12;
  const annDownDev = downsideDeviation(monthlyReturns, monthlyRf) * Math.sqrt(12);
  if (annDownDev === 0) return 0;
  return (annRet - RISK_FREE_RATE) / annDownDev;
}

/**
 * 젠센의 알파  α = Rp − [Rf + β(Rm − Rf)]
 * @param {number} portAnnualReturn  포트폴리오 연간 수익률
 * @param {number} beta
 * @param {number} [marketReturn=0.07]  시장 연간 수익률 (기본 7%)
 * @returns {number}
 */
export function jensensAlpha(portAnnualReturn, beta, marketReturn = 0.07) {
  return portAnnualReturn - (RISK_FREE_RATE + beta * (marketReturn - RISK_FREE_RATE));
}

// ============================================================
// 10. 그룹 2: 리스크 및 하방 손실 지표
// ============================================================

/**
 * 연환산 포트폴리오 변동성
 * @param {number[]} monthlyReturns
 * @returns {number}
 */
export function portfolioVolatility(monthlyReturns) {
  return stdDev(monthlyReturns) * Math.sqrt(12);
}

/**
 * 자산 간 상관계수 히트맵 및 분산 점수 산출
 * @param {Array<{name:string, returns:number[]}>} assets
 * @returns {{ score:number, heatmap:number[][], labels:string[] }}
 */
export function diversificationScore(assets) {
  const n = assets.length;

  // 히트맵 레이블 결정
  // portfolioLogic.ts가 productType/asset_class를 quantInput top-level에 직접 노출하므로
  // a.productType(3순위)에서 "국내채권"/"해외채권"을 정확히 잡는다.
  // a.assetClass는 classifyAsset("")이 "해외주식"을 덮어쓰므로 _meta 체크 이후에 배치한다.
  const resolveLabel = (a) => {
    return a.name        ||
           a.종목명      ||
           a.productType ||
           a.상품유형    ||
           a.asset_class ||
           a._meta?.productType ||
           a._meta?.asset_class ||
           a.assetClass  ||
           '채권';
  };

  if (n < 2) return { score: 1, heatmap: [[1]], labels: assets.map(resolveLabel) };

  const heatmap = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 1;
      try { return +correlation(assets[i].returns, assets[j].returns).toFixed(4); }
      catch { return 0; }
    })
  );

  let sumCorr = 0;
  let count   = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sumCorr += heatmap[i][j];
      count++;
    }
  }
  const avgCorr = count > 0 ? sumCorr / count : 0;
  // 분산 점수: 1 − 평균 상관계수 (1에 가까울수록 분산 우수)
  const score = +(1 - avgCorr).toFixed(4);

  return { score, heatmap, labels: assets.map(resolveLabel) };
}

/**
 * 연환산 변동성 기반 1개월 95% VaR
 * 공식: 총자산 × 연변동성 × 1.645 × √(1/12)
 * @param {number} portfolioValue    포트폴리오 총 금액 (원)
 * @param {number} annualVolatility  연환산 변동성 소수 (예: 0.18)
 * @returns {number} 최대 예상 손실 금액 (양수, 원)
 */
export function valueAtRisk95(portfolioValue, annualVolatility) {
  if (portfolioValue <= 0 || annualVolatility <= 0) return 0;
  return portfolioValue * annualVolatility * 1.645 * Math.sqrt(1 / 12);
}

// ============================================================
// 11. 그룹 3: 민감도 및 쏠림 지표
// ============================================================

/**
 * 포트폴리오 베타 (시장 수익률 대비)
 * @param {number[]} portReturnsArr
 * @param {number[]} marketReturns
 * @returns {number}
 */
export function portfolioBeta(portReturnsArr, marketReturns) {
  const varM = variance(marketReturns);
  if (varM === 0) return 1;
  return covariance(portReturnsArr, marketReturns) / varM;
}

/**
 * HHI 집중도 지수 및 단일 종목 20% 초과 경고
 * @param {Array<{name:string, weight:number}>} assets
 * @returns {{ hhi:number, warning:boolean, warningAssets:string[] }}
 */
export function hhiConcentration(assets) {
  const hhi           = assets.reduce((s, a) => s + a.weight ** 2, 0);
  const warningAssets = assets.filter(a => a.weight > HHI_WARNING_THRESHOLD).map(a => a.name);
  return {
    hhi: +hhi.toFixed(4),
    warning: warningAssets.length > 0,
    warningAssets,
  };
}

// ============================================================
// 12. 세금 메커니즘
// ============================================================

/**
 * 해외주식 양도소득세 (Direct_Stock)
 * 손익통산 → 250만 원 공제 → 22% 적용
 * @param {number} netGain  손익통산 후 양도차익 합계 (원)
 * @returns {{ taxableGain:number, tax:number }}
 */
export function foreignStockCapitalGainsTax(netGain) {
  const taxableGain = Math.max(netGain - FOREIGN_STOCK_DEDUCTION, 0);
  return {
    taxableGain,
    tax: +(taxableGain * FOREIGN_STOCK_TAX_RATE).toFixed(0),
  };
}

/**
 * 금융소득종합과세 연산
 * Fixed_Income 이자소득 + Indirect_Fund 배당·이자 차익 합산 후 2,000만 원 초과 시
 * 초과분에 (t_marginal − 15.4%) 누진 근사 세율 적용
 *
 * @param {number} totalInterest  Fixed_Income 이자소득 합계 (원)
 * @param {number} totalDividend  Indirect_Fund 배당·이자 차익 합계 (원)
 * @param {number} t_marginal     한계세율 (소수, page.tsx에서 수신)
 * @returns {{
 *   total: number,
 *   warning: boolean,
 *   excessAmount: number,
 *   baseTax: number,
 *   progressiveTax: number,
 *   totalTax: number
 * }}
 */
export function financialIncomeTaxCalculation(totalInterest, totalDividend, t_marginal) {
  const total          = totalInterest + totalDividend;
  const base           = Math.min(total, FINANCIAL_INCOME_THRESHOLD);
  const baseTax        = base * TAX_RATE_GENERAL;
  const excessAmount   = Math.max(total - FINANCIAL_INCOME_THRESHOLD, 0);
  const progressiveRate = Math.max(t_marginal - TAX_RATE_GENERAL, 0); // (t_marginal − 15.4%)
  const progressiveTax  = excessAmount * progressiveRate;

  return {
    total,
    warning:         total > FINANCIAL_INCOME_THRESHOLD,
    excessAmount,
    baseTax:         +baseTax.toFixed(0),
    progressiveTax:  +progressiveTax.toFixed(0),
    totalTax:        +(baseTax + progressiveTax).toFixed(0),
  };
}

/**
 * ISA 절세 시뮬레이션
 * 일반 계좌(15.4%) vs ISA(200만 원 비과세, 초과분 9.9%) 세액 비교
 * @param {number} gain  운용 차익 총액 (원)
 * @returns {{ generalTax:number, isaTax:number, taxSaving:number }}
 */
export function isaVsGeneralTaxSimulation(gain) {
  const generalTax = +(gain * TAX_RATE_GENERAL).toFixed(0);
  const isaExcess  = Math.max(gain - ISA_TAX_FREE_LIMIT, 0);
  const isaTax     = +(isaExcess * TAX_RATE_ISA_EXCESS).toFixed(0);
  return {
    generalTax,
    isaTax,
    taxSaving: +(generalTax - isaTax).toFixed(0),
  };
}

// ============================================================
// 13. 메인 분석 함수 – 전체 포트폴리오 정량 연산
// ============================================================

/**
 * 포트폴리오 전체 정량 분석 실행
 *
 * @param {Array<{
 *   name:    string,   // 종목명 또는 티커
 *   weight:  number,   // 비중 (0~1, 합산 1)
 *   value?:  number,   // 보유 금액 (원) – VaR 계산
 *   gain?:   number,   // 평가 손익 (원) – 세금 계산
 * }>} rawAssets
 *
 * @param {number}   t_marginal      page.tsx에서 넘겨받는 한계세율 (0~1)
 * @param {number[]} [marketReturns] 시장 기준 월별 수익률 배열 (생략 시 Mock 사용)
 *
 * @returns {Promise<{
 *   assets:       Array,
 *   performance:  object,
 *   risk:         object,
 *   sensitivity:  object,
 *   tax:          object,
 *   meta:         object,
 * }>}
 */
export async function runQuantAnalysis(rawAssets, t_marginal, marketReturns) {
  // ── Step 1: 자산 분류 태깅
  const tagged = tagPortfolioAssets(rawAssets);

  // ── Step 2: 각 자산 월별 수익률 시계열 병렬 수집 (ticker 우선 조회)
  const withReturns = await Promise.all(
    tagged.map(async asset => {
      const meta   = resolveAssetMeta(asset);
      // _meta.ticker 에서 Yahoo Finance 티커 추출 (portfolioLogic.ts 가 주입)
      const ticker = (asset._meta?.ticker || asset.ticker || '').trim();
      let returns;
      try {
        returns = await fetchAssetReturns(asset.name, meta.assetClass, meta.productType, ticker);
      } catch {
        // 예외 발생 시 프록시 시계열로 0 마스킹 방지
        const proxy = getAssetProxy(ticker || asset.name, meta.assetClass, meta.productType);
        const rc    = getRiskCoefficients(meta.assetClass, meta.productType);
        returns = buildProxyMonthlyReturns(proxy.annVol, rc.expRet ?? 0.06, 35);
      }
      return { ...asset, returns: returns ?? [] };
    })
  );

  // ── Step 3: 포트폴리오 합산 수익률
  const portRet = portfolioReturns(withReturns);

  // ── Step 3.5: 자산별 벤치마크 결정 및 유니크 벤치마크 병렬 수집 (캐시)
  const assetBMs = tagged.map(asset => {
    const meta = resolveAssetMeta(asset);
    return getBenchmarkTicker(meta.assetClass, meta.productType, meta.country);
  });
  const uniqueBMs = [...new Set(assetBMs.filter(Boolean))];
  const bmReturnCache = {};
  await Promise.all(uniqueBMs.map(async (bm) => {
    try {
      const data = await fetchYahooFinanceHistory(bm);
      if (data?.returns?.length >= 6) bmReturnCache[bm] = data.returns;
    } catch { /* 벤치마크 조회 실패 시 프록시 대체 */ }
  }));

  // ── Step 4: 포트폴리오 대표 시장 수익률 (최대 비중 자산의 벤치마크 우선)
  const dominantBM = assetBMs.reduce((best, bm, i) => {
    if (!best.bm || (tagged[i]?.weight ?? 0) > best.w) return { bm, w: tagged[i]?.weight ?? 0 };
    return best;
  }, { bm: null, w: -1 }).bm;
  const mktRet = marketReturns
    ?? (dominantBM && bmReturnCache[dominantBM])
    ?? await _mockMarketReturns(portRet.length);

  // ── Step 5: 총자산 · 벤치마크 기반 리스크 팩터 계산
  const totalPortValue = rawAssets.reduce((s, a) => s + (a.value ?? 0), 0);

  // 자산별 베타: 실제 벤치마크 시계열 공분산/분산 → 없으면 financialRules 프록시
  const assetBetas = tagged.map((asset, i) => {
    const meta    = resolveAssetMeta(asset);
    const bm      = assetBMs[i];
    const bmRet   = bm ? (bmReturnCache[bm] ?? null) : null;
    const aRet    = filterFinite(withReturns[i]?.returns ?? []);
    const defBeta = safeNum(getRiskCoefficients(meta.assetClass, meta.productType).beta, 1.0);
    if (bmRet && aRet.length >= 6) {
      try {
        const varBM = variance(bmRet);
        if (varBM > 0) {
          const computedBeta = covariance(aRet, bmRet) / varBM;
          return safeNum(computedBeta, defBeta);
        }
      } catch { /* fallthrough */ }
    }
    return defBeta;
  });

  // 포트폴리오 가중 리스크 팩터 (NaN·Infinity 완전 차단)
  const proxyMetrics = tagged.reduce((acc, asset, i) => {
    const meta  = resolveAssetMeta(asset);
    const proxy = getAssetProxy(asset.name, meta.assetClass, meta.productType);
    const w     = safeNum(rawAssets[i]?.weight ?? 0);
    return {
      annVol: safeNum(acc.annVol + w * safeNum(proxy.annVol, 0.18)),
      mdd:    safeNum(acc.mdd    + w * safeNum(proxy.mdd, 0.25)),
      beta:   safeNum(acc.beta   + w * safeNum(assetBetas[i], 1.0)),
    };
  }, { annVol: 0, mdd: 0, beta: 0 });

  const annualRet = safeNum(mean(portRet) * 12);
  const beta      = safeNum(proxyMetrics.beta, 1.0);
  const mktAnnRet = safeNum(mean(mktRet) * 12, 0.07);

  // ── Step 6: 그룹 1 – 성과 및 효율성 (NaN 가드 적용)
  const performance = {
    afterTaxExpectedReturn: safeNum(afterTaxExpectedReturn(annualRet, t_marginal)),
    sharpeRatio:            safeNum(sharpeRatio(portRet)),
    sortinoRatio:           safeNum(sortinoRatio(portRet)),
    jensensAlpha:           safeNum(jensensAlpha(annualRet, beta, mktAnnRet)),
  };

  // ── Step 7: 그룹 2 – 리스크 및 하방 손실 (NaN 가드 적용)
  const divInfo = diversificationScore(withReturns);
  const risk = {
    volatility:           safeNum(proxyMetrics.annVol, 0.15),
    mdd:                  safeNum(proxyMetrics.mdd, 0.10),
    diversificationScore: safeNum(divInfo.score, 0),
    correlationHeatmap:   { matrix: divInfo.heatmap, labels: divInfo.labels },
    var95:                safeNum(valueAtRisk95(totalPortValue, proxyMetrics.annVol)),
  };

  // ── Step 8: 그룹 3 – 민감도 및 쏠림 (NaN 가드 적용)
  const hhi = hhiConcentration(tagged);
  const sensitivity = {
    beta:             safeNum(beta, 1.0),
    hhi:              safeNum(hhi.hhi),
    hhiWarning:       hhi.warning,
    hhiWarningAssets: hhi.warningAssets,
  };

  // ── Step 9: 세금 연산
  const foreignDirectGain = withReturns
    .filter(a => a.taxType === TAX_TYPE.DIRECT_STOCK && a.assetClass === ASSET_CLASS.FOREIGN_STOCK)
    .reduce((s, a) => s + (a.gain ?? 0), 0);

  const totalInterest = withReturns
    .filter(a => a.taxType === TAX_TYPE.FIXED_INCOME)
    .reduce((s, a) => s + (a.gain ?? 0), 0);

  const totalDividend = withReturns
    .filter(a => a.taxType === TAX_TYPE.INDIRECT_FUND)
    .reduce((s, a) => s + (a.gain ?? 0), 0);

  const totalGain = rawAssets.reduce((s, a) => s + (a.gain ?? 0), 0);

  // ISA 시뮬레이션: 배당소득세 과세 대상 해외자산 총액 × 연 2.5% 배당수익률 가정
  // - taxType=INDIRECT_FUND(국내상장 해외ETF/펀드) 또는 사용자가 해외주식·해외채권으로 직접 지정한 자산
  const isaEligibleValue = withReturns
    .filter(a => {
      const userClass = a._meta?.asset_class ?? '';
      return a.taxType === TAX_TYPE.INDIRECT_FUND
        || userClass === ASSET_CLASS.FOREIGN_STOCK
        || userClass === ASSET_CLASS.FOREIGN_BOND;
    })
    .reduce((s, a) => s + (a.value ?? 0), 0);
  const isaGain = totalGain !== 0 ? totalGain : isaEligibleValue * 0.025;

  const tax = {
    foreignStock:    foreignStockCapitalGainsTax(foreignDirectGain),
    financialIncome: financialIncomeTaxCalculation(totalInterest, totalDividend, t_marginal),
    isaSimulation:   isaVsGeneralTaxSimulation(isaGain),
  };

  return {
    assets:      tagged,
    performance,
    risk,
    sensitivity,
    tax,
    meta: {
      t_marginal,
      totalPortfolioValue: totalPortValue,
      assetCount:          rawAssets.length,
      analysisDate:        new Date().toISOString(),
    },
  };
}

// 시장 수익률 Mock (KOSPI 대리 – 연 7% 기대, 변동성 15%)
async function _mockMarketReturns(length = 35) {
  await _delay(30);
  const annReturn = 0.07;
  const annVol    = 0.15;
  return Array.from({ length }, () =>
    annReturn / 12 + (Math.random() - 0.5) * (annVol / Math.sqrt(12)) * 2
  );
}

// ============================================================
// 14-a. 날짜 매칭 유틸 – 스트레스 테스트 역사적 가격 조회용
// ============================================================

/**
 * 날짜-종가 쌍 배열에서 타겟 날짜와 가장 가까운 데이터 반환.
 * 정확한 날짜(예: 2020-03-23 휴장일)가 없어도 최근 영업일로 대체.
 *
 * @param {Array<{date: string, close: number}>} pairs  날짜-종가 쌍 (dates/closes를 zip한 배열)
 * @param {string} targetDate  찾을 날짜 (YYYY-MM-DD 또는 YYYY-MM)
 * @param {number} [maxDeltaDays=10]  허용 최대 오차 일수
 * @returns {{ date: string, close: number } | null}
 */
export function findClosestPrice(pairs, targetDate, maxDeltaDays = 10) {
  if (!pairs.length) return null;
  const targetMs = new Date(targetDate).getTime();
  if (Number.isNaN(targetMs)) return null;

  let best = null;
  let bestDelta = Infinity;
  for (const p of pairs) {
    if (p.close == null || Number.isNaN(p.close)) continue;
    const delta = Math.abs(new Date(p.date).getTime() - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = p;
    }
  }

  const maxDeltaMs = maxDeltaDays * 24 * 3600 * 1000;
  return bestDelta <= maxDeltaMs ? best : null;
}

/**
 * fetchYahooFinanceHistory 결과로부터 특정 날짜의 종가 반환 (Tolerance 적용).
 * 월봉(YYYY-MM) 데이터 기준 — 일별 정밀도는 10일 이내 오차 허용.
 *
 * @param {{ dates: string[], closes: number[] }} history
 * @param {string} targetDate
 * @returns {number | null}
 */
export function getPriceAt(history, targetDate) {
  if (!history?.dates?.length) return null;
  const pairs = history.dates.map((date, i) => ({ date, close: history.closes[i] }));
  const found = findClosestPrice(pairs, targetDate);
  return found?.close ?? null;
}

// ============================================================
// 14. 스트레스 테스트 – 4대 시나리오 충격 행렬
// ============================================================

/**
 * 자산 메타 정보 정규화 헬퍼
 * quantEngine tagged format(camelCase) / assetPipeline _meta format(snake_case) 모두 지원
 */
function resolveAssetMeta(asset) {
  // 사용자가 직접 지정한 _meta.asset_class를 keyword 기반 classifyAsset보다 우선 적용.
  // tagPortfolioAssets가 classifyAsset 결과를 spread하여 asset.assetClass를 덮어쓰므로
  // 명시적 _meta 값이 존재할 때는 그것을 우선한다.
  const userClass = asset._meta?.asset_class;
  const assetClass = (userClass && userClass.trim())
    ? userClass
    : (asset.assetClass ?? ASSET_CLASS.FOREIGN_STOCK);

  const isForeignClass = [
    ASSET_CLASS.FOREIGN_STOCK, ASSET_CLASS.FOREIGN_BOND,
    ASSET_CLASS.GOLD, ASSET_CLASS.DOLLAR, ASSET_CLASS.CRYPTO,
  ].includes(assetClass);

  const isHedging =
    asset.isHedging         ??
    asset._meta?.isHedging  ??
    asset._meta?.is_hedged  ??
    false;

  // 사용자 지정 productType(_meta) > tagged productType > 빈 문자열
  const productType = (asset._meta?.productType && asset._meta.productType.trim())
    ? asset._meta.productType
    : (asset.productType ?? '');

  return {
    assetClass,
    productType,
    theme:     asset.theme    ?? asset._meta?.theme     ?? THEME.OTHER,
    taxType:   asset.taxType  ?? asset._meta?.taxType   ?? TAX_TYPE.DIRECT_STOCK,
    country:   asset._meta?.country ?? (isForeignClass ? '미국' : '한국'),
    isHedging,
    is_hedged: isHedging,
    weight:    safeNum(asset.weight ?? 0),
    value:     safeNum(asset.value  ?? 0),
    gain:      safeNum(asset.gain   ?? 0),
    name:      asset.name ?? '',
  };
}

/** 채권 Modified Duration 추정 (이름 키워드 기반) */
function estimateBondDuration(name = '') {
  const u = name.toUpperCase();
  if (u.includes('TLT')  || u.includes('20년')) return 18;
  if (u.includes('EDV')  || u.includes('25년')) return 24;
  if (u.includes('IEF')  || u.includes('10년')) return 8;
  if (u.includes('IEI')  || u.includes('7년'))  return 6;
  if (u.includes('SHY')  || u.includes('단기') || u.includes('2년') || u.includes('1년')) return 2;
  if (u.includes('중기') || u.includes('5년') || u.includes('3년')) return 4;
  if (u.includes('장기') || u.includes('국채')) return 8;
  return 5; // 기본 duration
}

// ── 시나리오 1: 금리 100bp 인상 ───────────────────────────────
// 기술주/반도체 -18%(국내)/-15%(해외), 금융주 +5%(국내)/+3%(해외)
// 채권 -Duration*1%, 리츠 -10%
function getScenario1Shock(asset) {
  const { assetClass, theme, country, is_hedged, name, productType } = resolveAssetMeta(asset);
  const isForeign = country !== '한국' ||
    [ASSET_CLASS.FOREIGN_STOCK, ASSET_CLASS.FOREIGN_BOND, ASSET_CLASS.GOLD].includes(assetClass);

  // 상품유형 우선 충격값 조회 (암호화폐 등)
  const ptShock = getProductTypeStressShock(productType, 'rateHike');
  if (ptShock !== null) return ptShock;

  if (theme === THEME.TECH || theme === THEME.SEMICONDUCTOR)
    return isForeign ? -0.15 : -0.18;
  if (theme === THEME.FINANCIAL)
    return isForeign ? +0.03 : +0.05;
  if (assetClass === ASSET_CLASS.DOMESTIC_BOND || assetClass === ASSET_CLASS.FOREIGN_BOND) {
    const maturity = asset._meta?.bond_maturity ?? estimateBondDuration(name);
    const yld = asset._meta?.bond_yield ? asset._meta.bond_yield / 100 : 0.035;
    return -(maturity / (1 + yld / 2) * 0.01);
  }
  if (assetClass === ASSET_CLASS.REITS)   return -0.10;
  if (assetClass === ASSET_CLASS.GOLD)    return -0.05;  // 실질금리 상승 시 금 하락
  if (assetClass === ASSET_CLASS.CASH)    return +0.01;  // 단기 예금 수혜
  if (assetClass === ASSET_CLASS.DOLLAR)  return +0.04;  // 달러 강세
  if (theme === THEME.HEALTHCARE)         return -0.07;
  if (theme === THEME.ETF)                return isForeign ? -0.12 : -0.10;
  return isForeign ? -0.08 : -0.10;                      // 기타 주식 기본값
}

// ── 시나리오 2: 원자재 쇼크 ───────────────────────────────────
// 원자재/금 +12%(국내)/+15%(해외), 기술주 -12%, 경기민감주 -15%, 채권 -4%
function getScenario2Shock(asset) {
  const { assetClass, theme, country, productType } = resolveAssetMeta(asset);
  const isForeign    = country !== '한국' ||
    [ASSET_CLASS.FOREIGN_STOCK, ASSET_CLASS.FOREIGN_BOND, ASSET_CLASS.GOLD].includes(assetClass);
  const isCyclical   = [THEME.ENERGY, THEME.INDUSTRIALS, THEME.CONSUMER].includes(theme);

  // 상품유형 우선 충격값 조회
  const ptShock = getProductTypeStressShock(productType, 'commodity');
  if (ptShock !== null) return ptShock;

  if (assetClass === ASSET_CLASS.GOLD)   return isForeign ? +0.15 : +0.12;
  if (theme === THEME.TECH || theme === THEME.SEMICONDUCTOR) return -0.12;
  if (isCyclical)                         return -0.15;
  if (assetClass === ASSET_CLASS.DOMESTIC_BOND || assetClass === ASSET_CLASS.FOREIGN_BOND)
                                          return -0.04;
  if (assetClass === ASSET_CLASS.REITS)   return -0.06;  // 비용 상승
  if (theme === THEME.FINANCIAL)          return -0.05;
  if (assetClass === ASSET_CLASS.CASH)    return 0;
  if (assetClass === ASSET_CLASS.DOLLAR)  return +0.03;  // 원자재 달러 거래 수혜
  if (theme === THEME.HEALTHCARE)         return -0.03;
  if (theme === THEME.ETF)               return isForeign ? -0.07 : -0.05;
  return isForeign ? -0.06 : -0.05;
}

// ── 시나리오 3: 환율 +200원 ───────────────────────────────────
// 해외/환노출 +12%, 환헤지 -2%, 국내수출주 +4%, 국내내수/금융 -10%~-12%
function getScenario3Shock(asset) {
  const { assetClass, theme, country, isHedging, is_hedged, productType } = resolveAssetMeta(asset);
  const hedged = isHedging || is_hedged;  // 신/구 필드 모두 확인
  const isForeign    = country !== '한국' ||
    [ASSET_CLASS.FOREIGN_STOCK, ASSET_CLASS.FOREIGN_BOND, ASSET_CLASS.GOLD, ASSET_CLASS.DOLLAR].includes(assetClass);
  const isDomestic   = !isForeign && assetClass === ASSET_CLASS.DOMESTIC_STOCK;
  const isExport     = isDomestic && (theme === THEME.SEMICONDUCTOR || theme === THEME.TECH || theme === THEME.INDUSTRIALS);
  const isDomesticConsumer = isDomestic &&
    (theme === THEME.CONSUMER || theme === THEME.OTHER || theme === THEME.HEALTHCARE);

  // 상품유형 우선 충격값 (암호화폐 등, 환헤지 미적용 시에만)
  const ptShock = getProductTypeStressShock(productType, 'fxUp200');
  if (ptShock !== null && !hedged) return ptShock;

  if (isForeign  && !hedged)    return +0.12;   // 환차익
  if (isForeign  &&  hedged)    return -0.02;   // 헤지 비용
  if (assetClass === ASSET_CLASS.DOLLAR) return +0.12;  // 달러 직접 보유
  if (isExport)                          return +0.04;  // 수출주 수혜
  if (theme === THEME.FINANCIAL)         return -0.10;  // 금융주 내수 타격
  if (isDomesticConsumer)                return -0.12;  // 내수주 타격
  if (assetClass === ASSET_CLASS.DOMESTIC_BOND) return -0.01;
  if (assetClass === ASSET_CLASS.CASH)   return 0;
  return 0;
}

// ── 시나리오 4: 복합위기 (Stagflation) ───────────────────────
// 시나리오 1+2+3 동시 발생, -80% 하한 적용
function getScenario4Shock(asset) {
  const combined = getScenario1Shock(asset) + getScenario2Shock(asset) + getScenario3Shock(asset);
  return Math.max(combined, -0.80);
}

/** Expected Loss = Sum(w_i × Shock_i) */
function computeExpectedLoss(assets, shockFn, portfolioValue) {
  // 채권은 asset.name = "" 이므로 productType / _meta 체인으로 표시명 해결
  const getDisplayName = (asset) =>
    asset.name        ||
    asset.productType ||
    asset.asset_class ||
    asset._meta?.productType ||
    asset._meta?.asset_class ||
    '자산';

  const details = assets.map(asset => {
    const { weight } = resolveAssetMeta(asset);
    const shock = shockFn(asset);
    return { name: getDisplayName(asset), shock, contribution: weight * shock };
  });
  const lossRate   = details.reduce((s, d) => s + d.contribution, 0);
  const lossAmount = portfolioValue * lossRate;
  return {
    lossRate:   +lossRate.toFixed(6),
    lossAmount: +lossAmount.toFixed(0),
    details,
  };
}

/** 리스크 진단 유형 상수 */
export const RISK_TYPE = Object.freeze({
  RATE_SENSITIVE:    '금리 충격 취약형',
  COMMODITY_EXPOSED: '인플레이션 취약형',
  FX_EXPOSED:        '환율 변동 취약형',
  STAGFLATION_RISK:  '복합위기(스태그플레이션) 취약형',
  BALANCED:          '상대적 균형형',
  DEFENSIVE:         '방어 우위형',
});

/** 시나리오 결과 → 리스크 진단 유형 배열 결정 */
function diagnosisRiskTypes(s1, s2, s3, s4) {
  const types = [];
  if (s1.lossRate < -0.10) types.push(RISK_TYPE.RATE_SENSITIVE);
  if (s2.lossRate < -0.10) types.push(RISK_TYPE.COMMODITY_EXPOSED);
  if (s3.lossRate < -0.10) types.push(RISK_TYPE.FX_EXPOSED);
  if (s4.lossRate < -0.20) types.push(RISK_TYPE.STAGFLATION_RISK);
  if (!types.length) {
    const worst = Math.min(s1.lossRate, s2.lossRate, s3.lossRate);
    return worst > -0.05 ? [RISK_TYPE.DEFENSIVE] : [RISK_TYPE.BALANCED];
  }
  return types;
}

/**
 * 4대 시나리오 스트레스 테스트 실행
 * Expected Loss = Sum(w_i × Shock_i)
 *
 * @param {Array<{name:string, weight:number, value:number, assetClass?:string, theme?:string, _meta?:object}>} assets
 * @param {number} portfolioValue  포트폴리오 총 금액 (원)
 * @returns {{
 *   scenario1: ScenarioResult,
 *   scenario2: ScenarioResult,
 *   scenario3: ScenarioResult,
 *   scenario4: ScenarioResult,
 *   riskTypes:  string[],
 *   diagnosis:  string,
 * }}
 */
export function runStressTest(assets, portfolioValue) {
  const s1 = computeExpectedLoss(assets, getScenario1Shock, portfolioValue);
  const s2 = computeExpectedLoss(assets, getScenario2Shock, portfolioValue);
  const s3 = computeExpectedLoss(assets, getScenario3Shock, portfolioValue);
  const s4 = computeExpectedLoss(assets, getScenario4Shock, portfolioValue);

  const riskTypes = diagnosisRiskTypes(s1, s2, s3, s4);

  // 동적 진단 문장 생성
  const sentenceMap = {
    [RISK_TYPE.RATE_SENSITIVE]:
      `금리 100bp 인상 시 약 ${Math.abs(s1.lossRate * 100).toFixed(1)}% ` +
      `(${Math.abs(s1.lossAmount / 1e8).toFixed(2)}억 원) 손실 예상. ` +
      `성장주·장기채 비중 축소 및 금융주·단기채 확대를 권고합니다.`,
    [RISK_TYPE.COMMODITY_EXPOSED]:
      `원자재 쇼크 시 약 ${Math.abs(s2.lossRate * 100).toFixed(1)}% ` +
      `(${Math.abs(s2.lossAmount / 1e8).toFixed(2)}억 원) 손실 예상. ` +
      `금·원자재 ETF 편입으로 인플레이션 헤지를 강화하세요.`,
    [RISK_TYPE.FX_EXPOSED]:
      `환율 +200원 충격 시 약 ${Math.abs(s3.lossRate * 100).toFixed(1)}% ` +
      `(${Math.abs(s3.lossAmount / 1e8).toFixed(2)}억 원) 손실 예상. ` +
      `환헤지 상품 전환 또는 달러 자산·국내 수출주 편입을 검토하세요.`,
    [RISK_TYPE.STAGFLATION_RISK]:
      `복합위기(스태그플레이션) 발생 시 약 ${Math.abs(s4.lossRate * 100).toFixed(1)}% ` +
      `(${Math.abs(s4.lossAmount / 1e8).toFixed(2)}억 원) 손실 예상. ` +
      `포트폴리오 전면 재구성이 시급합니다.`,
    [RISK_TYPE.BALANCED]:
      `4대 시나리오 전반에서 중간 수준의 손실 내성을 보입니다. ` +
      `소규모 리밸런싱으로 방어력을 추가 강화하세요.`,
    [RISK_TYPE.DEFENSIVE]:
      `4대 충격 시나리오 모두에서 손실이 5% 미만으로 방어 우위 포트폴리오입니다.`,
  };

  const diagnosis = riskTypes.map(t => sentenceMap[t] ?? t).join(' / ');

  return {
    scenario1: { label: '금리 100bp 인상',        ...s1 },
    scenario2: { label: '원자재 쇼크',             ...s2 },
    scenario3: { label: '환율 +200원',             ...s3 },
    scenario4: { label: '복합위기(스태그플레이션)', ...s4 },
    riskTypes,
    diagnosis,
  };
}

// ============================================================
// 15. 14점 만점 포트폴리오 건강검진
// ============================================================

// ── 항목별 평가 함수 (각 2점 만점) ───────────────────────────

function scoreDiversification(divScore) {
  if (divScore >= 0.50) return { score: 2, grade: '양호', detail: `분산 점수 ${(divScore * 100).toFixed(0)}점 – 자산 간 상관관계가 낮아 분산 효과 우수.` };
  if (divScore >= 0.30) return { score: 1, grade: '주의', detail: `분산 점수 ${(divScore * 100).toFixed(0)}점 – 상관관계가 다소 높습니다. 비상관 자산 편입을 검토하세요.` };
  return                       { score: 0, grade: '문제', detail: `분산 점수 ${(divScore * 100).toFixed(0)}점 – 분산 효과 미흡. 자산군 다각화가 필요합니다.` };
}

function scoreSingleStockConcentration(assets) {
  const maxW     = Math.max(0, ...assets.map(a => a.weight ?? 0));
  const maxAsset = assets.find(a => (a.weight ?? 0) === maxW);
  const pct      = (maxW * 100).toFixed(1);
  if (maxW <= 0.15) return { score: 2, grade: '양호', detail: `최대 단일 종목 비중 ${pct}% – 집중 리스크 없음.` };
  if (maxW <= 0.20) return { score: 1, grade: '주의', detail: `최대 단일 종목 비중 ${pct}% (${maxAsset?.name}) – 20% 근접. 모니터링 필요.` };
  return                  { score: 0, grade: '문제', detail: `단일 종목 ${pct}% (${maxAsset?.name}) – 20% 초과. 집중 리스크 경고.`, penalty: true };
}

function scoreSingleSectorConcentration(assets) {
  const sectorW = {};
  for (const a of assets) {
    const sector = resolveAssetMeta(a).assetClass;
    sectorW[sector] = (sectorW[sector] ?? 0) + (a.weight ?? 0);
  }
  const [sName, sW] = Object.entries(sectorW).sort(([, a], [, b]) => b - a)[0] ?? ['', 0];
  const pct         = (sW * 100).toFixed(1);
  if (sW <= 0.40) return { score: 2, grade: '양호', detail: `최대 섹터(${sName}) 비중 ${pct}% – 섹터 분산 양호.` };
  if (sW <= 0.60) return { score: 1, grade: '주의', detail: `최대 섹터(${sName}) 비중 ${pct}% – 60% 접근. 섹터 편중 주의.` };
  return                 { score: 0, grade: '문제', detail: `섹터(${sName}) 비중 ${pct}% – 60% 초과. 섹터 집중 리스크 경고.`, penalty: true };
}

function scoreVolatility(vol) {
  const pct = (vol * 100).toFixed(1);
  if (vol <= 0.10) return { score: 2, grade: '양호', detail: `연환산 변동성 ${pct}% – 안정적 수준.` };
  if (vol <= 0.20) return { score: 1, grade: '주의', detail: `연환산 변동성 ${pct}% – 중간 수준. 고위험 자산 비중 점검.` };
  return                  { score: 0, grade: '문제', detail: `연환산 변동성 ${pct}% – 20% 초과 고변동성. 리스크 자산 축소 권고.` };
}

function scoreSharpeRatio(sharpe) {
  const s = sharpe.toFixed(2);
  if (sharpe >= 1.0) return { score: 2, grade: '양호', detail: `샤프 지수 ${s} – 우수한 위험 대비 수익 효율.` };
  if (sharpe >= 0.5) return { score: 1, grade: '주의', detail: `샤프 지수 ${s} – 보통 수준. 고효율 자산 편입 검토.` };
  return                    { score: 0, grade: '문제', detail: `샤프 지수 ${s} – 0.5 미만 저효율. 수익/리스크 구조 재검토 필요.` };
}

function scoreMDD(mdd) {
  const pct = (mdd * 100).toFixed(1);
  if (mdd <= 0.10) return { score: 2, grade: '양호', detail: `최대낙폭(MDD) ${pct}% – 하방 손실 위험 낮음.` };
  if (mdd <= 0.20) return { score: 1, grade: '주의', detail: `최대낙폭(MDD) ${pct}% – 중간 수준. 손실 제한 전략 검토.` };
  return                  { score: 0, grade: '문제', detail: `최대낙폭(MDD) ${pct}% – 20% 초과 고낙폭. 방어 자산 편입 권고.` };
}

function scoreTaxEfficiency(financialIncomeTax) {
  if (!financialIncomeTax) return { score: 2, grade: '양호', detail: '세금 데이터 미제공 – 평가 생략.' };
  const totalMan = (financialIncomeTax.total / 10_000).toFixed(0);
  if (!financialIncomeTax.warning && financialIncomeTax.total <= 15_000_000)
    return { score: 2, grade: '양호', detail: `금융소득 합계 ${totalMan}만 원 – 종합과세 기준 충분히 이하.` };
  if (!financialIncomeTax.warning)
    return { score: 1, grade: '주의', detail: `금융소득 합계 ${totalMan}만 원 – 2,000만 원 접근. ISA·절세 상품 전환 검토.` };
  return { score: 0, grade: '문제', detail: `금융소득 합계 ${totalMan}만 원 – 종합과세 대상. 즉시 절세 전략 수립 필요.` };
}

/**
 * 14점 만점 포트폴리오 건강검진
 * 감점 규칙: 단일 종목 > 20% 또는 단일 섹터 > 60% 항목은 penalty 플래그 활성화
 * 배지: Hold(12~14) / Rebalance(8~11) / Sell(0~7)
 *
 * @param {{
 *   diversificationScore?: number,   0~1
 *   volatility?:           number,   연환산 변동성 소수
 *   sharpeRatio?:          number,
 *   mdd?:                  number,   0~1
 *   financialIncomeTax?:   object,   financialIncomeTaxCalculation() 결과
 * }} metrics
 * @param {Array}  assets      tagged + weighted 자산 배열
 * @param {number} [t_marginal]
 *
 * @returns {{
 *   totalScore:  number,
 *   badge:       'Hold'|'Rebalance'|'Sell',
 *   badgeKo:     string,
 *   items:       Array<{ key, label, score, grade, detail, penalty? }>,
 *   summary:     string,
 * }}
 */
export function portfolioHealthCheck(metrics, assets, t_marginal) {
  const {
    diversificationScore: divScore    = 0.5,
    volatility                        = 0.15,
    sharpeRatio                       = 0.5,
    mdd                               = 0.10,
    financialIncomeTax,
  } = metrics;

  const items = [
    { key: 'diversification', label: '분산도',           ...scoreDiversification(divScore) },
    { key: 'single_stock',    label: '단일 종목 집중도', ...scoreSingleStockConcentration(assets) },
    { key: 'single_sector',   label: '단일 섹터 집중도', ...scoreSingleSectorConcentration(assets) },
    { key: 'volatility',      label: '변동성',           ...scoreVolatility(volatility) },
    { key: 'sharpe',          label: '샤프 지수',         ...scoreSharpeRatio(sharpeRatio) },
    { key: 'mdd',             label: '최대낙폭(MDD)',     ...scoreMDD(mdd) },
    { key: 'tax_efficiency',  label: '세금 효율성',       ...scoreTaxEfficiency(financialIncomeTax) },
  ];

  const totalScore = items.reduce((s, i) => s + (i.score ?? 0), 0);

  const BADGE_TABLE = [
    { min: 12, badge: 'Hold',      badgeKo: '유지 (Hold) – 현 포트폴리오 유지를 권고합니다.' },
    { min:  8, badge: 'Rebalance', badgeKo: '리밸런싱 권고 (Rebalance) – 일부 조정이 필요합니다.' },
    { min:  0, badge: 'Sell',      badgeKo: '매도/재구성 권고 (Sell) – 포트폴리오 전면 재검토가 필요합니다.' },
  ];
  const { badge, badgeKo } = BADGE_TABLE.find(b => totalScore >= b.min) ?? BADGE_TABLE[2];

  const problemLabels = items.filter(i => i.score === 0).map(i => i.label);
  const cautionLabels = items.filter(i => i.score === 1).map(i => i.label);
  const penaltyLabels = items.filter(i => i.penalty).map(i => i.label);

  const summary = [
    `총점 ${totalScore}/14점 → ${badgeKo}`,
    problemLabels.length ? `문제 항목: ${problemLabels.join(', ')}.` : '',
    cautionLabels.length ? `주의 항목: ${cautionLabels.join(', ')}.` : '',
    penaltyLabels.length ? `[집중 리스크 경고] ${penaltyLabels.join(', ')} – 즉시 분산 조정 필요.` : '',
  ].filter(Boolean).join(' ');

  return { totalScore, badge, badgeKo, items, summary };
}

// ============================================================
// 16. Tax-loss Harvesting (TLH) 추천 엔진
// ============================================================

/**
 * 세법 기반 Tax-loss Harvesting 추천
 *
 * 1순위: 국내상장 해외펀드 (Indirect_Fund + 해외 자산군) → 금융소득종합과세 방어
 * 2순위: 해외직구 주식 (Direct_Stock + FOREIGN_STOCK) → 양도세 절감
 *        단, 거래비용(0.25%) 차감 후 절세 실익 존재 시에만 추천
 *
 * @param {Array<{name:string, assetClass?:string, taxType?:string, weight:number, value:number, gain:number, _meta?:object}>} assets
 * @param {number} t_marginal  한계세율 (소수)
 *
 * @returns {{
 *   priority1: TLHRecommendation[],
 *   priority2: TLHRecommendation[],
 *   summary:   string,
 * }}
 */
export function generateTLHRecommendations(assets, t_marginal) {
  // 미실현 손실 종목만 대상
  const lossAssets = assets.filter(a => (a.gain ?? resolveAssetMeta(a).gain) < 0);

  // ── 1순위: 국내상장 해외펀드 (종합과세 방어) ─────────────
  const priority1 = lossAssets
    .filter(a => {
      const { taxType, assetClass } = resolveAssetMeta(a);
      return taxType === TAX_TYPE.INDIRECT_FUND &&
             (assetClass === ASSET_CLASS.FOREIGN_STOCK || assetClass === ASSET_CLASS.FOREIGN_BOND);
    })
    .map(a => {
      const { gain, value, name } = resolveAssetMeta(a);
      const loss            = Math.abs(gain);
      const tradingCost     = value * FEE_RATE;
      // 손실 실현 시 금융소득 감소 → 종합과세 누진분 절감
      const progressiveRate = Math.max(t_marginal - TAX_RATE_GENERAL, 0);
      const taxSaving       = loss * progressiveRate;
      const netBenefit      = taxSaving - tradingCost;

      return {
        name,
        priority:       1,
        reason:         '국내상장 해외펀드 손실 실현 – 금융소득종합과세 방어',
        unrealizedLoss: -loss,
        taxSaving:      +taxSaving.toFixed(0),
        tradingCost:    +tradingCost.toFixed(0),
        netBenefit:     +netBenefit.toFixed(0),
        recommend:      true,   // 1순위는 종합과세 방어 목적이므로 실익 무관 추천
        message:        `[1순위] ${name}: 미실현 손실 ${(loss / 10_000).toFixed(0)}만 원 실현 시 ` +
                        `종합과세 절감 약 ${(taxSaving / 10_000).toFixed(0)}만 원` +
                        ` (거래비용 ${(tradingCost / 10_000).toFixed(0)}만 원 차감 → 순이익 ${(netBenefit / 10_000).toFixed(0)}만 원). 매도 권고.`,
      };
    });

  // ── 2순위: 해외직구 주식 (양도세 절감) ───────────────────
  const priority2 = lossAssets
    .filter(a => {
      const { taxType, assetClass } = resolveAssetMeta(a);
      return taxType === TAX_TYPE.DIRECT_STOCK &&
             assetClass === ASSET_CLASS.FOREIGN_STOCK;
    })
    .map(a => {
      const { gain, value, name } = resolveAssetMeta(a);
      const loss        = Math.abs(gain);
      const tradingCost = value * FEE_RATE;
      // 손실 통산 → 양도세 22% 절감
      const taxSaving   = loss * FOREIGN_STOCK_TAX_RATE;
      const netBenefit  = taxSaving - tradingCost;
      const recommend   = netBenefit > 0;   // 거래비용 차감 후 실익 존재 시만 추천

      return {
        name,
        priority:       2,
        reason:         '해외직구 주식 손실 실현 – 해외주식 양도소득세 절감',
        unrealizedLoss: -loss,
        taxSaving:      +taxSaving.toFixed(0),
        tradingCost:    +tradingCost.toFixed(0),
        netBenefit:     +netBenefit.toFixed(0),
        recommend,
        message: recommend
          ? `[2순위] ${name}: 미실현 손실 ${(loss / 10_000).toFixed(0)}만 원 실현 시 ` +
            `양도세 절감 ${(taxSaving / 10_000).toFixed(0)}만 원` +
            ` (거래비용 ${(tradingCost / 10_000).toFixed(0)}만 원 차감 → 순절세 ${(netBenefit / 10_000).toFixed(0)}만 원). 매도 권고.`
          : `[2순위] ${name}: 손실 ${(loss / 10_000).toFixed(0)}만 원이나 거래비용` +
            `(${(tradingCost / 10_000).toFixed(0)}만 원)이 절세액(${(taxSaving / 10_000).toFixed(0)}만 원)을 초과 → 매도 실익 없음.`,
      };
    })
    .sort((a, b) => b.netBenefit - a.netBenefit);  // 순절세액 큰 순서로 정렬

  // 요약 문장
  const p1Rec = priority1.filter(r => r.recommend);
  const p2Rec = priority2.filter(r => r.recommend);
  const summaryParts = [];

  if (p1Rec.length) {
    const total = p1Rec.reduce((s, r) => s + r.netBenefit, 0);
    summaryParts.push(
      `종합과세 방어용 국내상장 해외펀드 ${p1Rec.length}종목 매도 권고` +
      ` (순절세 합계 약 ${(total / 10_000).toFixed(0)}만 원).`
    );
  }
  if (p2Rec.length) {
    const total = p2Rec.reduce((s, r) => s + r.netBenefit, 0);
    summaryParts.push(
      `해외직구 주식 양도세 절감 ${p2Rec.length}종목 매도 권고` +
      ` (순절세 합계 약 ${(total / 10_000).toFixed(0)}만 원).`
    );
  }
  if (!summaryParts.length) {
    summaryParts.push('현재 TLH 실행 가능한 손실 종목 또는 거래비용 차감 후 실익 있는 매도 후보가 없습니다.');
  }

  return { priority1, priority2, summary: summaryParts.join(' ') };
}
