import { UNDERLYING_TICKERS, type ProductSpec } from './types'

const semiAnnualMonths = [6, 12, 18, 24, 30] as const

/**
 * Single source of truth for display, payoff, and future simulation inputs.
 * Rates and barriers use decimal form: 0.80 represents 80%.
 */
export const productSpecs = [
  {
    id: 'ELB2950',
    productType: 'ELB',
    structureName: '2Star 월수익지급식 NoKI',
    customerDescription: '삼성전자와 SK하이닉스가 매월 최초기준가격의 65% 이상이면 월수익을 지급합니다. 6개월마다 두 종목이 모두 80% 이상이면 원금과 그동안의 월수익을 조기상환하는 3년 만기 상품입니다.',
    principalProtection: '원금지급형',
    riskLevel: 5,
    riskLabel: '낮은위험',
    maturityMonths: 36,
    underlyings: ['삼성전자', 'SK하이닉스'],
    tickerByUnderlying: UNDERLYING_TICKERS,
    initialReferenceDate: '2026-08-31',
    monthlyCoupon: {
      rate: 0.0046,
      annualMaximumRate: 0.0552,
      barrier: 0.65,
      frequencyMonths: 1,
    },
    earlyRedemptions: semiAnnualMonths.map((month) => ({ month, barrier: 0.8 })),
    maturity: {
      principalRepayment: true,
      finalCouponIfConditionMet: true,
    },
  },
  {
    id: 'ELB2951',
    productType: 'ELB',
    structureName: '1Star 월수익지급식 NoKI',
    customerDescription: 'SK하이닉스 한 종목을 관찰합니다. 매월 최초기준가격의 80% 이상이면 월수익을 지급하며, 6개월마다 100% 이상이면 원금을 조기상환하는 3년 만기 상품입니다.',
    principalProtection: '원금지급형',
    riskLevel: 5,
    riskLabel: '낮은위험',
    maturityMonths: 36,
    underlyings: ['SK하이닉스'],
    tickerByUnderlying: UNDERLYING_TICKERS,
    initialReferenceDate: '2026-08-31',
    monthlyCoupon: {
      rate: 0.0063,
      annualMaximumRate: 0.0756,
      barrier: 0.8,
      frequencyMonths: 1,
    },
    earlyRedemptions: semiAnnualMonths.map((month) => ({ month, barrier: 1 })),
    maturity: {
      principalRepayment: true,
    },
  },
  {
    id: 'ELS31381',
    productType: 'ELS',
    structureName: '2Star Step-down 6Chance',
    customerDescription: '삼성전자와 SK하이닉스가 6개월마다 단계적으로 낮아지는 조기상환 기준을 모두 충족하면 정해진 수익을 지급합니다. 낙인 배리어를 한 번이라도 하회한 뒤 만기 조건을 충족하지 못하면 최저 성과 기초자산에 따라 원금손실이 발생할 수 있습니다.',
    principalProtection: '원금비보장형',
    riskLevel: 1,
    riskLabel: '매우높은위험',
    maturityMonths: 36,
    underlyings: ['삼성전자', 'SK하이닉스'],
    tickerByUnderlying: UNDERLYING_TICKERS,
    initialReferenceDate: '2026-08-31',
    earlyRedemptions: [
      { month: 6, barrier: 0.85, totalReturn: 0.1645 },
      { month: 12, barrier: 0.85, totalReturn: 0.329 },
      { month: 18, barrier: 0.8, totalReturn: 0.4935 },
      { month: 24, barrier: 0.8, totalReturn: 0.658 },
      { month: 30, barrier: 0.75, totalReturn: 0.8225 },
    ],
    knockIn: { barrier: 0.3, monitoring: 'daily-close', trigger: 'below' },
    maturity: {
      month: 36,
      barrier: 0.75,
      totalReturn: 0.987,
      noKnockInTotalReturn: 0.987,
      lossRule: 'worst-of-final-return',
    },
  },
  {
    id: 'ELS31382',
    productType: 'ELS',
    structureName: '2Star Step-down 4Chance',
    customerDescription: '삼성전자와 SK하이닉스를 3개월마다 관찰하는 1년 만기 상품입니다. 조기상환 기준을 모두 충족하면 정해진 수익을 지급하며, 낙인 발생 후 만기 조건을 충족하지 못하면 최저 성과 기초자산에 따라 원금손실이 발생할 수 있습니다.',
    principalProtection: '원금비보장형',
    riskLevel: 1,
    riskLabel: '매우높은위험',
    maturityMonths: 12,
    underlyings: ['삼성전자', 'SK하이닉스'],
    tickerByUnderlying: UNDERLYING_TICKERS,
    initialReferenceDate: '2026-08-31',
    earlyRedemptions: [
      { month: 3, barrier: 0.85, totalReturn: 0.053 },
      { month: 6, barrier: 0.85, totalReturn: 0.106 },
      { month: 9, barrier: 0.85, totalReturn: 0.159 },
    ],
    knockIn: { barrier: 0.35, monitoring: 'daily-close', trigger: 'below' },
    maturity: {
      month: 12,
      barrier: 0.8,
      totalReturn: 0.212,
      noKnockInTotalReturn: 0.212,
      lossRule: 'worst-of-final-return',
    },
  },
] as const satisfies readonly ProductSpec[]

export function getProductSpec(id: ProductSpec['id']): ProductSpec {
  const product = productSpecs.find((spec) => spec.id === id)

  if (!product) {
    throw new Error(`Unknown product id: ${id}`)
  }

  return product
}
