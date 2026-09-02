import { useState } from 'react'
import { Disclaimer } from '../components/Disclaimer'
import { ProductCard } from '../components/ProductCard'
import { SimulatorWorkspace } from '../features/simulator/SimulatorWorkspace'
import { getProductSpec, productSpecs } from '../products/products'
import type { ProductSpec } from '../products/types'

export function HomePage() {
  const [catalogSelectedId, setCatalogSelectedId] = useState<ProductSpec['id']>()
  const [simulationSelectedId, setSimulationSelectedId] = useState<ProductSpec['id']>()
  const catalogProduct = catalogSelectedId ? getProductSpec(catalogSelectedId) : undefined
  const simulationProduct = simulationSelectedId ? getProductSpec(simulationSelectedId) : undefined

  const selectCatalogProduct = (product: ProductSpec) => {
    setCatalogSelectedId((current) => current === product.id ? undefined : product.id)
    setSimulationSelectedId(product.id)
  }

  return (
    <main>
      <header className="hero">
        <p className="eyebrow">STRUCTURED PRODUCTS · BETA</p>
        <h1>
          <span>ELB · ELS</span>
          <em>Simulator</em>
        </h1>
        <p className="hero-description">상품 구조를 확인하고, 기존 시세 데이터 기반 Monte Carlo로 상환 가능성과 <span className="hero-no-break">위험을</span> 함께 살펴봅니다.</p>
      </header>

      <section className="product-section" aria-labelledby="products-title">
        <div className="section-heading section-heading--products">
          <div>
            <p className="eyebrow">PRODUCTS</p>
            <h2 id="products-title">상품 선택</h2>
          </div>
          <span>4개 상품</span>
        </div>
        <div className="product-grid">
          {productSpecs.map((product) => (
            <ProductCard key={product.id} product={product} onSelect={selectCatalogProduct} />
          ))}
        </div>
      </section>

      <div className="workspace">
        <SimulatorWorkspace
          catalogProduct={catalogProduct}
          simulationProduct={simulationProduct}
          products={productSpecs}
          onSimulationProductChange={setSimulationSelectedId}
        />
      </div>

      <Disclaimer />
    </main>
  )
}
