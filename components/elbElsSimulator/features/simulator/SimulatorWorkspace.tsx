import { useRef, useState } from 'react'
import { ProductDetail } from '../../components/ProductDetail'
import { displayProductName } from '../../components/ProductCard'
import type { ProductSpec } from '../../products/types'
import { ResultDashboard } from './ResultDashboard'
import { defaultSettings, type SimulatorSettings, useSimulator } from './useSimulator'
import { koreanMoneyUnits } from '../../utils/formatters'

interface SimulatorWorkspaceProps {
  catalogProduct?: ProductSpec
  simulationProduct?: ProductSpec
  products: readonly ProductSpec[]
  onSimulationProductChange: (id: ProductSpec['id']) => void
}

export function SimulatorWorkspace({ catalogProduct, simulationProduct, onSimulationProductChange, products }: SimulatorWorkspaceProps) {
  const [settings, setSettings] = useState<SimulatorSettings>(defaultSettings)
  const scenarioRef = useRef<HTMLElement>(null)
  const simulator = useSimulator(simulationProduct, settings, catalogProduct)
  const update = <K extends keyof SimulatorSettings>(key: K, value: SimulatorSettings[K]) => setSettings((current) => ({ ...current, [key]: value }))
  const updateOverride = (key: keyof SimulatorSettings['overrides'], value: number | undefined) => setSettings((current) => ({ ...current, overrides: { ...current.overrides, [key]: value } }))
  const isPreFixing = simulationProduct ? new Date().toISOString().slice(0, 10) < simulationProduct.initialReferenceDate : true
  return <>
    {catalogProduct && <ProductDetail product={catalogProduct} market={simulator.detailMarket} />}
    <section className="simulator-panel" aria-label="시뮬레이션 설정" ref={scenarioRef} tabIndex={-1}>
      <div className="section-heading"><div><p className="eyebrow">SIMULATION</p><h2>투자 시나리오</h2></div><span className="status-pill">{isPreFixing ? '기준가격 확정 전' : '기준가격 확정 후'}</span></div>
      <p className="fixing-note">{!simulationProduct ? '상품을 선택하면 기초자산과 최초기준가격 일정이 표시됩니다.' : isPreFixing ? `${simulationProduct.initialReferenceDate} 최초기준가격 결정 전입니다. 분석일 종가에서 기준가격일까지의 경로를 함께 시뮬레이션합니다.` : `${simulationProduct.initialReferenceDate} 실제 최초기준가격과 그 이후 관측 가격을 반영합니다.`}</p>
      <div className="form-grid">
        <label className="investment-amount-field">투자금액 (원)<span className="investment-input-row"><input type="text" inputMode="numeric" placeholder="예: 1,000,000" value={settings.investmentAmount?.toLocaleString('en-US') ?? ''} onChange={(event) => { const digits = event.target.value.replaceAll(/[^0-9]/g, ''); update('investmentAmount', digits ? Number(digits) : undefined) }} />{koreanMoneyUnits(settings.investmentAmount) && <output aria-live="polite">{koreanMoneyUnits(settings.investmentAmount)}</output>}</span></label>
        <label>상품 선택<select value={simulationProduct?.id ?? ''} onChange={(event) => onSimulationProductChange(event.target.value as ProductSpec['id'])}><option value="" disabled>상품을 선택하세요</option>{products.map((item) => <option value={item.id} key={item.id}>{displayProductName(item)}</option>)}</select></label>
        <div className="analysis-model-field"><span>분석모형</span><strong>반도체 주가 유사국면 기반 Monte Carlo</strong></div>
        <label>시뮬레이션 횟수<select value={settings.simulationCount ?? ''} onChange={(event) => update('simulationCount', event.target.value === '' ? undefined : Number(event.target.value) as 20_000 | 50_000 | 100_000)}><option value={20_000}>20,000</option><option value={50_000}>50,000 (기본)</option><option value={100_000}>100,000</option></select></label>
      </div>
      <details className="analysis-basis"><summary>분석 기준 보기</summary><div><p>현재 삼성전자·SK하이닉스의 20·60·120거래일 수익률, 40·60·90·120일 정규화 가격경로, 실현 변동성, 최근 고점 대비 하락폭과 두 종목 수익률 상관관계를 함께 비교합니다.</p><p><strong>House View 우선 후보군</strong> 2016~2018년, 2020~2022년</p><p>후보기간 전체에 고정 가중치를 주지 않습니다. 유사한 세부 episode가 끝난 뒤 실제 공동수익률 경로를 사용하고, 최근 시장과 과거 극단국면도 혼합합니다. 산업가격·재고 데이터는 입력하지 않으므로 DRAM Cycle 자체를 예측하는 모델은 아닙니다.</p></div></details>
      <details className="advanced-settings"><summary>고급 설정</summary><div className="form-grid form-grid--advanced">
        <div className="analysis-model-field"><span>고정 난수 시드</span><strong>42 · 같은 입력은 같은 결과를 재현합니다</strong></div>
        <NumberInput label="연 drift 재정의" value={settings.overrides.drift} onChange={(value) => updateOverride('drift', value)} />
        <NumberInput label="변동성 가정 재정의 (연)" value={settings.overrides.volatility} onChange={(value) => updateOverride('volatility', value)} />
        <NumberInput label="상관계수 재정의" value={settings.overrides.correlation} onChange={(value) => updateOverride('correlation', value)} />
        <NumberInput label="분석일 현재 종가 충격" value={settings.overrides.initialShock} onChange={(value) => updateOverride('initialShock', value)} />
        <NumberInput label="변동성 배수" value={settings.overrides.volatilityMultiplier} onChange={(value) => updateOverride('volatilityMultiplier', value)} />
      </div></details>
      <button className="run-button" disabled={simulator.loading || !simulationProduct || !settings.investmentAmount || !settings.simulationCount || settings.seed === undefined} title="상품과 필수 입력값을 모두 선택하면 실행할 수 있습니다." onClick={() => void simulator.run()}>{simulator.loading ? '시세와 경로를 계산 중…' : '시뮬레이션 실행'}</button>
      {simulator.loading && <p className="form-message">가격 데이터 조회 → 유사국면 탐색 → 공동수익률 블록 표본추출 → {(settings.simulationCount ?? 0).toLocaleString()}개 경로 계산</p>}
      {simulator.error && <p className="form-message form-message--error">{simulator.error}</p>}
    </section>
    {simulationProduct ? <ResultDashboard product={simulationProduct} result={simulator.result} market={simulator.market} investmentAmount={settings.investmentAmount ?? 0} comparisonResults={simulator.comparisonResults} comparisonLoading={simulator.comparisonLoading} onComparisonProduct={(id) => void simulator.ensureComparisonProduct(id)} onStress={(overrides) => void simulator.run(overrides)} loading={simulator.loading} /> : <section className="results-empty"><p className="eyebrow">RESULTS</p><h2>상품을 선택하세요</h2><p>선택 상품과 필수 입력값이 정해지면 시뮬레이션 결과를 표시합니다.</p></section>}
  </>
}

function NumberInput({ label, value, onChange }: { label: string; value: number | undefined; onChange: (value: number | undefined) => void }) { return <label>{label}<input type="number" step="0.01" placeholder="추정값 사용" value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))} /></label> }
