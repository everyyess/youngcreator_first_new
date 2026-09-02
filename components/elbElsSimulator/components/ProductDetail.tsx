import type { ProductSpec } from '../products/types'
import { percent } from '../utils/formatters'
import type { DailyPriceByUnderlying } from '../marketData'
import { displayProductName, displayStructureName, RiskGauge } from './ProductCard'
import { AssetPriceChart } from './AssetPriceChart'
import { ProductDocuments } from './ProductDocuments'

interface ProductDetailProps {
  product: ProductSpec
  market?: DailyPriceByUnderlying
}

export function ProductDetail({ product, market }: ProductDetailProps) {
  return (
    <section className="detail-card" aria-labelledby="product-detail-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">선택 상품</p>
          <h2 id="product-detail-title">{displayProductName(product)} <span>{product.productType}</span></h2>
        </div>
        <RiskGauge riskLevel={product.riskLevel} riskLabel={product.riskLabel} />
      </div>
      <p className="detail-summary">{displayStructureName(product.structureName)} · {product.maturityMonths / 12}년 만기 · {product.underlyings.join(' + ')}</p>
      <p className="detail-explanation">{product.customerDescription}</p>
      <ProductDocuments product={product} />

      <div className="condition-grid">
        <div>
          <h3>조기상환 조건</h3>
          <ul>
            {product.earlyRedemptions.map((condition) => (
              <li key={condition.month}>
                {condition.month}개월 · {percent(condition.barrier)} 이상
                {condition.totalReturn !== undefined && ` · 총수익 ${percent(condition.totalReturn, 2)}`}
              </li>
            ))}
          </ul>
        </div>

        {product.productType === 'ELB' ? (
          <div>
            <h3>월수익 및 만기</h3>
            <ul>
              <li>매월 {percent(product.monthlyCoupon.barrier)} 이상 시 월 {percent(product.monthlyCoupon.rate, 2)} 지급</li>
              <li>세전 최대 연 {percent(product.monthlyCoupon.annualMaximumRate, 2)}</li>
              <li>미조기상환 시 {product.maturityMonths}개월 만기 원금 지급</li>
              {product.maturity.finalCouponIfConditionMet && <li>최종 월수익 조건 충족 시 마지막 월쿠폰 추가</li>}
            </ul>
          </div>
        ) : (
          <div>
            <h3>만기상환 및 낙인 조건</h3>
            <ul>
              <li>{product.maturity.month}개월 만기평가 · {percent(product.maturity.barrier)} 이상 시 누적 수익률 {percent(product.maturity.totalReturn, 2)}</li>
              <li>{product.earlyRedemptions.length + 1}Chance 구성: 조기상환 평가 {product.earlyRedemptions.length}회 + 만기평가 1회</li>
              <li>낙인 기준: {percent(product.knockIn.barrier)} 미만 · 일별 종가 기준</li>
              <li>낙인 기준 미도달 시 만기 누적 수익률 {percent(product.maturity.noKnockInTotalReturn, 2)}</li>
              <li>낙인 발생 후 만기 조건 미충족 시 최저 수익률 기초자산에 따른 원금손실</li>
            </ul>
          </div>
        )}
      </div>
      <PriceChart product={product} market={market} />
    </section>
  )
}

function PriceChart({ product, market }: { product: ProductSpec; market?: DailyPriceByUnderlying }) {
  if (!market) return <div className="price-chart price-chart--loading">Yahoo Finance 일별 종가를 불러오는 중입니다.</div>
  return <div className="price-chart"><h3>기초자산 주가 · 보조지표</h3>{product.underlyings.map((underlying) => <AssetPriceChart key={underlying} name={underlying} ticker={product.tickerByUnderlying[underlying]!} history={market[underlying]} />)}</div>
}
