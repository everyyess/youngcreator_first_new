import { productDocuments } from '../products/documents'
import type { ProductSpec } from '../products/types'

export function ProductDocuments({ product }: { product: ProductSpec }) {
  return <details className="product-documents"><summary>상품 문서 다운로드 <span>PDF 2개</span></summary><div>{productDocuments[product.id].map((document) => <a key={document.kind} href={document.href} download={document.downloadName}><span><b>{document.kind}</b><small>{product.id} · PDF</small></span><i aria-hidden="true">↓</i></a>)}</div><p>투자 전 투자설명서의 상품구조, 중도상환 및 위험요인을 반드시 확인하세요.</p></details>
}
