/**
 * assetPipeline.js
 * 자산 입력 파이프라인 – quantEngine.js 호환 표준 입력 생성
 *
 * 흐름:
 *  PDF 파일
 *    └─▶ /api/parse-portfolio  (Claude Structured Output)
 *           └─▶ [{ name, asset_class, theme, country, buy_price, amount, is_hedged }]
 *                  └─▶ fillMissingFields()     (필드 보완)
 *                         └─▶ /api/auto-valuate (현재가 조회 → w_i 계산)
 *                                └─▶ buildQuantEngineInput()
 *                                       └─▶ quantEngine.runQuantAnalysis()
 *
 * UI 라이브러리에 의존하지 않는 순수 JS 함수만 포함
 */

// ============================================================
// 1. 상수 및 열거값
// ============================================================

/** 파이프라인 단계 상태 */
export const PIPELINE_STATUS = Object.freeze({
  IDLE:       'idle',
  PARSING:    'parsing',    // PDF → Claude
  FILLING:    'filling',    // 누락 필드 보완
  VALUATING:  'valuating',  // 현재가 조회
  COMPLETE:   'complete',
  ERROR:      'error',
});

/** "건강설정 건너뛰기" 여부 */
export const FILL_MODE = Object.freeze({
  STRICT: 'strict',   // 불명확 정보 → needs_review: true + UI 입력 요구
  SKIP:   'skip',     // 불명확 정보 → 포괄적 개념으로 자동 매핑
});

/** 8대 표준 자산군 */
export const ASSET_CLASS = Object.freeze({
  DOMESTIC_STOCK: '국내주식',
  FOREIGN_STOCK:  '해외주식',
  DOMESTIC_BOND:  '국내채권',
  FOREIGN_BOND:   '해외채권',
  GOLD:           '금',
  REITS:          '리츠',
  CASH:           '현금',
  DOLLAR:         '달러',
});

/** 과세 유형 (quantEngine.TAX_TYPE 미러) */
export const TAX_TYPE = Object.freeze({
  DIRECT_STOCK:  'Direct_Stock',
  INDIRECT_FUND: 'Indirect_Fund',
  FIXED_INCOME:  'Fixed_Income',
});

/** 필드별 기본값 – SKIP 모드 자동 매핑용 */
const FIELD_DEFAULTS = {
  asset_class: ASSET_CLASS.FOREIGN_STOCK,
  theme:       '기타',
  country:     '미국',
  is_hedged:   false,
  amount_type: 'value',   // 금액 기준
  buy_price:   null,
};

// ============================================================
// 2. 파이프라인 메인 엔트리
// ============================================================

/**
 * PDF 파일 → quantEngine 호환 자산 배열까지 전체 파이프라인 실행
 *
 * @param {File}   file    업로드된 PDF File 객체
 * @param {{
 *   fillMode?:       'strict'|'skip',   기본 'strict'
 *   onStatusChange?: (status:string, detail?:string) => void
 * }} [options]
 *
 * @returns {Promise<{
 *   rawAssets:      PortfolioAsset[],   Claude 파싱 원본
 *   reviewRequired: PortfolioAsset[],   needs_review:true 목록
 *   valuatedAssets: ValuatedAsset[],    현재가 + w_i 포함
 *   quantInput:     QuantEngineInput[], runQuantAnalysis 직접 투입 가능
 *   summary:        string,
 *   confidence:     'high'|'medium'|'low',
 * }>}
 */
export async function runPipeline(file, options = {}) {
  const { fillMode = FILL_MODE.STRICT, onStatusChange = () => {} } = options;

  // Step 1: PDF 파싱
  onStatusChange(PIPELINE_STATUS.PARSING, 'PDF를 Claude에 전달 중...');
  const parseResult = await parsePdfToAssets(file, { fillMode });

  // Step 2: 누락 필드 보완
  onStatusChange(PIPELINE_STATUS.FILLING, '부족 정보 자동 보완 중...');
  const filledAssets = fillMissingFields(parseResult.assets, fillMode);

  // Step 3: 자동 가치평가
  onStatusChange(PIPELINE_STATUS.VALUATING, '현재가 조회 및 비중 계산 중...');
  const valuatedAssets = await autoValuatePortfolio(filledAssets);

  // Step 4: quantEngine 입력 형식 변환
  const quantInput = buildQuantEngineInput(valuatedAssets);

  onStatusChange(PIPELINE_STATUS.COMPLETE, '파이프라인 완료');

  return {
    rawAssets:      parseResult.assets,
    reviewRequired: filledAssets.filter(a => a.needs_review),
    valuatedAssets,
    quantInput,
    summary:        parseResult.summary,
    confidence:     parseResult.confidence,
  };
}

// ============================================================
// 3. Step 1 – PDF → Claude Structured Output
// ============================================================

/**
 * PDF 파일을 /api/parse-portfolio로 전송하여 구조화된 자산 목록 수신
 *
 * @param {File}   file
 * @param {{ fillMode?: string }} [options]
 * @returns {Promise<{ assets: PortfolioAsset[], summary: string, confidence: string }>}
 */
export async function parsePdfToAssets(file, options = {}) {
  const { fillMode = FILL_MODE.STRICT } = options;

  const form = new FormData();
  form.append('file', file);
  form.append('skipHealthCheck', String(fillMode === FILL_MODE.SKIP));

  const res = await fetch('/api/parse-portfolio', { method: 'POST', body: form });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new PipelineError('PDF_PARSE_FAILED', err.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    assets:     Array.isArray(data.assets) ? data.assets : [],
    summary:    data.summary   ?? '',
    confidence: data.confidence ?? 'low',
  };
}

// ============================================================
// 4. Step 2 – 누락 필드 보완 / 자동 매핑
// ============================================================

/**
 * 불완전한 자산 항목의 누락 필드를 모드에 따라 보완
 *
 * STRICT: needs_review: true 로 표시, UI에서 입력 요구
 * SKIP  : FIELD_DEFAULTS 기본값으로 자동 매핑, 포괄적 분류 적용
 *
 * @param {PortfolioAsset[]} assets
 * @param {'strict'|'skip'}  mode
 * @returns {PortfolioAsset[]}
 */
export function fillMissingFields(assets, mode = FILL_MODE.STRICT) {
  return assets.map(asset => {
    const missing  = findMissingFields(asset);
    const isStrict = mode === FILL_MODE.STRICT;

    if (!missing.length) return { ...asset, needs_review: false };

    if (isStrict) {
      return {
        ...asset,
        needs_review:  true,
        review_reason: `누락 필드: ${missing.join(', ')}`,
      };
    }

    // SKIP 모드: 포괄적 기본값으로 자동 채움
    const filled = { ...asset };
    for (const field of missing) {
      if (FIELD_DEFAULTS[field] !== undefined) {
        filled[field] = FIELD_DEFAULTS[field];
      }
    }
    filled.needs_review  = false;
    filled.review_reason = null;
    return filled;
  });
}

/**
 * 단일 자산 항목의 필수 필드 검증
 * @param {PortfolioAsset} asset
 * @returns {{ valid: boolean, missingFields: string[] }}
 */
export function validateAssetRow(asset) {
  const missing = findMissingFields(asset);
  return { valid: missing.length === 0, missingFields: missing };
}

// 내부: 누락 필드 이름 목록 반환
function findMissingFields(asset) {
  const required = ['name', 'asset_class', 'theme', 'country', 'amount', 'is_hedged'];
  return required.filter(f => {
    const v = asset[f];
    return v === undefined || v === null || v === '';
  });
}

// ============================================================
// 5. Step 3 – 자동 가치평가 (Auto-valuation)
// ============================================================

/**
 * 종목명/수량만으로 하이브리드 수집 엔진 가동:
 *  보유수량 × 최신 현재가 → current_value → w_i 자동 갱신
 *
 * @param {PortfolioAsset[]} filledAssets
 * @returns {Promise<ValuatedAsset[]>}
 */
export async function autoValuatePortfolio(filledAssets) {
  const res = await fetch('/api/auto-valuate', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ assets: filledAssets }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new PipelineError('AUTO_VALUATE_FAILED', err.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json();
  return Array.isArray(data.assets) ? data.assets : [];
}

// ============================================================
// 6. Step 4 – quantEngine.js 입력 형식 변환
// ============================================================

/**
 * 파이프라인 출력 → quantEngine.runQuantAnalysis() 직접 투입 가능한 형식
 *
 * @param {ValuatedAsset[]} valuatedAssets
 * @returns {QuantEngineInput[]}
 */
export function buildQuantEngineInput(valuatedAssets) {
  return valuatedAssets.map(a => ({
    name:   a.name,
    weight: a.weight   ?? 0,
    value:  a.current_value ?? 0,
    gain:   a.gain     ?? 0,
    // 추가 메타 (quantEngine 내부 classifyAsset 재분류 없이 전달)
    _meta: {
      asset_class:  a.asset_class,
      theme:        a.theme,
      country:      a.country,
      is_hedged:    a.is_hedged,
      buy_price:    a.buy_price,
      current_price: a.current_price,
      amount:       a.amount,
      amount_type:  a.amount_type,
      needs_review: a.needs_review,
    },
  }));
}

// ============================================================
// 7. 유틸리티: 포트폴리오 비중 재계산
// ============================================================

/**
 * current_value 기준으로 w_i를 재계산
 * (사용자가 직접 금액을 수정했을 때 호출)
 *
 * @param {ValuatedAsset[]} assets
 * @returns {ValuatedAsset[]}
 */
export function computePortfolioWeights(assets) {
  const total = assets.reduce((s, a) => s + (a.current_value ?? 0), 0);
  if (total === 0) return assets.map(a => ({ ...a, weight: 0 }));
  return assets.map(a => ({
    ...a,
    weight: +((a.current_value ?? 0) / total).toFixed(6),
  }));
}

/**
 * 부분 업데이트: 특정 자산의 수량 또는 금액이 바뀌었을 때 w_i 재계산
 *
 * @param {ValuatedAsset[]} assets
 * @param {number}          index   변경된 자산 인덱스
 * @param {Partial<ValuatedAsset>} patch  변경 내용
 * @returns {ValuatedAsset[]}
 */
export function patchAndReweight(assets, index, patch) {
  const updated = assets.map((a, i) => (i === index ? { ...a, ...patch } : a));
  return computePortfolioWeights(updated);
}

// ============================================================
// 8. 에러 클래스
// ============================================================

export class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.name  = 'PipelineError';
    this.code  = code;
  }
}

/**
 * @typedef {Object} PortfolioAsset
 * @property {string}       name          종목명 또는 티커
 * @property {string}       asset_class   8대 표준 자산군
 * @property {string}       theme         세부 테마
 * @property {string}       country       투자 국가
 * @property {number|null}  buy_price     매수 단가
 * @property {number}       amount        보유 수량(주) 또는 금액(원)
 * @property {'quantity'|'value'} amount_type
 * @property {boolean}      is_hedged     환헤지 여부
 * @property {boolean}      needs_review  UI 추가 입력 필요 여부
 * @property {string|null}  review_reason
 */

/**
 * @typedef {PortfolioAsset & {
 *   current_price:  number,
 *   current_value:  number,
 *   weight:         number,
 *   gain:           number,
 *   price_source:   'yahoo'|'mock',
 * }} ValuatedAsset
 */

/**
 * @typedef {{ name:string, weight:number, value:number, gain:number, _meta:object }} QuantEngineInput
 */
