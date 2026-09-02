import type { Underlying } from '../products/types'

export interface DailyPrice {
  date: string
  /** Official Yahoo chart close: used for product fixing and payoff observations. */
  close: number
  /** Corporate-action adjusted close: used for return/parameter estimation only. */
  adjustedClose?: number
  high?: number
  low?: number
  volume?: number
}

export type DailyPriceByUnderlying = Record<Underlying, readonly DailyPrice[]>

export interface MarketDataProvider {
  getDailyPrices(ticker: string, from: string, to: string): Promise<DailyPrice[]>
}

export const priceUsageMetadata = {
  fixingAndPayoff: 'raw-close',
  parameterEstimation: 'adjusted-close-with-raw-close-fallback',
} as const
