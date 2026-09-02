import { calculatePayoff, type NormalizedPricePoint, type PayoffResult } from '../payoff'
import { addMonths } from '../payoff/calculatePayoff'
import type { ProductSpec, Underlying } from '../../products/types'
import { cholesky2x2, correlatedNormals } from './linearAlgebra'
import { createSeededRandom, standardNormal } from './random'
import { sampleRegimeReturnPath } from '../../marketData/regimeModel'
import type { ComparisonHorizonMonth, DistributionPoint, LossDistributionPoint, PathOutcomeCategory, PathResult, ProbabilityEstimate, SimulationResult, SimulationSamplePath, StructuredSimulationInput } from './types'

const TRADING_DAYS_PER_YEAR = 252
export const DEFAULT_SIMULATIONS = 50_000
export const DEFAULT_SEED = 42
const REPRESENTATIVE_CANDIDATES = 256

export function runStructuredProductSimulation(input: StructuredSimulationInput): SimulationResult {
  const simulationCount = input.simulationCount ?? DEFAULT_SIMULATIONS
  const seed = input.seed ?? DEFAULT_SEED
  if (!Number.isInteger(simulationCount) || simulationCount <= 0) throw new Error('simulationCount must be a positive integer.')
  const product = input.product
  const endDate = addMonths(product.initialReferenceDate, product.maturityMonths)
  const calendar = weekdayCalendar(input.analysisDate, endDate)
  const assumptions = resolveAssumptions(input)
  const factor = cholesky2x2(assumptions.correlation)
  const random = createSeededRandom(seed)
  const fixingSamples: Record<Underlying, number[]> = { 삼성전자: [], SK하이닉스: [] }
  const couponCounts = emptyCounts(product.productType === 'ELB' ? Array.from({ length: product.maturityMonths }, (_, index) => index + 1) : [])
  const couponConditionCounts = emptyCounts(product.productType === 'ELB' ? Array.from({ length: product.maturityMonths }, (_, index) => index + 1) : [])
  const earlyConditionCounts = emptyCounts(product.earlyRedemptions.map((condition) => condition.month))
  const earlyWorstOf = Object.fromEntries(product.earlyRedemptions.map((condition) => [condition.month, [] as number[]])) as Record<number, number[]>
  const pathResults: PathResult[] = []
  const samplePaths: SimulationSamplePath[] = []
  const candidates: Record<PathOutcomeCategory, SimulationSamplePath[]> = { EARLY_REDEMPTION: [], MATURITY_PROFIT: [], PRINCIPAL_LOSS: [] }
  let couponTotal = 0

  for (let pathId = 0; pathId < simulationCount; pathId += 1) {
    const generated = generateNormalizedPath(input, calendar, random, factor, assumptions)
    const payoff = calculatePayoff(product, { investmentAmount: input.investmentAmount, pricePath: generated.path, isChronological: true })
    const terminal = averageLastThreePrices(generated.path)
    const terminalRatio = { 삼성전자: terminal.삼성전자 / 100, SK하이닉스: terminal.SK하이닉스 / 100 }
    const terminalPrice = { 삼성전자: generated.initialFixing.삼성전자 * terminalRatio.삼성전자, SK하이닉스: generated.initialFixing.SK하이닉스 * terminalRatio.SK하이닉스 }
    const category = classifyPayoff(payoff)
    const pathResult: PathResult = {
      pathId,
      category,
      redemptionObservationIndex: payoff.earlyRedemptionMonth === undefined ? null : product.earlyRedemptions.findIndex((condition) => condition.month === payoff.earlyRedemptionMonth),
      redemptionMonth: payoff.earlyRedemptionMonth ?? product.maturityMonths,
      holdingDays: payoff.holdingDays,
      holdingYears: payoff.holdingDays / 365,
      realizedTotalReturn: payoff.totalReturn,
      realizedAnnualizedReturn: payoff.annualizedReturn,
      totalPayout: payoff.totalPayout,
      knockInOccurred: payoff.knockInOccurred,
      maturityWorstOfRatio: payoff.maturityWorstOfRatio ?? null,
      lossRate: payoff.lossRate,
      terminalUnderlyingRatio: terminalRatio,
      terminalUnderlyingPrice: terminalPrice,
      comparisonHorizons: comparisonHorizonSnapshots(product, generated.path, payoff),
    }
    pathResults.push(pathResult)
    fixingSamples.삼성전자.push(generated.initialFixing.삼성전자)
    fixingSamples.SK하이닉스.push(generated.initialFixing.SK하이닉스)
    couponTotal += payoff.couponCount
    payoff.couponPaidMonths.forEach((month) => { couponCounts[month] += 1 })
    collectConditionCounts(product, generated.path, couponConditionCounts, earlyConditionCounts)
    for (const condition of product.earlyRedemptions) { const point = observation(generated.path, addMonths(product.initialReferenceDate, condition.month)); earlyWorstOf[condition.month].push(Math.min(...product.underlyings.map((underlying) => requiredPrice(point.prices[underlying]))) / 100) }
    const sample: SimulationSamplePath = { pathId, initialFixing: generated.initialFixing, normalizedFixing: { 삼성전자: 100, SK하이닉스: 100 }, path: generated.path, payoff }
    if (samplePaths.length < (input.samplePathCount ?? 12)) samplePaths.push(sample)
    if (candidates[category].length < REPRESENTATIVE_CANDIDATES) candidates[category].push(sample)
  }

  const firstRedemptionCounts = Object.fromEntries(product.earlyRedemptions.map((condition) => [condition.month, pathResults.filter((path) => path.category === 'EARLY_REDEMPTION' && path.redemptionMonth === condition.month).length])) as Record<number, number>
  const early = probabilityMap(firstRedemptionCounts, simulationCount)
  const cumulativeEarly: Record<string, ProbabilityEstimate> = {}
  let cumulative = 0
  for (const month of product.earlyRedemptions.map((condition) => condition.month)) { cumulative += firstRedemptionCounts[month]; cumulativeEarly[String(month)] = probabilityEstimate(cumulative, simulationCount) }
  const earlyResults = pathResults.filter((path) => path.category === 'EARLY_REDEMPTION')
  const maturityProfitResults = pathResults.filter((path) => path.category === 'MATURITY_PROFIT')
  const lossResults = pathResults.filter((path) => path.category === 'PRINCIPAL_LOSS')
  const maturityReached = maturityProfitResults.length + lossResults.length
  const knockInCount = pathResults.filter((path) => path.knockInOccurred).length
  const realizedReturnDistribution = distribution(pathResults.map((path) => path.realizedTotalReturn))
  const conditionalLossDistribution = lossDistribution(lossResults.map((path) => path.lossRate))
  const terminalRatios = byUnderlying(pathResults, (path, underlying) => path.terminalUnderlyingRatio[underlying])
  const terminalPrices = byUnderlying(pathResults, (path, underlying) => path.terminalUnderlyingPrice[underlying])
  const result: SimulationResult = {
    productId: product.id,
    simulationCount,
    seed,
    analysisDate: input.analysisDate,
    initialFixing: { mode: input.analysisDate < product.initialReferenceDate ? 'simulated' : 'actual', ...summaryByUnderlying(fixingSamples) },
    initialFixingDistribution: fixingSamples,
    assumptions: { ...assumptions, tradingDaysPerYear: TRADING_DAYS_PER_YEAR, timeStep: 1 / TRADING_DAYS_PER_YEAR, futureSteps: calendar.filter((date) => date > input.analysisDate).length, priceBasis: 'raw-close-for-fixing-and-payoff', modelType: input.regimeBootstrap ? 'Similar-Regime Weighted Block Bootstrap' : 'Historical GBM', driftBasis: input.regimeBootstrap ? 'mixture-weighted-log-return' : 'historical-log-return' },
    estimatedParameters: input.estimatedParameters,
    redemptionStats: { early, cumulativeEarly, maturityReached: probabilityEstimate(maturityReached, simulationCount), maturityProfit: probabilityEstimate(maturityProfitResults.length, simulationCount) },
    outcomeStats: { earlyRedemption: probabilityEstimate(earlyResults.length, simulationCount), maturityProfit: probabilityEstimate(maturityProfitResults.length, simulationCount), principalLoss: probabilityEstimate(lossResults.length, simulationCount) },
    holdingPeriodStats: { meanDays: mean(pathResults.map((path) => path.holdingDays)) },
    returnStats: { expectedTotalReturn: mean(pathResults.map((path) => path.realizedTotalReturn)), expectedAnnualizedReturn: mean(pathResults.map((path) => path.realizedAnnualizedReturn)) },
    pathResults,
    realizedReturnDistribution,
    conditionalLossDistribution,
    barrierDiagnostics: { earlyObservation: Object.fromEntries(product.earlyRedemptions.map((condition) => { const values = earlyWorstOf[condition.month]; const below = values.filter((value) => value < condition.barrier).length; return [String(condition.month), { month: condition.month, barrier: condition.barrier, medianWorstOf: percentile(values, .5), p5WorstOf: percentile(values, .05), p95WorstOf: percentile(values, .95), belowBarrier: probabilityEstimate(below, simulationCount) }] })) },
    terminalPayoffDistribution: pathResults.map((path) => path.totalPayout / input.investmentAmount),
    terminalUnderlyingRatios: terminalRatios,
    terminalUnderlyingPrices: terminalPrices,
    samplePaths,
    representativePaths: {
      early: selectRepresentative(candidates.EARLY_REDEMPTION, earlyResults),
      maturityProfit: selectRepresentative(candidates.MATURITY_PROFIT, maturityProfitResults),
      principalLoss: selectRepresentative(candidates.PRINCIPAL_LOSS, lossResults),
    },
    warnings: input.analysisDate > product.initialReferenceDate && !input.observedRawHistory ? [`${product.initialReferenceDate} 이후 분석에는 이미 발생한 조건을 보존하기 위한 observedRawHistory가 필요합니다.`] : [],
    modelDiagnostics: createModelDiagnostics(input, assumptions, calendar),
  }
  if (product.productType === 'ELB') {
    result.couponStats = { monthly: probabilityMap(couponCounts, simulationCount), averageCouponPaymentProbability: couponTotal / (simulationCount * product.maturityMonths), expectedCouponCount: couponTotal / simulationCount, conditionByMonth: probabilityMap(couponConditionCounts, simulationCount), earlyConditionByMonth: probabilityMap(earlyConditionCounts, simulationCount) }
  } else {
    result.knockInStats = { touch: probabilityEstimate(knockInCount, simulationCount) }
    result.lossStats = { principalLoss: result.outcomeStats.principalLoss, averageLossRateWhenLoss: lossResults.length ? mean(lossResults.map((path) => path.lossRate)) : 0, averageLossRateAllPaths: mean(pathResults.map((path) => path.lossRate)) }
  }
  warnOnInvariantFailure(result, product)
  return result
}

export function validateSimulationInvariants(result: SimulationResult, product?: ProductSpec): string[] {
  const issues: string[] = []
  const earlyCount = result.outcomeStats.earlyRedemption.count
  const maturityProfitCount = result.outcomeStats.maturityProfit.count
  const lossCount = result.outcomeStats.principalLoss.count
  const firstEarlyCount = Object.values(result.redemptionStats.early).reduce((sum, stat) => sum + stat.count, 0)
  if (result.pathResults.length !== result.simulationCount) issues.push('canonical path result 수가 전체 시행 횟수와 다릅니다.')
  if (new Set(result.pathResults.map((path) => path.pathId)).size !== result.simulationCount) issues.push('pathId가 중복되었습니다.')
  if (earlyCount + maturityProfitCount + lossCount !== result.simulationCount) issues.push('세 배타적 상환 결과의 합이 전체 시행 횟수와 다릅니다.')
  if (firstEarlyCount !== earlyCount) issues.push('차수별 최초 조기상환 합계가 전체 조기상환 건수와 다릅니다.')
  if (firstEarlyCount + result.redemptionStats.maturityReached.count !== result.simulationCount) issues.push('최초 조기상환과 만기 도달 건수의 합이 전체 시행 횟수와 다릅니다.')
  if (result.redemptionStats.maturityReached.count !== maturityProfitCount + lossCount) issues.push('만기 도달 건수가 만기 정상상환과 원금손실의 합과 다릅니다.')
  if (result.knockInStats && lossCount > result.knockInStats.touch.count) issues.push('원금손실 건수가 낙인 발생 건수를 초과합니다.')
  let prior = 0
  for (const stat of Object.values(result.redemptionStats.cumulativeEarly)) { if (stat.count < prior) issues.push('누적 조기상환 건수가 감소했습니다.'); prior = stat.count }
  if (prior !== earlyCount) issues.push('마지막 누적 조기상환 건수가 전체 조기상환 건수와 다릅니다.')
  if (result.realizedReturnDistribution.reduce((sum, point) => sum + point.count, 0) !== result.simulationCount) issues.push('실현 총수익률 분포의 경로 수 합이 전체 시행 횟수와 다릅니다.')
  if (result.conditionalLossDistribution.reduce((sum, point) => sum + point.count, 0) !== lossCount) issues.push('조건부 손실률 분포의 경로 수 합이 원금손실 건수와 다릅니다.')
  if (product?.productType === 'ELB' && lossCount !== 0) issues.push('원금지급형 ELB에서 원금손실 경로가 발생했습니다.')
  const finitePathResult = result.pathResults.every((path) => [path.realizedTotalReturn, path.realizedAnnualizedReturn, path.totalPayout, path.lossRate, ...Object.values(path.terminalUnderlyingRatio), ...Object.values(path.terminalUnderlyingPrice)].every(Number.isFinite))
  if (!finitePathResult) issues.push('canonical path result에 NaN 또는 Infinity가 있습니다.')
  if (result.pathResults.some((path) => Object.values(path.terminalUnderlyingPrice).some((value) => value <= 0))) issues.push('GBM 기초자산 가격에 0 이하 값이 있습니다.')
  if (result.pathResults.some((path) => Object.values(path.comparisonHorizons).some((snapshot) => !snapshot || Object.values(snapshot.underlyingRatio).some((value) => !Number.isFinite(value) || value <= 0)))) issues.push('투자기간 비교 스냅샷에 유효하지 않은 가격비율이 있습니다.')
  if (product && result.pathResults.some((path) => [6, 12, 36].some((month) => month <= product.maturityMonths && !path.comparisonHorizons[month as ComparisonHorizonMonth]))) issues.push('상품 만기 이내의 투자기간 비교 스냅샷이 누락되었습니다.')
  if ([...result.samplePaths, ...Object.values(result.representativePaths).filter(Boolean) as SimulationSamplePath[]].some((sample) => sample.path.some((point) => Object.values(point.prices).some((value) => value === undefined || !Number.isFinite(value) || value <= 0)))) issues.push('표본 경로에 유효하지 않은 가격이 있습니다.')
  if ([...result.samplePaths, ...Object.values(result.representativePaths).filter(Boolean) as SimulationSamplePath[]].some((sample) => sample.path.some((point, index) => index > 0 && point.date <= sample.path[index - 1].date))) issues.push('표본 경로의 날짜가 오름차순이 아닙니다.')
  return [...new Set(issues)]
}

function warnOnInvariantFailure(result: SimulationResult, product: ProductSpec) { const issues = validateSimulationInvariants(result, product); if (issues.length) console.warn('[Monte Carlo invariant]', issues) }
function classifyPayoff(payoff: PayoffResult): PathOutcomeCategory { if (payoff.redemptionType === 'early') return 'EARLY_REDEMPTION'; return payoff.principalLossOccurred ? 'PRINCIPAL_LOSS' : 'MATURITY_PROFIT' }
function selectRepresentative(candidates: readonly SimulationSamplePath[], results: readonly PathResult[]) { if (!candidates.length || !results.length) return undefined; const metric = (path: PathResult) => path.category === 'EARLY_REDEMPTION' ? path.redemptionMonth : path.maturityWorstOfRatio ?? 1; const target = percentile(results.map(metric), .5); const byId = new Map(results.map((path) => [path.pathId, path])); return [...candidates].sort((left, right) => Math.abs(metric(byId.get(left.pathId)!) - target) - Math.abs(metric(byId.get(right.pathId)!) - target) || left.pathId - right.pathId)[0] }
function createModelDiagnostics(input: StructuredSimulationInput, assumptions: ReturnType<typeof resolveAssumptions>, calendar: readonly string[]): SimulationResult['modelDiagnostics'] { const assets = input.estimatedParameters.assets; return { observations: { 삼성전자: assets.삼성전자.observations, SK하이닉스: assets.SK하이닉스.observations }, parameterWarnings: parameterWarnings(input), reproducible: true, spot: input.analysisSpot, dailyMeanLogReturn: { 삼성전자: assets.삼성전자.dailyMeanLogReturn ?? (assets.삼성전자.annualizedDrift - assets.삼성전자.annualizedVolatility ** 2 / 2) / TRADING_DAYS_PER_YEAR, SK하이닉스: assets.SK하이닉스.dailyMeanLogReturn ?? (assets.SK하이닉스.annualizedDrift - assets.SK하이닉스.annualizedVolatility ** 2 / 2) / TRADING_DAYS_PER_YEAR }, dailyVolatility: { 삼성전자: assets.삼성전자.dailyVolatility ?? assets.삼성전자.annualizedVolatility / Math.sqrt(TRADING_DAYS_PER_YEAR), SK하이닉스: assets.SK하이닉스.dailyVolatility ?? assets.SK하이닉스.annualizedVolatility / Math.sqrt(TRADING_DAYS_PER_YEAR) }, annualizedDrift: assumptions.drift, annualizedVolatility: assumptions.volatility, observationPeriod: { 삼성전자: { from: assets.삼성전자.observationStart, to: assets.삼성전자.observationEnd }, SK하이닉스: { from: assets.SK하이닉스.observationStart, to: assets.SK하이닉스.observationEnd } }, correlationMatrix: [[1, assumptions.correlation], [assumptions.correlation, 1]], timeStep: 1 / TRADING_DAYS_PER_YEAR, futureSteps: calendar.filter((date) => date > input.analysisDate).length, modelType: input.regimeBootstrap ? 'Similar-Regime Weighted Block Bootstrap' : 'Historical GBM' } }
function parameterWarnings(input: StructuredSimulationInput) { const warnings: string[] = []; for (const underlying of ['삼성전자', 'SK하이닉스'] as const) { const asset = input.estimatedParameters.assets[underlying]; if (asset.observations < 120) warnings.push(`${underlying}의 추정 표본이 120 거래일 미만입니다.`); if (Math.abs(asset.annualizedDrift) > .5) warnings.push(`${underlying}의 역사적 연 drift가 ${(asset.annualizedDrift * 100).toFixed(1)}%로 높아 장기 가격 분포가 크게 우상향할 수 있습니다.`) } if (Math.abs(input.estimatedParameters.correlation) > .95) warnings.push('추정 상관계수가 매우 높아 두 기초자산이 유사하게 움직인다는 가정에 민감합니다.'); if (input.analysisDate < input.product.initialReferenceDate) warnings.push('최초기준가격 결정 전이므로 기준일까지의 가격도 경로별로 시뮬레이션한 뒤 각각 100으로 정규화합니다.'); return warnings }

function generateNormalizedPath(input: StructuredSimulationInput, calendar: readonly string[], random: () => number, factor: readonly [number, number, number, number], assumptions: ReturnType<typeof resolveAssumptions>) {
  const fixingDate = input.product.initialReferenceDate
  const fixingKnown = input.analysisDate >= fixingDate
  if (fixingKnown && !input.observedRawHistory) throw new Error('observedRawHistory is required on or after the initial fixing date.')
  let samsung = input.analysisSpot.삼성전자 * (1 + assumptions.initialShock)
  let hynix = input.analysisSpot.SK하이닉스 * (1 + assumptions.initialShock)
  let initialFixing: Record<Underlying, number> | undefined
  const path: NormalizedPricePoint[] = []
  const sampledReturns = input.regimeBootstrap ? sampleRegimeReturnPath(input.regimeBootstrap, calendar.length, random) : undefined
  let sampledReturnIndex = 0
  if (fixingKnown) { const observed = normalizeObservedHistory(input.product, input.observedRawHistory!, input.analysisDate); path.push(...observed.path); initialFixing = observed.initialFixing; samsung = observed.lastRaw.삼성전자 * (1 + assumptions.initialShock); hynix = observed.lastRaw.SK하이닉스 * (1 + assumptions.initialShock) }
  const startIndex = Math.max(0, calendar.findIndex((date) => date >= input.analysisDate))
  for (let index = startIndex; index < calendar.length; index += 1) {
    const date = calendar[index]
    if (fixingKnown && date <= input.analysisDate) continue
    if (date !== input.analysisDate || fixingKnown) {
      if (sampledReturns && input.regimeBootstrap) {
        const pair = adjustedBootstrapReturn(sampledReturns[sampledReturnIndex++], input, assumptions)
        samsung *= Math.exp(pair.삼성전자); hynix *= Math.exp(pair.SK하이닉스)
      } else {
        const [zSamsung, zHynix] = correlatedNormals(standardNormal(random), standardNormal(random), factor)
        samsung = gbmStep(samsung, assumptions.drift.삼성전자, assumptions.volatility.삼성전자, zSamsung); hynix = gbmStep(hynix, assumptions.drift.SK하이닉스, assumptions.volatility.SK하이닉스, zHynix)
      }
    }
    if (!initialFixing && date >= fixingDate) initialFixing = { 삼성전자: samsung, SK하이닉스: hynix }
    if (initialFixing && date >= fixingDate) path.push({ date, prices: { 삼성전자: samsung / initialFixing.삼성전자 * 100, SK하이닉스: hynix / initialFixing.SK하이닉스 * 100 } })
  }
  if (!initialFixing) throw new Error('Unable to create the initial fixing date in the simulation calendar.')
  return { initialFixing, path }
}
function adjustedBootstrapReturn(pair: Record<Underlying, number>, input: StructuredSimulationInput, assumptions: ReturnType<typeof resolveAssumptions>) {
  const model = input.regimeBootstrap!
  const overrides = input.overrides ?? {}
  const source = model.sourceMoments
  let zSamsung = (pair.삼성전자 - source.mean.삼성전자) / Math.max(source.dailyVolatility.삼성전자, Number.EPSILON)
  let zHynix = (pair.SK하이닉스 - source.mean.SK하이닉스) / Math.max(source.dailyVolatility.SK하이닉스, Number.EPSILON)
  if (overrides.correlation !== undefined) {
    const sourceResidual = (zHynix - source.correlation * zSamsung) / Math.sqrt(Math.max(1 - source.correlation ** 2, Number.EPSILON))
    zHynix = overrides.correlation * zSamsung + Math.sqrt(Math.max(1 - overrides.correlation ** 2, 0)) * sourceResidual
  }
  const targetMean = (underlying: Underlying) => overrides.drift === undefined ? source.mean[underlying] : (assumptions.drift[underlying] - assumptions.volatility[underlying] ** 2 / 2) / TRADING_DAYS_PER_YEAR
  const targetVol = (underlying: Underlying) => overrides.volatility === undefined && overrides.volatilityMultiplier === undefined ? source.dailyVolatility[underlying] : assumptions.volatility[underlying] / Math.sqrt(TRADING_DAYS_PER_YEAR)
  return { 삼성전자: targetMean('삼성전자') + zSamsung * targetVol('삼성전자'), SK하이닉스: targetMean('SK하이닉스') + zHynix * targetVol('SK하이닉스') }
}
function gbmStep(spot: number, annualDrift: number, annualVolatility: number, normal: number) { const dt = 1 / TRADING_DAYS_PER_YEAR; return spot * Math.exp((annualDrift - annualVolatility ** 2 / 2) * dt + annualVolatility * Math.sqrt(dt) * normal) }
function normalizeObservedHistory(product: ProductSpec, history: NonNullable<StructuredSimulationInput['observedRawHistory']>, analysisDate: string) { const byDate = new Map<string, Record<Underlying, number>>(); for (const underlying of ['삼성전자', 'SK하이닉스'] as const) for (const point of history[underlying]) { if (point.date < product.initialReferenceDate || point.date > analysisDate) continue; const prices = byDate.get(point.date) ?? {} as Record<Underlying, number>; prices[underlying] = point.close; byDate.set(point.date, prices) } const rows = [...byDate.entries()].filter(([, prices]) => (['삼성전자', 'SK하이닉스'] as const).every((underlying) => prices[underlying] > 0)).sort(([left], [right]) => left.localeCompare(right)); const fixing = rows.find(([date]) => date === product.initialReferenceDate)?.[1]; if (!fixing) throw new Error(`observedRawHistory must contain raw closes for ${product.initialReferenceDate}.`); const last = rows.at(-1)?.[1]; if (!last) throw new Error('observedRawHistory contains no complete price observations.'); return { initialFixing: fixing, lastRaw: last, path: rows.map(([date, prices]) => ({ date, prices: { 삼성전자: prices.삼성전자 / fixing.삼성전자 * 100, SK하이닉스: prices.SK하이닉스 / fixing.SK하이닉스 * 100 } })) } }
function resolveAssumptions(input: StructuredSimulationInput) { const overrides = input.overrides ?? {}; const volatilityMultiplier = overrides.volatilityMultiplier ?? 1; return { drift: { 삼성전자: overrides.drift ?? input.estimatedParameters.assets.삼성전자.annualizedDrift, SK하이닉스: overrides.drift ?? input.estimatedParameters.assets.SK하이닉스.annualizedDrift }, volatility: { 삼성전자: (overrides.volatility ?? input.estimatedParameters.assets.삼성전자.annualizedVolatility) * volatilityMultiplier, SK하이닉스: (overrides.volatility ?? input.estimatedParameters.assets.SK하이닉스.annualizedVolatility) * volatilityMultiplier }, correlation: overrides.correlation ?? input.estimatedParameters.correlation, initialShock: overrides.initialShock ?? 0, volatilityMultiplier } }
function collectConditionCounts(product: ProductSpec, path: readonly NormalizedPricePoint[], coupons: Record<number, number>, early: Record<number, number>) { if (product.productType === 'ELB') for (let month = 1; month <= product.maturityMonths; month += 1) if (allAtLeast(observation(path, addMonths(product.initialReferenceDate, month)), product.underlyings, product.monthlyCoupon.barrier)) coupons[month] += 1; for (const condition of product.earlyRedemptions) if (allAtLeast(observation(path, addMonths(product.initialReferenceDate, condition.month)), product.underlyings, condition.barrier)) early[condition.month] += 1 }
function comparisonHorizonSnapshots(product: ProductSpec, path: readonly NormalizedPricePoint[], payoff: PayoffResult): PathResult['comparisonHorizons'] {
  const snapshots: PathResult['comparisonHorizons'] = {}
  for (const month of [6, 12, 36] as const) {
    if (month > product.maturityMonths) continue
    const point = observation(path, addMonths(product.initialReferenceDate, month))
    const matured = month === product.maturityMonths
    const redeemed = payoff.redemptionType === 'early' && (payoff.earlyRedemptionMonth ?? Infinity) <= month
    snapshots[month as ComparisonHorizonMonth] = {
      month,
      underlyingRatio: {
        삼성전자: requiredPrice(point.prices.삼성전자) / 100,
        SK하이닉스: requiredPrice(point.prices.SK하이닉스) / 100,
      },
      productStatus: matured ? 'matured' : redeemed ? 'redeemed' : 'active',
      ...(matured || redeemed ? { realizedTotalReturn: payoff.totalReturn, principalLossOccurred: payoff.principalLossOccurred } : {}),
    }
  }
  return snapshots
}
function observation(path: readonly NormalizedPricePoint[], scheduledDate: string) { const exact = path.find((point) => point.date === scheduledDate); if (exact) return exact; const point = path.filter((candidate) => candidate.date < scheduledDate).at(-1); if (!point) throw new Error(`Missing simulated observation for ${scheduledDate}.`); return point }
function allAtLeast(point: NormalizedPricePoint, underlyings: readonly Underlying[], barrier: number) { return underlyings.every((underlying) => (point.prices[underlying] ?? -Infinity) >= barrier * 100) }
function weekdayCalendar(from: string, to: string) { const dates: string[] = []; const cursor = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`); while (cursor <= end) { if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) dates.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1) } return dates }
function emptyCounts(keys: readonly number[]) { return Object.fromEntries(keys.map((key) => [key, 0])) as Record<number, number> }
function probabilityMap(counts: Record<number, number>, samples: number) { return Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, probabilityEstimate(count, samples)])) }
function probabilityEstimate(count: number, samples: number): ProbabilityEstimate { const probability = count / samples; const z = 1.96; const denominator = 1 + z ** 2 / samples; const center = (probability + z ** 2 / (2 * samples)) / denominator; const margin = z * Math.sqrt(probability * (1 - probability) / samples + z ** 2 / (4 * samples ** 2)) / denominator; return { probability, lower95: Math.max(0, center - margin), upper95: Math.min(1, center + margin), count, samples } }
function distribution(values: readonly number[]): DistributionPoint[] { const counts = new Map<number, number>(); values.forEach((value) => { const rounded = Math.round(value * 1000) / 1000; counts.set(rounded, (counts.get(rounded) ?? 0) + 1) }); return [...counts.entries()].sort(([left], [right]) => left - right).map(([value, count]) => ({ value, count, probability: count / values.length })) }
function lossDistribution(values: readonly number[]): LossDistributionPoint[] { const boundaries = [0, .2, .4, .6, .8, 1]; return boundaries.slice(0, -1).map((lowerInclusive, index) => { const upperInclusive = boundaries[index + 1]; const upperExclusive = index < boundaries.length - 2; const count = values.filter((value) => value >= lowerInclusive && (upperExclusive ? value < upperInclusive : value <= upperInclusive)).length; return { lowerInclusive, upperInclusive, upperExclusive, count, probability: values.length ? count / values.length : 0 } }) }
function byUnderlying(results: readonly PathResult[], selector: (path: PathResult, underlying: Underlying) => number): Record<Underlying, number[]> { return { 삼성전자: results.map((path) => selector(path, '삼성전자')), SK하이닉스: results.map((path) => selector(path, 'SK하이닉스')) } }
function requiredPrice(value: number | undefined) { if (value === undefined || !Number.isFinite(value) || value <= 0) throw new Error('Generated terminal price is invalid.'); return value }
function averageLastThreePrices(path: readonly NormalizedPricePoint[]): Record<Underlying, number> { const points = path.slice(-3); if (points.length !== 3) throw new Error('Maturity price distribution requires three final observations.'); return { 삼성전자: mean(points.map((point) => requiredPrice(point.prices.삼성전자))), SK하이닉스: mean(points.map((point) => requiredPrice(point.prices.SK하이닉스))) } }
function mean(values: readonly number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }
function percentile(values: readonly number[], probability: number) { const sorted = [...values].sort((left, right) => left - right); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * probability))] ?? 0 }
function summaryByUnderlying(values: Record<Underlying, number[]>) { return { mean: { 삼성전자: mean(values.삼성전자), SK하이닉스: mean(values.SK하이닉스) }, median: { 삼성전자: percentile(values.삼성전자, .5), SK하이닉스: percentile(values.SK하이닉스, .5) }, p5: { 삼성전자: percentile(values.삼성전자, .05), SK하이닉스: percentile(values.SK하이닉스, .05) }, p95: { 삼성전자: percentile(values.삼성전자, .95), SK하이닉스: percentile(values.SK하이닉스, .95) } } }
