import type { ProductSpec } from '../products/types'
import { percent } from '../utils/formatters'

interface ProductCardProps {
  product: ProductSpec
  onSelect: (product: ProductSpec) => void
}

export function ProductCard({ product, onSelect }: ProductCardProps) {
  const earlyBarriers = product.earlyRedemptions.map((condition) => percent(condition.barrier)).join(' / ')
  const isElb = product.productType === 'ELB'
  const annualReturn = isElb
    ? product.monthlyCoupon.annualMaximumRate
    : product.maturity.totalReturn / (product.maturityMonths / 12)

  return (
    <button className="product-card" type="button" onClick={() => onSelect(product)} title={displayProductName(product)}>
      <div className="product-card-header"><span className={`product-type product-type--${product.productType.toLowerCase()}`}>{product.productType}</span><RiskGauge riskLevel={product.riskLevel} riskLabel={product.riskLabel} /></div>
      <h2>{displayProductName(product)}</h2>
      <p className="structure-name">{displayStructureName(product.structureName)}</p>
      <p className="underlyings">{product.underlyings.join(' + ')}</p>

      <dl className="card-metrics">
        {isElb ? (
          <>
            <div><dt>조기상환 조건</dt><dd>{percent(product.earlyRedemptions[0].barrier)}</dd></div>
            <div><dt>월수익 조건</dt><dd>{percent(product.monthlyCoupon.barrier)}</dd></div>
            <div><dt>세전 최대 연 수익률</dt><dd>{percent(annualReturn, 2)}</dd></div>
            <div><dt>월 수익률</dt><dd>{percent(product.monthlyCoupon.rate, 2)}</dd></div>
          </>
        ) : (
          <>
            <div><dt>만기</dt><dd>{product.maturityMonths / 12}년</dd></div>
            <div><dt>조기상환 배리어</dt><dd>{earlyBarriers.replaceAll('%', '')}</dd></div>
            <div><dt>낙인 기준</dt><dd>{percent(product.knockIn.barrier)}</dd></div>
            <div><dt>연 수익률</dt><dd>{percent(annualReturn, 1)}</dd></div>
          </>
        )}
      </dl>

      <span className={`principal-badge principal-badge--${isElb ? 'protected' : 'unprotected'}`}>{product.principalProtection}</span>
    </button>
  )
}

export function displayProductName(product: ProductSpec) {
  return product.productType === 'ELS' ? `삼성증권 제${product.id.slice(3)}회 주가연계증권` : `삼성증권 제${product.id.slice(3)}회 주가연계파생결합사채`
}

export function displayStructureName(name: string) { return name.replace('NoKI', '낙인배리어 없음') }

export function RiskGauge({ riskLevel, riskLabel }: { riskLevel: 1 | 5; riskLabel: string }) {
  const label = riskLabel.replace('매우높은', '매우 높은 ')
  return <span className={`risk-gauge-wrap risk-gauge-wrap--${riskLevel}`} aria-label={`${riskLevel}등급 ${label}`} title={`${riskLevel}등급 · ${label}`}><span className={`risk-gauge risk-gauge--${riskLevel}`}><i /></span><small>{riskLevel}등급 ({label})</small></span>
}
