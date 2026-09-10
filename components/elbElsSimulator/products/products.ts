import { UNDERLYING_TICKERS, type ProductSpec } from './types'

const semiAnnualMonths = [6, 12, 18, 24, 30] as const

/**
 * Single source of truth for display, payoff, and future simulation inputs.
 * Rates and barriers use decimal form: 0.80 represents 80%.
 */
export const productSpecs = [
  {
    id: 'ELB2962',
    productType: 'ELB',
    structureName: '1Star 월수익지급식 NoKI Barrier 6Chance',
    customerDescription: 'SK하이닉스가 매월 최초기준가격의 80% 이상이면 월 0.6%의 수익을 지급합니다. 6개월마다 100% 이상이면 원금을 조기상환하며, 미상환 시 3년 만기에 원금을 지급하는 상품입니다.',
    principalProtection: '원금지급형',
    riskLevel: 5,
    riskLabel: '낮은위험',
    maturityMonths: 36,
    underlyings: ['SK하이닉스'],
    tickerByUnderlying: UNDERLYING_TICKERS,
    initialReferenceDate: '2026-09-14',
    monthlyCoupon: {
      rate: 0.006,
      annualMaximumRate: 0.072,
      barrier: 0.8,
      frequencyMonths: 1,
    },
    earlyRedemptions: semiAnnualMonths.map((month) => ({ month, barrier: 1 })),
    maturity: {
      principalRepayment: true,
      finalCouponIfConditionMet: true,
    },
  },
  {
    id: 'ELB2963',
    productType: 'ELB',
    structureName: '2Star 월수익지급식 NoKI Barrier 6Chance',
    customerDescription: '삼성전자와 SK하이닉스가 모두 매월 최초기준가격의 80% 이상이면 월 0.7%의 수익을 지급합니다. 6개월마다 두 종목이 모두 90% 이상이면 원금을 조기상환하며, 미상환 시 3년 만기에 원금을 지급합니다.',
    principalProtection: '원금지급형',
    riskLevel: 5,
    riskLabel: '낮은위험',
    maturityMonths: 36,
    underlyings: ['삼성전자', 'SK하이닉스'],
    tickerByUnderlying: UNDERLYING_TICKERS,
    initialReferenceDate: '2026-09-14',
    monthlyCoupon: {
      rate: 0.007,
      annualMaximumRate: 0.084,
      barrier: 0.8,
      frequencyMonths: 1,
    },
    earlyRedemptions: semiAnnualMonths.map((month) => ({ month, barrier: 0.9 })),
    maturity: {
      principalRepayment: true,
      finalCouponIfConditionMet: true,
    },
  },
  {
    id: 'ELS31438',
    productType: 'ELS',
    structureName: '2Star Step-down 12Chance',
    customerDescription: '삼성전자와 SK하이닉스를 3개월마다 관찰하여 단계적으로 낮아지는 조기상환 기준을 모두 충족하면 연 30% 수준의 수익을 지급합니다. 30% 낙인 발생 후 만기 75% 조건을 충족하지 못하면 최저 성과 기초자산에 따라 원금손실이 발생할 수 있습니다.',
    principalProtection: '원금비보장형',
    riskLevel: 1,
    riskLabel: '매우높은위험',
    maturityMonths: 36,
    underlyings: ['삼성전자', 'SK하이닉스'],
    tickerByUnderlying: UNDERLYING_TICKERS,
    initialReferenceDate: '2026-09-14',
    earlyRedemptions: [
      { month: 3, barrier: 0.95, totalReturn: 0.075 },
      { month: 6, barrier: 0.95, totalReturn: 0.15 },
      { month: 9, barrier: 0.9, totalReturn: 0.225 },
      { month: 12, barrier: 0.9, totalReturn: 0.3 },
      { month: 15, barrier: 0.9, totalReturn: 0.375 },
      { month: 18, barrier: 0.9, totalReturn: 0.45 },
      { month: 21, barrier: 0.85, totalReturn: 0.525 },
      { month: 24, barrier: 0.85, totalReturn: 0.6 },
      { month: 27, barrier: 0.8, totalReturn: 0.675 },
      { month: 30, barrier: 0.8, totalReturn: 0.75 },
      { month: 33, barrier: 0.75, totalReturn: 0.825 },
    ],
    knockIn: { barrier: 0.3, monitoring: 'daily-close', trigger: 'below' },
    maturity: {
      month: 36,
      barrier: 0.75,
      totalReturn: 0.9,
      noKnockInTotalReturn: 0.9,
      lossRule: 'worst-of-final-return',
    },
  },
  {
    id: 'ELS31439',
    productType: 'ELS',
    structureName: '2Star Step-down 6Chance',
    customerDescription: '삼성전자와 SK하이닉스를 6개월마다 관찰하여 95%부터 75%까지 낮아지는 조기상환 기준을 모두 충족하면 연 35.3% 수준의 수익을 지급합니다. 35% 낙인 발생 후 만기 75% 조건을 충족하지 못하면 원금손실이 발생할 수 있습니다.',
    principalProtection: '원금비보장형',
    riskLevel: 1,
    riskLabel: '매우높은위험',
    maturityMonths: 36,
    underlyings: ['삼성전자', 'SK하이닉스'],
    tickerByUnderlying: UNDERLYING_TICKERS,
    initialReferenceDate: '2026-09-14',
    earlyRedemptions: [
      { month: 6, barrier: 0.95, totalReturn: 0.1765 },
      { month: 12, barrier: 0.9, totalReturn: 0.353 },
      { month: 18, barrier: 0.85, totalReturn: 0.5295 },
      { month: 24, barrier: 0.8, totalReturn: 0.706 },
      { month: 30, barrier: 0.75, totalReturn: 0.8825 },
    ],
    knockIn: { barrier: 0.35, monitoring: 'daily-close', trigger: 'below' },
    maturity: {
      month: 36,
      barrier: 0.75,
      totalReturn: 1.059,
      noKnockInTotalReturn: 1.059,
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
