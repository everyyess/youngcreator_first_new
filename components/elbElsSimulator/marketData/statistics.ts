import type { Underlying } from '../products/types'
import type { DailyPrice, DailyPriceByUnderlying } from './types'

const TRADING_DAYS_PER_YEAR = 252

export interface AssetParameters {
  dailyMeanLogReturn?: number
  dailyVolatility?: number
  annualizedDrift: number
  annualizedVolatility: number
  realizedVolatility20D: number
  realizedVolatility60D: number
  maxDrawdown1Y: number
  ma20: number | null
  ma60: number | null
  ma120: number | null
  rsi14: number | null
  observations: number
  observationStart?: string
  observationEnd?: string
}

export interface EstimatedParameters {
  assets: Record<Underlying, AssetParameters>
  correlation: number
  priceBasis: 'adjusted-close-with-raw-close-fallback'
  estimationMethod?: 'historical-window' | 'house-view-weighted' | 'similar-regime-bootstrap'
  lookbackYears?: 1 | 3 | 5 | 10
  houseView?: import('./houseView').HouseViewMetadata
  regimeModel?: import('./regimeModel').SimilarRegimeMetadata
}

/**
 * Typed adaptation of report-summation's return, covariance and correlation
 * formulas. It intentionally uses adjusted close first for statistical inputs.
 */
export function estimateHistoricalParameters(prices: DailyPriceByUnderlying): EstimatedParameters {
  const samsung = returnSeries(prices.삼성전자)
  const hynix = returnSeries(prices.SK하이닉스)
  const aligned = alignReturnSeries(prices.삼성전자, prices.SK하이닉스)
  return {
    assets: {
      삼성전자: assetParameters(prices.삼성전자, samsung),
      SK하이닉스: assetParameters(prices.SK하이닉스, hynix),
    },
    correlation: correlation(aligned.left, aligned.right),
    priceBasis: 'adjusted-close-with-raw-close-fallback',
    estimationMethod: 'historical-window',
  }
}

export function valueForEstimation(price: DailyPrice): number {
  return price.adjustedClose ?? price.close
}

export function logReturns(history: readonly DailyPrice[]): number[] {
  return returnSeries(history).map((entry) => entry.returnValue)
}

function returnSeries(history: readonly DailyPrice[]) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  const result: Array<{ date: string; returnValue: number }> = []
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = valueForEstimation(sorted[index - 1])
    const current = valueForEstimation(sorted[index])
    if (previous > 0 && current > 0) result.push({ date: sorted[index].date, returnValue: Math.log(current / previous) })
  }
  return result
}

function assetParameters(history: readonly DailyPrice[], returns: Array<{ returnValue: number }>): AssetParameters {
  const values = returns.map((entry) => entry.returnValue)
  const dailyVariance = variance(values)
  const annualizedVolatility = Math.sqrt(dailyVariance * TRADING_DAYS_PER_YEAR)
  // Log-return mean estimates (mu - sigma²/2); convert to GBM's SDE drift mu.
  const annualizedDrift = mean(values) * TRADING_DAYS_PER_YEAR + annualizedVolatility ** 2 / 2
  const estimationPrices = history.map(valueForEstimation)
  return {
    dailyMeanLogReturn: mean(values),
    dailyVolatility: Math.sqrt(dailyVariance),
    annualizedDrift,
    annualizedVolatility,
    realizedVolatility20D: realizedVolatility(values, 20),
    realizedVolatility60D: realizedVolatility(values, 60),
    maxDrawdown1Y: maxDrawdown(estimationPrices.slice(-TRADING_DAYS_PER_YEAR)),
    ma20: movingAverage(estimationPrices, 20),
    ma60: movingAverage(estimationPrices, 60),
    ma120: movingAverage(estimationPrices, 120),
    rsi14: rsi(estimationPrices, 14),
    observations: values.length,
    observationStart: history[0]?.date,
    observationEnd: history.at(-1)?.date,
  }
}

function alignReturnSeries(leftHistory: readonly DailyPrice[], rightHistory: readonly DailyPrice[]) {
  const left = new Map(returnSeries(leftHistory).map((entry) => [entry.date, entry.returnValue]))
  const right = new Map(returnSeries(rightHistory).map((entry) => [entry.date, entry.returnValue]))
  const dates = [...left.keys()].filter((date) => right.has(date))
  return { left: dates.map((date) => left.get(date)!), right: dates.map((date) => right.get(date)!) }
}

export function covariance(left: readonly number[], right: readonly number[]): number {
  const count = Math.min(left.length, right.length)
  if (count < 2) return 0
  const l = left.slice(0, count)
  const r = right.slice(0, count)
  const leftMean = mean(l)
  const rightMean = mean(r)
  return l.reduce((sum, value, index) => sum + (value - leftMean) * (r[index] - rightMean), 0) / (count - 1)
}

export function correlation(left: readonly number[], right: readonly number[]): number {
  const leftStd = Math.sqrt(variance(left))
  const rightStd = Math.sqrt(variance(right))
  return leftStd === 0 || rightStd === 0 ? 0 : covariance(left, right) / (leftStd * rightStd)
}

function mean(values: readonly number[]): number { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }
function variance(values: readonly number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
}
function realizedVolatility(values: readonly number[], window: number): number {
  return values.length < window ? 0 : Math.sqrt(variance(values.slice(-window)) * TRADING_DAYS_PER_YEAR)
}
function movingAverage(values: readonly number[], window: number): number | null {
  return values.length < window ? null : mean(values.slice(-window))
}
function maxDrawdown(values: readonly number[]): number {
  let peak = -Infinity
  let drawdown = 0
  for (const value of values) { peak = Math.max(peak, value); if (peak > 0) drawdown = Math.max(drawdown, (peak - value) / peak) }
  return drawdown
}
function rsi(values: readonly number[], period: number): number | null {
  if (values.length <= period) return null
  const changes = values.slice(-period - 1).slice(1).map((value, index) => value - values[values.length - period - 1 + index])
  const gains = changes.filter((change) => change > 0)
  const losses = changes.filter((change) => change < 0).map(Math.abs)
  const averageGain = mean(gains) * gains.length / period
  const averageLoss = mean(losses) * losses.length / period
  if (averageLoss === 0) return 100
  return 100 - 100 / (1 + averageGain / averageLoss)
}
