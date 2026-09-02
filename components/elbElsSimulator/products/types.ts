export type ProductId = 'ELB2950' | 'ELB2951' | 'ELS31381' | 'ELS31382'

export type Underlying = '삼성전자' | 'SK하이닉스'
export type UnderlyingTicker = '005930.KS' | '000660.KS'

/** Fixed-product Yahoo tickers, confirmed by youngcreator_new_project's stock-search mapping. */
export const UNDERLYING_TICKERS: Readonly<Record<Underlying, UnderlyingTicker>> = {
  삼성전자: '005930.KS',
  SK하이닉스: '000660.KS',
}

export type RiskLevel = 1 | 5

export interface EarlyRedemptionCondition {
  month: number
  barrier: number
  /** Total return paid when this early redemption condition is met. */
  totalReturn?: number
}

export interface MonthlyCoupon {
  rate: number
  annualMaximumRate: number
  barrier: number
  frequencyMonths: 1
}

export interface ELBProductSpec {
  id: Extract<ProductId, `ELB${string}`>
  productType: 'ELB'
  structureName: string
  customerDescription: string
  principalProtection: '원금지급형'
  riskLevel: 5
  riskLabel: '낮은위험'
  maturityMonths: 36
  underlyings: readonly Underlying[]
  tickerByUnderlying: Readonly<Partial<Record<Underlying, UnderlyingTicker>>>
  initialReferenceDate: '2026-08-31'
  monthlyCoupon: MonthlyCoupon
  earlyRedemptions: readonly EarlyRedemptionCondition[]
  maturity: {
    principalRepayment: true
    /** Explicitly present only when the maturity coupon condition is specified. */
    finalCouponIfConditionMet?: true
  }
}

export interface KnockInCondition {
  barrier: number
  monitoring: 'daily-close'
  trigger: 'below'
}

export interface ELSProductSpec {
  id: Extract<ProductId, `ELS${string}`>
  productType: 'ELS'
  structureName: string
  customerDescription: string
  principalProtection: '원금비보장형'
  riskLevel: 1
  riskLabel: '매우높은위험'
  maturityMonths: 12 | 36
  underlyings: readonly [Underlying, Underlying]
  tickerByUnderlying: Readonly<Record<Underlying, UnderlyingTicker>>
  initialReferenceDate: '2026-08-31'
  earlyRedemptions: readonly EarlyRedemptionCondition[]
  knockIn: KnockInCondition
  maturity: {
    month: 12 | 36
    barrier: number
    totalReturn: number
    noKnockInTotalReturn: number
    lossRule: 'worst-of-final-return'
  }
}

export type ProductSpec = ELBProductSpec | ELSProductSpec
