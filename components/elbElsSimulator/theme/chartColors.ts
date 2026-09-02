import type { Underlying, UnderlyingTicker } from '../products/types'

export const UNDERLYING_COLORS_BY_CODE = {
  '005930': '#0A78F5',
  '000660': '#ED4770',
} as const

export const UNDERLYING_COLORS: Readonly<Record<Underlying, string>> = {
  삼성전자: UNDERLYING_COLORS_BY_CODE['005930'],
  SK하이닉스: UNDERLYING_COLORS_BY_CODE['000660'],
}

export function underlyingColor(underlying: Underlying, ticker?: UnderlyingTicker) {
  const code = ticker?.replace('.KS', '') as keyof typeof UNDERLYING_COLORS_BY_CODE | undefined
  return code ? UNDERLYING_COLORS_BY_CODE[code] ?? UNDERLYING_COLORS[underlying] : UNDERLYING_COLORS[underlying]
}
