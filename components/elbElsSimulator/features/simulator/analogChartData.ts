import { valueForEstimation } from '../../marketData'
import type { DailyPrice } from '../../marketData/types'

/** Display-only normalization. Model inputs and analog scores are not changed. */
export function normalizedPricePath(history: readonly DailyPrice[], from: string, to: string, points = 40): readonly number[] {
  const values = history
    .filter((point) => point.date >= from && point.date <= to)
    .map(valueForEstimation)
    .filter((value) => Number.isFinite(value) && value > 0)
  if (values.length < 2) return []
  return resample(values.map((value) => 100 * value / values[0]), points)
}

/**
 * Continuation metadata is normalized to 100 independently. Rebase it to the
 * analog episode's final level so the display is one continuous price path.
 */
export function connectNormalizedContinuation(historical: readonly number[], continuation: readonly number[]) {
  if (!historical.length) return { historical, continuation, combined: continuation, anchorIndex: 0 }
  if (!continuation.length) return { historical, continuation, combined: historical, anchorIndex: historical.length - 1 }
  const historicalEnd = historical.at(-1)!
  const continuationStart = continuation[0]
  const rebasedContinuation = continuation.map((value) => historicalEnd * value / continuationStart)
  return {
    historical,
    continuation: rebasedContinuation,
    combined: [...historical, ...rebasedContinuation.slice(1)],
    anchorIndex: historical.length - 1,
  }
}

function resample(values: readonly number[], points: number): readonly number[] {
  if (points <= 1) return [values[0]]
  return Array.from({ length: points }, (_, index) => interpolate(values, index * (values.length - 1) / (points - 1)))
}

function interpolate(values: readonly number[], position: number) {
  const lower = Math.floor(position)
  const fraction = position - lower
  const left = values[lower] ?? values.at(-1) ?? 100
  const right = values[lower + 1] ?? left
  return left + fraction * (right - left)
}
