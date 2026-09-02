import type { ComparisonHorizonMonth, PathResult } from '../../engines/monteCarlo'
import type { ProductSpec } from '../../products/types'

export const STRATEGY_SCENARIOS = [.2, .1, 0, -.1, -.2] as const
export const CONDITIONAL_TOLERANCE = .05
export const MIN_CONDITIONAL_SAMPLES = 30
export const COMPARISON_HORIZONS = [6, 12, 36] as const satisfies readonly ComparisonHorizonMonth[]

export type MaturityStrategyCell = {
  kind: 'maturity'
  value: number
  returnValue: number
  samples: number
  lossProbability: number
}

export type InterimStrategyCell = {
  kind: 'interim'
  value: number
  returnValue: number
  samples: number
  redeemedCount: number
  activeCount: number
  redeemedProbability: number
  activeProbability: number
  meanRedeemedReturn?: number
}

export type StructuredStrategyCell =
  | MaturityStrategyCell
  | InterimStrategyCell
  | { kind: 'excluded'; maturityMonths: number }
  | { kind: 'insufficient'; samples: number }

export function calculateStructuredScenario(
  product: ProductSpec,
  paths: readonly PathResult[],
  investment: number,
  horizon: ComparisonHorizonMonth,
  scenario: number,
  minimumSamples = MIN_CONDITIONAL_SAMPLES,
): StructuredStrategyCell {
  if (horizon > product.maturityMonths) return { kind: 'excluded', maturityMonths: product.maturityMonths }

  const target = 1 + scenario
  const group = paths.filter((path) => {
    const snapshot = path.comparisonHorizons[horizon]
    return snapshot && Math.abs(snapshot.underlyingRatio.SK하이닉스 - target) <= CONDITIONAL_TOLERANCE
  })
  if (group.length < minimumSamples) return { kind: 'insufficient', samples: group.length }

  if (horizon === product.maturityMonths) {
    const portfolioReturn = mean(group.map((path) => directUnderlyingSleeveReturn(product, path, horizon) / 2 + requiredSettledReturn(path, horizon) / 2))
    const losses = group.filter((path) => path.comparisonHorizons[horizon]?.principalLossOccurred).length
    return {
      kind: 'maturity',
      value: investment * (1 + portfolioReturn),
      returnValue: portfolioReturn,
      samples: group.length,
      lossProbability: losses / group.length,
    }
  }

  const redeemed = group.filter((path) => path.comparisonHorizons[horizon]?.productStatus === 'redeemed')
  const activeCount = group.length - redeemed.length
  const portfolioReturn = mean(group.map((path) => {
    const snapshot = path.comparisonHorizons[horizon]!
    const structuredReturn = snapshot.productStatus === 'redeemed' ? requiredSettledReturn(path, horizon) : 0
    return directUnderlyingSleeveReturn(product, path, horizon) / 2 + structuredReturn / 2
  }))
  return {
    kind: 'interim',
    value: investment * (1 + portfolioReturn),
    returnValue: portfolioReturn,
    samples: group.length,
    redeemedCount: redeemed.length,
    activeCount,
    redeemedProbability: redeemed.length / group.length,
    activeProbability: activeCount / group.length,
    meanRedeemedReturn: redeemed.length ? mean(redeemed.map((path) => requiredSettledReturn(path, horizon))) : undefined,
  }
}

/** Equal-weight direct-underlying sleeve, observed on the same conditional path. */
export function directUnderlyingSleeveReturn(product: ProductSpec, path: PathResult, horizon: ComparisonHorizonMonth) {
  const ratios = path.comparisonHorizons[horizon]?.underlyingRatio
  if (!ratios) throw new Error(`${horizon}개월 기초자산 수익률이 없습니다.`)
  return mean(product.underlyings.map((underlying) => ratios[underlying] - 1))
}

export function mixedStrategyLabel(product: ProductSpec) {
  const directWeights = product.underlyings.map((underlying) => `${underlying} ${50 / product.underlyings.length}%`).join(' + ')
  return `${directWeights} + ${product.id} 50%`
}

function requiredSettledReturn(path: PathResult, horizon: ComparisonHorizonMonth) {
  const value = path.comparisonHorizons[horizon]?.realizedTotalReturn
  if (value === undefined || !Number.isFinite(value)) throw new Error(`${horizon}개월 확정수익률이 없습니다.`)
  return value
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
