import { runStructuredProductSimulation } from '../engines/monteCarlo'
import { createSeededRandom } from '../engines/monteCarlo/random'
import { getProductSpec } from '../products/products'
import type { Underlying } from '../products/types'
import { buildSimilarRegimeModel, sampleRegimeReturnPath, SIMILAR_REGIME_CONFIG, type SimilarRegimeConfig, type SimilarRegimeMatch } from './regimeModel'
import { valueForEstimation } from './statistics'
import type { DailyPrice, DailyPriceByUnderlying } from './types'

const THREE_MONTH_DAYS = 63
const SIX_MONTH_DAYS = 126

export interface EventCalibration {
  predictedRate: number
  observedRate: number
  bias: number
  meanAbsoluteError: number
  brierScore: number
}

export interface RollingAnchorResult {
  anchorDate: string
  sourceDataEnd: string
  barrier3MPredicted: number
  barrier3MObserved: 0 | 1
  barrier6MPredicted: number
  barrier6MObserved: 0 | 1
  knockInPredicted: number
  knockInObserved: 0 | 1
  drawdownP5: number
  drawdownP95: number
  actualMaximumDrawdown: number
  drawdownCovered: boolean
}

export interface RollingValidationSummary {
  anchorFrequency: 'quarterly'
  anchors: readonly RollingAnchorResult[]
  barrier3M: EventCalibration
  barrier6M: EventCalibration
  knockIn: EventCalibration
  drawdown: {
    coverage: number
    belowP5Count: number
    aboveP95Count: number
    meanP5: number
    meanP95: number
    meanActual: number
  }
}

export interface ProbabilityRow {
  label: string
  simulationCount: number
  seed: number
  earlyRedemption: number
  knockIn: number
  principalLoss: number
}

export interface SensitivityRow extends ProbabilityRow {
  earlyRedemptionDelta: number
  knockInDelta: number
  principalLossDelta: number
}

export interface AnalogWeightDiagnostics {
  effectiveSampleSize: number
  maximumWeight: number
  herfindahlIndex: number
  episodes: ReadonlyArray<Pick<SimilarRegimeMatch, 'start' | 'end' | 'normalizedWeight' | 'similarityScore' | 'timeWarpRatio'> & { effectiveEpisodeShare: number }>
}

export function quarterlyRollingAnchors(prices: DailyPriceByUnderlying, earliest = '2023-01-01', horizonDays = SIX_MONTH_DAYS): string[] {
  const paired = alignedReturns(prices)
  const byQuarter = new Map<string, string>()
  paired.forEach((point) => {
    if (point.date < earliest) return
    const month = Number(point.date.slice(5, 7)); const quarter = Math.floor((month - 1) / 3) + 1
    byQuarter.set(`${point.date.slice(0, 4)}-Q${quarter}`, point.date)
  })
  return [...byQuarter.values()].filter((anchor) => paired.filter((point) => point.date > anchor).length >= horizonDays)
}

export function runRollingWalkForwardValidation(
  prices: DailyPriceByUnderlying,
  options: { anchors?: readonly string[]; samples?: number; seed?: number; knockInBarrier?: number; config?: SimilarRegimeConfig } = {},
): RollingValidationSummary {
  const anchors = options.anchors ?? quarterlyRollingAnchors(prices)
  const samples = options.samples ?? 500
  const seed = options.seed ?? 42
  const knockInBarrier = options.knockInBarrier ?? .35
  const config = options.config ?? SIMILAR_REGIME_CONFIG
  const fullReturns = alignedReturns(prices)
  const results: RollingAnchorResult[] = []

  anchors.forEach((anchorDate, anchorIndex) => {
    const future = fullReturns.filter((point) => point.date > anchorDate).slice(0, SIX_MONTH_DAYS)
    if (future.length !== SIX_MONTH_DAYS) return
    const historical: DailyPriceByUnderlying = {
      삼성전자: prices.삼성전자.filter((point) => point.date <= anchorDate),
      SK하이닉스: prices.SK하이닉스.filter((point) => point.date <= anchorDate),
    }
    const { model } = buildSimilarRegimeModel(historical, config)
    if (model.metadata.sourcePeriod.to > anchorDate || model.metadata.topSimilarRegimes.some((episode) => episode.end > anchorDate)) throw new Error(`${anchorDate} walk-forward에 미래 데이터가 포함되었습니다.`)
    const random = createSeededRandom(seed + anchorIndex)
    const simulated = Array.from({ length: samples }, () => sampleRegimeReturnPath(model, SIX_MONTH_DAYS, random))
    const simulatedDrawdowns = simulated.map(maximumDrawdown)
    const actual3M = future.slice(0, THREE_MONTH_DAYS)
    results.push({
      anchorDate,
      sourceDataEnd: model.metadata.sourcePeriod.to,
      barrier3MPredicted: frequency(simulated, (path) => terminalWorstOf(path.slice(0, THREE_MONTH_DAYS)) >= .85),
      barrier3MObserved: terminalWorstOf(actual3M) >= .85 ? 1 : 0,
      barrier6MPredicted: frequency(simulated, (path) => terminalWorstOf(path) >= .85),
      barrier6MObserved: terminalWorstOf(future) >= .85 ? 1 : 0,
      knockInPredicted: frequency(simulated, (path) => minimumRatio(path) < knockInBarrier),
      knockInObserved: minimumRatio(future) < knockInBarrier ? 1 : 0,
      drawdownP5: quantile(simulatedDrawdowns, .05),
      drawdownP95: quantile(simulatedDrawdowns, .95),
      actualMaximumDrawdown: maximumDrawdown(future),
      drawdownCovered: false,
    })
    const last = results.at(-1)!
    last.drawdownCovered = last.actualMaximumDrawdown >= last.drawdownP5 && last.actualMaximumDrawdown <= last.drawdownP95
  })
  if (!results.length) throw new Error('Rolling walk-forward에 사용할 anchor가 없습니다.')
  return {
    anchorFrequency: 'quarterly', anchors: results,
    barrier3M: calibration(results.map((row) => [row.barrier3MPredicted, row.barrier3MObserved])),
    barrier6M: calibration(results.map((row) => [row.barrier6MPredicted, row.barrier6MObserved])),
    knockIn: calibration(results.map((row) => [row.knockInPredicted, row.knockInObserved])),
    drawdown: {
      coverage: frequency(results, (row) => row.drawdownCovered),
      belowP5Count: results.filter((row) => row.actualMaximumDrawdown < row.drawdownP5).length,
      aboveP95Count: results.filter((row) => row.actualMaximumDrawdown > row.drawdownP95).length,
      meanP5: mean(results.map((row) => row.drawdownP5)), meanP95: mean(results.map((row) => row.drawdownP95)), meanActual: mean(results.map((row) => row.actualMaximumDrawdown)),
    },
  }
}

export function sensitivityConfigs(base: SimilarRegimeConfig = SIMILAR_REGIME_CONFIG): ReadonlyArray<{ label: string; config: SimilarRegimeConfig }> {
  const mixture = (similarRegime: number, recentMarket: number, tailHistory: number) => ({ ...base, mixtureWeights: { similarRegime, recentMarket, tailHistory } })
  return [
    { label: '기준 65/20/15', config: base },
    { label: '유사국면 55/25/20', config: mixture(.55, .25, .20) },
    { label: '유사국면 75/15/10', config: mixture(.75, .15, .10) },
    { label: '유사국면 제거', config: mixture(0, .5714285714, .4285714286) },
    { label: '최근시장 제거', config: mixture(.8125, 0, .1875) },
    { label: '극단구간 제거', config: mixture(.7647058824, .2352941176, 0) },
    { label: 'lambda 0.50', config: { ...base, similarityLambda: .50 } },
    { label: 'lambda 1.20', config: { ...base, similarityLambda: 1.20 } },
    { label: 'block 5일', config: { ...base, blockLength: 5 } },
    { label: 'block 20일', config: { ...base, blockLength: 20 } },
    { label: 'warp 불확실성 0%', config: { ...base, warpUncertainty: 0 } },
    { label: 'warp 불확실성 30%', config: { ...base, warpUncertainty: .30 } },
    { label: 'time-warp OFF', config: timeWarpOffConfig(base) },
  ]
}

export function timeWarpOffConfig(base: SimilarRegimeConfig = SIMILAR_REGIME_CONFIG): SimilarRegimeConfig {
  return { ...base, warpBounds: [1, 1 + 1e-9], warpUncertainty: 0 }
}

export function runSensitivityAblation(prices: DailyPriceByUnderlying, simulationCount = 5_000, seed = 42): SensitivityRow[] {
  const rows = sensitivityConfigs().map(({ label, config }) => runEls31382Probability(prices, config, simulationCount, seed, label))
  const baseline = rows[0]
  return rows.map((row) => ({ ...row, earlyRedemptionDelta: row.earlyRedemption - baseline.earlyRedemption, knockInDelta: row.knockIn - baseline.knockIn, principalLossDelta: row.principalLoss - baseline.principalLoss }))
}

export function runPathSeedStability(prices: DailyPriceByUnderlying, counts: readonly number[] = [20_000, 50_000], seeds: readonly number[] = [17, 42, 2026]): ProbabilityRow[] {
  return counts.flatMap((simulationCount) => seeds.map((seed) => runEls31382Probability(prices, SIMILAR_REGIME_CONFIG, simulationCount, seed, `${simulationCount.toLocaleString()}경로 / seed ${seed}`)))
}

export function analogWeightDiagnostics(matches: readonly SimilarRegimeMatch[]): AnalogWeightDiagnostics {
  const weights = matches.map((match) => match.normalizedWeight)
  const herfindahlIndex = sum(weights.map((weight) => weight ** 2))
  const effectiveSampleSize = 1 / herfindahlIndex
  return { effectiveSampleSize, herfindahlIndex, maximumWeight: Math.max(...weights), episodes: matches.map((match) => ({ start: match.start, end: match.end, normalizedWeight: match.normalizedWeight, similarityScore: match.similarityScore, timeWarpRatio: match.timeWarpRatio, effectiveEpisodeShare: match.normalizedWeight * effectiveSampleSize })) }
}

function runEls31382Probability(prices: DailyPriceByUnderlying, config: SimilarRegimeConfig, simulationCount: number, seed: number, label: string): ProbabilityRow {
  const analysisDate = commonLatestDate(prices)
  const { model, estimatedParameters } = buildSimilarRegimeModel(prices, config)
  const result = runStructuredProductSimulation({ product: getProductSpec('ELS31382'), investmentAmount: 1_000_000, analysisDate, analysisSpot: { 삼성전자: closeOn(prices.삼성전자, analysisDate), SK하이닉스: closeOn(prices.SK하이닉스, analysisDate) }, estimatedParameters, regimeBootstrap: model, simulationCount, seed, observedRawHistory: prices })
  return { label, simulationCount, seed, earlyRedemption: result.outcomeStats.earlyRedemption.probability, knockIn: result.knockInStats?.touch.probability ?? 0, principalLoss: result.outcomeStats.principalLoss.probability }
}

type JointReturn = Record<Underlying, number> & { date: string }
function alignedReturns(prices: DailyPriceByUnderlying): JointReturn[] { const samsung = datedReturns(prices.삼성전자); const hynix = new Map(datedReturns(prices.SK하이닉스).map((item) => [item.date, item.value])); return samsung.flatMap((item) => hynix.has(item.date) ? [{ date: item.date, 삼성전자: item.value, SK하이닉스: hynix.get(item.date)! }] : []) }
function datedReturns(history: readonly DailyPrice[]) { const sorted = [...history].sort((left, right) => left.date.localeCompare(right.date)); return sorted.slice(1).flatMap((point, index) => { const previous = valueForEstimation(sorted[index]); const current = valueForEstimation(point); return previous > 0 && current > 0 ? [{ date: point.date, value: Math.log(current / previous) }] : [] }) }
function terminalRatio(path: readonly Record<Underlying, number>[], underlying: Underlying) { return Math.exp(sum(path.map((point) => point[underlying]))) }
function terminalWorstOf(path: readonly Record<Underlying, number>[]) { return Math.min(terminalRatio(path, '삼성전자'), terminalRatio(path, 'SK하이닉스')) }
function minimumRatio(path: readonly Record<Underlying, number>[]) { let samsung = 1; let hynix = 1; let minimum = 1; path.forEach((point) => { samsung *= Math.exp(point.삼성전자); hynix *= Math.exp(point.SK하이닉스); minimum = Math.min(minimum, samsung, hynix) }); return minimum }
function maximumDrawdown(path: readonly Record<Underlying, number>[]) { return Math.max(assetDrawdown(path, '삼성전자'), assetDrawdown(path, 'SK하이닉스')) }
function assetDrawdown(path: readonly Record<Underlying, number>[], underlying: Underlying) { let level = 1; let peak = 1; let drawdown = 0; path.forEach((point) => { level *= Math.exp(point[underlying]); peak = Math.max(peak, level); drawdown = Math.max(drawdown, 1 - level / peak) }); return drawdown }
function calibration(rows: ReadonlyArray<readonly [number, number]>): EventCalibration { const predictedRate = mean(rows.map(([predicted]) => predicted)); const observedRate = mean(rows.map(([, observed]) => observed)); return { predictedRate, observedRate, bias: predictedRate - observedRate, meanAbsoluteError: mean(rows.map(([predicted, observed]) => Math.abs(predicted - observed))), brierScore: mean(rows.map(([predicted, observed]) => (predicted - observed) ** 2)) } }
function commonLatestDate(prices: DailyPriceByUnderlying) { const samsung = new Set(prices.삼성전자.map((point) => point.date)); const dates = prices.SK하이닉스.map((point) => point.date).filter((date) => samsung.has(date)).sort(); if (!dates.length) throw new Error('공통 거래일이 없습니다.'); return dates.at(-1)! }
function closeOn(history: readonly DailyPrice[], date: string) { const point = history.find((item) => item.date === date); if (!point) throw new Error(`${date} 종가가 없습니다.`); return point.close }
function quantile(values: readonly number[], probability: number) { const sorted = [...values].sort((left, right) => left - right); const position = (sorted.length - 1) * probability; const lower = Math.floor(position); const fraction = position - lower; return (sorted[lower] ?? 0) + fraction * ((sorted[lower + 1] ?? sorted[lower] ?? 0) - (sorted[lower] ?? 0)) }
function frequency<T>(values: readonly T[], predicate: (value: T) => boolean) { return values.filter(predicate).length / values.length }
function sum(values: readonly number[]) { return values.reduce((total, value) => total + value, 0) }
function mean(values: readonly number[]) { return values.length ? sum(values) / values.length : 0 }
