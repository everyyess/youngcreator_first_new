import type { Underlying } from '../products/types'
import { estimateHistoricalParameters, valueForEstimation, type AssetParameters, type EstimatedParameters } from './statistics'
import type { DailyPrice, DailyPriceByUnderlying } from './types'

const TRADING_DAYS = 252

export interface HouseViewRegime {
  name: string
  start: string
  end: string
}

export interface HouseViewConfig {
  regimes: readonly HouseViewRegime[]
  cycleInfluence: number
  recentMarketInfluence: number
  recentYears: number
}

export interface CycleStatistic {
  name: string
  period: string
  observations: number
  totalReturn: Record<Underlying, number>
  annualizedVolatility: Record<Underlying, number>
  maxDrawdown: Record<Underlying, number>
  correlation: number
}

export interface HouseViewMetadata {
  methodology: 'regime-weighted-historical-parameters'
  config: HouseViewConfig
  normalizedWeights: { similarCycles: number; recentMarket: number }
  weightedObservations: Record<Underlying, number>
  recentStart: string
  cycleStatistics: readonly CycleStatistic[]
}

export const HOUSE_VIEW_CONFIG: HouseViewConfig = {
  regimes: [
    { name: 'DRAM Cycle 2016–2018', start: '2016-01-01', end: '2018-12-31' },
    { name: 'DRAM Cycle 2020–2022', start: '2020-01-01', end: '2022-12-31' },
  ],
  cycleInfluence: 0.65,
  recentMarketInfluence: 0.35,
  recentYears: 3,
}

type DatedReturn = { date: string; value: number }

export function estimateHouseViewParameters(prices: DailyPriceByUnderlying, config: HouseViewConfig = HOUSE_VIEW_CONFIG): EstimatedParameters {
  validateConfig(config)
  const base = estimateHistoricalParameters(prices)
  const latestDate = [prices.삼성전자.at(-1)?.date, prices.SK하이닉스.at(-1)?.date].filter(Boolean).sort().at(-1)
  if (!latestDate) throw new Error('House View 추정에 사용할 가격 데이터가 없습니다.')
  const recentStart = shiftYears(latestDate, -config.recentYears)
  const returns = { 삼성전자: datedReturns(prices.삼성전자), SK하이닉스: datedReturns(prices.SK하이닉스) }
  const samsungWeights = observationWeights(returns.삼성전자.map((item) => item.date), recentStart, config)
  const hynixWeights = observationWeights(returns.SK하이닉스.map((item) => item.date), recentStart, config)
  const aligned = align(returns.삼성전자, returns.SK하이닉스)
  const alignedWeights = observationWeights(aligned.map((item) => item.date), recentStart, config)
  const assets = {
    삼성전자: weightedAsset(base.assets.삼성전자, returns.삼성전자, samsungWeights),
    SK하이닉스: weightedAsset(base.assets.SK하이닉스, returns.SK하이닉스, hynixWeights),
  }
  const left = aligned.map((item) => item.left)
  const right = aligned.map((item) => item.right)
  const covariance = weightedCovariance(left, right, alignedWeights)
  const correlation = covariance / Math.sqrt(Math.max(weightedVariance(left, alignedWeights) * weightedVariance(right, alignedWeights), Number.EPSILON))
  const groupWeights = normalizedGroupWeights(aligned.map((item) => item.date), recentStart, config)
  return {
    assets,
    correlation: Math.max(-0.999, Math.min(0.999, correlation)),
    priceBasis: 'adjusted-close-with-raw-close-fallback',
    estimationMethod: 'house-view-weighted',
    houseView: {
      methodology: 'regime-weighted-historical-parameters',
      config,
      normalizedWeights: groupWeights,
      weightedObservations: { 삼성전자: samsungWeights.filter((weight) => weight > 0).length, SK하이닉스: hynixWeights.filter((weight) => weight > 0).length },
      recentStart,
      cycleStatistics: [...config.regimes.map((regime) => cycleStatistic(prices, regime.name, regime.start, regime.end)), cycleStatistic(prices, '현재 Cycle · 최근 시장', recentStart, latestDate)],
    },
  }
}

function validateConfig(config: HouseViewConfig) {
  if (config.cycleInfluence < 0 || config.recentMarketInfluence < 0 || config.cycleInfluence + config.recentMarketInfluence <= 0) throw new Error('House View 가중치는 0 이상이며 합이 0보다 커야 합니다.')
  if (!Number.isFinite(config.recentYears) || config.recentYears <= 0) throw new Error('최근시장 반영기간은 양수여야 합니다.')
}

function datedReturns(history: readonly DailyPrice[]): DatedReturn[] {
  const sorted = [...history].sort((left, right) => left.date.localeCompare(right.date))
  return sorted.slice(1).flatMap((point, index) => {
    const previous = valueForEstimation(sorted[index])
    const current = valueForEstimation(point)
    return previous > 0 && current > 0 ? [{ date: point.date, value: Math.log(current / previous) }] : []
  })
}

function isCycle(date: string, config: HouseViewConfig) { return config.regimes.some((regime) => date >= regime.start && date <= regime.end) }
function observationWeights(dates: readonly string[], recentStart: string, config: HouseViewConfig) {
  const cycleCount = dates.filter((date) => isCycle(date, config)).length
  const recentCount = dates.filter((date) => date >= recentStart && !isCycle(date, config)).length
  const raw = dates.map((date) => isCycle(date, config) && cycleCount ? config.cycleInfluence / cycleCount : date >= recentStart && recentCount ? config.recentMarketInfluence / recentCount : 0)
  const total = raw.reduce((sum, value) => sum + value, 0)
  if (total <= 0) throw new Error('House View 구간에 해당하는 수익률 관측치가 없습니다.')
  return raw.map((value) => value / total)
}

function normalizedGroupWeights(dates: readonly string[], recentStart: string, config: HouseViewConfig) {
  const weights = observationWeights(dates, recentStart, config)
  const similarCycles = weights.reduce((sum, weight, index) => sum + (isCycle(dates[index], config) ? weight : 0), 0)
  return { similarCycles, recentMarket: 1 - similarCycles }
}

function weightedAsset(base: AssetParameters, returns: readonly DatedReturn[], weights: readonly number[]): AssetParameters {
  const values = returns.map((item) => item.value)
  const dailyMean = weightedMean(values, weights)
  const dailyVariance = weightedVariance(values, weights)
  const annualizedVolatility = Math.sqrt(dailyVariance * TRADING_DAYS)
  const selected = returns.filter((_, index) => weights[index] > 0)
  return { ...base, dailyMeanLogReturn: dailyMean, dailyVolatility: Math.sqrt(dailyVariance), annualizedDrift: dailyMean * TRADING_DAYS + annualizedVolatility ** 2 / 2, annualizedVolatility, observations: selected.length, observationStart: selected[0]?.date, observationEnd: selected.at(-1)?.date }
}

function weightedMean(values: readonly number[], weights: readonly number[]) { return values.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0) }
function weightedVariance(values: readonly number[], weights: readonly number[]) {
  const average = weightedMean(values, weights)
  const sumSquares = values.reduce((sum, value, index) => sum + (weights[index] ?? 0) * (value - average) ** 2, 0)
  const correction = 1 - weights.reduce((sum, weight) => sum + weight ** 2, 0)
  return correction > 0 ? sumSquares / correction : 0
}
function weightedCovariance(left: readonly number[], right: readonly number[], weights: readonly number[]) {
  const leftMean = weightedMean(left, weights); const rightMean = weightedMean(right, weights)
  const sum = left.reduce((total, value, index) => total + (weights[index] ?? 0) * (value - leftMean) * (right[index] - rightMean), 0)
  const correction = 1 - weights.reduce((total, weight) => total + weight ** 2, 0)
  return correction > 0 ? sum / correction : 0
}

function align(left: readonly DatedReturn[], right: readonly DatedReturn[]) { const rightMap = new Map(right.map((item) => [item.date, item.value])); return left.flatMap((item) => rightMap.has(item.date) ? [{ date: item.date, left: item.value, right: rightMap.get(item.date)! }] : []) }
function shiftYears(date: string, years: number) { const next = new Date(`${date}T00:00:00Z`); next.setUTCFullYear(next.getUTCFullYear() + years); return next.toISOString().slice(0, 10) }

function cycleStatistic(prices: DailyPriceByUnderlying, name: string, start: string, end: string): CycleStatistic {
  const sliced = { 삼성전자: prices.삼성전자.filter((point) => point.date >= start && point.date <= end), SK하이닉스: prices.SK하이닉스.filter((point) => point.date >= start && point.date <= end) }
  const parameters = estimateHistoricalParameters(sliced)
  return {
    name, period: `${start.slice(0, 4)}~${end.slice(0, 4)}`, observations: Math.min(parameters.assets.삼성전자.observations, parameters.assets.SK하이닉스.observations),
    totalReturn: { 삼성전자: totalReturn(sliced.삼성전자), SK하이닉스: totalReturn(sliced.SK하이닉스) },
    annualizedVolatility: { 삼성전자: parameters.assets.삼성전자.annualizedVolatility, SK하이닉스: parameters.assets.SK하이닉스.annualizedVolatility },
    maxDrawdown: { 삼성전자: maximumDrawdown(sliced.삼성전자), SK하이닉스: maximumDrawdown(sliced.SK하이닉스) }, correlation: parameters.correlation,
  }
}
function totalReturn(history: readonly DailyPrice[]) { const first = history[0] ? valueForEstimation(history[0]) : 0; const last = history.at(-1) ? valueForEstimation(history.at(-1)!) : 0; return first > 0 ? last / first - 1 : 0 }
function maximumDrawdown(history: readonly DailyPrice[]) { let peak = 0; let result = 0; for (const point of history) { const value = valueForEstimation(point); peak = Math.max(peak, value); if (peak > 0) result = Math.max(result, 1 - value / peak) } return result }
