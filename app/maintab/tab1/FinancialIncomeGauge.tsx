"use client";

import { useState, useMemo } from "react";
import { AlertTriangle } from "lucide-react";

// ─── 상수 ──────────────────────────────────────────────────────────────────────
export const THRESHOLD = 20_000_000; // 금융소득 종합과세 기준
export const FINANCIAL_INCOME_STORAGE_KEY = "financial-income-summary-v1";
export const NEW_PORTFOLIO_INCOME_STORAGE_KEY = "new-portfolio-income-summary-v1";
export const FINANCIAL_INCOME_RESET_KEY = "financial-income-reset-v1";

const DOMESTIC_DIV_WITHHOLDING = 0.154; // 국내배당 원천징수 14% + 지방세 1.4% (표시용, 계산은 calcWithholdingKRW)
const FOREIGN_DIV_WITHHOLDING  = 0.15;  // 미국 조세조약 기준 (표시용 기본값 — 실제 계산은 국가별 calcForeignDividendWithholding)

// ─── 세율·상수 테이블 (하드코딩 금지 — 배당·이자소득세 계산에 필요한 값은 전부 여기서 관리) ──
// 조문 근거는 각 항목 옆 주석 참고. "확인 필요"로 표시된 항목은 개정 여부·실무 처리를 세무 담당자가 재확인할 것.
export const TAX_RATES = {
  incomeWithholdingRate: 0.14,   // 이자·배당소득 원천징수(국세) — 소득세법 §127①
  localSurtaxRate: 0.10,         // 지방소득세 = 소득세액 × 10% — 지방세법 §92
  foreignStockCapitalGainsExemption: 2_500_000, // 해외주식 양도소득 기본공제(연간) — 소득세법 §118의4
  foreignStockCapitalGainsRate: 0.22,           // 지방세 포함 22%(국세 20%+지방세 2%) — 소득세법 §118의5
  domesticMajorShareholderValueThreshold: 5_000_000_000, // 대주주 판정 기준(종목당 보유액) — 소득세법 시행령 §157
  // 배당수익률(주당 연간배당금÷현재가) 이상치 판정 기준. 100%를 기본값으로 둔 이유: 배당은 세율을
  // 아무리 높게 잡아도 현실적으로 연 100%를 넘을 수 없어(그런 상품은 존재하지 않음), 그 이상이면
  // 상품 자체의 문제가 아니라 데이터 정합성 문제로 본다 — 대표 사례가 레버리지/인버스 ETF(SOXS·SOXL·
  // TQQQ 등)의 액면병합: 병합 전 주식 수 기준으로 지급된 과거 배당금(trailingAnnualDividendRate)이
  // 병합 후 주식 수로 소급 조정되지 않은 채 Yahoo Finance에서 내려오면, 병합 후(현재) 주가로 나눈
  // 배당수익률이 수백 %로 튀어버린다(실사례: SOXS 721.69%).
  implausibleDividendYieldThreshold: 1.0,
  // 해외주식 배당 현지 원천징수세율(조세조약 제한세율). 국가명은 이 대시보드 자산입력 폼(COUNTRIES: 국내/미국/일본/중국/유럽/기타)과 일치.
  // 실사용 고객 자산이 사실상 미국주식 위주라 "유럽"·"기타"는 국가별 세율을 별도 관리하지 않기로 함(의도적 범위 제한).
  // 해당 국가는 getForeignDividendWithholdingRate()에서 국내세율(14%)로 폴백 — 추가징수 없음으로 처리.
  foreignDividendWithholdingByCountry: {
    "미국": 0.15, // 한미 조세조약 제12조
    "일본": 0.15, // 한일 조세조약 제10조
    "중국": 0.10, // 한중 조세조약 제10조
  } as Record<string, number>,
};

// 배당가산율(Gross-up) — 소득세법 §17③. 법인세율 변동에 연동해 개정된다: 2024년 세법개정으로 11%→10%
// 인하(2024년 이후 지급분부터), 2026년 법인세율 인상에 따라 2027-01-01 이후 지급분부터 다시 11%로 환원.
// 하드코딩 대신 "지급연도 → 세율" 테이블로 관리 — 다음 개정 때도 이 표에 한 줄만 추가하면 된다.
const GROSS_UP_RATE_SCHEDULE: { effectiveFrom: string; rate: number }[] = [
  { effectiveFrom: "2024-01-01", rate: 0.10 },
  { effectiveFrom: "2027-01-01", rate: 0.11 },
];
function getGrossUpRate(asOfDate: Date = new Date()): number {
  let rate = GROSS_UP_RATE_SCHEDULE[0].rate;
  for (const row of GROSS_UP_RATE_SCHEDULE) {
    if (asOfDate.getTime() >= new Date(row.effectiveFrom).getTime()) rate = row.rate;
  }
  return rate;
}

// 해외주식 배당 현지 원천징수세율 조회 — 등록 안 된 국가("유럽"·"기타" 포함)는 0.14로 폴백(의도적 범위 제한, 위 주석 참고)
function getForeignDividendWithholdingRate(country?: string): number {
  if (!country) return TAX_RATES.incomeWithholdingRate;
  return TAX_RATES.foreignDividendWithholdingByCountry[country] ?? TAX_RATES.incomeWithholdingRate;
}

// 채권 이자소득 발행국별 현지 원천징수세율. 배당과 정반대인 항목이 있어(미국) 배당 테이블을 절대 재사용하지 않는다.
// - 미국: 외국인 채권이자에 현지 원천징수 없음(Portfolio Interest Exemption) — 배당(15%)과 반대
// - 브라질: 한·브라질 조세조약상 정부 발행 채권 이자는 국내 과세도 면제(원천징수 대상 자체가 아님, 아래 별도 처리)
// - 그 외 국가는 채권이자 전용 조세조약 세율표가 없어 배당 세율표로 임시 대체(확인 필요 — TAX_RATES 주석 참고 패턴과 동일)
const BOND_TAX_EXEMPT_COUNTRIES = new Set(["브라질"]);
// "현지(local)" 세율 — 순수 해외(비과세국 제외) 채권에만 쓰인다. 국내 채권은 calcBondInterestWithholding에서
// calcWithholdingKRW로 별도 처리(국세14%+지방세1.4%=15.4%)하므로 이 함수까지 안 온다.
function getBondWithholdingRate(issuerCountry?: string): number {
  if (issuerCountry === "미국") return 0;
  return getForeignDividendWithholdingRate(issuerCountry); // 기타 국가: 확인 필요(위 주석 참고)
}

// 채권 이자소득 원천징수 계산 — 브라질 국채처럼 조세조약상 완전 비과세인 경우 isExempt로 별도 표시(종합과세 합산 제외)
function calcBondInterestWithholding(
  grossIncomeKRW: number,
  issuerCountry?: string
): { totalTax: number; net: number; effectiveRate: number; isExempt: boolean } {
  if (issuerCountry && BOND_TAX_EXEMPT_COUNTRIES.has(issuerCountry)) {
    return { totalTax: 0, net: grossIncomeKRW, effectiveRate: 0, isExempt: true };
  }
  // 국내 채권 — "현지세율 vs 국내세율 비교 후 부족분만 top-up" 모델은 해외 채권 전용이다. 국내 채권을
  // 그 모델에 태우면 getBondWithholdingRate가 돌려주는 기준값(14%, 국세만)과 비교 기준(국내세율 14%,
  // 역시 국세만)이 같은 값이라 "이미 충분함" 판정이 나서 지방소득세 1.4%가 통째로 누락되는 버그가 있었다
  // (2026-09 발견·수정) — 국내 채권 이자는 배당과 동일하게 calcWithholdingKRW(14%+지방세1.4%=15.4%)로 계산한다.
  if (!issuerCountry || issuerCountry === "한국" || issuerCountry === "국내") {
    const w = calcWithholdingKRW(grossIncomeKRW);
    return { totalTax: w.totalTax, net: w.net, effectiveRate: grossIncomeKRW > 0 ? w.totalTax / grossIncomeKRW : DOMESTIC_DIV_WITHHOLDING, isExempt: false };
  }
  const localRate = getBondWithholdingRate(issuerCountry);
  const localWithholding = Math.floor(grossIncomeKRW * localRate);
  if (localRate >= TAX_RATES.incomeWithholdingRate) {
    return { totalTax: localWithholding, net: grossIncomeKRW - localWithholding, effectiveRate: grossIncomeKRW > 0 ? localWithholding / grossIncomeKRW : localRate, isExempt: false };
  }
  const domesticTopUpNational = Math.floor(grossIncomeKRW * (TAX_RATES.incomeWithholdingRate - localRate));
  const domesticTopUpLocal = Math.floor(domesticTopUpNational * TAX_RATES.localSurtaxRate);
  const totalTax = localWithholding + domesticTopUpNational + domesticTopUpLocal;
  return { totalTax, net: grossIncomeKRW - totalTax, effectiveRate: grossIncomeKRW > 0 ? totalTax / grossIncomeKRW : localRate, isExempt: false };
}

// 국세(소득세)·지방소득세를 원 단위 절사(floor)로 순차 계산 — 원천징수세액 원 미만은 절사하는 실무 방식.
function calcWithholdingKRW(grossIncomeKRW: number): { nationalTax: number; localTax: number; totalTax: number; net: number } {
  const nationalTax = Math.floor(grossIncomeKRW * TAX_RATES.incomeWithholdingRate);
  const localTax = Math.floor(nationalTax * TAX_RATES.localSurtaxRate);
  const totalTax = nationalTax + localTax;
  return { nationalTax, localTax, totalTax, net: grossIncomeKRW - totalTax };
}

// 해외배당: 현지 원천징수세율과 국내세율(14%) 비교 — 현지세율이 국내세율 이상이면 국내 추가징수 없음(예: 미국 15%),
// 현지세율이 국내세율보다 낮으면 차액만 국내에서 추가 원천징수(예: 중국 10% → 국내서 4%+지방세 0.4% 추가).
function calcForeignDividendWithholding(grossIncomeKRW: number, country?: string): { localWithholding: number; domesticTopUpNational: number; domesticTopUpLocal: number; totalTax: number; net: number; effectiveRate: number } {
  const localRate = getForeignDividendWithholdingRate(country);
  const localWithholding = Math.floor(grossIncomeKRW * localRate);
  if (localRate >= TAX_RATES.incomeWithholdingRate) {
    return { localWithholding, domesticTopUpNational: 0, domesticTopUpLocal: 0, totalTax: localWithholding, net: grossIncomeKRW - localWithholding, effectiveRate: grossIncomeKRW > 0 ? localWithholding / grossIncomeKRW : localRate };
  }
  const domesticTopUpNational = Math.floor(grossIncomeKRW * (TAX_RATES.incomeWithholdingRate - localRate));
  const domesticTopUpLocal = Math.floor(domesticTopUpNational * TAX_RATES.localSurtaxRate);
  const totalTax = localWithholding + domesticTopUpNational + domesticTopUpLocal;
  return { localWithholding, domesticTopUpNational, domesticTopUpLocal, totalTax, net: grossIncomeKRW - totalTax, effectiveRate: grossIncomeKRW > 0 ? totalTax / grossIncomeKRW : localRate };
}

// ─── 개별 종목 하드코딩 ────────────────────────────────────────────────────────
// KB금융(105560): 고배당 배당소득 분리과세(밸류업 특례, 조특법 — 2026~2028 한시) 대상. 아래 규칙 적용.
//  · 고객의 전체 금융소득(KB금융 포함)이 2,000만원 이하 → KB금융도 그냥 종합과세에 같이 합산(어차피 14% 동일)
//  · 2,000만원 초과 → KB금융 배당은 "분리과세 신청"으로 보고 2,000만원 판정·종합과세 계산에서 제외,
//    KB금융 배당만 따로 모아 아래 누진 분리과세로 계산(2천만↓ 15.4% / 3억↓ 22% / 50억↓ 27.5% / 초과 33%)
const KB_FINANCIAL_CODE = "105560";

function bareStockCode(ticker: string): string {
  return (ticker ?? "").replace(/\.(KS|KQ)$/i, "").trim();
}

// 고배당 분리과세 대상 배당 "합계"에만 매기는 누진세(다른 배당·이자와 섞지 않음). 지방세 포함.
// 지급 시 이미 15.4%가 원천징수됐으므로 실제 추가납부는 (누진세 − 기원천징수)의 양수분.
function separateDividendTaxKRW(amount: number): { tax: number; additionalTax: number } {
  if (!(amount > 0)) return { tax: 0, additionalTax: 0 };
  const tiers: Array<[number, number]> = [
    [20_000_000, 0.154],
    [300_000_000, 0.22],
    [5_000_000_000, 0.275],
    [Number.POSITIVE_INFINITY, 0.33],
  ];
  let tax = 0;
  let prev = 0;
  for (const [cap, rate] of tiers) {
    if (amount <= prev) break;
    tax += (Math.min(amount, cap) - prev) * rate;
    prev = cap;
  }
  return { tax: Math.round(tax), additionalTax: Math.max(0, Math.round(tax - amount * 0.154)) };
}

// 금융소득종합과세 계산 — rolling(트레일링 365일)·calendarYtd(달력연도 누적) 두 기준에 동일하게 적용하는 공용 로직.
// (비교과세: 2,000만원까지 14%+초과분 한계세율 vs 전액 14% 중 큰 쪽 — 소득세법 §14③)
function computeComprehensiveTax(
  dividendIncomeAmt: number,
  grossUpTargetAmt: number,
  interestIncomeAmt: number,
  withholdingCollected: number,
  tMarginal: number
): ComprehensiveTaxResult {
  const totalFinancialIncome = interestIncomeAmt + dividendIncomeAmt;
  // Gross-up은 "Gross-up 대상 배당소득 전체"가 아니라, 그중 2,000만원을 초과하는 부분에만 적용된다
  // (국세상담센터 기준 적용 순서: ①이자소득 → ②Gross-up 비대상 배당 → ③Gross-up 대상 배당 순으로
  // 2,000만원 한도를 채우고, 그 다음(초과분)부터 Gross-up 대상 배당이 시작된다고 봄). 국내법인 배당이
  // 아무리 커도 2,000만원 이내 구간은 애초에 14% 분리과세로 끝나는 구간이라 이중과세 조정을 안 해준다.
  const nonGrossUpDividend = Math.max(0, dividendIncomeAmt - grossUpTargetAmt); // 해외직접·집합투자 배당 등
  const bucketAfterInterest = Math.max(0, THRESHOLD - interestIncomeAmt);
  const bucketAfterNonGrossUp = Math.max(0, bucketAfterInterest - nonGrossUpDividend);
  const grossUpEligibleExcess = Math.max(0, grossUpTargetAmt - bucketAfterNonGrossUp);
  const grossUpAmount = grossUpEligibleExcess * getGrossUpRate();
  const taxableFinancialIncome = totalFinancialIncome + grossUpAmount;
  let generalTax = 0;
  let comparisonTax = 0;
  let finalTax = 0;
  let dividendTaxCredit = 0;
  let additionalTax = 0;
  if (totalFinancialIncome > THRESHOLD) {
    generalTax = (taxableFinancialIncome - THRESHOLD) * tMarginal + THRESHOLD * TAX_RATES.incomeWithholdingRate;
    // 비교산출세액(분리과세 가정 시 세액)엔 Gross-up을 넣지 않는다 — Gross-up은 종합과세 표준에만
    // 얹는 가공의 가산액이라, "분리과세했다면 냈을 세금"엔 애초에 존재하지 않는 개념이다(출처:
    // https://sootax.co.kr/3922 — 분리과세 산출세액 = 금융소득 전체 × 14%, Gross-up 미포함).
    comparisonTax = totalFinancialIncome * TAX_RATES.incomeWithholdingRate;
    finalTax = Math.max(generalTax, comparisonTax);
    // 배당세액공제 한도 = 종합과세로 인해 늘어난 세부담(종합과세 산출세액 − 분리과세 산출세액).
    // "산출세액의 10%" 같은 식은 세법에 없다 — Gross-up 세율(10%)이 잘못 섞여 들어갔던 오류였다.
    dividendTaxCredit = Math.min(grossUpAmount, Math.max(0, generalTax - comparisonTax));
    additionalTax = Math.max(finalTax - dividendTaxCredit - withholdingCollected, 0);
  }
  return {
    dividendIncome: Math.round(dividendIncomeAmt),
    totalFinancialIncome: Math.round(totalFinancialIncome),
    grossUpAmount: Math.round(grossUpAmount),
    taxableFinancialIncome: Math.round(taxableFinancialIncome),
    generalTax: Math.round(generalTax),
    comparisonTax: Math.round(comparisonTax),
    finalTax: Math.round(finalTax),
    dividendTaxCredit: Math.round(dividendTaxCredit),
    withholdingTax: Math.round(withholdingCollected),
    additionalTax: Math.round(additionalTax),
    isOverThreshold: totalFinancialIncome > THRESHOLD,
  };
}

// ─── 타입 ──────────────────────────────────────────────────────────────────────
export interface IncomeBreakdownItem {
  name: string;
  ticker: string;
  incomeType: "배당" | "이자" | "배당(국내직접)" | "배당(해외직접)" | "배당(집합투자)";
  annualIncome: number;    // 연간 gross 소득 (세전, 원)
  netIncome: number;       // 실수령 (원천징수 차감, 원)
  yieldRate: number;       // 수익률 (소수)
  value: number;           // 보유 평가액 (원)
  principal?: number;      // 채권 액면금액(faceValue) 근사값
  withholdingRate: number; // 원천징수율 (소수)
  // 채권 전용 표시 배지 — 계산에서 제외되었거나(미확인/범위외) 특수 처리된(비과세/만기인식) 사유
  bondNote?: "표면금리 미확인" | "조세조약 비과세" | "만기 일시인식" | "신종자본증권(콜 이후 금리변동 가능)" | "할인채 할인액 과세 확인 필요";
  // 배당 전용 표시 배지 — 배당수익률이 현실적으로 불가능한 수준(100%↑)이면 데이터 정합성 문제로 보고
  // 계산에서 제외한다(레버리지/인버스 ETF 액면병합 등). 임의로 "올바른" 값을 추정하지 않는다.
  dividendNote?: "배당소득 계산 불가(레버리지/인버스 ETF 추정 — 액면병합)";
  // KB금융 등 고배당 분리과세 대상이면서, 전체 금융소득 2,000만원 초과로 실제 분리과세 처리된 항목.
  separatelyTaxed?: boolean;
  // 외화표시 채권 전용 표시 배지 — bondNote와 별개(동시에 뜰 수 있음). "미확인"은 진입 시점 환율을
  // 정확히 캡처하지 못해 오늘 환율로 근사한 경우(신규 추가 전 저장된 포지션 등), "만기 시점 환율
  // 미확정"은 만기가 멀어(1년 이후) 그 시점 환율을 알 수 없는데 오늘 환율로 근사 계산한 경우.
  fxNote?: "진입환율 미확인(근사치)" | "만기 시점 환율 미확정";
}

// 복리채 등 만기 일시상환형 채권의 "아직 도래하지 않은"(1년 이후) 미래 일시 인식 예정 이자.
// 향후 1년 예상(interestIncome)엔 포함 안 됨 — 별도로 "그 해 급증"을 경고하기 위한 정보용 리스트.
export interface BondMaturityLumpSum {
  name: string;
  ticker: string;
  maturityYear: number;
  lumpSumGross: number;
  lumpSumNet: number;
  fxNote?: "진입환율 미확인(근사치)" | "만기 시점 환율 미확정";
}

export interface CapitalGainsBreakdownItem {
  name: string;
  ticker: string;
  gain: number;
  tax: number;
  category: "해외주식" | "국내대주주" | "해외펀드";
}

// 금융소득종합과세 계산 결과 한 벌 — rolling(트레일링 365일)과 calendarYtd(달력연도 누적) 두 기준에
// 각각 동일한 모양으로 계산해서 쓴다. 종합과세는 법적으로 달력연도 기준으로만 판정되므로
// FinancialIncomeSummary 최상위 필드(rolling, "향후 1년 예상" 표시용)와 calendarYtd(종합과세 판정 전용)를 분리해서 둔다.
export interface ComprehensiveTaxResult {
  dividendIncome: number;
  totalFinancialIncome: number;
  grossUpAmount: number;
  taxableFinancialIncome: number;
  generalTax: number;
  comparisonTax: number;
  finalTax: number;
  dividendTaxCredit: number;
  withholdingTax: number;
  additionalTax: number;
  isOverThreshold: boolean;
}

export interface FinancialIncomeSummary {
  interestIncome: number;
  dividendIncome: number;
  totalCapitalGains: number;
  totalCapitalLosses: number;
  netCapitalGains: number;
  foreignCapitalGainsTax: number;
  domesticMajorShareholderTax: number;
  capitalGainsTax: number;
  totalFinancialIncome: number;
  grossUpAmount: number;
  taxableFinancialIncome: number;
  generalTax: number;
  comparisonTax: number;
  finalTax: number;
  dividendTaxCredit: number;
  withholdingTax: number;
  additionalTax: number;
  tMarginal: number;
  isOverThreshold: boolean;
  // 달력연도(1/1~오늘) 누적 기준 종합과세 점검 — 위 최상위 필드들("향후 1년 예상" 트레일링 365일)과는
  // 별개 판정. 연말에 배당이 몰린 경우처럼 두 기준의 임계값 통과 여부가 달라질 수 있어 반드시 분리해서 봐야 함.
  calendarYtd: ComprehensiveTaxResult;
  breakdown: IncomeBreakdownItem[];
  capitalGainsBreakdown: CapitalGainsBreakdownItem[];
  majorShareholderWarning: boolean;
  majorShareholderItems: { name: string; ticker: string; value: number; estimatedTax: number }[];
  // 조세조약상 비과세인 채권이자(예: 브라질 국채) — 위 interestIncome/종합과세 합산엔 포함 안 됨. 정보 표시 전용.
  bondTaxExemptInterestIncome: number;
  // KB금융(고배당 분리과세 대상) 배당이 있고 전체 금융소득이 2,000만원을 초과해 실제로 분리과세 처리된 경우.
  // 이 경우 위 totalFinancialIncome·grossUpAmount·finalTax 등은 KB금융분을 뺀 값이고, dividendIncome(목록·합계용)엔
  // KB금융이 그대로 포함된다. 대상 없거나 2,000만원 이하여서 그냥 합산한 경우 null.
  separateElection: {
    dividendIncome: number; // 분리과세 처리된 KB금융 배당 합계
    tax: number;            // 분리과세 총세액(지방세 포함 누진)
    additionalTax: number;  // 추가납부액 = 총세액 − 기원천징수(15.4%)
  } | null;
  // 복리채 등 만기가 1년 이후인 일시상환형 채권의 미래 일시 인식 예정 이자 목록(정보 표시 전용)
  bondMaturityLumpSums: BondMaturityLumpSum[];
  updatedAt: number;
}

// ─── TLH 타입 ──────────────────────────────────────────────────────────────────
export interface TLHAsset {
  name: string;
  ticker: string;
  buy_price?: number | null;
  current_price?: number;
  amount: number;
  amount_type: "quantity" | "value";
  productType?: string;
}

export interface TLHData {
  assets: TLHAsset[];
  netCapitalGains: number;
  capitalGainsTax: number;
}

// ─── 포맷 유틸 ─────────────────────────────────────────────────────────────────
// 100만원 미만은 "만원" 단위로 반올림하지 않고 원 단위 그대로 표시한다.
// (개별 항목을 각자 만원 단위로 반올림해서 보여주면, 정확한 합계와 화면에 보이는
//  항목별 숫자를 더한 값이 달라 보이는 착시가 생김 — 예: 3.55만+1.55만인데 화면엔 4만+2만=6만처럼 보이고
//  실제 합계 5.1만은 5만으로 표시되는 식. 소액 구간에서는 절사·반올림 오차가 커서 원 단위로 정확히 보여줌.)
function fmtWon(n: number) {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억원`;
  if (Math.abs(n) >= 1_000_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만원`;
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

// ─── IncomeRow ─────────────────────────────────────────────────────────────────
function IncomeRow({ item }: { item: IncomeBreakdownItem }) {
  const isInterest = item.incomeType === "이자";

  const tagLabel = isInterest ? null :
    item.incomeType === "배당(국내직접)" ? "국내직접" :
    item.incomeType === "배당(해외직접)" ? "해외직접" :
    item.incomeType === "배당(집합투자)" ? "집합투자" : "배당";

  const bondNoteStyle =
    item.bondNote === "조세조약 비과세" ? "bg-emerald-50 text-emerald-600" :
    item.bondNote === "만기 일시인식" ? "bg-blue-50 text-blue-600" :
    item.bondNote === "신종자본증권(콜 이후 금리변동 가능)" ? "bg-amber-50 text-amber-600" : // 계산은 됐지만 유의사항 있음
    "bg-slate-100 text-slate-400"; // 표면금리 미확인 / 할인채 할인액 과세 확인 필요 — 계산 자체가 안 된 경우

  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0">
      <div className="flex items-center gap-1.5 min-w-0 flex-1 text-xs">
        <span className="font-bold text-navy truncate">{item.name}</span>
        {item.ticker && (
          <span className="text-[10px] text-slate-400 font-mono shrink-0">({item.ticker})</span>
        )}
        {isInterest ? (
          <>
            <span className="text-[10px] text-slate-500 shrink-0">표면금리 {fmtPct(item.yieldRate)}</span>
            {item.principal != null && item.principal > 0 && (
              <span className="text-[10px] text-slate-400 shrink-0">액면 {fmtWon(item.principal)}</span>
            )}
            {item.bondNote && (
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold shrink-0 ${bondNoteStyle}`}>
                {item.bondNote}
              </span>
            )}
            {item.fxNote && (
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 shrink-0">
                {item.fxNote}
              </span>
            )}
          </>
        ) : (
          <>
            {/* 배당률(dividendYield)은 표시 전용 필드로, 실제 세금 계산엔 절대 안 쓴다(주당 실배당금
                ×수량만 씀) — 그런데도 화면에 큰 숫자로 떠 있으면 그게 계산에 반영된 것처럼 오해를
                살 수 있고(SOXS 721% 사례), 계산에 안 쓰는 값을 굳이 보여줄 이유도 없어 UI에서 제거. */}
            {item.dividendNote && (
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 shrink-0">
                {item.dividendNote}
              </span>
            )}
            {item.separatelyTaxed && (
              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 shrink-0">
                고배당 분리과세 (2천만원 판정 제외)
              </span>
            )}
            {tagLabel && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 shrink-0">
                {tagLabel}
              </span>
            )}
          </>
        )}
      </div>
      <div className="shrink-0 text-xs font-bold text-samsung">
        {fmtWon(item.annualIncome)}
      </div>
    </div>
  );
}

// ─── CapitalGainsRow ───────────────────────────────────────────────────────────
function CapitalGainsRow({ item }: { item: CapitalGainsBreakdownItem }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-50 last:border-0">
      <div className="flex items-center gap-1.5 min-w-0 flex-1 text-xs">
        <span className="font-bold text-navy truncate">{item.name}</span>
        {item.ticker && (
          <span className="text-[10px] text-slate-400 font-mono shrink-0">({item.ticker})</span>
        )}
        <span className={`text-[10px] shrink-0 font-semibold ${item.gain > 0 ? "text-blue-600" : item.gain < 0 ? "text-red-500" : "text-slate-400"}`}>
          {item.gain > 0 ? `차익 ${fmtWon(item.gain)}` : item.gain < 0 ? `손실 ${fmtWon(Math.abs(item.gain))}` : "손익 없음"}
        </span>
        <span className="rounded-full bg-orange-50 px-1.5 py-0.5 text-[9px] font-bold text-orange-600 shrink-0">
          {item.category}
        </span>
      </div>
      <div className="shrink-0 text-xs font-bold text-orange-600">
        세액 {fmtWon(item.tax)}
      </div>
    </div>
  );
}

// ─── FinancialIncomeGauge ──────────────────────────────────────────────────────
interface FinancialIncomeGaugeProps {
  summary: FinancialIncomeSummary | null;
  additionalIncome?: number;
  tlhData?: TLHData;
  hideCapitalGains?: boolean;
}

export function FinancialIncomeGauge({
  summary,
  additionalIncome = 0,
  tlhData,
  hideCapitalGains = false,
}: FinancialIncomeGaugeProps) {
  const [activeTab, setActiveTab] = useState<"배당" | "이자" | "양도">("배당");
  const [taxDetailExpanded, setTaxDetailExpanded] = useState(false);
  const [yangdoSubTab, setYangdoSubTab] = useState<"양도소득세" | "TLH">("양도소득세");
  const [showAllDividends, setShowAllDividends] = useState(false);
  const [showAllInterest, setShowAllInterest] = useState(false);

  const ITEM_LIMIT = 7;

  // TLH 탭 표시 여부 및 기초 데이터 (B패널에만 tlhData가 전달됨)
  const tlhComputed = useMemo(() => {
    if (!tlhData) return null;
    const today = new Date();
    const isYearEnd = today.getMonth() === 11 && today.getDate() >= 21 && today.getDate() <= 26;
    const dec26 = new Date(today.getFullYear(), 11, 26);
    const daysLeft = isYearEnd
      ? Math.max(0, Math.ceil((dec26.getTime() - today.getTime()) / 86400000))
      : null;

    const baseCandidates = tlhData.assets
      .filter(
        (a) =>
          (a.productType === "해외주식" || a.productType === "해외ETF") &&
          a.buy_price != null && a.buy_price > 0 &&
          a.current_price != null && a.current_price > 0 &&
          a.amount_type === "quantity" && a.amount > 0
      )
      .map((a) => {
        const cp = a.current_price!;
        const bp = a.buy_price!;
        const unrealizedGain = (cp - bp) * a.amount;
        const lossRate = (cp - bp) / bp;
        const newNetGains = tlhData.netCapitalGains + unrealizedGain;
        const newTax = newNetGains > 2_500_000 ? Math.round((newNetGains - 2_500_000) * 0.22) : 0;
        const taxSaving = Math.max(0, tlhData.capitalGainsTax - newTax);
        return {
          name: a.name, ticker: a.ticker, unrealizedGain, lossRate, taxSaving,
          amount: a.amount, buyPrice: bp, currentPrice: cp,
        };
      })
      .filter((c) => c.unrealizedGain < 0);

    const hasAny = isYearEnd
      ? baseCandidates.length > 0
      : baseCandidates.some((c) => c.taxSaving >= 1_000_000 || c.lossRate <= -0.15);

    return { baseCandidates, isYearEnd, daysLeft, hasAny };
  }, [tlhData]);

  const baseIncome = summary?.totalFinancialIncome ?? 0;
  const totalIncome = baseIncome + additionalIncome;
  const basePct = Math.min((baseIncome / THRESHOLD) * 100, 100);
  const totalPct = Math.min((totalIncome / THRESHOLD) * 100, 100);
  const isOver = totalIncome > THRESHOLD;
  const remaining = Math.max(THRESHOLD - totalIncome, 0);

  const gaugeColor =
    totalPct >= 100 ? "#dc2626" :
    totalPct >= 80  ? "#f59e0b" :
    totalPct >= 50  ? "#003CDC" : "#10b981";

  const statusLabel =
    totalPct >= 100 ? "종합과세 해당" :
    totalPct >= 80  ? "종합과세 임박" :
    totalPct >= 50  ? "주의 구간"    : "안전 구간";

  const dividendItems = (summary?.breakdown ?? []).filter(b => b.incomeType.startsWith("배당"));
  const interestItems = (summary?.breakdown ?? []).filter(b => b.incomeType === "이자");
  // gain === 0이어도 양도소득세 대상 종목(해외주식·ETF)이면 표시
  const visibleGainsItems = summary?.capitalGainsBreakdown ?? [];


  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-soft overflow-hidden flex-1">

      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <span className="text-xs font-extrabold uppercase tracking-widest text-slate-400">
          금융소득종합과세 및 해외양도세 점검
        </span>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: isOver ? "#fee2e2" : "#f0fdf4",
            color: isOver ? "#dc2626" : "#16a34a",
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* 금액 + 게이지 */}
      <div className="px-4 pt-4 pb-3">
        <p className="text-[10px] font-bold text-slate-400 mb-1">향후 1년 예상 — 최근 12개월 실지급액을 그대로 다음 1년에 투영(이미 받은 배당·이자 포함)</p>
        <div className="flex items-end gap-1.5 mb-1">
          <span className="text-3xl font-black tracking-tight text-slate-800">
            {fmtWon(totalIncome)}
          </span>
          <span className="text-sm font-bold text-slate-400 pb-1">/ 2,000만원</span>
        </div>
        <div className="text-[11px] text-slate-500 mb-3">
          배당소득 {fmtWon(summary?.dividendIncome ?? 0)} + 이자소득 {fmtWon(summary?.interestIncome ?? 0)}
          <span className="ml-1.5 text-slate-400">(세전 합산, 종합과세 기준)</span>
        </div>

        {/* 게이지 바 */}
        <div className="relative h-3 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${basePct}%`, backgroundColor: gaugeColor }}
          />
          {additionalIncome > 0 && (
            <div
              className="absolute top-0 h-full rounded-r-full transition-all duration-700 ease-out"
              style={{
                left: `${basePct}%`,
                width: `${Math.min((additionalIncome / THRESHOLD) * 100, 100 - basePct)}%`,
                backgroundColor: "#7c3aed",
                opacity: 0.75,
              }}
            />
          )}
        </div>

        {/* 눈금 */}
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-slate-400">0</span>
          <span className="text-[10px] text-slate-500 font-bold">1,000만원</span>
          <span className="text-[10px] text-slate-400">2,000만원</span>
        </div>

        {/* 상태 메시지 */}
        <div className="mt-3">
          {isOver ? (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
              <AlertTriangle size={14} className="shrink-0 text-red-500 mt-0.5" />
              <p className="text-xs font-semibold text-red-700 leading-snug">
                2,000만원을 <strong>{fmtWon(totalIncome - THRESHOLD)}</strong> 초과.
                금융소득 종합과세 신고 대상입니다.
                {summary && (
                  <> 원천징수 <strong>{fmtWon(summary.withholdingTax)}</strong> 기납부 후, 추가납부세액 예상 <strong>{fmtWon(summary.additionalTax)}</strong>.</>
                )}
              </p>
            </div>
          ) : (
            <div className="rounded-lg bg-emerald-50 px-3 py-2">
              <span className="text-xs font-semibold text-emerald-700">
                여유 <strong>{fmtWon(remaining)}</strong>
              </span>
            </div>
          )}
          <p className="mt-1.5 text-[10px] text-slate-400">
            주식 배당소득·채권 이자소득만 계산합니다. 펀드·랩어카운트 등 다른 상품의 분배금·이자는 포함되지 않습니다.
          </p>
        </div>

        {/* 달력연도 누적(calendarYtd) 종합과세 점검 — 2026-09-06 제거(사용자 요청).
            이유: 채권 이자소득은 지급 이벤트(날짜) 데이터가 없어 이 지표에서 구조적으로 영구히 제외할 수밖에
            없었음 — 그 결과 "달력연도 기준 실제 누적"이라면서 실제로는 이자소득이 통째로 빠진 반쪽 숫자가 되어,
            오히려 "이 기준이 더 정확할 것"이라는 오해로 종합과세 위험을 과소평가하게 만들 위험이 더 컸음.
            계산 로직(calcFinancialIncomeSummary의 calendarYtd 필드)은 그대로 남겨뒀지만 화면에는 안 띄움.
        {summary?.calendarYtd && (
          <div className={`mt-3 rounded-lg border px-3 py-2.5 ${summary.calendarYtd.isOverThreshold ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                {new Date().getFullYear()}년 누적(1/1~오늘) 종합과세 점검
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  summary.calendarYtd.isOverThreshold ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600"
                }`}
              >
                {summary.calendarYtd.isOverThreshold ? "종합과세 해당" : "안전"}
              </span>
            </div>
            <div className="text-sm font-black text-slate-800">
              {fmtWon(summary.calendarYtd.totalFinancialIncome)}
              <span className="ml-1 text-[11px] font-bold text-slate-400">/ 2,000만원</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">
              올해 실제 지급된 주식 배당만 합산 — 위 "향후 1년 예상"과는 다른 기준입니다
              (채권 이자는 지급일 데이터가 없어 이 합계에서 제외)
            </p>
          </div>
        )}
        */}

        {/* 대주주 요건 알림 */}
        {summary?.majorShareholderWarning && (
          <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5">
            <div className="text-xs font-bold text-orange-700 mb-1">⚠️ 대주주 요건 해당 가능 종목</div>
            <div className="space-y-1">
              {summary.majorShareholderItems.map((item, idx) => (
                <div key={idx} className="text-xs text-orange-600">
                  {item.name} · 보유액 {(item.value / 100_000_000).toFixed(1).replace(/\.0$/, "")}억원 · 매도 시 양도소득세 20~25%
                  {item.estimatedTax > 0 && ` · 추정 세액 ${Math.round(item.estimatedTax / 10_000).toLocaleString("ko-KR")}만원`}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>


      {/* 소득 탭: 배당 / 이자 — hideCapitalGains 시 양도 탭 제외 */}
      <div className="border-t border-slate-100">
        <div data-consultation-lock-exempt="true" className="flex border-b border-slate-100">
          {(hideCapitalGains ? ["배당", "이자"] as const : ["배당", "이자", "양도"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-xs font-bold transition ${
                activeTab === tab
                  ? "border-b-2 border-samsung text-samsung"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              {tab === "배당" && `배당소득 ${fmtWon(summary?.dividendIncome ?? 0)}`}
              {tab === "이자" && `이자소득 ${fmtWon(summary?.interestIncome ?? 0)}`}
              {tab === "양도" && `양도소득세 ${fmtWon(summary?.capitalGainsTax ?? 0)}`}
            </button>
          ))}
        </div>

        <div className="px-4 py-3 min-h-[80px]">
          {activeTab === "배당" && (
            <div className="space-y-0">
              {dividendItems.length > 0 ? (
                <>
                  {(showAllDividends ? dividendItems : dividendItems.slice(0, ITEM_LIMIT)).map((item, i) => (
                    <IncomeRow key={i} item={item} />
                  ))}
                  {dividendItems.length > ITEM_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllDividends(v => !v)}
                      className="w-full mt-1 py-1 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition"
                    >
                      {showAllDividends
                        ? "▲ 접기"
                        : `▼ ${dividendItems.length - ITEM_LIMIT}개 더보기`}
                    </button>
                  )}
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="flex justify-between text-xs font-bold text-navy">
                      <span>배당소득 합계 (세전)</span>
                      <span>{fmtWon(summary?.dividendIncome ?? 0)}</span>
                    </div>
                  </div>

                  {summary?.separateElection && (
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 space-y-0.5">
                      <p className="text-[11px] font-bold text-emerald-700">
                        고배당 분리과세 적용 (전체 금융소득 2,000만원 초과)
                      </p>
                      <p className="text-[10px] leading-4 text-emerald-700/80">
                        KB금융 배당은 배당소득 합계엔 포함되지만, 2,000만원 판정·종합과세 계산에서는 빠지고
                        아래처럼 따로 14~30% 누진 분리과세로 계산해요.
                      </p>
                      <div className="flex justify-between text-[11px] text-emerald-700 pt-0.5">
                        <span>분리과세 배당 (2천만원 판정 제외)</span>
                        <span className="font-bold">{fmtWon(summary.separateElection.dividendIncome)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] text-emerald-700">
                        <span>분리과세 세액 (누진)</span>
                        <span className="font-bold">{fmtWon(summary.separateElection.tax)}</span>
                      </div>
                      {summary.separateElection.additionalTax > 0 && (
                        <div className="flex justify-between text-[11px] text-red-600">
                          <span>└ 추가 납부 (기원천징수 15.4% 초과분)</span>
                          <span className="font-bold">{fmtWon(summary.separateElection.additionalTax)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">
                  배당소득 내역이 없습니다. 종목을 입력하면 자동 계산됩니다.
                </p>
              )}

              {/* 종합과세 상세 */}
              {summary?.isOverThreshold && (
                <div className="border-t border-slate-100 mt-2 pt-2 space-y-1">
                  {taxDetailExpanded ? (
                    <>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Gross-up 가산액</span>
                        <span>{fmtWon(summary.grossUpAmount)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>종합과세 합산액</span>
                        <span>{fmtWon(summary.taxableFinancialIncome)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>일반산출세액</span>
                        <span>{fmtWon(summary.generalTax)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>비교산출세액</span>
                        <span>{fmtWon(summary.comparisonTax)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-700 font-bold">
                        <span>적용 산출세액 <span className="text-[10px] font-normal text-slate-400">(둘 중 큰 금액)</span></span>
                        <span>{fmtWon(summary.finalTax)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-emerald-600">
                        <span>배당세액공제</span>
                        <span>-{fmtWon(summary.dividendTaxCredit)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-blue-600">
                        <span>기납부 원천징수세액</span>
                        <span>-{fmtWon(summary.withholdingTax)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-red-600 font-bold mt-1 pt-1 border-t border-slate-50">
                        <span>추가 납부세액</span>
                        <span>{fmtWon(summary.additionalTax)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTaxDetailExpanded(false)}
                        className="w-full text-center text-xs font-semibold text-slate-500 mt-2 py-1 hover:text-slate-700 transition"
                      >
                        세금 계산 상세 보기 ▲
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-xs text-red-600 font-bold">
                        <span>추가 납부세액</span>
                        <span>{fmtWon(summary.additionalTax)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTaxDetailExpanded(true)}
                        className="w-full text-center text-xs font-semibold text-slate-500 mt-1 py-1 hover:text-slate-700 transition"
                      >
                        세금 계산 상세 보기 ▼
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "이자" && (
            <div className="space-y-0">
              {interestItems.length > 0 ? (
                <>
                  {(showAllInterest ? interestItems : interestItems.slice(0, ITEM_LIMIT)).map((item, i) => <IncomeRow key={i} item={item} />)}
                  {interestItems.length > ITEM_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setShowAllInterest(v => !v)}
                      className="w-full mt-1 py-1 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition"
                    >
                      {showAllInterest
                        ? "▲ 접기"
                        : `▼ ${interestItems.length - ITEM_LIMIT}개 더보기`}
                    </button>
                  )}
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <div className="flex justify-between text-xs font-bold text-navy">
                      <span>이자소득 합계 (세전)</span>
                      <span>{fmtWon(summary?.interestIncome ?? 0)}</span>
                    </div>
                    {(summary?.bondTaxExemptInterestIncome ?? 0) > 0 && (
                      <div className="flex justify-between text-[11px] text-emerald-600 mt-1">
                        <span>비과세 이자소득 (조세조약, 위 합계·종합과세 합산 제외)</span>
                        <span>{fmtWon(summary!.bondTaxExemptInterestIncome)}</span>
                      </div>
                    )}
                  </div>
                  {(summary?.bondMaturityLumpSums.length ?? 0) > 0 && (
                    <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
                      <p className="text-[10px] font-extrabold text-blue-700 mb-1">
                        만기 일시인식 예정 이자 (복리채 등 — 아직 향후 1년 합계엔 미포함)
                      </p>
                      {summary!.bondMaturityLumpSums.map((m, i) => (
                        <div key={i} className="flex justify-between items-center gap-1 text-[11px] text-blue-600">
                          <span className="flex items-center gap-1 min-w-0">
                            <span className="truncate">{m.name} · {m.maturityYear}년 만기</span>
                            {m.fxNote && (
                              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 shrink-0">
                                {m.fxNote}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0">{fmtWon(m.lumpSumGross)}</span>
                        </div>
                      ))}
                      <p className="text-[10px] text-blue-400 mt-1">
                        해당 연도에 금융소득이 일시에 늘어나 종합과세 기준을 넘을 수 있으니 만기 도래 연도를 미리 점검하세요.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">
                  이자소득 내역이 없습니다. 채권 종목을 입력하면 자동 계산됩니다.
                </p>
              )}
            </div>
          )}

          {activeTab === "양도" && (
            <div className="space-y-0">
              {/* B패널 TLH 서브탭 토글 — tlhData가 전달된 경우에만 표시 */}
              {tlhComputed?.hasAny && (
                <div className="flex gap-1 border-b border-slate-100 mb-2">
                  <button
                    type="button"
                    onClick={() => setYangdoSubTab("양도소득세")}
                    className={`px-3 py-1.5 text-xs font-bold rounded-t transition ${
                      yangdoSubTab === "양도소득세"
                        ? "bg-slate-100 text-navy"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    양도소득세
                  </button>
                  <button
                    type="button"
                    onClick={() => setYangdoSubTab("TLH")}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-t transition ${
                      yangdoSubTab === "TLH"
                        ? "bg-slate-100 text-navy"
                        : "text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    절세 전략 TLH
                    {tlhComputed.isYearEnd && tlhComputed.daysLeft !== null && (
                      <span className="text-[10px] font-bold text-orange-500">
                        ⏰ D-{tlhComputed.daysLeft}
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* 양도소득세 기존 내용 — TLH 탭이 없거나 양도소득세 서브탭 선택 시 */}
              {(!tlhComputed?.hasAny || yangdoSubTab === "양도소득세") && (
                <>
                  {visibleGainsItems.length > 0 ? (
                    <>
                      {visibleGainsItems.map((item, i) => (
                        <CapitalGainsRow key={i} item={item} />
                      ))}
                      <div className="border-t border-slate-100 mt-2 pt-2 space-y-1">
                        <div className="flex justify-between text-xs text-slate-500">
                          <span>총 차익 (손익통산)</span>
                          <span>{fmtWon(summary?.netCapitalGains ?? 0)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-500">
                          <span>기본공제</span>
                          <span>-250만원</span>
                        </div>
                        <div className="flex justify-between text-xs font-bold text-orange-600 pt-1 border-t border-slate-50">
                          <span>최종 양도소득세</span>
                          <span>{fmtWon(summary?.capitalGainsTax ?? 0)}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 text-center py-4">
                      해외주식·ETF 양도차익 내역이 없습니다.
                    </p>
                  )}
                </>
              )}

              {/* TLH 탭 내용 */}
              {tlhComputed?.hasAny && yangdoSubTab === "TLH" && tlhData && (
                <TLHTabContent
                  baseCandidates={tlhComputed.baseCandidates}
                  isYearEnd={tlhComputed.isYearEnd}
                  daysLeft={tlhComputed.daysLeft}
                  netCapitalGains={tlhData.netCapitalGains}
                  capitalGainsTax={tlhData.capitalGainsTax}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TLHTabContent ─────────────────────────────────────────────────────────────
export function TLHTabContent({
  baseCandidates,
  isYearEnd,
  daysLeft,
  netCapitalGains,
  capitalGainsTax,
}: {
  baseCandidates: {
    name: string; ticker: string;
    unrealizedGain: number; lossRate: number; taxSaving: number;
    amount: number; buyPrice: number; currentPrice: number;
  }[];
  isYearEnd: boolean;
  daysLeft: number | null;
  netCapitalGains: number;
  capitalGainsTax: number;
}) {
  const [lossThreshold, setLossThreshold] = useState(15);

  // 세금 0원을 만들기 위해 필요한 손실 규모
  const taxableGapToFill = Math.max(0, netCapitalGains - 2_500_000);

  const candidates = useMemo(() => {
    return baseCandidates
      .map((c) => {
        const triggers: ("tax_saving" | "year_end" | "loss_rate")[] = [];
        if (c.taxSaving >= 1_000_000) triggers.push("tax_saving");
        if (isYearEnd) triggers.push("year_end");
        if (c.lossRate < -(lossThreshold / 100)) triggers.push("loss_rate");

        // 이 종목만으로 세금 0원을 만들기 위한 최소 매도 주수
        const perShareLoss = c.buyPrice - c.currentPrice; // 양수 (손실)
        const sharesNeeded = perShareLoss > 0
          ? Math.ceil(taxableGapToFill / perShareLoss)
          : c.amount;
        const sharesRecommended = Math.min(sharesNeeded, c.amount);
        const canZeroTax = sharesRecommended >= sharesNeeded; // 보유 주수로 세금 0원 가능 여부

        // 권장 주수 매도 시 절세액
        const lossIfSell = perShareLoss * sharesRecommended;
        const newNet = netCapitalGains - lossIfSell;
        const newTaxIfSell = newNet > 2_500_000 ? Math.round((newNet - 2_500_000) * 0.22) : 0;
        const taxSavingRecommended = Math.max(0, capitalGainsTax - newTaxIfSell);

        return { ...c, triggers, sharesRecommended, canZeroTax, taxSavingRecommended, newTaxIfSell };
      })
      .filter((c) => c.triggers.length > 0);
  }, [baseCandidates, lossThreshold, isYearEnd, taxableGapToFill, netCapitalGains, capitalGainsTax]);

  // 권장 주수 전체 매도 시 합산 효과
  const combinedLoss = candidates.reduce((sum, c) => sum + (c.buyPrice - c.currentPrice) * c.sharesRecommended, 0);
  const combinedNewNet = netCapitalGains - combinedLoss;
  const combinedNewTax = combinedNewNet > 2_500_000 ? Math.round((combinedNewNet - 2_500_000) * 0.22) : 0;
  const combinedSaving = Math.max(0, capitalGainsTax - combinedNewTax);

  return (
    <div className="space-y-3 pt-1">
      {/* 손실 기준 슬라이더 */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-slate-500 font-semibold whitespace-nowrap shrink-0">
          손실 기준
        </span>
        <input
          type="range"
          min={10}
          max={30}
          value={lossThreshold}
          onChange={(e) => setLossThreshold(Number(e.target.value))}
          className="flex-1 h-1.5 accent-blue-600"
        />
        <span className="text-[11px] font-bold text-blue-700 w-8 text-right shrink-0">
          -{lossThreshold}%
        </span>
      </div>

      {/* 절세 시뮬레이션 요약 */}
      {capitalGainsTax > 0 && candidates.length > 0 && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5">
          <p className="text-[11px] font-bold text-blue-700 mb-2">
            권장 주수 매도 시 절세 시뮬레이션
          </p>
          <div className="flex items-center justify-center gap-4">
            <div className="text-center">
              <p className="text-[10px] text-slate-500">현재 양도소득세</p>
              <p className="text-sm font-black text-red-600">{fmtWon(capitalGainsTax)}</p>
            </div>
            <span className="text-slate-400 text-lg font-bold">→</span>
            <div className="text-center">
              <p className="text-[10px] text-slate-500">TLH 후 세액</p>
              <p className={`text-sm font-black ${combinedNewTax === 0 ? "text-emerald-600" : "text-blue-700"}`}>
                {combinedNewTax === 0 ? "0원" : fmtWon(combinedNewTax)}
              </p>
            </div>
          </div>
          <div className="mt-2 text-center border-t border-blue-100 pt-2">
            <span className="text-xs font-black text-emerald-600">
              절세 효과 {fmtWon(combinedSaving)}{combinedNewTax === 0 ? " · 세금 완전 제거" : ""}
            </span>
          </div>
        </div>
      )}

      {/* 후보 종목 리스트 */}
      {candidates.length > 0 ? (
        <div className="space-y-2">
          {candidates.map((c, i) => (
            <div
              key={i}
              className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5"
            >
              {/* 종목명 + 배지 */}
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <span className="text-xs font-bold text-navy truncate">{c.name}</span>
                {c.ticker && (
                  <span className="text-[10px] text-slate-400 font-mono">({c.ticker})</span>
                )}
                {c.triggers.includes("loss_rate") && (
                  <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700">
                    {Math.abs(c.lossRate * 100).toFixed(1)}%↓
                  </span>
                )}
                {c.triggers.includes("tax_saving") && (
                  <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">절세효과</span>
                )}
                {c.triggers.includes("year_end") && (
                  <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700">
                    연말임박{daysLeft !== null ? ` D-${daysLeft}` : ""}
                  </span>
                )}
              </div>

              {/* 핵심: 권장 매도 주수 */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-slate-500">
                    평가손실 {fmtWon(Math.abs(c.unrealizedGain))} · 보유 {c.amount.toLocaleString()}주
                  </p>
                  <p className="text-xs font-bold text-blue-700 mt-0.5">
                    권장 매도{" "}
                    <span className="text-sm font-black">{c.sharesRecommended.toLocaleString()}주</span>
                    {c.canZeroTax
                      ? <span className="ml-1 text-emerald-600 font-bold">→ 세금 0원 가능</span>
                      : <span className="ml-1 text-slate-500 font-normal">(전량, 세금 완전제거 불가)</span>
                    }
                  </p>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className="text-[10px] text-slate-400">절세</p>
                  <p className="text-xs font-black text-emerald-600">{fmtWon(c.taxSavingRecommended)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400 text-center py-3">
          현재 기준 TLH 후보 종목이 없습니다.
        </p>
      )}

      {/* 30일 재매수 주의 */}
      <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
        <span className="text-amber-500 text-xs mt-0.5 shrink-0">⚠</span>
        <p className="text-[11px] font-semibold text-amber-700 leading-snug">
          절세 매도 후 동일 종목 재매수는 30일 이후 권장
        </p>
      </div>
    </div>
  );
}

// ─── AssetForIncomeCalc ────────────────────────────────────────────────────────
export interface AssetForIncomeCalc {
  name: string;
  ticker?: string;
  asset_class: string;
  productType?: string;
  country?: string;
  current_price?: number;
  current_value?: number;
  amount: number;
  amount_type: "quantity" | "value";
  buy_price?: number | null;
  dividendYield?: number;              // 연간 배당수익률 (소수)
  trailingAnnualDividendRate?: number; // 주당 연간 배당금 (최근 365일 트레일링 — "향후 1년 예상" 투영용)
  annualDividendRate?: number;         // 주당 연간 배당금 (대체 필드)
  calendarYtdDividendRate?: number;    // 달력연도 1/1~오늘 실지급 주당 배당금 합 — 종합과세 판정 전용
  interestRate?: number;               // 채권 표면금리 (소수 — bond_yield/100). YTM 아님 — 반드시 표면금리만 사용.
  faceValue?: number;                  // 채권 액면금액 — 없으면 buy_price×수량으로 근사(이 앱은 채권을 액면가 근처
                                        // 배분금액으로 다루므로 매수단가≈액면가 근사가 실무상 오차가 작음)
  issuerCountry?: string;              // 채권 발행국(한국/미국/브라질 등) — country(배당용, 광의 국내/해외)와 다른 개념
  couponType?: "이표채" | "복리채" | "할인채"; // 없으면 이표채로 간주
  isPerpetual?: boolean;                // 신종자본증권(영구채) — 이자소득은 일반 이표채와 동일하게 계산(만기 불필요), 콜 이후 스텝업 가능성만 배지로 표시
  maturityDate?: string;                // ISO(YYYY-MM-DD) — 만기 임박 안분·복리채 만기 일시인식에 사용
  purchaseDate?: string;                // ISO — 복리채 보유연수 계산 기준(없으면 오늘, 신규 매수 시뮬레이션 기준)
  // 외화표시 채권 환율 재환산용 — "투자 시점 원화 환산액에 환율이 고정"되는 문제를 막기 위해, 진입 시점
  // 환율로 외화 원금을 역산한 뒤 계산 시점의 실시간 환율로 다시 곱한다(주식 배당과 같은 원칙).
  bondCurrency?: string;                 // "USD"|"BRL" 등 — 없으면 원화 채권(재환산 불필요)
  bondFxRateAtEntry?: number;            // 진입 시점 환율(1회 캐싱)
  bondFxRateNow?: number;                // 계산 시점 실시간 환율(매번 갱신)
  // true = bondFxRateAtEntry가 실제 "탭5 채권 추가" 클릭 순간의 실시간 환율로 캡처된 값(신뢰 가능).
  // false/undefined = runAnalysis가 이 필드를 처음 마주쳐 방어적으로 오늘 환율을 대입한 값(진짜 진입
  // 시점 환율이 아닐 수 있음 — 이 기능 배포 이전부터 저장돼 있던 포지션 등). 배지 표시 판단에 사용.
  bondFxRateEntryConfirmed?: boolean;
}

// 매도로 실현된 손익(예: CustomerContext의 SellRecord) — 보유 중인 자산의 미실현 평가손익과 별개로
// 양도소득세 계산에 반영해야 함. 매도 시점엔 이미 포지션이 사라지므로 assets 루프만으로는 절대 안 잡힘.
export interface RealizedSaleForIncomeCalc {
  name: string;
  productType?: string; // "해외주식"/"해외ETF"만 명확히 분류과세 대상으로 반영(국내는 원칙적으로 비과세라 계산 제외)
  realizedGain: number;
}

// ─── calcFinancialIncomeSummary ────────────────────────────────────────────────
export function calcFinancialIncomeSummary(
  assets: AssetForIncomeCalc[],
  tMarginal: number = 0.385,
  realizedSales: RealizedSaleForIncomeCalc[] = []
): FinancialIncomeSummary {
  const breakdown: IncomeBreakdownItem[] = [];
  const cgBreakdownTemp: CapitalGainsBreakdownItem[] = [];
  const majorShareholderItems: { name: string; ticker: string; value: number; estimatedTax: number }[] = [];

  let interestIncome = 0;
  let dividendIncome = 0;
  let totalCapitalGains = 0;
  let totalCapitalLosses = 0;
  let grossUpTargetDividend = 0;
  let totalWithholdingCollected = 0; // 실제 원천징수세액 합계 (국내·해외 항목별 실제 계산값의 합 — 종합과세 기납부세액 계산에 사용)

  // 달력연도(1/1~오늘) 누적 배당소득 — "향후 1년 예상"(트레일링 365일)과는 별도로 집계.
  // 금융소득종합과세는 법적으로 달력연도 기준으로만 판정되므로 이 값으로 별도 종합과세 판정을 만든다.
  // ※ 이자소득(채권)은 원금×표면이율 기반 단순 연환산이라 "실지급 이벤트" 개념이 없어 달력연도 분리를 안 함 —
  //    rolling과 동일한 interestIncome을 그대로 재사용.
  let calendarYtdDividendIncome = 0;
  let calendarYtdGrossUpTargetDividend = 0;
  let calendarYtdWithholdingCollected = 0;

  let bondTaxExemptInterestIncome = 0; // 조세조약상 완전 비과세인 채권이자(예: 브라질 국채) — 종합과세 합산 제외
  // KB금융 배당 — 우선 종합과세에 정상 포함해 두고, 루프 종료 후 전체 금융소득 > 2,000만원이면
  // 이 종목분을 빼고 별도 분리과세로 재계산한다(KB_FINANCIAL_CODE 주석 참고).
  let kbDividendIncome = 0;
  let kbCalendarYtdDividendIncome = 0;
  let kbWithholding = 0;
  let kbCalendarYtdWithholding = 0;
  const bondMaturityLumpSums: BondMaturityLumpSum[] = []; // 복리채 등 만기 1년 이후인 일시상환 예정 이자(정보용)

  for (const a of assets) {
    const assetClass = (a.asset_class ?? "").trim();
    const productType = (a.productType ?? "").trim();

    // 채권 여부 (통합유형 + 레거시 모두 처리)
    const isBond =
      assetClass === "국내채권" || assetClass === "해외채권" ||
      productType === "국내채권" || productType === "해외채권";

    // 채권은 종목명 입력이 비활성화되어 name=""일 수 있음 → productType으로 대체
    // 주식·ETF는 name 없으면 스킵
    if (!a.name && !isBond) continue;
    const name = a.name || productType || "채권";

    const ticker = a.ticker ?? "";
    const isKoreanTicker = ticker.endsWith(".KS") || ticker.endsWith(".KQ");
    const isDomesticListed = isKoreanTicker || a.country === "국내" || a.country === "한국";

    // 보유 평가액 (주식·ETF용)
    const value =
      a.current_value ??
      (a.amount_type === "quantity"
        ? (a.current_price ?? 0) * a.amount
        : a.amount);

    // 매매차익 (주식·ETF용)
    let gain = 0;
    if (!isBond && a.buy_price && a.current_price && a.amount_type === "quantity") {
      gain = (a.current_price - a.buy_price) * a.amount;
    }

    // ── 채권: 이자소득 ──────────────────────────────────────────────────────────
    // 대전제(채권_이자소득세_계산로직 스펙): 이자는 액면금액×표면금리로만 계산한다. 매수단가·현재가·YTM은
    // 절대 쓰지 않는다. 매매차익·상환차익은 개인 비과세이므로 아래에서 채권은 양도소득 계산을 생략한다.
    if (isBond) {
      // 액면금액 — faceValue 우선, 없으면 buy_price×수량으로 근사(이 앱은 채권을 액면가 근처 배분금액으로
      // 다루므로 매수단가≈액면가 근사가 실무상 오차가 작음. 프리미엄/디스카운트 매매가 도입되면 faceValue를
      // 별도로 받아야 함 — 확인 필요)
      const faceValue =
        a.faceValue ??
        (a.amount_type === "quantity" ? (a.buy_price ?? 0) * a.amount : (a.buy_price ?? 0));
      const rate = a.interestRate ?? 0; // 이미 소수(bond_yield/100) — 반드시 표면금리, YTM 아님
      const couponType = a.couponType ?? "이표채"; // 데이터 없으면 이표채로 간주(카탈로그 대부분이 이표채)
      // issuerCountry 명시값이 없으면(수동 입력 채권 등) 배당에도 쓰는 일반 country 필드로 대체 폴백
      const issuerCountry = a.issuerCountry ?? a.country ?? (isDomesticListed ? "한국" : undefined);

      // 외화표시 채권(USD/BRL 등) 환율 재환산 배수 — 액면금액(faceValue)은 "투자 시점 원화 환산액"으로
      // 고정 저장되어 있으므로, 이자소득도 그 시점 환율에 영구히 고정하면 안 된다(주식 배당은 매 분석마다
      // 실시간 환율을 다시 적용하는데 채권만 예외로 두면 형평이 안 맞고, 환율이 오른 만큼 실제 원화 수령액도
      // 커진다). foreignPrincipal(외화 원금) = faceValue / 진입환율로 복원한 뒤, 표면금리를 곱하고 현재
      // 환율로 재환산한다 — 결과적으로 faceValue × rate × (bondFxRateNow / bondFxRateAtEntry)와 동일하다.
      // 두 환율 값이 모두 없으면(원화표시 채권이거나 환율 조회 실패) 배수 1(기존 방식)로 그대로 둔다.
      const fxRatio =
        a.bondCurrency && a.bondFxRateAtEntry && a.bondFxRateAtEntry > 0 && a.bondFxRateNow
          ? a.bondFxRateNow / a.bondFxRateAtEntry
          : 1;
      // 재환산이 실제로 적용된(fxRatio가 1이 아니거나, 통화가 있어 재환산 로직을 탄) 경우에만 배지 후보.
      // bondFxRateEntryConfirmed가 true(탭5 "추가" 클릭 순간 실제로 캡처된 값)이면 신뢰할 수 있으므로
      // 배지를 붙이지 않는다 — false/undefined면 runAnalysis가 방어적으로 오늘 환율을 대입한 것이라
      // 진짜 진입 시점 환율이 아닐 수 있음을 알린다.
      const entryFxUnconfirmedNote: "진입환율 미확인(근사치)" | undefined =
        a.bondCurrency && !a.bondFxRateEntryConfirmed ? "진입환율 미확인(근사치)" : undefined;

      // 신종자본증권(영구채) — "만기"가 불확정인 건 맞지만, 이자소득(표면금리×액면금액)은 만기와 무관하게
      // 정상 계산된다(만기가 필요한 건 YTM·듀레이션 같은 수익률 지표뿐, 이자소득 계산엔 안 씀). 개인
      // 투자자에게는 이 이자도 그대로 15.4% 원천징수 대상이라, 계산에서 빼면 오히려 게이지가 실제보다
      // 낮게 나오는 과소계상 오류가 된다(과대계상보다 위험 — 고객이 "안전하다"고 오해하고 넘어감).
      // 그래서 일반 이표채와 동일하게 계산하고, 콜 이후 스텝업 조항으로 표면금리가 바뀔 수 있다는 점만
      // 배지로 알린다(계산은 "현재 표면금리가 계속 유지된다"고 가정 — 다른 모든 종목의 향후1년 예상과 동일 원칙).

      // 할인채(제로쿠폰) — "표면금리=0 → 이자 0원"과는 다른 경로로 처리해야 한다. 할인액(액면-매수가)은
      // 원칙적으로 이자소득 과세 대상이다(소득세법상 채권 보유기간 이자상당액·할인액 과세 규정) — "할인채라
      // 원래 비과세"가 아니다. 브라질국채(BLTN)가 0원인 건 할인채라서가 아니라 한-브라질 조세조약상
      // 정부발행채 이자(할인액 포함)가 면제되기 때문 — 그 진짜 이유를 배지에 정확히 반영한다. 비과세국이
      // 아닌 할인채는 실제 할인액을 계산할 신뢰할 만한 액면가 데이터가 없어 "확인 필요"로 표시하고 임의로
      // 0원(=비과세로 오인될 수 있는 표시) 처리하지 않는다.
      if (couponType === "할인채") {
        const isTreatyExemptDiscount = !!(issuerCountry && BOND_TAX_EXEMPT_COUNTRIES.has(issuerCountry));
        if (faceValue > 0) {
          breakdown.push({
            name, ticker, incomeType: "이자", annualIncome: 0, netIncome: 0, yieldRate: 0,
            value: value > 0 ? Math.round(value) : Math.round(faceValue), principal: Math.round(faceValue),
            withholdingRate: 0,
            bondNote: isTreatyExemptDiscount ? "조세조약 비과세" : "할인채 할인액 과세 확인 필요",
          });
        }
        continue;
      }

      // 표면금리 없음 → 이자소득 0. 표면금리가 아예 미확인인 경우만 배지로 구분 표시(임의 추정 금지).
      if (!(rate > 0) || !(faceValue > 0)) {
        if (faceValue > 0) {
          breakdown.push({
            name, ticker, incomeType: "이자", annualIncome: 0, netIncome: 0, yieldRate: 0,
            value: value > 0 ? Math.round(value) : Math.round(faceValue), principal: Math.round(faceValue),
            withholdingRate: 0, bondNote: a.interestRate == null ? "표면금리 미확인" : undefined,
          });
        }
        continue;
      }

      const today = new Date();
      const maturity = a.maturityDate ? new Date(a.maturityDate) : null;
      const daysToMaturity = maturity ? Math.round((maturity.getTime() - today.getTime()) / 86_400_000) : null;

      if (couponType === "복리채") {
        // 만기 일시상환형(예: 국민주택채권 1종) — 보유기간 중 현금흐름 0. 이자는 만기 시점에 일시 인식된다.
        const purchase = a.purchaseDate ? new Date(a.purchaseDate) : today;
        const holdingYears = maturity ? Math.max(0, (maturity.getTime() - purchase.getTime()) / (365 * 86_400_000)) : 0;
        const lumpSumGross = faceValue * (Math.pow(1 + rate, holdingYears) - 1) * fxRatio;
        if (lumpSumGross > 0 && maturity) {
          if (daysToMaturity !== null && daysToMaturity <= 365) {
            // 만기가 향후 1년 이내 — 실제로 이 기간에 현금으로 들어오므로 "향후 1년 예상"에 포함
            const w = calcBondInterestWithholding(lumpSumGross, issuerCountry);
            if (!w.isExempt) {
              interestIncome += lumpSumGross;
              totalWithholdingCollected += w.totalTax;
            } else {
              bondTaxExemptInterestIncome += lumpSumGross;
            }
            breakdown.push({
              name, ticker, incomeType: "이자", annualIncome: Math.round(lumpSumGross), netIncome: Math.round(w.net),
              yieldRate: rate, value: value > 0 ? Math.round(value) : Math.round(faceValue), principal: Math.round(faceValue),
              withholdingRate: w.effectiveRate, bondNote: w.isExempt ? "조세조약 비과세" : "만기 일시인식",
              fxNote: entryFxUnconfirmedNote,
            });
          } else {
            // 만기가 1년 이후 — 이번 "향후 1년" 합계엔 넣지 않고 미래 일시인식 예정으로만 별도 기록.
            // 이 시점의 fxRatio는 "오늘 환율이 수년 뒤 만기 시점까지 유지된다"는 훨씬 약한 가정 위에
            // 있으므로(이표채·근시일 복리채보다 불확실성이 큼), 진입환율 확인 여부와 무관하게 항상
            // "만기 시점 환율 미확정" 배지를 붙인다.
            const w = calcBondInterestWithholding(lumpSumGross, issuerCountry);
            bondMaturityLumpSums.push({
              name, ticker, maturityYear: maturity.getFullYear(),
              lumpSumGross: Math.round(lumpSumGross), lumpSumNet: Math.round(w.net),
              fxNote: a.bondCurrency ? "만기 시점 환율 미확정" : undefined,
            });
          }
        }
        continue;
      }

      // 이표채(기본) — 연간 표면이자 = 액면금액 × 표면금리. 지급주기(paymentFrequency)는 등간격 지급이면
      // 어느 주기든 "향후 1년" 합계엔 영향이 없어(회차만 다를 뿐 연 합계는 동일) 계산에 쓰지 않는다.
      let annualGross = faceValue * rate * fxRatio;
      if (daysToMaturity !== null && daysToMaturity < 365) {
        // 만기가 1년 이내면 만기 이후엔 이자가 없으므로 잔존일수만큼만 반영
        annualGross = annualGross * Math.max(0, daysToMaturity) / 365;
      }
      if (annualGross > 0) {
        const w = calcBondInterestWithholding(annualGross, issuerCountry);
        if (!w.isExempt) {
          interestIncome += annualGross;
          totalWithholdingCollected += w.totalTax;
        } else {
          bondTaxExemptInterestIncome += annualGross;
        }
        breakdown.push({
          name, ticker, incomeType: "이자", annualIncome: Math.round(annualGross), netIncome: Math.round(w.net),
          yieldRate: rate, value: value > 0 ? Math.round(value) : Math.round(faceValue), principal: Math.round(faceValue),
          withholdingRate: w.effectiveRate,
          bondNote: w.isExempt ? "조세조약 비과세" : a.isPerpetual ? "신종자본증권(콜 이후 금리변동 가능)" : undefined,
          fxNote: entryFxUnconfirmedNote,
        });
      }
      continue; // 채권은 양도소득 계산 생략(매매차익 비과세)
    }

    // ── 리츠 / 주식 / ETF: 배당소득 ────────────────────────────────────────────
    // 주의: 여기서 쓰는 건 "배당수익률"이 아니라 "주당 실제 배당금(dividendPerShare) × 보유수량"이다.
    // dividendYield(배당수익률)는 세액 계산에 절대 쓰지 않는다 — 표시(yieldRate)용으로만 보관.
    if (value > 0) {
      const yieldRate = a.dividendYield ?? 0;
      const dividendPerShare = a.trailingAnnualDividendRate ?? a.annualDividendRate ?? 0;

      // 배당수익률 이상치 검사 — TAX_RATES.implausibleDividendYieldThreshold 주석 참고.
      // 레버리지/인버스 ETF(SOXS·SOXL·TQQQ 등)는 구조적으로 가치가 계속 깎여나가 동전주 탈출용
      // 액면병합을 반복하는데(SOXS는 최근 2년간 3회, 누적 2,000:1), Yahoo가 주는 "최근 12개월 배당금
      // 합계"가 병합 전후로 서로 다른 "1주" 기준 금액을 그대로 더해서 줘 실제 배당수익률이 수백 %로
      // 왜곡되는 사례가 실측 확인됨(SOXS 721.69%). 병합 비율로 역산 보정을 시도해봤지만 그렇게 해도
      // 여전히 비정상적 수치가 나오고 외부 소스와도 설명 안 되는 차이가 있어(2026-09 검증) — 이 상품군은
      // 데이터 자체를 신뢰할 수 있게 재구성할 방법이 없다고 결론. 계산에 쓰지 않고 배지로만 표시한다.
      const impliedYield = a.current_price != null && a.current_price > 0 ? dividendPerShare / a.current_price : 0;
      const isImplausibleDividend = a.amount_type === "quantity" && impliedYield > TAX_RATES.implausibleDividendYieldThreshold;

      if (isImplausibleDividend) {
        breakdown.push({
          name, ticker, incomeType: "배당", annualIncome: 0, netIncome: 0, yieldRate,
          value: Math.round(value), withholdingRate: 0,
          dividendNote: "배당소득 계산 불가(레버리지/인버스 ETF 추정 — 액면병합)",
        });
      } else if (dividendPerShare > 0 && a.amount_type === "quantity" && a.amount > 0) {
        const annualGross = dividendPerShare * a.amount;
        // 달력연도(1/1~오늘) 누적분 — 종합과세 판정 전용, 데이터 없으면 0(=올해 아직 배당 없음으로 취급)
        const calendarYtdPerShare = a.calendarYtdDividendRate ?? 0;
        const calendarYtdGross = calendarYtdPerShare * a.amount;

        // 소득유형 분류 (원천징수 계산 방식도 여기서 갈림 — 국내: 소득세14%+지방세1.4%,
        // 해외직접: 현지 조세조약세율과 국내14% 비교 후 낮은 쪽만 국내 추가징수)
        let incomeType: IncomeBreakdownItem["incomeType"] = "배당";
        let withholdingRate: number;
        let annualNet: number;
        if (isDomesticListed && productType === "국내주식") {
          incomeType = "배당(국내직접)";
          grossUpTargetDividend += annualGross; // Gross-up (11%) 대상
          calendarYtdGrossUpTargetDividend += calendarYtdGross;
          const w = calcWithholdingKRW(annualGross);
          const wYtd = calcWithholdingKRW(calendarYtdGross);
          withholdingRate = DOMESTIC_DIV_WITHHOLDING;
          annualNet = w.net;
          totalWithholdingCollected += w.totalTax;
          calendarYtdWithholdingCollected += wYtd.totalTax;
          // KB금융 — 종합과세엔 위처럼 정상 반영해 두고, 루프 종료 후 "전체 금융소득 > 2,000만원"이면
          // 이 종목분(소득·Gross-up 전액·원천징수)을 빼고 별도 분리과세로 재계산한다.
          if (bareStockCode(ticker) === KB_FINANCIAL_CODE) {
            kbDividendIncome += annualGross;
            kbCalendarYtdDividendIncome += calendarYtdGross;
            kbWithholding += w.totalTax;
            kbCalendarYtdWithholding += wYtd.totalTax;
          }
        } else if (!isDomesticListed && productType === "해외주식") {
          incomeType = "배당(해외직접)";
          const w = calcForeignDividendWithholding(annualGross, a.country);
          withholdingRate = w.effectiveRate;
          annualNet = w.net;
          totalWithholdingCollected += w.totalTax;
          calendarYtdWithholdingCollected += calcForeignDividendWithholding(calendarYtdGross, a.country).totalTax;
        } else {
          if (
            productType === "국내ETF" || productType === "해외ETF" ||
            productType === "ETF" || productType === "펀드" ||
            productType === "채권형" || productType === "리츠" ||
            productType === "집합투자"
          ) {
            incomeType = "배당(집합투자)";
          }
          // 집합투자기구(펀드·ETF·리츠 등)의 원천징수는 "어디서 설정됐는지"가 아니라 "어디에 상장돼
          // 있는지"로 갈라야 한다 — 예: 미국에 상장된 SCHD는 미국이 조세조약 세율(15%)로 현지 원천징수
          // 하지, 국내 세율(14%)로 떼지 않는다. 개별 해외주식과 완전히 같은 트랙(현지조약세율 vs 국내14%
          // 비교)을 태운다. 국내 상장 ETF·펀드·리츠만 국내 원천징수(14%+1.4%)를 적용한다.
          if (!isDomesticListed) {
            const w = calcForeignDividendWithholding(annualGross, a.country);
            withholdingRate = w.effectiveRate;
            annualNet = w.net;
            totalWithholdingCollected += w.totalTax;
            calendarYtdWithholdingCollected += calcForeignDividendWithholding(calendarYtdGross, a.country).totalTax;
          } else {
            const w = calcWithholdingKRW(annualGross);
            withholdingRate = DOMESTIC_DIV_WITHHOLDING;
            annualNet = w.net;
            totalWithholdingCollected += w.totalTax;
            calendarYtdWithholdingCollected += calcWithholdingKRW(calendarYtdGross).totalTax;
          }
        }
        dividendIncome += annualGross;
        calendarYtdDividendIncome += calendarYtdGross;

        breakdown.push({
          name,  // a.name || productType || "채권" (fallback 적용)
          ticker,
          incomeType,
          annualIncome: Math.round(annualGross),
          netIncome: annualNet,
          yieldRate,
          value: Math.round(value),
          withholdingRate,
        });
      }
    }

    // ── ② 국내 대주주 (보유액 50억 이상 국내주식) — gain 여부와 무관하게 항상 체크 ──────
    // 2020년 귀속분부터 국내 대주주 주식·해외주식 양도소득은 손익통산되고 기본공제 250만원도 연 1회만
    // 적용된다(국세청 개정) — 그래서 여기서 자체적으로 250만원 공제·세율을 매기지 않고, 아래 해외주식과
    // 같은 통합 풀(totalCapitalGains/totalCapitalLosses)에 손익만 넣는다. 실제 공제·세율 적용은 루프
    // 종료 후 통합 계산부에서 한 번에 한다. estimatedTax는 그 통합 계산 이후 귀속 세액으로 채워 넣는다
    // (아래 "// 대주주 항목 estimatedTax 채우기" 참고).
    if (isDomesticListed && value >= TAX_RATES.domesticMajorShareholderValueThreshold && productType === "국내주식") {
      majorShareholderItems.push({ name: a.name, ticker, value, estimatedTax: 0 });
      if (gain > 0) totalCapitalGains += gain;
      else if (gain < 0) totalCapitalLosses += gain;
      if (gain !== 0) {
        cgBreakdownTemp.push({ name: a.name, ticker, gain, tax: 0, category: "국내대주주" });
      }
    }

    // ── 양도소득 ────────────────────────────────────────────────────────────────
    if (gain !== 0) {
      // ① 해외주식·해외ETF·해외펀드: 손익통산 후 250만원 공제, 22%
      const isForeignTaxable =
        !isDomesticListed && (
          productType === "해외주식" ||
          productType === "해외ETF" ||
          productType === "주식형" ||    // 레거시
          productType === "ETF" ||       // 레거시
          productType === "개별주식" ||  // 레거시
          productType === "채권형" ||    // 레거시
          productType === "펀드"         // 레거시
        );

      if (isForeignTaxable) {
        const cat: CapitalGainsBreakdownItem["category"] =
          productType === "해외ETF" || productType === "ETF" ? "해외주식" :
          productType === "펀드" || productType === "채권형" ? "해외펀드" : "해외주식";
        if (gain > 0) totalCapitalGains += gain;
        else totalCapitalLosses += gain;
        cgBreakdownTemp.push({ name: a.name, ticker, gain, tax: 0, category: cat });

      // ③ 국내상장 해외ETF (자산 = 해외) 매매차익 → 배당소득(집합투자)
      } else if (isDomesticListed && gain > 0 && assetClass === "해외주식") {
        const w = calcWithholdingKRW(gain);
        dividendIncome += gain;
        totalWithholdingCollected += w.totalTax;
        breakdown.push({
          name: a.name + " (매매차익)",
          ticker,
          incomeType: "배당(집합투자)",
          annualIncome: Math.round(gain),
          netIncome: w.net,
          yieldRate: (a.buy_price && a.amount) ? gain / (a.buy_price * a.amount) : 0,
          value: Math.round(value),
          withholdingRate: DOMESTIC_DIV_WITHHOLDING,
        });
      }
      // ④ 국내주식형 ETF·국내채권 매매차익: 비과세 (생략)
    }
  }

  // ── 매도로 실현된 손익(해외주식·해외ETF만) — 보유 중인 자산 루프와는 별개로 합산 ─────────
  // 매도 시점엔 이미 포지션이 사라져 위 루프에서 절대 안 잡히므로, 별도 realizedSales로 받은 값을 더한다.
  // productType이 "해외주식"/"해외ETF"로 명확한 경우만 반영 — 국내/해외 구분이 모호한 값(예: 레거시 "ETF")은
  // 잘못 과세될 위험이 있어 보수적으로 제외한다(국내 매매차익은 원칙적으로 비과세라 반영 안 해도 세액 누락 없음).
  for (const s of realizedSales) {
    if (!s.realizedGain) continue;
    const pt = (s.productType ?? "").trim();
    if (pt !== "해외주식" && pt !== "해외ETF") continue;
    if (s.realizedGain > 0) totalCapitalGains += s.realizedGain;
    else totalCapitalLosses += s.realizedGain;
    cgBreakdownTemp.push({
      name: `${s.name} (매도 실현)`,
      ticker: "",
      gain: s.realizedGain,
      tax: 0,
      category: "해외주식",
    });
  }

  // ── 국내대주주+해외주식 통합 손익통산 및 양도소득세 ──────────────────────────
  // 2020년 귀속분부터 국내 대주주 주식과 해외주식(ETF·펀드 포함)의 양도소득은 하나의 풀로 손익통산되고,
  // 기본공제 250만원도 그 통합 풀에 연 1회만 적용된다(국세청 개정) — 종전처럼 "해외주식 250만원 +
  // 국내대주주 250만원"을 각각 따로 공제하면 과다공제가 된다.
  // 세율 구조(3억원 기준 22%/27.5%)는 원래 국내대주주 전용이었는데, 통합 후 해외주식분에도 동일하게
  // 적용되는지는 확인 필요 — 다만 3억원 이하 구간에서는 어차피 두 세율이 같은 22%로 일치하므로, 이 통합
  // 세율표를 쓰는 게 "따로 나눠서 계산" 대비 더 정확할 것으로 판단해 적용한다(실무 확인 권장).
  const netCapitalGains = totalCapitalGains + totalCapitalLosses;
  const taxableNetGains = Math.max(0, netCapitalGains - TAX_RATES.foreignStockCapitalGainsExemption);
  const capitalGainsTax = taxableNetGains <= 0 ? 0
    : Math.round(
        taxableNetGains <= 300_000_000
          ? taxableNetGains * TAX_RATES.foreignStockCapitalGainsRate
          : 300_000_000 * TAX_RATES.foreignStockCapitalGainsRate + (taxableNetGains - 300_000_000) * 0.275
      );
  const foreignCapitalGainsTax = capitalGainsTax; // 통합 풀 전체 세액(하위호환 필드 — 아래서 카테고리별로 재분배)

  // 항목별 기여 세액 배분 — 이제 국내대주주·해외주식 구분 없이 이익(gain>0) 종목에 비례 배분
  const capitalGainsBreakdown: CapitalGainsBreakdownItem[] = cgBreakdownTemp.map((item) => {
    let tax = 0;
    if (capitalGainsTax > 0 && totalCapitalGains > 0 && item.gain > 0) {
      tax = capitalGainsTax * (item.gain / totalCapitalGains);
    }
    return { ...item, gain: Math.round(item.gain), tax: Math.round(tax) };
  }).sort((a, b) => b.gain - a.gain);

  // 대주주 항목 estimatedTax 채우기 — 통합 계산 결과에서 이 종목에 귀속된 세액을 역으로 채워 넣는다
  // (경고 UI에서 "이 종목 때문에 예상되는 세금"을 보여주기 위한 근사치).
  for (const mi of majorShareholderItems) {
    const matched = capitalGainsBreakdown.find(
      (b) => b.category === "국내대주주" && b.name === mi.name && b.ticker === mi.ticker
    );
    if (matched) mi.estimatedTax = matched.tax;
  }
  const domesticMajorShareholderTaxFinal = capitalGainsBreakdown
    .filter((b) => b.category === "국내대주주")
    .reduce((s, b) => s + b.tax, 0);

  // ── 금융소득 종합과세 계산 (gross 기준) ─────────────────────────────────────
  // 우선 KB금융을 포함해 전부 합산한 결과(All)를 낸 뒤, "전체 금융소득 > 2,000만원"이면 KB금융분을
  // 빼고 재계산한다(KB_FINANCIAL_CODE 주석 참고). 2,000만원 이하면 그냥 합산본을 그대로 쓴다.
  const rollingAll = computeComprehensiveTax(dividendIncome, grossUpTargetDividend, interestIncome, totalWithholdingCollected, tMarginal);
  // calendarYtd(달력연도 1/1~오늘 누적, 종합과세 판정 전용)의 이자소득은 0으로 둔다.
  // 채권 이자는 원금×표면이율로 "연간 전체"를 한 번에 계산하는 구조라, 실제 지급 이벤트(날짜)가 없다 —
  // 그래서 오늘 막 편입한 채권도 rolling의 연간 이자 전액이 그대로 여기 들어가버리는 버그가 있었음
  // (실제로는 매수일 이후 경과 기간만큼만 지급됐어야 함). 매입일·지급주기 데이터가 없어 정확한 비례 계산이
  // 불가능하므로, 잘못된 값을 보여주는 것보다 "이 달력연도 누적 지표는 배당소득만 반영"으로 확실히 하는 편을 택함.
  const calendarYtdAll = computeComprehensiveTax(calendarYtdDividendIncome, calendarYtdGrossUpTargetDividend, 0, calendarYtdWithholdingCollected, tMarginal);

  const kbSeparate = kbDividendIncome > 0 && rollingAll.totalFinancialIncome > THRESHOLD;
  const rolling = kbSeparate
    ? computeComprehensiveTax(
        dividendIncome - kbDividendIncome,
        Math.max(0, grossUpTargetDividend - kbDividendIncome), // KB금융 국내주식 배당은 전액 Gross-up 대상
        interestIncome,
        Math.max(0, totalWithholdingCollected - kbWithholding),
        tMarginal,
      )
    : rollingAll;
  const calendarYtd = kbSeparate
    ? computeComprehensiveTax(
        calendarYtdDividendIncome - kbCalendarYtdDividendIncome,
        Math.max(0, calendarYtdGrossUpTargetDividend - kbCalendarYtdDividendIncome),
        0,
        Math.max(0, calendarYtdWithholdingCollected - kbCalendarYtdWithholding),
        tMarginal,
      )
    : calendarYtdAll;
  const separateElection = kbSeparate
    ? { dividendIncome: Math.round(kbDividendIncome), ...separateDividendTaxKRW(kbDividendIncome) }
    : null;

  return {
    interestIncome: Math.round(interestIncome),
    dividendIncome: Math.round(dividendIncome), // KB금융 포함 전체 — 배당 목록·"배당소득 합계"용
    totalCapitalGains: Math.round(totalCapitalGains),
    totalCapitalLosses: Math.round(totalCapitalLosses),
    netCapitalGains: Math.round(netCapitalGains),
    foreignCapitalGainsTax,
    domesticMajorShareholderTax: Math.round(domesticMajorShareholderTaxFinal),
    capitalGainsTax,
    totalFinancialIncome: rolling.totalFinancialIncome,
    grossUpAmount: rolling.grossUpAmount,
    taxableFinancialIncome: rolling.taxableFinancialIncome,
    generalTax: rolling.generalTax,
    comparisonTax: rolling.comparisonTax,
    finalTax: rolling.finalTax,
    dividendTaxCredit: rolling.dividendTaxCredit,
    withholdingTax: rolling.withholdingTax,
    additionalTax: rolling.additionalTax,
    tMarginal,
    isOverThreshold: rolling.isOverThreshold,
    calendarYtd,
    breakdown: (() => {
      const map = new Map<string, IncomeBreakdownItem>();
      for (const item of breakdown) {
        const key = `${item.name}::${item.ticker}::${item.incomeType}`;
        const existing = map.get(key);
        if (existing) {
          map.set(key, {
            ...existing,
            annualIncome: existing.annualIncome + item.annualIncome,
            netIncome: existing.netIncome + item.netIncome,
            value: (existing.value ?? 0) + (item.value ?? 0),
          });
        } else {
          map.set(key, { ...item });
        }
      }
      return Array.from(map.values())
        // KB금융이 실제 분리과세 처리된 경우에만 그 행에 배지를 붙인다(2,000만원 이하면 그냥 합산이라 배지 없음).
        .map((it) => (kbSeparate && bareStockCode(it.ticker) === KB_FINANCIAL_CODE ? { ...it, separatelyTaxed: true } : it))
        .sort((a, b) => b.annualIncome - a.annualIncome);
    })(),
    capitalGainsBreakdown,
    majorShareholderWarning: majorShareholderItems.length > 0,
    majorShareholderItems,
    bondTaxExemptInterestIncome: Math.round(bondTaxExemptInterestIncome),
    separateElection,
    bondMaturityLumpSums,
    updatedAt: Date.now(),
  };
}

/** 새 공식 기반 세후 수익률 계산
 * = (① 양도 세후 수익 + ② 배당·이자 세후 수익) ÷ 투자 원금
 */
export function calcAfterTaxReturn(
  summary: FinancialIncomeSummary,
  assets: Array<{ buy_price?: number | null; current_price?: number; current_value?: number; amount: number; amount_type?: string }>,
  includeCapitalGainsTax?: boolean
): number {
  // 총 투자원금: 매수단가 × 수량 합계
  const principal = assets.reduce((sum, a) => {
    if ((a.amount_type ?? "quantity") === "value") return sum + a.amount;
    if (a.buy_price != null && a.buy_price > 0) return sum + a.buy_price * a.amount;
    if (a.current_value != null && a.current_value > 0) return sum + a.current_value;
    if (a.current_price != null && a.current_price > 0) return sum + a.current_price * a.amount;
    return sum;
  }, 0);

  if (principal <= 0) return 0;

  // 현재 평가금액 합계 (모든 종목 포함)
  const currentTotal = assets.reduce((sum, a) => {
    if ((a.amount_type ?? "quantity") === "value") return sum + (a.current_value ?? a.amount);
    if (a.current_value != null && a.current_value > 0) return sum + a.current_value;
    if (a.current_price != null && a.current_price > 0) return sum + a.current_price * a.amount;
    if (a.buy_price != null && a.buy_price > 0) return sum + a.buy_price * a.amount;
    return sum;
  }, 0);

  // 전체 평가손익 (국내 + 해외 모든 종목)
  const priceReturn = currentTotal - principal;

  // 금융소득세: 금융소득 × 15.4% (2,000만원 초과 시 종합과세 기준)
  const totalFI = summary.totalFinancialIncome;
  const financialIncomeTax = summary.isOverThreshold
    ? (summary.finalTax - summary.dividendTaxCredit)
    : totalFI * 0.154;

  // 양도소득세 (기존 포트폴리오는 실제 매도 없으므로 제외)
  const capitalGainsTax = (includeCapitalGainsTax ?? true) ? summary.capitalGainsTax : 0;

  // 세후수익률 = (전체 평가손익 − 금융소득세 − 양도소득세) / 총 투자원금
  return (priceReturn - financialIncomeTax - capitalGainsTax) / principal;
}

/** proxy-finance API 응답에서 배당 데이터 추출 */
export function extractDividendFromYahoo(yahooJson: Record<string, unknown>): {
  dividendYield?: number;
  trailingAnnualDividendRate?: number;
  annualDividendRate?: number;
} {
  let dy = yahooJson?.dividendYield;
  let tadr = yahooJson?.trailingAnnualDividendRate;
  let adr = yahooJson?.annualDividendRate;

  if (typeof dy !== "number" || typeof tadr !== "number" || typeof adr !== "number") {
    const results = (yahooJson?.chart as Record<string, unknown>)?.result as Record<string, unknown>[] | undefined;
    const m = (results?.[0]?.meta ?? {}) as Record<string, unknown>;
    if (typeof dy !== "number") dy = m?.dividendYield;
    if (typeof tadr !== "number") tadr = m?.trailingAnnualDividendRate;
    if (typeof adr !== "number") adr = m?.annualDividendRate;
  }

  return {
    dividendYield: typeof dy === "number" && dy > 0 ? dy : undefined,
    trailingAnnualDividendRate: typeof tadr === "number" && tadr > 0 ? tadr : undefined,
    annualDividendRate: typeof adr === "number" && adr > 0 ? adr : undefined,
  };
}
