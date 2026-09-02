import type { ProductSpec, Underlying } from '../../products/types'

/** A closing-price snapshot expressed as a percentage of its initial price (100). */
export interface NormalizedPricePoint {
  date: string
  prices: Partial<Record<Underlying, number>>
}

export interface PayoffInput {
  investmentAmount: number
  /** Ordered daily-close observations. Prices are normalized, never raw KRW prices. */
  pricePath: readonly NormalizedPricePoint[]
  /** Internal simulation fast path: the caller already guarantees ascending dates. */
  isChronological?: boolean
}

export interface PayoffResult {
  productId: ProductSpec['id']
  redemptionType: 'early' | 'maturity'
  redemptionDate: string
  holdingDays: number
  principalReturned: number
  couponIncome: number
  totalPayout: number
  /** Return relative to investment principal, e.g. 0.1645 for 16.45%. */
  totalReturn: number
  annualizedReturn: number
  couponCount: number
  couponPaidMonths: readonly number[]
  earlyRedemptionMonth?: number
  knockInOccurred: boolean
  principalLossOccurred: boolean
  /** Worst final three-close average ratio, populated for ELS paths reaching maturity. */
  maturityWorstOfRatio?: number
  /** Canonical loss rate returned by the payoff engine. */
  lossRate: number
}
