import type { DailyPrice, MarketDataProvider } from './types'

/**
 * Browser-side adapter for the same-origin Node.js development proxy.
 * The browser never calls Yahoo Finance directly, avoiding browser CORS limits.
 */
export function createYoungCreatorYahooProvider(options: {
  apiOrigin?: string
  fetchFn?: typeof fetch
} = {}): MarketDataProvider {
  const apiOrigin = options.apiOrigin ?? ''
  const fetchFn = options.fetchFn ?? fetch

  return {
    async getDailyPrices(ticker, from, to) {
      const url = new URL('/api/proxy-finance', apiOrigin || window.location.origin)
      url.searchParams.set('ticker', ticker)
      url.searchParams.set('startDate', from)
      url.searchParams.set('endDate', to)
      const response = await fetchFn(url)
      if (!response.ok) throw new Error(`Market data request failed (${response.status}).`)
      const payload = await response.json() as YahooChartResponse
      return parseYahooChartDailyPrices(payload)
    },
  }
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{ close?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; volume?: Array<number | null> }>
        adjclose?: Array<{ adjclose?: Array<number | null> }>
      }
    }>
  }
}

/** Shared parsing policy: raw close is retained even when an adjusted close exists. */
export function parseYahooChartDailyPrices(payload: YahooChartResponse): DailyPrice[] {
  const chart = payload.chart?.result?.[0]
  const timestamps = chart?.timestamp ?? []
  const closes = chart?.indicators?.quote?.[0]?.close ?? []
  const highs = chart?.indicators?.quote?.[0]?.high ?? []
  const lows = chart?.indicators?.quote?.[0]?.low ?? []
  const volumes = chart?.indicators?.quote?.[0]?.volume ?? []
  const adjusted = chart?.indicators?.adjclose?.[0]?.adjclose ?? []

  return timestamps.flatMap((timestamp, index) => {
    const close = closes[index]
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) return []
    const adjustedClose = adjusted[index]
    return [{
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      close,
      ...(typeof highs[index] === 'number' ? { high: highs[index] } : {}),
      ...(typeof lows[index] === 'number' ? { low: lows[index] } : {}),
      ...(typeof volumes[index] === 'number' ? { volume: volumes[index] } : {}),
      ...(typeof adjustedClose === 'number' && Number.isFinite(adjustedClose) && adjustedClose > 0 ? { adjustedClose } : {}),
    }]
  }).sort((left, right) => left.date.localeCompare(right.date))
}
