import { useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Rectangle, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarShapeProps } from 'recharts'
import type { ComparisonHorizonMonth, DistributionPoint, LossDistributionPoint, ProbabilityEstimate, SimulationResult, SimulationSamplePath } from '../../engines/monteCarlo'
import type { DailyPriceByUnderlying, SimilarRegimeMatch } from '../../marketData'
import type { ProductSpec, Underlying } from '../../products/types'
import { productSpecs } from '../../products/products'
import { displayProductName } from '../../components/ProductCard'
import { UNDERLYING_COLORS } from '../../theme/chartColors'
import { cumulativeProbabilityDomain, realizedReturnDomain } from './chartDomains'
import { calculateStructuredScenario, COMPARISON_HORIZONS, MIN_CONDITIONAL_SAMPLES, mixedStrategyLabel, STRATEGY_SCENARIOS, type StructuredStrategyCell } from './strategyComparison'
import { connectNormalizedContinuation, normalizedPricePath } from './analogChartData'

const pct = (value: number) => `${(value * 100).toFixed(1)}%`
const signedPct = (value: number) => `${value >= 0 ? '+' : ''}${pct(value)}`
const won = (value: number) => `${Math.round(value).toLocaleString()}원`
const countText = (value: number) => `${value.toLocaleString()}개 경로`

export function ResultDashboard({ product, result, market, investmentAmount, comparisonResults, comparisonLoading, onComparisonProduct, onStress, loading }: { product: ProductSpec; result?: SimulationResult; market?: DailyPriceByUnderlying; investmentAmount: number; comparisonResults: Partial<Record<ProductSpec['id'], SimulationResult>>; comparisonLoading: boolean; onComparisonProduct: (id: ProductSpec['id']) => void; onStress: (overrides: { initialShock?: number; volatilityMultiplier?: number }) => void; loading: boolean }) {
  const [stress, setStress] = useState('기준')
  const [pathScenario, setPathScenario] = useState<'early' | 'maturityProfit' | 'principalLoss'>('early')
  const [showDetailed, setShowDetailed] = useState(false)
  if (!result) return <section className="results-empty"><p className="eyebrow">RESULTS</p><h2>결과 준비</h2><p>시세 조회와 Monte Carlo 실행 후 상품별 결과가 표시됩니다.</p></section>

  const earlyRows = Object.entries(result.redemptionStats.early).map(([month, stat]) => ({ label: `${month}개월`, month: Number(month), probability: stat.probability, cumulative: result.redemptionStats.cumulativeEarly[month].probability, count: stat.count, cumulativeCount: result.redemptionStats.cumulativeEarly[month].count, samples: stat.samples, maturityReached: false }))
  const earlyBars = [...earlyRows, { label: '만기 도달', month: product.maturityMonths, probability: result.redemptionStats.maturityReached.probability, cumulative: 1, count: result.redemptionStats.maturityReached.count, cumulativeCount: result.simulationCount, samples: result.simulationCount, maturityReached: true }]
  const selectedPath = result.representativePaths[pathScenario] ?? result.representativePaths.early ?? result.representativePaths.maturityProfit ?? result.representativePaths.principalLoss ?? result.samplePaths[0]
  const pathRows = selectedPath ? pathRowsFrom(selectedPath) : []
  const barriers = barrierDefinitions(product)
  const availableScenarios = ([['early', '조기상환'], ['maturityProfit', '만기 정상상환'], ['principalLoss', '원금손실']] as const).filter(([key]) => Boolean(result.representativePaths[key]))
  const isElb = product.productType === 'ELB'
  const cumulativeDomain = cumulativeProbabilityDomain(earlyRows.map((row) => row.cumulative))
  const runStress = (next: string) => { setStress(next); if (next === '기준') onStress({}); if (next === '현재 종가 -20%') onStress({ initialShock: -.2 }); if (next === '현재 종가 -30%') onStress({ initialShock: -.3 }); if (next === '변동성 1.5배') onStress({ volatilityMultiplier: 1.5 }) }

  return <section className={`results-dashboard ${isElb ? 'results-dashboard--elb' : 'results-dashboard--els'}`}>
    <div className="section-heading"><div><p className="eyebrow">RESULTS</p><h2>{product.id} 시뮬레이션 결과</h2></div><span className="status-pill">{result.simulationCount.toLocaleString()}개 경로 · 시드 {result.seed}</span></div>

    <section aria-labelledby="core-results-title">
      <h3 className="result-group-title" id="core-results-title">핵심 결과</h3>
      <div className="kpi-grid kpi-grid--results">
        <Kpi title="조기상환 확률" value={pct(result.outcomeStats.earlyRedemption.probability)} estimate={result.outcomeStats.earlyRedemption} />
        <Kpi title="평균 예상 보유기간" value={`${(result.holdingPeriodStats.meanDays / 365).toFixed(2)}년`} />
        <Kpi title={isElb ? '만기 상환 확률' : '만기 정상상환 확률'} value={pct(result.outcomeStats.maturityProfit.probability)} estimate={result.outcomeStats.maturityProfit} />
        <Kpi title="원금손실 확률" value={pct(result.outcomeStats.principalLoss.probability)} estimate={isElb ? undefined : result.outcomeStats.principalLoss} hint={isElb ? '원금지급형 상품의 만기 기준 원금손실은 구조상 발생하지 않습니다.' : undefined} danger={!isElb} />
        <Kpi title="기대 총수익률" value={pct(result.returnStats.expectedTotalReturn)} hint={`경로별 실제 누적수익률의 산술평균 · 기대 상환금액 ${won(investmentAmount * (1 + result.returnStats.expectedTotalReturn))}`} />
      </div>
      <div className="secondary-kpis"><span>만기 도달 확률 <strong>{pct(result.redemptionStats.maturityReached.probability)}</strong> <small>{countText(result.redemptionStats.maturityReached.count)}</small></span>{result.knockInStats && <span title={`95% 신뢰구간 ${pct(result.knockInStats.touch.lower95)}~${pct(result.knockInStats.touch.upper95)}`}>낙인 발생 확률 <strong>{pct(result.knockInStats.touch.probability)}</strong> <small>{countText(result.knockInStats.touch.count)}</small></span>}<span title="경로별 누적수익률을 실제 보유기간 기준 유효 연수익률로 복리환산한 뒤 평균한 값">복리환산 기대수익률 <strong>{pct(result.returnStats.expectedAnnualizedReturn)}</strong></span></div>
    </section>

    <section className="result-summary"><p className="eyebrow">EASY SUMMARY</p><h3>결과 한눈에 보기</h3><p>{result.simulationCount.toLocaleString()}개 시뮬레이션 중 <strong>{pct(result.outcomeStats.earlyRedemption.probability)}</strong>가 만기 이전에 상환되고, <strong>{pct(result.outcomeStats.maturityProfit.probability)}</strong>는 만기에 정상상환{isElb ? '됐습니다.' : `, ${pct(result.outcomeStats.principalLoss.probability)}에서는 원금손실이 발생했습니다.`}</p><p className="model-caution">본 분석은 현재 반도체 시장과 유사한 과거 주가 국면에 높은 가중치를 부여하되, 최근 시장과 과거 극단구간을 함께 반영해 미래 경로를 생성합니다. 과거 유사국면이 동일하게 반복된다는 의미는 아니며 모델 가정에 따른 시나리오 분석입니다.</p></section>
    <OutcomeComposition result={result} isElb={isElb} />
    <div className="explanation-actions"><ExplanationPanels product={product} result={result} market={market} /><button type="button" className="detail-toggle" onClick={() => setShowDetailed((current) => !current)}>{showDetailed ? '간략히 보기' : '전체 분석 보기'}</button></div>
    <StrategyComparison investment={investmentAmount} results={comparisonResults} loading={comparisonLoading} onSelectProduct={onComparisonProduct} modelLabel={modelLabel(result)} />
    {showDetailed && <>
    <section className="probability-basis"><strong>배타적 결과 검산</strong><span>조기상환 {countText(result.outcomeStats.earlyRedemption.count)}</span><span>만기 정상상환 {countText(result.outcomeStats.maturityProfit.count)}</span><span>원금손실 {countText(result.outcomeStats.principalLoss.count)}</span><span>합계 {countText(result.outcomeStats.earlyRedemption.count + result.outcomeStats.maturityProfit.count + result.outcomeStats.principalLoss.count)} / 전체 {countText(result.simulationCount)}</span></section>

    <section className="result-group" aria-labelledby="redemption-analysis-title"><h3 className="result-group-title" id="redemption-analysis-title">상환 시점 분석</h3><div className="result-chart-grid">
      <Chart title="차수별 최초 조기상환 확률" subtitle="각 막대는 이전 차수에서 상환되지 않고 해당 평가일에 처음 상환된 경로의 비율입니다."><ResponsiveContainer><BarChart data={earlyBars}><CartesianGrid vertical={false} /><XAxis dataKey="label" /><YAxis domain={[0, 1]} tickFormatter={pct} /><Tooltip cursor={false} content={<ProbabilityTooltip />} /><Bar dataKey="probability" radius={[4, 4, 0, 0]}>{earlyBars.map((row) => <Cell key={row.label} fill={row.maturityReached ? '#9aa7b6' : isElb ? '#198b72' : '#c9593d'} />)}<LabelList dataKey="probability" position="top" formatter={(value) => pct(Number(value ?? 0))} style={{ fontSize: 10, fill: '#40556b' }} /></Bar></BarChart></ResponsiveContainer></Chart>
      <Chart title="누적 조기상환 확률" subtitle="만기 도달 경로는 포함하지 않습니다. Y축은 데이터 범위에 맞춰 자동 확대됩니다."><ResponsiveContainer><LineChart data={earlyRows} margin={{ top: 16, right: 24, left: 14, bottom: 2 }}><CartesianGrid vertical={false} /><XAxis dataKey="label" /><YAxis domain={cumulativeDomain} tickFormatter={pct} width={52} /><Tooltip cursor={false} content={<ProbabilityTooltip cumulative />} /><Line type="monotone" dataKey="cumulative" stroke="#256bc0" strokeWidth={2.5} dot={{ r: 3 }}><LabelList dataKey="cumulative" position="top" formatter={(value) => pct(Number(value ?? 0))} style={{ fontSize: 10, fill: '#256bc0' }} /></Line></LineChart></ResponsiveContainer></Chart>
    </div></section>

    <section className="result-group" aria-labelledby="performance-analysis-title"><h3 className="result-group-title" id="performance-analysis-title">투자성과 분석</h3><div className="result-chart-grid">
      <RealizedReturnChart distribution={result.realizedReturnDistribution} samples={result.simulationCount} />
      {!isElb ? <Chart title="원금손실 경로의 손실률 분포" subtitle={`원금손실이 발생한 경로만을 대상으로 계산 · 총 ${countText(result.outcomeStats.principalLoss.count)}`}><ResponsiveContainer><BarChart data={result.conditionalLossDistribution}><CartesianGrid vertical={false} /><XAxis dataKey="lowerInclusive" tickFormatter={(_, index) => lossLabel(result.conditionalLossDistribution[index])} /><YAxis domain={[0, 1]} tickFormatter={pct} /><Tooltip cursor={false} content={<LossTooltip lossSamples={result.outcomeStats.principalLoss.count} />} /><Bar dataKey="probability" fill="#c85a46" radius={[3, 3, 0, 0]}><LabelList dataKey="probability" position="top" formatter={(value) => pct(Number(value ?? 0))} style={{ fontSize: 10, fill: '#93412e' }} /></Bar></BarChart></ResponsiveContainer></Chart> : <Chart title="월별 월수익 조건 충족 확률" subtitle="전체 경로에서 해당 월의 월수익 조건이 충족된 비율입니다."><ResponsiveContainer><BarChart data={Object.entries(result.couponStats!.monthly).map(([month, stat]) => ({ month: `${month}개월`, probability: stat.probability, count: stat.count, samples: stat.samples }))}><XAxis dataKey="month" interval={5} /><YAxis domain={[0, 1]} tickFormatter={pct} /><Tooltip cursor={false} content={<MonthlyCouponTooltip />} /><Bar dataKey="probability" fill="#1b9a7f" /></BarChart></ResponsiveContainer></Chart>}
    </div></section>

    <section className="result-group" aria-labelledby="representative-path-title"><h3 className="result-group-title" id="representative-path-title">대표 경로</h3><Chart title="실제 결과별 대표 경로 (최초기준가격=100)" subtitle={selectedPath ? `${pathScenarioLabel(pathScenario)} · 상환일 ${selectedPath.payoff.redemptionDate} · 실현 총수익률 ${pct(selectedPath.payoff.totalReturn)}` : undefined}><div className="path-controls">{availableScenarios.map(([key, label]) => <button type="button" className={pathScenario === key ? 'active' : ''} onClick={() => setPathScenario(key)} key={key}>{label}</button>)}</div><div className="barrier-legend"><span><i style={{ background: UNDERLYING_COLORS.삼성전자 }} />삼성전자</span><span><i style={{ background: UNDERLYING_COLORS.SK하이닉스 }} />SK하이닉스</span>{product.productType === 'ELS' && <span><i style={{ background: '#364152' }} />두 종목 중 낮은 값</span>}{barriers.map((barrier) => <span key={barrier.key}><i style={{ background: barrier.color }} />{barrier.label} {barrier.value.toFixed(0)}</span>)}</div><ResponsiveContainer><LineChart data={pathRows} margin={{ top: 8, right: 14, left: 4, bottom: 6 }}><CartesianGrid vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => String(value).slice(2)} minTickGap={40} /><YAxis ticks={pathAxisTicks(pathRows, barriers.map((barrier) => barrier.value))} domain={['auto', 'auto']} tickFormatter={(value) => Number(value).toFixed(1)} width={48} /><Tooltip cursor={false} content={<PathTooltip />} /><ReferenceLine y={100} stroke="#8390a0" strokeDasharray="4 3" />{barriers.map((barrier) => <ReferenceLine key={barrier.key} y={barrier.value} stroke={barrier.color} strokeOpacity={.65} strokeDasharray="5 4" />)}{selectedPath && <ReferenceLine x={selectedPath.payoff.redemptionDate} stroke="#1f426a" strokeDasharray="3 3" label={{ value: `${selectedPath.payoff.earlyRedemptionMonth ?? product.maturityMonths}개월 상환`, position: 'insideTopLeft', fontSize: 10, fill: '#1f426a' }} />}<Line dataKey="삼성전자" stroke={UNDERLYING_COLORS.삼성전자} strokeWidth={2} strokeOpacity={.78} dot={false} /><Line dataKey="SK하이닉스" stroke={UNDERLYING_COLORS.SK하이닉스} strokeWidth={2} strokeOpacity={.78} dot={false} />{product.productType === 'ELS' && <Line dataKey="Worst-of" stroke="#364152" strokeWidth={3} dot={false} />}</LineChart></ResponsiveContainer></Chart></section>

    <section className="initial-fixing"><p className="eyebrow">MATURITY UNDERLYING PRICES</p><h3>만기 기초자산 가격 분포</h3><p>모든 경로의 만기평가 3거래일 평균 가격입니다. 조기상환 경로도 비교 목적의 만기 시점 가상 가격은 계속 생성하지만 payoff에는 사용하지 않습니다.</p><div className="initial-fixing-grid">{product.underlyings.map((underlying) => <TerminalPriceChart key={underlying} underlying={underlying} result={result} />)}</div></section>

    {!isElb && <div className="risk-summary"><strong>위험 요약</strong><span>낙인 발생 {pct(result.knockInStats!.touch.probability)}</span><span>손실 경로 평균 손실률 {pct(result.lossStats!.averageLossRateWhenLoss)}</span><span>전체 경로 평균 손실률 {pct(result.lossStats!.averageLossRateAllPaths)}</span></div>}
    <div className="stress-panel"><div><p className="eyebrow">STRESS</p><h3>기준 시나리오 대비 스트레스</h3></div><div className="stress-buttons">{['기준', '현재 종가 -20%', '현재 종가 -30%', '변동성 1.5배'].map((label) => <button key={label} className={stress === label ? 'active' : ''} disabled={loading} onClick={() => runStress(label)}>{label}</button>)}</div><p>버튼을 누르면 같은 시세·시드로 전체 Monte Carlo를 다시 계산합니다. 가격 충격은 분석일 현재 종가에 적용됩니다. {result.initialFixing.mode === 'simulated' ? '기준가격 확정 전에는 동일 배율 충격이 경로별 기준가격에도 반영되므로 상대 배리어 확률은 원칙적으로 변하지 않고 절대가격 분포만 달라집니다.' : '기준가격 확정 후에는 확정 기준가격 대비 현재 수준을 낮추므로 상대 배리어 확률도 변합니다.'} 현재: {stress}</p></div>
    {market && <details className="method-panel"><summary>역사적 보조지표 (Monte Carlo와 별도)</summary>{product.underlyings.map((name) => { const p = result.estimatedParameters.assets[name]; const latest = market[name].at(-1); return <p key={name}><strong>{name}</strong> 최근 종가 {won(latest?.close ?? 0)} · 이동평균 20일 {won(p.ma20 ?? 0)} · 이동평균 60일 {won(p.ma60 ?? 0)} · RSI14 {p.rsi14?.toFixed(1) ?? '—'} · 1년 최대낙폭 {pct(p.maxDrawdown1Y)}</p> })}</details>}
    <ModelDetails product={product} result={result} market={market} />
    </>}
  </section>
}

function Kpi({ title, value, estimate, hint, danger }: { title: string; value: string; estimate?: ProbabilityEstimate; hint?: string; danger?: boolean }) { const description = hint ?? (estimate ? `${countText(estimate.count)} / 전체 ${countText(estimate.samples)}` : undefined); return <article className={`kpi kpi--value ${danger ? 'kpi--danger' : ''}`} title={description}><span>{title}{description && ' ⓘ'}</span><strong>{value}</strong>{estimate && <small>95% 신뢰구간 {pct(estimate.lower95)}~{pct(estimate.upper95)}</small>}</article> }
function OutcomeComposition({ result, isElb }: { result: SimulationResult; isElb: boolean }) {
  const rows = [
    { label: '조기상환', estimate: result.outcomeStats.earlyRedemption, color: '#2876C8' },
    { label: isElb ? '만기상환' : '만기 정상상환', estimate: result.outcomeStats.maturityProfit, color: '#6D8F7A' },
    ...(!isElb ? [{ label: '원금손실', estimate: result.outcomeStats.principalLoss, color: '#C85A46' }] : []),
  ]
  return <section className="outcome-composition" aria-label="상환 결과 구성"><div className="outcome-heading"><div><p className="eyebrow">OUTCOME MIX</p><h3>상환 결과 구성</h3></div><span>배타적 결과 · 합계 100%</span></div><div className="outcome-stack" role="img" aria-label={rows.map((row) => `${row.label} ${pct(row.estimate.probability)}`).join(', ')}>{rows.map((row) => <i key={row.label} style={{ width: `${row.estimate.probability * 100}%`, background: row.color }} />)}</div><div className="outcome-legend">{rows.map((row) => <span key={row.label}><i style={{ background: row.color }} /><b>{row.label}</b><strong>{pct(row.estimate.probability)}</strong><small>{row.estimate.count.toLocaleString()}개 경로</small></span>)}</div></section>
}

function ExplanationPanels({ product, result, market }: { product: ProductSpec; result: SimulationResult; market?: DailyPriceByUnderlying }) {
  const lossRates = result.pathResults.filter((path) => path.category === 'PRINCIPAL_LOSS').map((path) => path.lossRate)
  const representativeLoss = result.representativePaths.principalLoss?.payoff
  const regime = result.estimatedParameters.regimeModel
  return <>
    <details className="explanation-panel"><summary>왜 이런 결과인가요?</summary><div className="explanation-content explanation-content--analog"><p className="analog-summary">현재와 유사한 과거 반도체 주가 국면을 우선 참고하고, 최근 시장과 극단 하락국면을 함께 반영해 미래 경로를 생성했습니다.</p>{regime ? <><h4>현재 기초자산 위치</h4><div className="current-position-grid">{product.underlyings.map((underlying) => { const features = regime.currentFeatures; const spot = result.modelDiagnostics.spot[underlying]; const fixing = result.initialFixing.median[underlying]; return <article key={underlying}><strong style={{ color: UNDERLYING_COLORS[underlying] }}>{underlying}</strong><span>현재가격 / 기준가격 추정치 <b>{won(spot)} / {won(fixing)} ({pct(spot / fixing)})</b></span><span>최근 변동성 <b>{pct(features.annualizedVolatility[underlying])}</b></span><span>20·60·120일 상승률 <b>{pct(features.momentumByHorizon[20][underlying])} / {pct(features.momentumByHorizon[60][underlying])} / {pct(features.momentumByHorizon[120][underlying])}</b></span><span>최근 고점 대비 하락폭 <b>{pct(features.drawdown[underlying])}</b></span></article> })}</div><h4>주요 유사국면 3개</h4><div className="regime-match-list regime-match-list--compact">{regime.topSimilarRegimes.slice(0, 3).map((match, index) => <AnalogEpisodeCard key={`${match.start}-${match.end}`} index={index} match={match} currentPath={regime.currentFeatures.normalizedPath} market={market} underlyings={product.underlyings} />)}</div><p className="analog-more-hint">전체 8개 유사국면과 모델 설정은 아래 <b>전체 분석 보기</b>에서 확인할 수 있습니다.</p></> : <p>유사국면 상세 데이터가 없는 기본 모형 결과입니다.</p>}</div></details>
    <details className="explanation-panel explanation-panel--loss"><summary>손실은 언제 발생하나요?</summary><div className="explanation-content">{product.productType === 'ELS' ? <><h4>원금손실 발생 조건</h4><div className="loss-flow"><span>① 투자기간 중 한 종목이라도<br /><b>{pct(product.knockIn.barrier)} 미만</b> 기록</span><i>그리고</i><span>② 만기 Worst-of가<br /><b>{pct(product.maturity.barrier)} 미만</b></span><i>→</i><span className="loss-box">원금손실<br />Worst-of 비율로 상환</span></div><p>낙인이 발생하지 않으면 만기 수익상환됩니다. 낙인이 발생했더라도 만기 Worst-of가 {pct(product.maturity.barrier)} 이상으로 회복하면 수익상환되며, 두 조건을 모두 만족할 때만 원금손실입니다.</p>{representativeLoss && <p className="loss-example"><strong>대표 손실 경로 예시</strong> 낙인 기준 {pct(product.knockIn.barrier)} 미만 기록 → 만기 Worst-of {pct(representativeLoss.maturityWorstOfRatio ?? 0)} → 원금 상환율 약 {pct(representativeLoss.maturityWorstOfRatio ?? 0)} → 손실률 {signedPct(-representativeLoss.lossRate)}</p>}<div className="loss-stat-grid"><span>손실발생 확률 <b>{pct(result.outcomeStats.principalLoss.probability)}</b></span><span>손실경로 평균손실률 <b>{pct(result.lossStats?.averageLossRateWhenLoss ?? 0)}</b></span><span>손실경로 중앙손실률 <b>{pct(percentile(lossRates, .5))}</b></span><span>손실경로 중 큰 손실 5% 기준 <b>{pct(percentile(lossRates, .95))}</b></span><span>전체 경로 평균손실률 <b>{pct(result.lossStats?.averageLossRateAllPaths ?? 0)}</b></span></div></> : <><h4>기초자산 하락에 따른 만기 원금손실 없음</h4><p>이 ELB는 만기 보유 시 상품 구조상 원금을 지급합니다. 다만 예금자보호 대상이 아니며 발행사 신용위험과 만기 전 중도상환 시 손실 가능성이 있습니다.</p></>}</div></details>
  </>
}

function StrategyComparison({ investment, results, loading, onSelectProduct, modelLabel }: { investment: number; results: Partial<Record<ProductSpec['id'], SimulationResult>>; loading: boolean; onSelectProduct: (id: ProductSpec['id']) => void; modelLabel: string }) {
  const [elbId, setElbId] = useState<ProductSpec['id']>('ELB2951')
  const [elsId, setElsId] = useState<ProductSpec['id']>('ELS31382')
  const [horizon, setHorizon] = useState<ComparisonHorizonMonth>(12)
  const elbResult = results[elbId]; const elsResult = results[elsId]
  const elbs = productSpecs.filter((item) => item.productType === 'ELB'); const elses = productSpecs.filter((item) => item.productType === 'ELS')
  const elbProduct = productSpecs.find((item) => item.id === elbId)!
  const elsProduct = productSpecs.find((item) => item.id === elsId)!
  const choose = (kind: 'ELB' | 'ELS', id: ProductSpec['id']) => { if (kind === 'ELB') setElbId(id); else setElsId(id); onSelectProduct(id) }
  const isInterim = horizon < elbProduct.maturityMonths || horizon < elsProduct.maturityMonths
  return <section className="strategy-comparison">
    <div className="outcome-heading"><div><p className="eyebrow">PORTFOLIO SCENARIOS</p><h3>기초자산 직접투자와 혼합전략 비교</h3></div><span>현재 기준 · {modelLabel}</span></div>
    <div className="strategy-horizon" role="group" aria-label="투자전략 비교기간"><span>비교기간</span><div>{COMPARISON_HORIZONS.map((month) => <button type="button" key={month} className={horizon === month ? 'active' : ''} aria-pressed={horizon === month} onClick={() => setHorizon(month)}>{horizonLabel(month)}</button>)}</div></div>
    <div className="strategy-summary"><strong>{horizonSummary(horizon)}</strong><span>SK하이닉스 기간수익률별 예상 투자성과</span>{isInterim && <small>※ 미상환 ELB/ELS는 평가손익이 확정되지 않은 존속상품입니다.</small>}</div>
    <div className="strategy-selectors"><label>비교 ELB<select value={elbId} onChange={(event) => choose('ELB', event.target.value as ProductSpec['id'])}>{elbs.map((item) => <option key={item.id} value={item.id}>{displayProductName(item)}</option>)}</select></label><label>비교 ELS<select value={elsId} onChange={(event) => choose('ELS', event.target.value as ProductSpec['id'])}>{elses.map((item) => <option key={item.id} value={item.id}>{displayProductName(item)}</option>)}</select></label></div>
    <p className="chart-subtitle">각 열은 {horizonLabel(horizon)} 후 SK하이닉스 수익률 목표 ±5%p 경로군입니다. 동일 모델·시드의 상품별 경로에서 해당 시점 가격으로 조건부 표본을 추출하며, 별도 비교상품은 성능을 위해 최대 5,000개 경로를 사용하고 {MIN_CONDITIONAL_SAMPLES}개 미만이면 보간하지 않습니다.</p>
    <div className="strategy-table-wrap"><table className="strategy-table"><thead><tr><th>투자전략</th>{STRATEGY_SCENARIOS.map((scenario) => <th key={scenario}>{signedPct(scenario)}</th>)}</tr></thead><tbody>
      <StrategyRow label="SK하이닉스 100%" scenarios={STRATEGY_SCENARIOS.map((scenario) => ({ kind: 'direct' as const, value: investment * (1 + scenario), returnValue: scenario }))} />
      <StrategyRow label={mixedStrategyLabel(elbProduct)} scenarios={STRATEGY_SCENARIOS.map((scenario) => elbResult ? calculateStructuredScenario(elbProduct, elbResult.pathResults, investment, horizon, scenario) : horizon > elbProduct.maturityMonths ? { kind: 'excluded', maturityMonths: elbProduct.maturityMonths } : { kind: 'pending' })} />
      <StrategyRow label={mixedStrategyLabel(elsProduct)} scenarios={STRATEGY_SCENARIOS.map((scenario) => elsResult ? calculateStructuredScenario(elsProduct, elsResult.pathResults, investment, horizon, scenario) : horizon > elsProduct.maturityMonths ? { kind: 'excluded', maturityMonths: elsProduct.maturityMonths } : { kind: 'pending' })} />
    </tbody></table></div>
    {loading && <p className="form-message">선택 상품의 조건부 경로를 계산 중입니다.</p>}
    <p className="strategy-footnote">‘-’는 선택 상품의 법정 만기가 해당 비교기간보다 짧아 별도 재투자 가정 없이 비교할 수 없음을 의미합니다.</p>
    <p className="strategy-footnote">2Star의 삼성전자 성과는 동일 조건부 Monte Carlo 경로에서 관측된 값을 사용합니다.</p>
    <p className="strategy-message">표시 금액은 직접주식 시가와 이미 상환된 상품 금액, 그리고 존속상품의 원금(평가손익 0 가정)을 합산한 조건부 보유·상환금액입니다. 존속상품의 중도 공정가치는 반영하지 않습니다.</p>
  </section>
}
type StrategyCell = StructuredStrategyCell | { kind: 'direct'; value: number; returnValue: number } | { kind: 'pending' }
function StrategyRow({ label, scenarios }: { label: string; scenarios: readonly StrategyCell[] }) { return <tr><th>{label}</th>{scenarios.map((cell, index) => <StrategyCellView key={STRATEGY_SCENARIOS[index]} cell={cell} />)}</tr> }
function StrategyCellView({ cell }: { cell: StrategyCell }) {
  if (cell.kind === 'direct') return <td><strong>{won(cell.value)}</strong><span className={cell.returnValue >= 0 ? 'up' : 'down'}>{signedPct(cell.returnValue)}</span></td>
  if (cell.kind === 'excluded') return <td className="strategy-excluded" title={`선택 상품의 만기가 ${cell.maturityMonths / 12}년이므로 3년 비교 대상에서 제외됩니다.`}><strong>–</strong><small>상품 만기 초과</small></td>
  if (cell.kind === 'pending') return <td><span className="insufficient">계산 중</span></td>
  if (cell.kind === 'insufficient') return <td title={`조건부 표본 ${cell.samples.toLocaleString()}개`}><span className="insufficient">표본 부족</span><small>{cell.samples.toLocaleString()}개 경로</small></td>
  if (cell.kind === 'interim') return <td className="strategy-interim" title={`조건부 표본 ${cell.samples.toLocaleString()}개 · 상환완료 ${cell.redeemedCount.toLocaleString()}개 · 상품존속 ${cell.activeCount.toLocaleString()}개`}><strong>{won(cell.value)}</strong><span className={cell.returnValue >= 0 ? 'up' : 'down'}>{signedPct(cell.returnValue)}</span><div className="strategy-interim-stats"><span>상환 완료 <b>{pct(cell.redeemedProbability)}</b></span><span>상품 존속 <b>{pct(cell.activeProbability)}</b></span><span>상환경로 평균수익 <b>{cell.meanRedeemedReturn === undefined ? '해당 없음' : signedPct(cell.meanRedeemedReturn)}</b></span><small>표본 {cell.samples.toLocaleString()}개</small></div></td>
  return <td title={`조건부 표본 ${cell.samples.toLocaleString()}개 · 상품 원금손실 경로 ${pct(cell.lossProbability)}`}><strong>{won(cell.value)}</strong><span className={cell.returnValue >= 0 ? 'up' : 'down'}>{signedPct(cell.returnValue)}</span><small>손실경로 {pct(cell.lossProbability)} · 표본 {cell.samples.toLocaleString()}개</small></td>
}
function horizonLabel(month: ComparisonHorizonMonth) { return month === 6 ? '6개월' : month === 12 ? '1년' : '3년' }
function horizonSummary(month: ComparisonHorizonMonth) { return month === 6 ? '6개월 시점 비교' : `${month / 12}년 후 비교` }
function modelLabel(result: SimulationResult) { const parameters = result.estimatedParameters; return parameters.estimationMethod === 'similar-regime-bootstrap' ? '반도체 주가 유사국면' : parameters.estimationMethod === 'house-view-weighted' ? '기존 House View' : `최근 ${parameters.lookbackYears ?? 3}년` }
function Chart({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) { return <article className="chart-card"><h3>{title}</h3>{subtitle && <p className="chart-subtitle">{subtitle}</p>}<div>{children}</div></article> }
function RealizedReturnChart({ distribution, samples }: { distribution: readonly DistributionPoint[]; samples: number }) {
  const [fullRange, setFullRange] = useState(false)
  const domain = realizedReturnDomain(distribution, fullRange)
  const visibleDistribution = distribution.filter((point) => point.value >= domain[0] && point.value <= domain[1])
  const minimum = Math.min(...distribution.map((point) => point.value))
  const maximum = Math.max(...distribution.map((point) => point.value))
  const tailOutsideViewport = minimum < domain[0] || maximum > domain[1]
  const subtitle = fullRange
    ? '각 경로의 실제 상환시점 누적수익률 전체 범위입니다.'
    : `확률질량 기준 P1~P99.5 범위를 확대해 표시합니다.${tailOutsideViewport ? ' 전체 범위에는 꼬리 손실 경로가 포함됩니다.' : ''}`
  return <Chart title="상환 시 실현 총수익률 분포" subtitle={subtitle}>
    <button type="button" className="range-toggle" onClick={() => setFullRange((current) => !current)}>{fullRange ? '주요 구간 보기' : '전체 범위 보기'}</button>
    <ResponsiveContainer><BarChart data={visibleDistribution} margin={{ top: 24, right: 12, left: 8, bottom: 5 }}><CartesianGrid vertical={false} stroke="#E7EDF4" strokeOpacity={.65} /><XAxis type="number" dataKey="value" domain={domain} allowDataOverflow tickFormatter={pct} minTickGap={34} /><YAxis domain={[0, 'auto']} tickFormatter={pct} width={56} /><Tooltip cursor={false} content={<ReturnTooltip samples={samples} />} /><Bar dataKey="probability" fill="#7da7da" fillOpacity={.92} shape={pmfBarShape(fullRange ? 7 : 18)} activeBar={false} isAnimationActive={false} /></BarChart></ResponsiveContainer>
  </Chart>
}
function pmfBarShape(visualWidth: number) {
  return (props: BarShapeProps) => {
    if (!Number.isFinite(props.x) || !Number.isFinite(props.y) || !Number.isFinite(props.height) || props.height <= 0) return <g />
    const center = props.x + Math.max(props.width, 0) / 2
    return <Rectangle {...props} className="pmf-bar-shape" x={center - visualWidth / 2} width={visualWidth} radius={[4, 4, 0, 0]} />
  }
}
function ProbabilityTooltip({ active, payload, cumulative }: { active?: boolean; payload?: Array<{ payload: { label: string; probability: number; cumulative: number; count: number; cumulativeCount: number; samples: number; maturityReached: boolean } }>; cumulative?: boolean }) { const row = payload?.[0]?.payload; if (!active || !row) return null; return <TooltipBox title={cumulative ? `${row.label}까지` : row.maturityReached ? '만기까지 조기상환되지 않음' : `${row.label}차`}><span>{cumulative ? '누적 조기상환 확률' : row.maturityReached ? '만기 도달 확률' : '최초 조기상환 확률'} {pct(cumulative ? row.cumulative : row.probability)}</span><span>{countText(cumulative ? row.cumulativeCount : row.count)} / 전체 {countText(row.samples)}</span></TooltipBox> }
function ReturnTooltip({ active, payload, samples }: { active?: boolean; payload?: Array<{ payload: DistributionPoint }>; samples: number }) { const row = payload?.[0]?.payload; return active && row ? <TooltipBox title={`실현 총수익률 ${pct(row.value)}`}><span>확률 {pct(row.probability)}</span><span>{countText(row.count)} / 전체 {countText(samples)}</span></TooltipBox> : null }
function LossTooltip({ active, payload, lossSamples }: { active?: boolean; payload?: Array<{ payload: LossDistributionPoint }>; lossSamples: number }) { const row = payload?.[0]?.payload; return active && row ? <TooltipBox title={`손실률 ${lossLabel(row)}`}><span>손실경로 내 비중 {pct(row.probability)}</span><span>{countText(row.count)} / 손실 경로 {countText(lossSamples)}</span></TooltipBox> : null }
function MonthlyCouponTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { month: string; probability: number; count: number; samples: number } }> }) { const row = payload?.[0]?.payload; return active && row ? <TooltipBox title={row.month}><span>조건 충족 확률 {pct(row.probability)}</span><span>{countText(row.count)} / 전체 {countText(row.samples)}</span></TooltipBox> : null }
function PriceDistributionTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PriceDistributionRow }> }) { const row = payload?.[0]?.payload; return active && row ? <TooltipBox title={`가격 ${won(row.price)}`}><span>확률 {pct(row.probability)}</span><span>{countText(row.count)} / 전체 {countText(row.samples)}</span></TooltipBox> : null }
function PathTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number }>; label?: string }) { return active && payload?.length ? <TooltipBox title={label ?? ''}>{payload.map((item) => { const color = item.dataKey === '삼성전자' ? UNDERLYING_COLORS.삼성전자 : item.dataKey === 'SK하이닉스' ? UNDERLYING_COLORS.SK하이닉스 : '#364152'; return <span key={item.dataKey} style={{ color }}><i className="series-dot" style={{ background: color }} />{item.dataKey} {Number(item.value ?? 0).toFixed(1)}</span> })}</TooltipBox> : null }
function TooltipBox({ title, children }: { title: string; children: ReactNode }) { return <div className="price-tooltip"><b>{title}</b>{children}</div> }

function TerminalPriceChart({ underlying, result }: { underlying: Underlying; result: SimulationResult }) { const [fullRange, setFullRange] = useState(false); const values = result.terminalUnderlyingPrices[underlying]; const median = percentile(values, .5); const relativeChange = median / result.initialFixing.median[underlying] - 1; const rows = priceHistogram(values, fullRange); return <Chart title={`만기 기초자산 가격 분포 — ${underlying}`} subtitle={`중앙값 ${won(median)} · 최초기준가격 대비 ${signedPct(relativeChange)} · ${fullRange ? '전체 범위' : '표시범위 P1~P99 (양끝 막대에 꼬리 포함)'}`}><button type="button" className="range-toggle" onClick={() => setFullRange((current) => !current)}>{fullRange ? 'P1~P99 보기' : '전체 범위 보기'}</button><ResponsiveContainer><BarChart data={rows}><CartesianGrid vertical={false} /><XAxis dataKey="price" tickFormatter={(value) => Math.round(Number(value)).toLocaleString()} minTickGap={38} /><YAxis domain={[0, 'auto']} tickFormatter={pct} /><Tooltip cursor={false} content={<PriceDistributionTooltip />} /><Bar dataKey="probability" fill={UNDERLYING_COLORS[underlying]} /></BarChart></ResponsiveContainer></Chart> }
type PriceDistributionRow = { price: number; probability: number; count: number; samples: number }
function priceHistogram(values: readonly number[], fullRange: boolean): PriceDistributionRow[] { const low = percentile(values, fullRange ? 0 : .01); const high = percentile(values, fullRange ? 1 : .99); const width = (high - low) / 20 || 1; const counts = new Array(20).fill(0) as number[]; values.forEach((value) => { const index = Math.min(19, Math.max(0, Math.floor((value - low) / width))); counts[index] += 1 }); return counts.map((count, index) => ({ price: low + (index + .5) * width, probability: count / values.length, count, samples: values.length })) }
function percentile(values: readonly number[], probability: number) { const sorted = [...values].sort((left, right) => left - right); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * probability))] ?? 0 }

type BarrierDefinition = { key: string; value: number; label: string; color: string }
function barrierDefinitions(product: ProductSpec): BarrierDefinition[] { if (product.productType === 'ELB') { const grouped = groupEarlyBarriers(product); return [{ key: 'coupon', value: product.monthlyCoupon.barrier * 100, label: '월수익 조건', color: '#198b72' }, ...grouped] } return [{ key: 'knock-in', value: product.knockIn.barrier * 100, label: '낙인 기준', color: '#c44f3b' }, ...groupEarlyBarriers(product), { key: 'maturity', value: product.maturity.barrier * 100, label: '만기 정상상환', color: '#198b72' }] }
function groupEarlyBarriers(product: ProductSpec): BarrierDefinition[] { const grouped = new Map<number, number[]>(); product.earlyRedemptions.forEach((condition) => grouped.set(condition.barrier * 100, [...(grouped.get(condition.barrier * 100) ?? []), condition.month])); return [...grouped.entries()].map(([value, months]) => ({ key: `early-${value}`, value, label: `조기상환 ${months.join('·')}개월`, color: '#256bc0' })) }
function pathRowsFrom(sample: SimulationSamplePath) { const visible = sample.path.filter((point) => point.date <= sample.payoff.redemptionDate); const every = Math.max(1, Math.ceil(visible.length / 130)); return visible.filter((_, index) => index % every === 0 || index === visible.length - 1).map((point) => ({ date: point.date, 삼성전자: point.prices.삼성전자 ?? 0, SK하이닉스: point.prices.SK하이닉스 ?? 0, 'Worst-of': Math.min(point.prices.삼성전자 ?? Infinity, point.prices.SK하이닉스 ?? Infinity) })) }
function pathAxisTicks(rows: Array<{ 삼성전자: number; SK하이닉스: number; 'Worst-of': number }>, barrierValues: number[]) { const values = rows.flatMap((row) => [row.삼성전자, row.SK하이닉스, row['Worst-of']]); const low = Math.floor(Math.min(...values, ...barrierValues, 100) / 10) * 10; const high = Math.ceil(Math.max(...values, 100) / 10) * 10; return [...new Set([low, ...barrierValues, 100, high])].sort((left, right) => left - right) }
function pathScenarioLabel(value: 'early' | 'maturityProfit' | 'principalLoss') { return value === 'early' ? '조기상환 경로' : value === 'maturityProfit' ? '만기 정상상환 경로' : '원금손실 경로' }
function lossLabel(point: LossDistributionPoint) { return `${Math.round(point.lowerInclusive * 100)}~${Math.round(point.upperInclusive * 100)}%` }

function ModelDetails({ product, result, market }: { product: ProductSpec; result: SimulationResult; market?: DailyPriceByUnderlying }) {
  const regime = result.estimatedParameters.regimeModel
  return <details className="method-panel"><summary>모델 상세</summary>
    {regime ? <><section className="regime-model-details"><h4>전체 Analog episode</h4><p className="chart-subtitle">기본 설명에서 보여준 상위 3개를 포함한 전체 유사국면입니다. 과거 유사구간과 이후 실제 경로는 종료시점을 기준으로 연속 표시합니다.</p><div className="regime-match-list">{regime.topSimilarRegimes.map((match, index) => <AnalogEpisodeCard key={`${match.start}-${match.end}`} index={index} match={match} currentPath={regime.currentFeatures.normalizedPath} market={market} underlyings={product.underlyings} />)}</div></section><section className="regime-model-details"><h4>모델 구성</h4><div className="model-config-grid"><span>후보국면 <b>{regime.config.candidateRegimes.map((candidate) => `${candidate.start.slice(0, 4)}~${candidate.end.slice(0, 4)}`).join(', ')}</b></span><span>유사국면 / 최근시장 / 극단구간 <b>{pct(regime.normalizedComponentWeights.similarRegime)} / {pct(regime.normalizedComponentWeights.recentMarket)} / {pct(regime.normalizedComponentWeights.tailHistory)}</b></span><span>유사도 감쇠계수 <b>{regime.config.similarityLambda}</b></span><span>공동수익률 블록 길이 <b>{regime.config.blockLength}거래일</b></span><span>시간배율 범위 <b>{regime.config.warpBounds[0].toFixed(2)}~{regime.config.warpBounds[1].toFixed(2)} · 경로별 ±{pct(regime.config.warpUncertainty)}</b></span><span>유사국면 개별 최대비중 <b>{pct(regime.config.maxEpisodeWeight)}</b></span><span>시뮬레이션 경로 수 <b>{result.simulationCount.toLocaleString()}개</b></span><span>고정 난수 시드 <b>{result.seed}</b></span></div></section></> : <p>시뮬레이션 경로 {result.simulationCount.toLocaleString()}개 · 고정 난수 시드 {result.seed}</p>}
  </details>
}

function AnalogEpisodeCard({ index, match, currentPath, market, underlyings }: { index: number; match: SimilarRegimeMatch; currentPath: Record<Underlying, readonly number[]>; market?: DailyPriceByUnderlying; underlyings: readonly Underlying[] }) {
  return <article className="analog-episode-card"><b>{index + 1}</b><span><strong>{match.start} ~ {match.end}</strong><small>{match.houseViewCandidate}</small></span><em>유사도 {match.similarityScore.toFixed(1)}%<br />적용비중 {pct(match.normalizedWeight)} · 시간배율 {match.timeWarpRatio.toFixed(2)}배</em><AnalogPathComparison match={match} currentPath={currentPath} market={market} underlyings={underlyings} /></article>
}

function AnalogPathComparison({ match, currentPath, market, underlyings }: { match: SimilarRegimeMatch; currentPath: Record<Underlying, readonly number[]>; market?: DailyPriceByUnderlying; underlyings: readonly Underlying[] }) {
  const historicalPath = Object.fromEntries(underlyings.map((underlying) => [underlying, normalizedPricePath(market?.[underlying] ?? [], match.start, match.end)])) as Partial<Record<Underlying, readonly number[]>>
  const connected = Object.fromEntries(underlyings.map((underlying) => [underlying, connectNormalizedContinuation(historicalPath[underlying] ?? [], match.continuationPath[underlying] ?? [])])) as Record<Underlying, ReturnType<typeof connectNormalizedContinuation>>
  const currentDomain = miniChartDomain(underlyings.flatMap((underlying) => [...(currentPath[underlying] ?? [])]))
  const analogDomain = miniChartDomain(underlyings.flatMap((underlying) => [...connected[underlying].combined]))
  return <div className="analog-path-comparison"><div className="analog-asset-legend">{underlyings.map((underlying) => <span key={underlying}><i style={{ background: UNDERLYING_COLORS[underlying] }} />{underlying}</span>)}</div><div className="analog-path-panels"><section><small>현재 경로</small><NormalizedMiniChart label="현재 경로" paths={currentPath} underlyings={underlyings} domain={currentDomain} /><MiniChartRange domain={currentDomain} /></section><section className="analog-continuous-panel"><small>과거 유사구간 → 이후 실제 경로</small><ContinuousAnalogMiniChart connected={connected} underlyings={underlyings} domain={analogDomain} /><div className="analog-segment-legend"><span><i />과거 유사구간</span><span><i className="continuation" />이후 실제 경로</span></div><MiniChartRange domain={analogDomain} /></section></div></div>
}

function NormalizedMiniChart({ label, paths, underlyings, domain }: { label: string; paths: Partial<Record<Underlying, readonly number[]>>; underlyings: readonly Underlying[]; domain: readonly [number, number] }) {
  const width = 180
  const height = 54
  const [low, high] = domain
  const y = (value: number) => height - ((value - low) / Math.max(high - low, 1)) * height
  const baseline = y(100)
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}, 시작가격 100 정규화`} preserveAspectRatio="none"><line x1="0" x2={width} y1={baseline} y2={baseline} />{underlyings.map((underlying) => { const values = paths[underlying] ?? []; if (values.length < 2) return null; const points = values.map((value, index) => `${(index / (values.length - 1)) * width},${y(value)}`).join(' '); return <polyline key={underlying} points={points} stroke={UNDERLYING_COLORS[underlying]} /> })}</svg>
}

function ContinuousAnalogMiniChart({ connected, underlyings, domain }: { connected: Record<Underlying, ReturnType<typeof connectNormalizedContinuation>>; underlyings: readonly Underlying[]; domain: readonly [number, number] }) {
  const width = 360
  const height = 54
  const [low, high] = domain
  const y = (value: number) => height - ((value - low) / Math.max(high - low, 1)) * height
  const maximumLength = Math.max(2, ...underlyings.map((underlying) => connected[underlying].combined.length))
  const anchorIndex = Math.max(0, ...underlyings.map((underlying) => connected[underlying].anchorIndex))
  const x = (index: number) => index / (maximumLength - 1) * width
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="과거 유사구간과 이후 실제 경로를 연속 표시한 정규화 경로" preserveAspectRatio="none"><line x1="0" x2={width} y1={y(100)} y2={y(100)} /><line className="analog-anchor-line" x1={x(anchorIndex)} x2={x(anchorIndex)} y1="0" y2={height} />{underlyings.flatMap((underlying) => { const item = connected[underlying]; const historicalPoints = item.historical.map((value, index) => `${x(index)},${y(value)}`).join(' '); const continuationPoints = item.continuation.map((value, index) => `${x(item.anchorIndex + index)},${y(value)}`).join(' '); return [historicalPoints && <polyline key={`${underlying}-historical`} points={historicalPoints} stroke={UNDERLYING_COLORS[underlying]} />, continuationPoints && <polyline className="analog-continuation-line" key={`${underlying}-continuation`} points={continuationPoints} stroke={UNDERLYING_COLORS[underlying]} />] })}</svg>
}

function miniChartDomain(values: readonly number[]): readonly [number, number] {
  const low = Math.min(100, ...values)
  const high = Math.max(100, ...values)
  const padding = Math.max((high - low) * .1, 1)
  return [low - padding, high + padding]
}
function MiniChartRange({ domain }: { domain: readonly [number, number] }) { return <small className="mini-chart-range">정규화 {Math.ceil(domain[1])} ↔ {Math.floor(domain[0])}</small> }
function PortfolioComparison({ result, investment }: { result: SimulationResult; investment: number }) { const [direct, setDirect] = useState(investment / 2); const [elb, setElb] = useState(investment / 2); const directMean = result.terminalUnderlyingRatios.SK하이닉스.reduce((sum, value) => sum + value, 0) / result.terminalUnderlyingRatios.SK하이닉스.length; const elbMean = result.pathResults.reduce((sum, path) => sum + path.totalPayout / investment, 0) / result.pathResults.length; return <section className="portfolio-panel"><p className="eyebrow">ELB2951 MIX</p><h3>SK하이닉스 직접투자 vs 혼합</h3><div className="form-grid"><label>직접투자 금액<input type="number" value={direct} onChange={(event) => setDirect(Number(event.target.value))} /></label><label>ELB 금액<input type="number" value={elb} onChange={(event) => setElb(Number(event.target.value))} /></label></div><p>직접투자 기대 종료금액 {won(direct * directMean)} · ELB 기대 상환금액 {won(elb * elbMean)} · 합계 {won(direct * directMean + elb * elbMean)}</p></section> }

