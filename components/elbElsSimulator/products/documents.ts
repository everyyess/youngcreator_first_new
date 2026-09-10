import type { ProductId } from './types'

export interface ProductDocument {
  kind: '투자설명서' | '제안서'
  href: string
  downloadName: string
}

const documents = (id: ProductId): readonly ProductDocument[] => [
  { kind: '투자설명서', href: `/documents/${id}-investment-prospectus.pdf`, downloadName: `${id}_투자설명서.pdf` },
  { kind: '제안서', href: `/documents/${id}-proposal.pdf`, downloadName: `${id}_제안서.pdf` },
]

export const productDocuments: Readonly<Record<ProductId, readonly ProductDocument[]>> = {
  ELB2962: documents('ELB2962'),
  ELB2963: documents('ELB2963'),
  ELS31438: documents('ELS31438'),
  ELS31439: documents('ELS31439'),
}
