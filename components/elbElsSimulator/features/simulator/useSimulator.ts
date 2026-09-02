import { useEffect, useRef, useState } from 'react'
import { runStructuredProductSimulation, type MonteCarloOverrides, type SimulationResult } from '../../engines/monteCarlo'
import { buildSimilarRegimeModel, createYoungCreatorYahooProvider, estimateHistoricalParameters, type DailyPriceByUnderlying, type EstimatedParameters, type RegimeBootstrapModel } from '../../marketData'
import { getProductSpec } from '../../products/products'
import type { ProductSpec, Underlying } from '../../products/types'

export type SensitivityModel = 'recent-1' | 'recent-3' | 'recent-5'
export interface SimulatorSettings {
  investmentAmount?: number; simulationCount?: 20_000 | 50_000 | 100_000; seed?: number
  overrides: MonteCarloOverrides
}

export const defaultSettings: SimulatorSettings = { simulationCount: 50_000, seed: 42, overrides: {} }
const COMPARISON_SIMULATION_LIMIT = 5_000
const SENSITIVITY_SIMULATION_LIMIT = 3_000

interface SimulationContext {
  investmentAmount: number
  analysisDate: string
  spot: Record<Underlying, number>
  parameters: EstimatedParameters
  regimeBootstrap?: RegimeBootstrapModel
  simulationCount: 20_000 | 50_000 | 100_000
  seed: number
  overrides: MonteCarloOverrides
  raw: DailyPriceByUnderlying
}

export function useSimulator(product: ProductSpec | undefined, settings: SimulatorSettings, detailProduct = product) {
  const [result, setResult] = useState<SimulationResult>()
  const [market, setMarket] = useState<DailyPriceByUnderlying>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [comparisonLoading, setComparisonLoading] = useState(false)
  const [comparisonResults, setComparisonResults] = useState<Partial<Record<ProductSpec['id'], SimulationResult>>>({})
  const [sensitivityResults, setSensitivityResults] = useState<Partial<Record<SensitivityModel, SimulationResult>>>({})
  const [detailMarket, setDetailMarket] = useState<DailyPriceByUnderlying>()
  const contextRef = useRef<SimulationContext | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!detailProduct) {
        if (!cancelled) setDetailMarket(undefined)
        return
      }
      try {
        const provider = createYoungCreatorYahooProvider()
        const to = new Date().toISOString().slice(0, 10); const fromDate = new Date(); fromDate.setFullYear(fromDate.getFullYear() - 1); const from = fromDate.toISOString().slice(0, 10)
        const histories = await Promise.all((['삼성전자', 'SK하이닉스'] as Underlying[]).map((underlying) => provider.getDailyPrices(detailProduct.tickerByUnderlying[underlying]!, from, to)))
        if (!cancelled) setDetailMarket({ 삼성전자: histories[0], SK하이닉스: histories[1] })
      } catch { if (!cancelled) setDetailMarket(undefined) }
    }
    void load(); return () => { cancelled = true }
  }, [detailProduct])
  useEffect(() => {
    setResult(undefined)
    setMarket(undefined)
    setError(undefined)
    setComparisonResults({})
    setSensitivityResults({})
    contextRef.current = undefined
  }, [product?.id])
  const run = async (overrides = settings.overrides) => {
    setLoading(true); setError(undefined)
    try {
      if (!product) throw new Error('상품을 선택하세요.')
      if (!settings.investmentAmount || !settings.simulationCount || settings.seed === undefined) throw new Error('투자금액과 시뮬레이션 횟수를 입력하세요.')
      const provider = createYoungCreatorYahooProvider()
      const today = new Date().toISOString().slice(0, 10)
      const from = '2015-01-01'
      const histories = await Promise.all((['삼성전자', 'SK하이닉스'] as Underlying[]).map((underlying) => provider.getDailyPrices(product.tickerByUnderlying[underlying]!, product.initialReferenceDate < from ? product.initialReferenceDate : from, today)))
      const raw: DailyPriceByUnderlying = { 삼성전자: histories[0], SK하이닉스: histories[1] }
      const estimation: DailyPriceByUnderlying = {
        삼성전자: raw.삼성전자.filter((point) => point.date >= from), SK하이닉스: raw.SK하이닉스.filter((point) => point.date >= from),
      }
      if (estimation.삼성전자.length < 30 || estimation.SK하이닉스.length < 30) throw new Error('파라미터 추정에 필요한 공통 시세가 충분하지 않습니다.')
      const latestCommonDate = commonLatestDate(raw)
      const spot = { 삼성전자: closeOnOrBefore(raw.삼성전자, latestCommonDate), SK하이닉스: closeOnOrBefore(raw.SK하이닉스, latestCommonDate) }
      const regime = buildSimilarRegimeModel(estimation)
      const parameters = regime.estimatedParameters
      const context: SimulationContext = { investmentAmount: settings.investmentAmount, analysisDate: latestCommonDate, spot, parameters, regimeBootstrap: regime.model, simulationCount: settings.simulationCount, seed: settings.seed, overrides, raw }
      contextRef.current = context
      const next = simulateProduct(product, context)
      setMarket(raw); setResult(next)
      const defaults = ['ELB2951', 'ELS31382'] as const
      const comparisons: Partial<Record<ProductSpec['id'], SimulationResult>> = { [product.id]: next }
      for (const id of defaults) comparisons[id] = id === product.id ? next : simulateProduct(getProductSpec(id), context, Math.min(context.simulationCount, COMPARISON_SIMULATION_LIMIT))
      setComparisonResults(comparisons)
      const sensitivities: Partial<Record<SensitivityModel, SimulationResult>> = {}
      for (const years of [1, 3, 5] as const) {
        const historicalPrices = sliceYears(estimation, latestCommonDate, years)
        const historicalParameters = { ...estimateHistoricalParameters(historicalPrices), lookbackYears: years as 1 | 3 | 5 }
        sensitivities[`recent-${years}`] = simulateProduct(product, { ...context, parameters: historicalParameters, regimeBootstrap: undefined }, Math.min(context.simulationCount, SENSITIVITY_SIMULATION_LIMIT))
      }
      setSensitivityResults(sensitivities)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '알 수 없는 오류가 발생했습니다.') }
    finally { setLoading(false) }
  }
  const ensureComparisonProduct = async (id: ProductSpec['id']) => {
    if (comparisonResults[id]) return
    const context = contextRef.current
    if (!context) return
    setComparisonLoading(true)
    try { const next = simulateProduct(getProductSpec(id), context, Math.min(context.simulationCount, COMPARISON_SIMULATION_LIMIT)); setComparisonResults((current) => ({ ...current, [id]: next })) }
    finally { setComparisonLoading(false) }
  }
  return { result, market, detailMarket, error, loading, comparisonLoading, comparisonResults, sensitivityResults, ensureComparisonProduct, run }
}

function simulateProduct(product: ProductSpec, context: SimulationContext, simulationCount: number = context.simulationCount) { return runStructuredProductSimulation({ product, investmentAmount: context.investmentAmount, analysisDate: context.analysisDate, analysisSpot: context.spot, estimatedParameters: context.parameters, regimeBootstrap: context.regimeBootstrap, simulationCount, seed: context.seed, overrides: context.overrides, observedRawHistory: context.raw }) }

function commonLatestDate(prices: DailyPriceByUnderlying) {
  const samsung = new Set(prices.삼성전자.map((point) => point.date)); const shared = prices.SK하이닉스.map((point) => point.date).filter((date) => samsung.has(date)).sort()
  if (!shared.length) throw new Error('두 기초자산의 공통 거래일을 찾을 수 없습니다.')
  return shared.at(-1)!
}
function closeOnOrBefore(history: DailyPriceByUnderlying[Underlying], date: string) { const item = history.filter((point) => point.date <= date).at(-1); if (!item) throw new Error(`${date}의 종가를 찾을 수 없습니다.`); return item.close }
function sliceYears(prices: DailyPriceByUnderlying, end: string, years: number): DailyPriceByUnderlying { const from = new Date(`${end}T00:00:00Z`); from.setUTCFullYear(from.getUTCFullYear() - years); const start = from.toISOString().slice(0, 10); return { 삼성전자: prices.삼성전자.filter((point) => point.date >= start), SK하이닉스: prices.SK하이닉스.filter((point) => point.date >= start) } }
