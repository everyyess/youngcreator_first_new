import { useState, type FormEvent } from 'react'
import type { ProductSpec } from '../products/types'
import { money } from '../utils/formatters'

interface SimulationFormProps {
  products: readonly ProductSpec[]
  selectedId: ProductSpec['id']
  onProductChange: (id: ProductSpec['id']) => void
}

export function SimulationForm({ products, selectedId, onProductChange }: SimulationFormProps) {
  const [investment, setInvestment] = useState(10_000_000)
  const [message, setMessage] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('Monte Carlo engine은 다음 단계에서 구현됩니다.')
  }

  return (
    <section className="simulation-card" aria-labelledby="simulation-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">시뮬레이션 설정</p>
          <h2 id="simulation-title">실행 조건</h2>
        </div>
        <span className="status-pill">준비 중</span>
      </div>

      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            투자금액
            <input
              type="number"
              min="0"
              step="100000"
              value={investment}
              onChange={(event) => setInvestment(Number(event.target.value))}
            />
            <small>{money(investment)}</small>
          </label>
          <label>
            상품 선택
            <select value={selectedId} onChange={(event) => onProductChange(event.target.value as ProductSpec['id'])}>
              {products.map((product) => <option key={product.id} value={product.id}>{product.id} · {product.productType}</option>)}
            </select>
          </label>
          <label>
            Historical lookback
            <select defaultValue="3">
              <option value="1">1년</option>
              <option value="3">3년</option>
              <option value="5">5년</option>
            </select>
          </label>
          <label>
            시뮬레이션 횟수
            <select defaultValue="50000">
              <option value="10000">10,000</option>
              <option value="20000">20,000</option>
              <option value="50000">50,000 (기본)</option>
              <option value="100000">100,000</option>
            </select>
          </label>
          <label>
            고정 난수 시드
            <input type="number" value="42" readOnly />
          </label>
        </div>

        <details className="advanced-settings">
          <summary>Advanced settings</summary>
          <div className="form-grid form-grid--advanced">
            <label>Drift override<input type="number" step="0.01" placeholder="기본 추정값" /></label>
            <label>Volatility override<input type="number" step="0.01" placeholder="기본 추정값" /></label>
            <label>Correlation override<input type="number" step="0.01" min="-1" max="1" placeholder="기본 추정값" /></label>
            <label>Initial shock<input type="number" step="0.01" placeholder="예: -0.05" /></label>
          </div>
        </details>

        <button className="run-button" type="submit">시뮬레이션 실행 <span aria-hidden="true">→</span></button>
        {message && <p className="form-message" role="status">{message}</p>}
      </form>
    </section>
  )
}
