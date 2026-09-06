export function percent(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

export function money(value: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Formats a positive won amount using Korean eok/man units for presentation.
 * This deliberately does not coerce arbitrary text so invalid input can stay hidden.
 */
export function koreanMoneyUnits(value: number | string | null | undefined): string {
  const parsed = typeof value === 'number' ? value : parseMoneyInput(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return ''

  const eok = Math.floor(parsed / 100_000_000)
  const remainderAfterEok = parsed % 100_000_000
  const man = Math.floor(remainderAfterEok / 10_000)
  const won = remainderAfterEok % 10_000
  const parts: string[] = []

  if (eok > 0) parts.push(`${eok.toLocaleString('ko-KR')}억`)
  if (man > 0) parts.push(`${man.toLocaleString('ko-KR')}만`)
  if (won > 0) parts.push(`${won.toLocaleString('ko-KR')}원`)
  else parts.push('원')

  return parts.join(' ')
}

function parseMoneyInput(value: string | null | undefined): number {
  if (value === null || value === undefined) return Number.NaN
  const normalized = value.trim().replaceAll(',', '')
  if (!/^\d+$/.test(normalized)) return Number.NaN
  return Number(normalized)
}
