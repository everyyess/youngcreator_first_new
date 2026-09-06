import type { Underlying } from '../products/types'
import { createSeededRandom } from '../engines/monteCarlo/random'
import { estimateHistoricalParameters, valueForEstimation, type AssetParameters, type EstimatedParameters } from './statistics'
import type { DailyPrice, DailyPriceByUnderlying } from './types'

const TRADING_DAYS = 252
const MOMENTUM_HORIZONS = [20, 60, 120] as const

export type RegimeComponent = 'similarRegime' | 'recentMarket' | 'tailHistory'
export type RegimeFeatureKey =
  | 'samsungMomentum20' | 'hynixMomentum20'
  | 'samsungMomentum60' | 'hynixMomentum60'
  | 'samsungMomentum120' | 'hynixMomentum120'
  | 'samsungVolatility' | 'hynixVolatility'
  | 'samsungDrawdown' | 'hynixDrawdown' | 'correlation'

export interface SimilarRegimeConfig {
  currentWindows: readonly number[]
  historicalWindows: readonly number[]
  normalizedPathPoints: number
  blockLength: number
  similarityLambda: number
  maxAnalogEpisodes: number
  analogClusterGapDays: number
  maxEpisodeWeight: number
  warpBounds: readonly [number, number]
  warpUncertainty: number
  recentMarketDays: number
  tailPercentile: number
  candidateRegimes: readonly { name: string; start: string; end: string }[]
  featureWeights: Readonly<Record<RegimeFeatureKey, number>>
  pathShapeWeight: number
  mixtureWeights: Readonly<Record<RegimeComponent, number>>
}

export interface RegimeFeatures {
  momentum: Record<Underlying, number>
  momentumByHorizon: Record<20 | 60 | 120, Record<Underlying, number>>
  annualizedVolatility: Record<Underlying, number>
  drawdown: Record<Underlying, number>
  correlation: number
  normalizedPath: Record<Underlying, readonly number[]>
}

export interface SimilarRegimeMatch {
  start: string
  end: string
  currentWindowDays: number
  historicalWindowDays: number
  timeWarpRatio: number
  similarityScore: number
  normalizedWeight: number
  houseViewCandidate: string
  continuationStart: string
  continuationEnd: string
  continuationPath: Record<Underlying, readonly number[]>
}

export interface SimilarRegimeMetadata {
  methodology: 'multi-horizon-analog-continuation-bootstrap'
  config: SimilarRegimeConfig
  currentFeatures: RegimeFeatures
  topSimilarRegimes: readonly SimilarRegimeMatch[]
  normalizedComponentWeights: Record<RegimeComponent, number>
  componentBlockCounts: Record<RegimeComponent, number>
  sourcePeriod: { from: string; to: string }
  featureScaling: 'median-iqr-robust-z-score'
  similarityFormula: 'exp(-lambda * weighted-feature-and-path-distance)'
  jointReturnSampling: true
}

export interface RegimeBootstrapModel {
  config: SimilarRegimeConfig
  metadata: SimilarRegimeMetadata
  blocks: readonly RegimeReturnBlock[]
  analogEpisodes: readonly AnalogEpisode[]
  cumulativeWeights: Record<RegimeComponent, readonly number[]>
  sourceMoments: { mean: Record<Underlying, number>; dailyVolatility: Record<Underlying, number>; correlation: number }
}

export interface RegimeModelBuildResult { model: RegimeBootstrapModel; estimatedParameters: EstimatedParameters }

export interface RegimeBacktestSummary {
  evaluations: number
  barrier3MPredictedRate: number
  barrier3MObservedRate: number
  barrier3MCalibrationBias: number
  barrier3MCalibrationError: number
  barrier6MPredictedRate: number
  barrier6MObservedRate: number
  barrier6MCalibrationBias: number
  barrier6MCalibrationError: number
  knockInPredictedRate: number
  knockInObservedRate: number
  knockInCalibrationBias: number
  knockInCalibrationError: number
  drawdownDistributionCoverage: number
  jointDownsidePredictedFrequency: number
  jointDownsideObservedFrequency: number
  jointDownsideCalibrationError: number
  directionalAccuracy: number
  volatilityCalibrationRatio: Record<Underlying, number>
}

export const SIMILAR_REGIME_CONFIG: SimilarRegimeConfig = {
  currentWindows: [40, 60, 90, 120], historicalWindows: [40, 60, 90, 120], normalizedPathPoints: 25,
  blockLength: 10, similarityLambda: 0.85,
  maxAnalogEpisodes: 8, analogClusterGapDays: 30, maxEpisodeWeight: 0.25,
  warpBounds: [0.5, 2], warpUncertainty: 0.15,
  recentMarketDays: 252, tailPercentile: 0.85,
  candidateRegimes: [
    { name: 'House View 후보 2016–2018', start: '2016-01-01', end: '2018-12-31' },
    { name: 'House View 후보 2020–2022', start: '2020-01-01', end: '2022-12-31' },
  ],
  featureWeights: {
    samsungMomentum20: 0.05, hynixMomentum20: 0.05,
    samsungMomentum60: 0.075, hynixMomentum60: 0.075,
    samsungMomentum120: 0.075, hynixMomentum120: 0.075,
    samsungVolatility: 0.10, hynixVolatility: 0.10,
    samsungDrawdown: 0.075, hynixDrawdown: 0.075, correlation: 0.10,
  },
  pathShapeWeight: 0.15,
  mixtureWeights: { similarRegime: 0.65, recentMarket: 0.20, tailHistory: 0.15 },
}

type PairedReturn = { date: string; 삼성전자: number; SK하이닉스: number }
type RegimeReturnBlock = { start: string; end: string; returns: readonly PairedReturn[]; tailScore: number }
type AnalogCandidate = { startIndex: number; endIndex: number; currentWindowDays: number; historicalWindowDays: number; warpRatio: number; features: RegimeFeatures; similarity: number; candidate: string; pathDistance: number }
type AnalogEpisode = AnalogCandidate & { continuation: readonly PairedReturn[]; weight: number }
type WeightedObservation = { value: Record<Underlying, number>; weight: number }

export function buildSimilarRegimeModel(prices: DailyPriceByUnderlying, config: SimilarRegimeConfig = SIMILAR_REGIME_CONFIG): RegimeModelBuildResult {
  validateConfig(config)
  const paired = alignedReturns(prices)
  const maximumWindow = Math.max(120, ...config.currentWindows, ...config.historicalWindows)
  if (paired.length < maximumWindow + config.blockLength * 3) throw new Error('유사국면 탐색에 필요한 공통 가격 이력이 부족합니다.')
  const currentFeatures = featuresAt(paired, paired.length - 1, Math.max(...config.currentWindows), config.normalizedPathPoints)
  const candidates = createAnalogCandidates(paired, currentFeatures, config)
  const selected = selectClusteredEpisodes(candidates, paired, config)
  if (selected.length < Math.min(4, config.maxAnalogEpisodes)) throw new Error('겹침을 제거한 House View analog episode가 충분하지 않습니다.')
  const cappedAnalogWeights = cappedNormalize(selected.map((episode) => episode.similarity), config.maxEpisodeWeight)
  const analogEpisodes: AnalogEpisode[] = selected.map((episode, index) => ({ ...episode, continuation: paired.slice(episode.endIndex + 1), weight: cappedAnalogWeights[index] }))

  const blocks = createBlocks(paired, config.blockLength)
  const tailThreshold = quantile(blocks.map((block) => block.tailScore), config.tailPercentile)
  const recentStartDate = paired[Math.max(0, paired.length - config.recentMarketDays)]?.date ?? paired[0].date
  const recentWeights = normalize(blocks.map((block) => block.start >= recentStartDate ? 1 : 0))
  const tailWeights = normalize(blocks.map((block) => block.tailScore >= tailThreshold ? Math.max(block.tailScore, Number.EPSILON) : 0))
  const moments = weightedMoments(effectiveObservations(analogEpisodes, blocks, recentWeights, tailWeights, config))
  const base = estimateHistoricalParameters(prices)
  const estimatedParameters: EstimatedParameters = {
    assets: { 삼성전자: weightedAsset(base.assets.삼성전자, moments, '삼성전자', paired), SK하이닉스: weightedAsset(base.assets.SK하이닉스, moments, 'SK하이닉스', paired) },
    correlation: moments.correlation, priceBasis: 'adjusted-close-with-raw-close-fallback', estimationMethod: 'similar-regime-bootstrap',
  }
  const maximumSimilarity = Math.max(...analogEpisodes.map((episode) => episode.similarity), Number.EPSILON)
  const topSimilarRegimes: SimilarRegimeMatch[] = analogEpisodes.map((episode) => {
    const continuationSample = episode.continuation.slice(0, 60)
    return {
      start: paired[episode.startIndex].date, end: paired[episode.endIndex].date,
      currentWindowDays: episode.currentWindowDays, historicalWindowDays: episode.historicalWindowDays, timeWarpRatio: episode.warpRatio,
      similarityScore: episode.similarity / maximumSimilarity * 100, normalizedWeight: episode.weight, houseViewCandidate: episode.candidate,
      continuationStart: episode.continuation[0]?.date ?? paired[episode.endIndex].date,
      continuationEnd: continuationSample.at(-1)?.date ?? episode.continuation[0]?.date ?? paired[episode.endIndex].date,
      continuationPath: normalizedContinuation(continuationSample, config.normalizedPathPoints),
    }
  })
  const metadata: SimilarRegimeMetadata = {
    methodology: 'multi-horizon-analog-continuation-bootstrap', config, currentFeatures, topSimilarRegimes,
    normalizedComponentWeights: { ...config.mixtureWeights },
    componentBlockCounts: { similarRegime: analogEpisodes.length, recentMarket: recentWeights.filter((weight) => weight > 0).length, tailHistory: tailWeights.filter((weight) => weight > 0).length },
    sourcePeriod: { from: paired[0].date, to: paired.at(-1)!.date }, featureScaling: 'median-iqr-robust-z-score', similarityFormula: 'exp(-lambda * weighted-feature-and-path-distance)', jointReturnSampling: true,
  }
  estimatedParameters.regimeModel = metadata
  return { estimatedParameters, model: { config, metadata, blocks, analogEpisodes, cumulativeWeights: { similarRegime: cumulative(cappedAnalogWeights), recentMarket: cumulative(recentWeights), tailHistory: cumulative(tailWeights) }, sourceMoments: { mean: moments.mean, dailyVolatility: { 삼성전자: Math.sqrt(moments.variance.삼성전자), SK하이닉스: Math.sqrt(moments.variance.SK하이닉스) }, correlation: moments.correlation } } }
}

export function sampleRegimeReturnPath(model: RegimeBootstrapModel, steps: number, random: () => number): Array<Record<Underlying, number>> {
  const output: Array<Record<Underlying, number>> = []
  while (output.length < steps) {
    const component = sampleComponent(model.config.mixtureWeights, random())
    if (component === 'similarRegime') {
      const episode = model.analogEpisodes[sampleCumulative(model.cumulativeWeights.similarRegime, random())]
      const uncertainty = 1 + (random() * 2 - 1) * model.config.warpUncertainty
      const warp = clamp(episode.warpRatio * uncertainty, model.config.warpBounds[0], model.config.warpBounds[1])
      const sourceNeeded = Math.ceil(model.config.blockLength * warp) + 1
      const maxOffset = Math.max(0, episode.continuation.length - sourceNeeded)
      const offset = Math.floor(random() * (maxOffset + 1))
      output.push(...warpReturns(episode.continuation.slice(offset, offset + sourceNeeded), model.config.blockLength, warp))
    } else {
      const block = model.blocks[sampleCumulative(model.cumulativeWeights[component], random())]
      output.push(...block.returns.map((item) => ({ 삼성전자: item.삼성전자, SK하이닉스: item.SK하이닉스 })))
    }
  }
  return output.slice(0, steps)
}

export function validateRegimeModel(model: RegimeBootstrapModel): string[] {
  const issues: string[] = []
  if (Math.abs(sum(Object.values(model.config.mixtureWeights)) - 1) > 1e-10) issues.push('혼합 component 가중치 합이 1이 아닙니다.')
  if (Math.abs(sum(model.analogEpisodes.map((episode) => episode.weight)) - 1) > 1e-10) issues.push('Analog episode 가중치 합이 1이 아닙니다.')
  if (model.analogEpisodes.some((episode) => episode.weight > model.config.maxEpisodeWeight + 1e-10)) issues.push('Analog episode 최대 가중치 제한을 초과했습니다.')
  if (model.analogEpisodes.some((episode, index) => episode.continuation[0]?.date <= model.metadata.topSimilarRegimes[index]?.end)) issues.push('Analog continuation이 episode 종료 이후가 아닙니다.')
  for (const component of Object.keys(model.cumulativeWeights) as RegimeComponent[]) {
    const weights = model.cumulativeWeights[component]
    if (!weights.length || Math.abs(weights.at(-1)! - 1) > 1e-10) issues.push(`${component} sampling weight가 정규화되지 않았습니다.`)
    if (weights.some((value, index) => !Number.isFinite(value) || value + 1e-12 < (weights[index - 1] ?? 0))) issues.push(`${component} sampling weight가 유효하지 않습니다.`)
  }
  if (model.blocks.some((block) => block.returns.length !== model.config.blockLength || block.returns.some((item) => !Number.isFinite(item.삼성전자) || !Number.isFinite(item.SK하이닉스)))) issues.push('수익률 block에 누락 또는 비유한 값이 있습니다.')
  return issues
}

export function seededRegimeTerminalReturns(model: RegimeBootstrapModel, steps: number, samples: number, seed: number) { const random = createSeededRandom(seed); return Array.from({ length: samples }, () => { const path = sampleRegimeReturnPath(model, steps, random); return { 삼성전자: terminalRatio(path, '삼성전자') - 1, SK하이닉스: terminalRatio(path, 'SK하이닉스') - 1 } }) }

export function walkForwardAnalogBacktest(prices: DailyPriceByUnderlying, evaluationDates: readonly string[], samples = 300, seed = 42): RegimeBacktestSummary {
  const fullReturns = alignedReturns(prices)
  const points = evaluationDates.flatMap((evaluationDate, evaluationIndex) => {
    const historical = { 삼성전자: prices.삼성전자.filter((point) => point.date <= evaluationDate), SK하이닉스: prices.SK하이닉스.filter((point) => point.date <= evaluationDate) }
    const future = fullReturns.filter((point) => point.date > evaluationDate).slice(0, 126)
    if (future.length !== 126) return []
    const { model } = buildSimilarRegimeModel(historical)
    if (model.metadata.sourcePeriod.to > evaluationDate || model.metadata.topSimilarRegimes.some((match) => match.end > evaluationDate)) throw new Error('Walk-forward analog 탐색에 미래 데이터가 포함되었습니다.')
    const random = createSeededRandom(seed + evaluationIndex)
    const simulated = Array.from({ length: samples }, () => sampleRegimeReturnPath(model, 126, random))
    const actual3M = future.slice(0, 63); const actual6M = future
    const simulatedDrawdowns = simulated.map(pathMaximumDrawdown)
    const actualTerminal = { 삼성전자: terminalRatio(actual6M, '삼성전자') - 1, SK하이닉스: terminalRatio(actual6M, 'SK하이닉스') - 1 }
    const simulatedTerminal = { 삼성전자: simulated.map((path) => terminalRatio(path, '삼성전자') - 1), SK하이닉스: simulated.map((path) => terminalRatio(path, 'SK하이닉스') - 1) }
    const predictedVolatility = { 삼성전자: mean(simulated.map((path) => Math.sqrt(variance(path.map((item) => item.삼성전자)) * TRADING_DAYS))), SK하이닉스: mean(simulated.map((path) => Math.sqrt(variance(path.map((item) => item.SK하이닉스)) * TRADING_DAYS))) }
    const actualVolatility = { 삼성전자: Math.sqrt(variance(actual6M.map((item) => item.삼성전자)) * TRADING_DAYS), SK하이닉스: Math.sqrt(variance(actual6M.map((item) => item.SK하이닉스)) * TRADING_DAYS) }
    const barrier3MPredicted = mean(simulated.map((path) => terminalWorstOf(path.slice(0, 63)) >= .85 ? 1 : 0)); const barrier3MObserved = terminalWorstOf(actual3M) >= .85 ? 1 : 0
    const barrier6MPredicted = mean(simulated.map((path) => terminalWorstOf(path) >= .85 ? 1 : 0)); const barrier6MObserved = terminalWorstOf(actual6M) >= .85 ? 1 : 0
    const knockInPredicted = mean(simulated.map((path) => pathMinimumRatio(path) < .35 ? 1 : 0)); const knockInObserved = pathMinimumRatio(actual6M) < .35 ? 1 : 0
    const jointDownsidePredicted = mean(simulated.map(jointDownsideFrequency)); const jointDownsideObserved = jointDownsideFrequency(actual6M)
    return [{
      barrier3MPredicted, barrier3MObserved, barrier3MError: Math.abs(barrier3MPredicted - barrier3MObserved),
      barrier6MPredicted, barrier6MObserved, barrier6MError: Math.abs(barrier6MPredicted - barrier6MObserved),
      knockInPredicted, knockInObserved, knockInError: Math.abs(knockInPredicted - knockInObserved),
      drawdownCovered: pathMaximumDrawdown(actual6M) >= quantile(simulatedDrawdowns, .05) && pathMaximumDrawdown(actual6M) <= quantile(simulatedDrawdowns, .95) ? 1 : 0,
      jointDownsidePredicted, jointDownsideObserved, jointDownsideError: Math.abs(jointDownsidePredicted - jointDownsideObserved),
      directional: (['삼성전자', 'SK하이닉스'] as const).map((underlying) => Math.sign(mean(simulatedTerminal[underlying])) === Math.sign(actualTerminal[underlying]) ? 1 : 0),
      volatilityRatio: { 삼성전자: predictedVolatility.삼성전자 / Math.max(actualVolatility.삼성전자, Number.EPSILON), SK하이닉스: predictedVolatility.SK하이닉스 / Math.max(actualVolatility.SK하이닉스, Number.EPSILON) },
    }]
  })
  if (!points.length) throw new Error('Walk-forward 검증에 사용할 평가시점이 없습니다.')
  const barrier3MPredictedRate = mean(points.map((point) => point.barrier3MPredicted)); const barrier3MObservedRate = mean(points.map((point) => point.barrier3MObserved))
  const barrier6MPredictedRate = mean(points.map((point) => point.barrier6MPredicted)); const barrier6MObservedRate = mean(points.map((point) => point.barrier6MObserved))
  const knockInPredictedRate = mean(points.map((point) => point.knockInPredicted)); const knockInObservedRate = mean(points.map((point) => point.knockInObserved))
  const jointDownsidePredictedFrequency = mean(points.map((point) => point.jointDownsidePredicted)); const jointDownsideObservedFrequency = mean(points.map((point) => point.jointDownsideObserved))
  return { evaluations: points.length, barrier3MPredictedRate, barrier3MObservedRate, barrier3MCalibrationBias: barrier3MPredictedRate - barrier3MObservedRate, barrier3MCalibrationError: mean(points.map((point) => point.barrier3MError)), barrier6MPredictedRate, barrier6MObservedRate, barrier6MCalibrationBias: barrier6MPredictedRate - barrier6MObservedRate, barrier6MCalibrationError: mean(points.map((point) => point.barrier6MError)), knockInPredictedRate, knockInObservedRate, knockInCalibrationBias: knockInPredictedRate - knockInObservedRate, knockInCalibrationError: mean(points.map((point) => point.knockInError)), drawdownDistributionCoverage: mean(points.map((point) => point.drawdownCovered)), jointDownsidePredictedFrequency, jointDownsideObservedFrequency, jointDownsideCalibrationError: mean(points.map((point) => point.jointDownsideError)), directionalAccuracy: mean(points.flatMap((point) => point.directional)), volatilityCalibrationRatio: { 삼성전자: mean(points.map((point) => point.volatilityRatio.삼성전자)), SK하이닉스: mean(points.map((point) => point.volatilityRatio.SK하이닉스)) } }
}

export function pseudoOutOfSampleBacktest(prices: DailyPriceByUnderlying, evaluationDates: readonly string[], _horizonDays = 60, samples = 300, seed = 42) { return walkForwardAnalogBacktest(prices, evaluationDates, samples, seed) }

function createAnalogCandidates(paired: readonly PairedReturn[], currentFeatures: RegimeFeatures, config: SimilarRegimeConfig) {
  const raw: Array<Omit<AnalogCandidate, 'similarity'>> = []
  const currentPaths = new Map(config.currentWindows.map((window) => [window, normalizedContinuation(paired.slice(-window), config.normalizedPathPoints)]))
  for (const regime of config.candidateRegimes) for (let endIndex = 119; endIndex < paired.length - Math.ceil(config.blockLength * config.warpBounds[1]) - 1; endIndex += 1) {
    const date = paired[endIndex].date
    if (date < regime.start || date > regime.end) continue
    const historicalFeatures = new Map<number, RegimeFeatures>()
    for (const historicalWindowDays of config.historicalWindows) {
      if (endIndex - Math.max(120, historicalWindowDays) + 1 < 0) continue
      if (paired[endIndex - historicalWindowDays + 1].date < regime.start) continue
      historicalFeatures.set(historicalWindowDays, featuresAt(paired, endIndex, historicalWindowDays, config.normalizedPathPoints))
    }
    for (const currentWindowDays of config.currentWindows) for (const historicalWindowDays of config.historicalWindows) {
      const features = historicalFeatures.get(historicalWindowDays)
      if (!features) continue
      const warpRatio = clamp(historicalWindowDays / currentWindowDays, config.warpBounds[0], config.warpBounds[1])
      raw.push({ startIndex: endIndex - historicalWindowDays + 1, endIndex, currentWindowDays, historicalWindowDays, warpRatio, features, candidate: regime.name, pathDistance: normalizedPathDistance(currentPaths.get(currentWindowDays)!, features.normalizedPath) })
    }
  }
  if (!raw.length) throw new Error('House View 후보기간에서 analog episode를 찾을 수 없습니다.')
  const scaling = robustScaling(raw.map((candidate) => featureVector(candidate.features)))
  const currentVector = featureVector(currentFeatures)
  return raw.map((candidate) => { const featureDistance = weightedFeatureDistance(currentVector, featureVector(candidate.features), scaling, config.featureWeights); const combinedDistance = Math.sqrt(featureDistance ** 2 + config.pathShapeWeight * candidate.pathDistance ** 2); return { ...candidate, similarity: Math.exp(-config.similarityLambda * combinedDistance) } })
}

function selectClusteredEpisodes(candidates: readonly AnalogCandidate[], paired: readonly PairedReturn[], config: SimilarRegimeConfig) { const selected: AnalogCandidate[] = []; for (const candidate of [...candidates].sort((left, right) => right.similarity - left.similarity)) { if (!selected.some((prior) => Math.abs(prior.endIndex - candidate.endIndex) < config.analogClusterGapDays || overlapRatio(prior.startIndex, prior.endIndex, candidate.startIndex, candidate.endIndex) > .35)) selected.push(candidate); if (selected.length === config.maxAnalogEpisodes) break } return selected.filter((episode) => paired[episode.endIndex + 1]) }
function featuresAt(paired: readonly PairedReturn[], endIndex: number, pathWindow: number, points: number): RegimeFeatures { const momentumByHorizon = Object.fromEntries(MOMENTUM_HORIZONS.map((horizon) => [horizon, { 삼성전자: terminalRatio(paired.slice(Math.max(0, endIndex - horizon + 1), endIndex + 1), '삼성전자') - 1, SK하이닉스: terminalRatio(paired.slice(Math.max(0, endIndex - horizon + 1), endIndex + 1), 'SK하이닉스') - 1 }])) as RegimeFeatures['momentumByHorizon']; const window60 = paired.slice(Math.max(0, endIndex - 59), endIndex + 1); const window120 = paired.slice(Math.max(0, endIndex - 119), endIndex + 1); const path = paired.slice(Math.max(0, endIndex - pathWindow + 1), endIndex + 1); return { momentum: momentumByHorizon[60], momentumByHorizon, annualizedVolatility: { 삼성전자: Math.sqrt(variance(window60.map((item) => item.삼성전자)) * TRADING_DAYS), SK하이닉스: Math.sqrt(variance(window60.map((item) => item.SK하이닉스)) * TRADING_DAYS) }, drawdown: { 삼성전자: assetDrawdown(window120, '삼성전자'), SK하이닉스: assetDrawdown(window120, 'SK하이닉스') }, correlation: correlation(window60.map((item) => item.삼성전자), window60.map((item) => item.SK하이닉스)), normalizedPath: normalizedContinuation(path, points) } }
function featureVector(features: RegimeFeatures): Record<RegimeFeatureKey, number> { return { samsungMomentum20: features.momentumByHorizon[20].삼성전자, hynixMomentum20: features.momentumByHorizon[20].SK하이닉스, samsungMomentum60: features.momentumByHorizon[60].삼성전자, hynixMomentum60: features.momentumByHorizon[60].SK하이닉스, samsungMomentum120: features.momentumByHorizon[120].삼성전자, hynixMomentum120: features.momentumByHorizon[120].SK하이닉스, samsungVolatility: features.annualizedVolatility.삼성전자, hynixVolatility: features.annualizedVolatility.SK하이닉스, samsungDrawdown: features.drawdown.삼성전자, hynixDrawdown: features.drawdown.SK하이닉스, correlation: features.correlation } }
function robustScaling(vectors: readonly Record<RegimeFeatureKey, number>[]) { return Object.fromEntries((Object.keys(vectors[0]) as RegimeFeatureKey[]).map((key) => { const values = vectors.map((vector) => vector[key]); return [key, { scale: Math.max((quantile(values, .75) - quantile(values, .25)) / 1.349, 1e-6) }] })) as Record<RegimeFeatureKey, { scale: number }> }
function weightedFeatureDistance(current: Record<RegimeFeatureKey, number>, historical: Record<RegimeFeatureKey, number>, scaling: Record<RegimeFeatureKey, { scale: number }>, weights: Record<RegimeFeatureKey, number>) { return Math.sqrt((Object.keys(weights) as RegimeFeatureKey[]).reduce((total, key) => total + weights[key] * ((current[key] - historical[key]) / scaling[key].scale) ** 2, 0)) }
function normalizedPathDistance(current: Record<Underlying, readonly number[]>, historical: Record<Underlying, readonly number[]>) { const values = (['삼성전자', 'SK하이닉스'] as const).flatMap((underlying) => current[underlying].map((value, index) => (Math.log(value / 100) - Math.log((historical[underlying][index] ?? 100) / 100)) / .2)); return Math.sqrt(mean(values.map((value) => value ** 2))) }
function normalizedContinuation(returns: readonly Record<Underlying, number>[], points: number): Record<Underlying, readonly number[]> { return { 삼성전자: resampledNormalizedPath(returns, '삼성전자', points), SK하이닉스: resampledNormalizedPath(returns, 'SK하이닉스', points) } }
function resampledNormalizedPath(returns: readonly Record<Underlying, number>[], underlying: Underlying, points: number) { const values = [100]; let level = 100; returns.forEach((item) => { level *= Math.exp(item[underlying]); values.push(level) }); return Array.from({ length: points }, (_, index) => interpolate(values, index * (values.length - 1) / Math.max(points - 1, 1))) }
function createBlocks(paired: readonly PairedReturn[], blockLength: number): RegimeReturnBlock[] { const blocks: RegimeReturnBlock[] = []; for (let index = 0; index + blockLength <= paired.length; index += 1) { const returns = paired.slice(index, index + blockLength); blocks.push({ start: returns[0].date, end: returns.at(-1)!.date, returns, tailScore: blockTailScore(returns) }) } return blocks }
function blockTailScore(block: readonly PairedReturn[]) { return (Math.sqrt(variance(block.map((item) => item.삼성전자)) * TRADING_DAYS) + Math.sqrt(variance(block.map((item) => item.SK하이닉스)) * TRADING_DAYS)) / 2 + pathMaximumDrawdown(block) * 2 + jointDownsideFrequency(block) * 3 }
function effectiveObservations(episodes: readonly AnalogEpisode[], blocks: readonly RegimeReturnBlock[], recentWeights: readonly number[], tailWeights: readonly number[], config: SimilarRegimeConfig): WeightedObservation[] { const observations: WeightedObservation[] = []; episodes.forEach((episode) => { const sample = episode.continuation.slice(0, Math.min(252, episode.continuation.length)); sample.forEach((item) => observations.push({ value: item, weight: config.mixtureWeights.similarRegime * episode.weight / sample.length })) }); blocks.forEach((block, index) => block.returns.forEach((item) => { observations.push({ value: item, weight: config.mixtureWeights.recentMarket * recentWeights[index] / block.returns.length }); observations.push({ value: item, weight: config.mixtureWeights.tailHistory * tailWeights[index] / block.returns.length }) })); return observations }
function weightedMoments(observations: readonly WeightedObservation[]) { const weights = normalize(observations.map((item) => item.weight)); const samsung = observations.map((item) => item.value.삼성전자); const hynix = observations.map((item) => item.value.SK하이닉스); const meanValue = { 삼성전자: weightedMean(samsung, weights), SK하이닉스: weightedMean(hynix, weights) }; const varianceValue = { 삼성전자: weightedVariance(samsung, weights), SK하이닉스: weightedVariance(hynix, weights) }; return { mean: meanValue, variance: varianceValue, correlation: clamp(weightedCovariance(samsung, hynix, weights) / Math.sqrt(Math.max(varianceValue.삼성전자 * varianceValue.SK하이닉스, Number.EPSILON)), -.999, .999) } }
function weightedAsset(base: AssetParameters, moments: ReturnType<typeof weightedMoments>, underlying: Underlying, paired: readonly PairedReturn[]): AssetParameters { const annualizedVolatility = Math.sqrt(moments.variance[underlying] * TRADING_DAYS); return { ...base, dailyMeanLogReturn: moments.mean[underlying], dailyVolatility: Math.sqrt(moments.variance[underlying]), annualizedDrift: moments.mean[underlying] * TRADING_DAYS + annualizedVolatility ** 2 / 2, annualizedVolatility, observations: paired.length, observationStart: paired[0].date, observationEnd: paired.at(-1)?.date } }
function warpReturns(source: readonly PairedReturn[], outputLength: number, warp: number): Array<Record<Underlying, number>> { return Array.from({ length: outputLength }, (_, index) => ({ 삼성전자: integrateReturn(source, '삼성전자', index * warp, (index + 1) * warp), SK하이닉스: integrateReturn(source, 'SK하이닉스', index * warp, (index + 1) * warp) })) }
function integrateReturn(source: readonly PairedReturn[], underlying: Underlying, start: number, end: number) { let total = 0; for (let index = Math.floor(start); index < Math.ceil(end); index += 1) { const overlap = Math.max(0, Math.min(end, index + 1) - Math.max(start, index)); total += (source[Math.min(index, source.length - 1)]?.[underlying] ?? 0) * overlap } return total }
function cappedNormalize(raw: readonly number[], cap: number) { const result = new Array(raw.length).fill(0) as number[]; let remaining = 1; const active = new Set(raw.map((_, index) => index)); while (active.size) { const activeTotal = [...active].reduce((total, index) => total + raw[index], 0); let cappedAny = false; for (const index of [...active]) { const proposed = activeTotal > 0 ? remaining * raw[index] / activeTotal : remaining / active.size; if (proposed > cap + 1e-12) { result[index] = cap; remaining -= cap; active.delete(index); cappedAny = true } } if (!cappedAny) { const denominator = [...active].reduce((total, index) => total + raw[index], 0); for (const index of active) result[index] = denominator > 0 ? remaining * raw[index] / denominator : remaining / active.size; break } } return normalize(result) }
function validateConfig(config: SimilarRegimeConfig) { if (!config.currentWindows.length || !config.historicalWindows.length || config.currentWindows.some((value) => value < 20) || config.historicalWindows.some((value) => value < 20)) throw new Error('Analog window는 20거래일 이상이어야 합니다.'); if (!Number.isInteger(config.blockLength) || config.blockLength <= 0) throw new Error('block length는 양의 정수여야 합니다.'); if (config.warpBounds[0] <= 0 || config.warpBounds[0] >= config.warpBounds[1]) throw new Error('time-warp bound가 유효하지 않습니다.'); if (config.maxEpisodeWeight * config.maxAnalogEpisodes < 1) throw new Error('episode 최대 가중치로 전체 질량을 배분할 수 없습니다.'); if (Math.abs(sum(Object.values(config.featureWeights)) + config.pathShapeWeight - 1) > 1e-10) throw new Error('feature와 path-shape 가중치 합은 1이어야 합니다.'); if (Math.abs(sum(Object.values(config.mixtureWeights)) - 1) > 1e-10) throw new Error('mixture 가중치 합은 1이어야 합니다.') }
function alignedReturns(prices: DailyPriceByUnderlying): PairedReturn[] { const samsung = datedReturns(prices.삼성전자); const hynix = new Map(datedReturns(prices.SK하이닉스).map((item) => [item.date, item.value])); return samsung.flatMap((item) => hynix.has(item.date) ? [{ date: item.date, 삼성전자: item.value, SK하이닉스: hynix.get(item.date)! }] : []) }
function datedReturns(history: readonly DailyPrice[]) { const sorted = [...history].sort((left, right) => left.date.localeCompare(right.date)); return sorted.slice(1).flatMap((point, index) => { const previous = valueForEstimation(sorted[index]); const current = valueForEstimation(point); return previous > 0 && current > 0 ? [{ date: point.date, value: Math.log(current / previous) }] : [] }) }
function terminalRatio(path: readonly Record<Underlying, number>[], underlying: Underlying) { return Math.exp(sum(path.map((item) => item[underlying]))) }
function terminalWorstOf(path: readonly Record<Underlying, number>[]) { return Math.min(terminalRatio(path, '삼성전자'), terminalRatio(path, 'SK하이닉스')) }
function pathMinimumRatio(path: readonly Record<Underlying, number>[]) { let samsung = 1; let hynix = 1; let minimum = 1; for (const item of path) { samsung *= Math.exp(item.삼성전자); hynix *= Math.exp(item.SK하이닉스); minimum = Math.min(minimum, samsung, hynix) } return minimum }
function assetDrawdown(path: readonly Record<Underlying, number>[], underlying: Underlying) { let level = 1; let peak = 1; let result = 0; for (const item of path) { level *= Math.exp(item[underlying]); peak = Math.max(peak, level); result = Math.max(result, 1 - level / peak) } return result }
function pathMaximumDrawdown(path: readonly Record<Underlying, number>[]) { return Math.max(assetDrawdown(path, '삼성전자'), assetDrawdown(path, 'SK하이닉스')) }
function jointDownsideFrequency(path: readonly Record<Underlying, number>[]) { return mean(path.map((item) => item.삼성전자 < -.02 && item.SK하이닉스 < -.02 ? 1 : 0)) }
function overlapRatio(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) { const overlap = Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart) + 1); return overlap / Math.min(leftEnd - leftStart + 1, rightEnd - rightStart + 1) }
function normalize(values: readonly number[]) { const total = sum(values); if (!(total > 0) || !Number.isFinite(total)) throw new Error('sampling weight를 정규화할 수 없습니다.'); return values.map((value) => value / total) }
function cumulative(values: readonly number[]) { let total = 0; const output = values.map((value) => total += value); output[output.length - 1] = 1; return output }
function sampleComponent(weights: Record<RegimeComponent, number>, draw: number): RegimeComponent { if (draw < weights.similarRegime) return 'similarRegime'; if (draw < weights.similarRegime + weights.recentMarket) return 'recentMarket'; return 'tailHistory' }
function sampleCumulative(weights: readonly number[], draw: number) { let low = 0; let high = weights.length - 1; while (low < high) { const middle = Math.floor((low + high) / 2); if (draw <= weights[middle]) high = middle; else low = middle + 1 } return low }
function weightedMean(values: readonly number[], weights: readonly number[]) { return values.reduce((total, value, index) => total + value * weights[index], 0) }
function weightedVariance(values: readonly number[], weights: readonly number[]) { const average = weightedMean(values, weights); const correction = 1 - sum(weights.map((weight) => weight ** 2)); return correction > 0 ? values.reduce((total, value, index) => total + weights[index] * (value - average) ** 2, 0) / correction : 0 }
function weightedCovariance(left: readonly number[], right: readonly number[], weights: readonly number[]) { const leftMean = weightedMean(left, weights); const rightMean = weightedMean(right, weights); const correction = 1 - sum(weights.map((weight) => weight ** 2)); return correction > 0 ? left.reduce((total, value, index) => total + weights[index] * (value - leftMean) * (right[index] - rightMean), 0) / correction : 0 }
function correlation(left: readonly number[], right: readonly number[]) { const denominator = Math.sqrt(variance(left) * variance(right)); return denominator ? covariance(left, right) / denominator : 0 }
function covariance(left: readonly number[], right: readonly number[]) { if (left.length < 2) return 0; const leftMean = mean(left); const rightMean = mean(right); return left.reduce((total, value, index) => total + (value - leftMean) * (right[index] - rightMean), 0) / (left.length - 1) }
function variance(values: readonly number[]) { if (values.length < 2) return 0; const average = mean(values); return mean(values.map((value) => (value - average) ** 2)) * values.length / (values.length - 1) }
function quantile(values: readonly number[], probability: number) { const sorted = [...values].sort((left, right) => left - right); const position = (sorted.length - 1) * probability; const lower = Math.floor(position); const fraction = position - lower; return (sorted[lower] ?? 0) + fraction * ((sorted[lower + 1] ?? sorted[lower] ?? 0) - (sorted[lower] ?? 0)) }
function interpolate(values: readonly number[], position: number) { const lower = Math.floor(position); const fraction = position - lower; return (values[lower] ?? values.at(-1) ?? 0) + fraction * ((values[lower + 1] ?? values[lower] ?? values.at(-1) ?? 0) - (values[lower] ?? values.at(-1) ?? 0)) }
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, value)) }
function sum(values: readonly number[]) { return values.reduce((total, value) => total + value, 0) }
function mean(values: readonly number[]) { return values.length ? sum(values) / values.length : 0 }

