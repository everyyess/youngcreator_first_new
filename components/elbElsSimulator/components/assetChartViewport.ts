export interface ChartViewport {
  /** Inclusive data index. */
  start: number
  /** Exclusive data index. */
  end: number
}

export const MIN_CHART_WINDOW = 8

export function clampViewport(viewport: ChartViewport, total: number, minimumWindow = MIN_CHART_WINDOW): ChartViewport {
  if (total <= 0) return { start: 0, end: 0 }
  const size = Math.min(total, Math.max(Math.min(minimumWindow, total), Math.round(viewport.end - viewport.start)))
  const start = Math.min(Math.max(0, Math.round(viewport.start)), total - size)
  return { start, end: start + size }
}

export function zoomViewport(viewport: ChartViewport, total: number, anchorRatio: number, factor: number, minimumWindow = MIN_CHART_WINDOW): ChartViewport {
  const current = clampViewport(viewport, total, minimumWindow)
  const currentSize = current.end - current.start
  if (currentSize <= 0) return current
  const anchor = Math.min(1, Math.max(0, anchorRatio))
  const nextSize = Math.min(total, Math.max(Math.min(minimumWindow, total), Math.round(currentSize * factor)))
  const anchorIndex = current.start + anchor * (currentSize - 1)
  const nextStart = Math.round(anchorIndex - anchor * (nextSize - 1))
  return clampViewport({ start: nextStart, end: nextStart + nextSize }, total, minimumWindow)
}

export function panViewport(viewport: ChartViewport, total: number, deltaPoints: number, minimumWindow = MIN_CHART_WINDOW): ChartViewport {
  const current = clampViewport(viewport, total, minimumWindow)
  const start = current.start + Math.round(deltaPoints)
  return clampViewport({ start, end: start + current.end - current.start }, total, minimumWindow)
}

export function visiblePriceDomain(values: readonly number[], paddingRatio = 0.05): [number, number] {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) return [0, 1]
  const low = Math.min(...finite)
  const high = Math.max(...finite)
  const span = high - low
  const padding = span > 0 ? span * paddingRatio : Math.max(Math.abs(low) * 0.02, 1)
  return [low - padding, high + padding]
}
