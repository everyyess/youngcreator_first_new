export interface WeightedPoint {
  value: number
  count: number
}

export function cumulativeProbabilityDomain(values: readonly number[]): [number, number] {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) return [0, 1]
  const minimum = Math.min(...finite)
  const maximum = Math.max(...finite)
  const padding = Math.max((maximum - minimum) * 0.25, 0.025)
  let low = Math.max(0, Math.floor((minimum - padding) * 100) / 100)
  let high = Math.min(1, Math.ceil((maximum + padding) * 100) / 100)
  if (high - low < 0.05) {
    const midpoint = (minimum + maximum) / 2
    low = Math.max(0, Math.floor((midpoint - 0.025) * 100) / 100)
    high = Math.min(1, Math.ceil((midpoint + 0.025) * 100) / 100)
  }
  if (low === high) return low === 0 ? [0, 0.05] : [Math.max(0, low - 0.05), low]
  return [low, high]
}

export function weightedPercentile(points: readonly WeightedPoint[], probability: number) {
  const sorted = [...points].filter((point) => point.count > 0 && Number.isFinite(point.value)).sort((left, right) => left.value - right.value)
  const total = sorted.reduce((sum, point) => sum + point.count, 0)
  if (!total) return 0
  const target = Math.min(1, Math.max(0, probability)) * total
  let cumulative = 0
  for (const point of sorted) {
    cumulative += point.count
    if (cumulative >= target) return point.value
  }
  return sorted.at(-1)!.value
}

export function realizedReturnDomain(points: readonly WeightedPoint[], fullRange: boolean): [number, number] {
  const values = points.filter((point) => point.count > 0 && Number.isFinite(point.value))
  if (!values.length) return [-0.01, 0.01]
  const low = fullRange ? Math.min(...values.map((point) => point.value)) : weightedPercentile(values, 0.01)
  const high = fullRange ? Math.max(...values.map((point) => point.value)) : weightedPercentile(values, 0.995)
  const span = high - low
  const padding = span > 0 ? span * 0.1 : Math.max(Math.abs(low) * 0.1, 0.01)
  return [low - padding, high + padding]
}
