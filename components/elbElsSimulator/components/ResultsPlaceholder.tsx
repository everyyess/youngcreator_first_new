import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import type { ProductSpec } from '../products/types'

interface ResultsPlaceholderProps {
  product: ProductSpec
}

const pendingData = [
  { name: '1차', value: 0 },
  { name: '만기', value: 0 },
  { name: '손실', value: 0 },
]

export function ResultsPlaceholder({ product }: ResultsPlaceholderProps) {
  const metrics = product.productType === 'ELB'
    ? ['6개월 조기상환 확률', '1년 누적 조기상환 확률', '월쿠폰 지급확률', '평균 예상 보유기간', '기대수익률']
    : ['차수별 조기상환 확률', '만기 정상상환 확률', '낙인 발생 확률', '원금손실 확률', '평균 예상 보유기간', '기대 총수익률']

  return (
    <section className="results-card" aria-labelledby="results-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">결과 영역</p>
          <h2 id="results-title">시뮬레이션 결과</h2>
        </div>
        <span className="status-pill">대기 중</span>
      </div>
      <div className="kpi-grid">
        {metrics.map((metric) => <div className="kpi" key={metric}><span>{metric}</span><strong>—</strong></div>)}
      </div>
      <div className="chart-placeholder" aria-label="향후 수익 시나리오 차트 영역">
        <ResponsiveContainer width="100%" height={144}>
          <BarChart data={pendingData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: '#7d8795', fontSize: 12 }} />
            <YAxis hide domain={[0, 1]} />
            <Bar dataKey="value" fill="#b6c5d8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p>Monte Carlo 실행 후 확률 분포와 수익 시나리오가 표시됩니다.</p>
      </div>
    </section>
  )
}
