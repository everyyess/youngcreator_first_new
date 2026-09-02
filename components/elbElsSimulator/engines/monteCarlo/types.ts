import type { NormalizedPricePoint, PayoffResult } from '../payoff'
import type { EstimatedParameters } from '../../marketData/statistics'
import type { DailyPrice } from '../../marketData/types'
import type { RegimeBootstrapModel } from '../../marketData/regimeModel'
import type { ProductSpec, Underlying } from '../../products/types'

export interface MonteCarloOverrides {
  drift?: number
  volatility?: number
  volatilityMultiplier?: number
  correlation?: number
  initialShock?: number
}

export interface StructuredSimulationInput {
  product: ProductSpec
  investmentAmount: number
  analysisDate: string
  /** Raw closes at analysisDate, never adjusted prices. */
  analysisSpot: Record<Underlying, number>
  estimatedParameters: EstimatedParameters
  simulationCount?: number
  seed?: number
  overrides?: MonteCarloOverrides
  /** Required after the initial fixing date to preserve already-observed payoff events. */
  observedRawHistory?: Record<Underlying, readonly DailyPrice[]>
  samplePathCount?: number
  /** When present, future joint log returns come from weighted historical blocks instead of GBM shocks. */
  regimeBootstrap?: RegimeBootstrapModel
}

export interface ProbabilityEstimate {
  probability: number
  lower95: number
  upper95: number
  count: number
  samples: number
}

export interface SimulationSamplePath {
  pathId: number
  initialFixing: Record<Underlying, number>
  normalizedFixing: Record<Underlying, number>
  path: ReadonlyArray<NormalizedPricePoint>
  payoff: PayoffResult
}

export type PathOutcomeCategory = 'EARLY_REDEMPTION' | 'MATURITY_PROFIT' | 'PRINCIPAL_LOSS'
export type ComparisonHorizonMonth = 6 | 12 | 36

/** Read-only checkpoint used by the strategy comparison. It does not price a live product. */
export interface ComparisonHorizonSnapshot {
  month: ComparisonHorizonMonth
  underlyingRatio: Record<Underlying, number>
  productStatus: 'redeemed' | 'active' | 'matured'
  /** Defined only when the product has redeemed or reached legal maturity. */
  realizedTotalReturn?: number
  principalLossOccurred?: boolean
}

/** Canonical economic result for exactly one simulated path. */
export interface PathResult {
  pathId: number
  category: PathOutcomeCategory
  redemptionObservationIndex: number | null
  redemptionMonth: number
  holdingDays: number
  holdingYears: number
  realizedTotalReturn: number
  realizedAnnualizedReturn: number
  totalPayout: number
  knockInOccurred: boolean
  maturityWorstOfRatio: number | null
  lossRate: number
  terminalUnderlyingRatio: Record<Underlying, number>
  terminalUnderlyingPrice: Record<Underlying, number>
  comparisonHorizons: Partial<Record<ComparisonHorizonMonth, ComparisonHorizonSnapshot>>
}

export interface DistributionPoint {
  value: number
  count: number
  probability: number
}

export interface LossDistributionPoint {
  lowerInclusive: number
  upperInclusive: number
  upperExclusive: boolean
  count: number
  probability: number
}

export interface SimulationResult {
  productId: ProductSpec['id']
  simulationCount: number
  seed: number
  analysisDate: string
  initialFixing: { mode: 'simulated' | 'actual'; mean: Record<Underlying, number>; median: Record<Underlying, number>; p5: Record<Underlying, number>; p95: Record<Underlying, number> }
  initialFixingDistribution: Record<Underlying, ReadonlyArray<number>>
  assumptions: {
    drift: Record<Underlying, number>
    volatility: Record<Underlying, number>
    correlation: number
    initialShock: number
    volatilityMultiplier: number
    tradingDaysPerYear: 252
    timeStep: number
    futureSteps: number
    priceBasis: 'raw-close-for-fixing-and-payoff'
    modelType: 'Historical GBM' | 'Similar-Regime Weighted Block Bootstrap'
    driftBasis: 'historical-log-return' | 'mixture-weighted-log-return'
  }
  estimatedParameters: EstimatedParameters
  redemptionStats: { early: Record<string, ProbabilityEstimate>; cumulativeEarly: Record<string, ProbabilityEstimate>; maturityReached: ProbabilityEstimate; maturityProfit: ProbabilityEstimate }
  outcomeStats: { earlyRedemption: ProbabilityEstimate; maturityProfit: ProbabilityEstimate; principalLoss: ProbabilityEstimate }
  couponStats?: { monthly: Record<string, ProbabilityEstimate>; averageCouponPaymentProbability: number; expectedCouponCount: number; conditionByMonth: Record<string, ProbabilityEstimate>; earlyConditionByMonth: Record<string, ProbabilityEstimate> }
  knockInStats?: { touch: ProbabilityEstimate }
  lossStats?: { principalLoss: ProbabilityEstimate; averageLossRateWhenLoss: number; averageLossRateAllPaths: number }
  holdingPeriodStats: { meanDays: number }
  returnStats: { expectedTotalReturn: number; expectedAnnualizedReturn: number }
  pathResults: ReadonlyArray<PathResult>
  realizedReturnDistribution: ReadonlyArray<DistributionPoint>
  conditionalLossDistribution: ReadonlyArray<LossDistributionPoint>
  barrierDiagnostics: { earlyObservation: Record<string, { month: number; barrier: number; medianWorstOf: number; p5WorstOf: number; p95WorstOf: number; belowBarrier: ProbabilityEstimate }> }
  terminalPayoffDistribution: ReadonlyArray<number>
  terminalUnderlyingRatios: Record<Underlying, ReadonlyArray<number>>
  /** Raw closing-price equivalents on the final simulated observation date. */
  terminalUnderlyingPrices: Record<Underlying, ReadonlyArray<number>>
  samplePaths: ReadonlyArray<SimulationSamplePath>
  /** One actual path for each available payoff outcome, never an averaged path. */
  representativePaths: { early?: SimulationSamplePath; maturityProfit?: SimulationSamplePath; principalLoss?: SimulationSamplePath }
  warnings: readonly string[]
  modelDiagnostics: {
    observations: Record<Underlying, number>
    parameterWarnings: readonly string[]
    reproducible: true
    spot: Record<Underlying, number>
    dailyMeanLogReturn: Record<Underlying, number>
    dailyVolatility: Record<Underlying, number>
    annualizedDrift: Record<Underlying, number>
    annualizedVolatility: Record<Underlying, number>
    observationPeriod: Record<Underlying, { from?: string; to?: string }>
    correlationMatrix: readonly [readonly [1, number], readonly [number, 1]]
    timeStep: number
    futureSteps: number
    modelType: 'Historical GBM' | 'Similar-Regime Weighted Block Bootstrap'
  }
}
