import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Area, Bar, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { withChartIndicators } from '../marketData/chartIndicators'
import type { DailyPrice } from '../marketData'
import type { Underlying, UnderlyingTicker } from '../products/types'
import { underlyingColor } from '../theme/chartColors'
import { clampViewport, panViewport, visiblePriceDomain, zoomViewport, type ChartViewport } from './assetChartViewport'

type DragState = { pointerId: number; x: number; viewport: ChartViewport; moved: boolean }

export function AssetPriceChart({ name, ticker, history }: { name: Underlying; ticker: UnderlyingTicker; history: readonly DailyPrice[] }) {
  const [options, setOptions] = useState({ ma: false, trend: false, ichimoku: false })
  const [viewport, setViewport] = useState<ChartViewport>({ start: 0, end: 252 })
  const [dragging, setDragging] = useState(false)
  const chartElement = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const allData = useMemo(() => withChartIndicators(history).slice(-252), [history])
  const safeViewport = clampViewport(viewport, allData.length)
  const data = allData.slice(safeViewport.start, safeViewport.end)
  const latest = allData.at(-1)
  const prior = allData.at(-2)

  useEffect(() => {
    setViewport({ start: 0, end: allData.length })
  }, [allData.length])

  useEffect(() => {
    const node = chartElement.current
    if (!node) return
    const wheel = (event: WheelEvent) => {
      const horizontalGesture = Math.abs(event.deltaX) > Math.abs(event.deltaY) && Math.abs(event.deltaX) > 1
      if (horizontalGesture && !event.ctrlKey) {
        event.preventDefault()
        const width = Math.max(node.clientWidth, 1)
        setViewport((current) => panViewport(current, allData.length, event.deltaX / width * (current.end - current.start) * 1.8))
        return
      }

      const pinchGesture = event.ctrlKey
      const mouseWheel = event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || Math.abs(event.deltaY) >= 40
      if (!pinchGesture && !mouseWheel) return

      event.preventDefault()
      const bounds = node.getBoundingClientRect()
      const anchor = (event.clientX - bounds.left) / Math.max(bounds.width, 1)
      const factor = event.deltaY < 0 ? 0.8 : 1.25
      setViewport((current) => zoomViewport(current, allData.length, anchor, factor))
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => node.removeEventListener('wheel', wheel)
  }, [allData.length])

  if (!latest || !prior) return null
  const diff = latest.close - prior.close
  const rate = diff / prior.close
  const color = underlyingColor(name, ticker)
  const domain = visiblePriceDomain(data.map((row) => row.close))
  const toggle = (key: keyof typeof options) => setOptions((value) => ({ ...value, [key]: !value[key] }))

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const deltaPixels = event.clientX - drag.current.x
    if (!drag.current.moved && Math.abs(deltaPixels) < 4) return
    drag.current.moved = true
    setDragging(true)
    const width = Math.max(event.currentTarget.clientWidth, 1)
    const windowSize = drag.current.viewport.end - drag.current.viewport.start
    setViewport(panViewport(drag.current.viewport, allData.length, -deltaPixels / width * windowSize))
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.current = null
    setDragging(false)
  }

  return <article className="asset-chart">
    <header><div><h4>{name} <small>{ticker.replace('.KS', '')}</small></h4><strong>{latest.close.toLocaleString()}원</strong> <em className={diff >= 0 ? 'up' : 'down'}>{diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toLocaleString()}원 ({(rate * 100).toFixed(2)}%)</em></div><div className="chart-options"><span>보조지표 옵션</span>{([['ma', '이동평균선'], ['trend', '추세선'], ['ichimoku', '일목균형표']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={options[key]} onChange={() => toggle(key)} />{label}</label>)}</div></header>
    <div className="asset-summary"><span>고가 <b>{(latest.high ?? latest.close).toLocaleString()}원</b></span><span>저가 <b>{(latest.low ?? latest.close).toLocaleString()}원</b></span><span>거래량 <b>{(latest.volume ?? 0).toLocaleString()}</b></span></div>
    <div
      ref={chartElement}
      className={`asset-chart-main${dragging ? ' is-dragging' : ''}`}
      tabIndex={0}
      aria-label={`${name} 인터랙티브 주가 그래프`}
      onPointerEnter={(event) => event.currentTarget.focus({ preventScroll: true })}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        drag.current = { pointerId: event.pointerId, x: event.clientX, viewport: safeViewport, moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={pointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    ><ResponsiveContainer><ComposedChart data={data}><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={46} /><YAxis yAxisId="price" tickFormatter={wonFull} width={76} domain={domain} /><Tooltip cursor={false} content={dragging ? () => null : <PriceTooltip color={color} />} /><Legend />
      {options.ichimoku && <Area yAxisId="price" type="monotone" dataKey="spanA" stroke="rgba(35,150,85,.6)" fill="rgba(35,150,85,.13)" name="선행스팬 A" />}{options.ichimoku && <Area yAxisId="price" type="monotone" dataKey="spanB" stroke="rgba(204,77,67,.6)" fill="rgba(204,77,67,.10)" name="선행스팬 B" />}
      <Line yAxisId="price" type="monotone" dataKey="close" stroke={color} strokeWidth={2.3} dot={false} name="종가" />{options.ma && <><Line yAxisId="price" dataKey="sma20" stroke="#E58A24" dot={false} name="SMA 20" /><Line yAxisId="price" dataKey="ema12" stroke="#159570" dot={false} name="EMA 12" strokeDasharray="4 3" /></>}{options.trend && <><Line yAxisId="price" dataKey="support" stroke="#28A05C" dot={false} name="지지 추세선" strokeDasharray="6 3" /><Line yAxisId="price" dataKey="resistance" stroke="#B76A2B" dot={false} name="저항 추세선" strokeDasharray="6 3" /></>}{options.ichimoku && <><Line yAxisId="price" dataKey="tenkan" stroke="#7B5CC7" dot={false} name="전환선" /><Line yAxisId="price" dataKey="kijun" stroke="#C18425" dot={false} name="기준선" /><Line yAxisId="price" dataKey="chikou" stroke="#697888" dot={false} name="후행스팬" strokeDasharray="3 3" /></>}</ComposedChart></ResponsiveContainer></div>
    <div className="asset-volume"><ResponsiveContainer><ComposedChart data={data}><XAxis dataKey="date" hide /><YAxis tickFormatter={volumeShort} width={52} /><Tooltip cursor={false} content={dragging ? () => null : <PriceTooltip color={color} />} /><Bar dataKey="volume" fill={color} fillOpacity={.55} name="거래량" /></ComposedChart></ResponsiveContainer></div>
  </article>
}

function shortDate(value: string) { return value.slice(2) }
function wonFull(value: number) { return Math.round(value).toLocaleString() }
function volumeShort(value: number) { return value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : `${Math.round(value / 1000)}K` }
function PriceTooltip({ active, payload, color }: { active?: boolean; payload?: Array<{ payload: { date: string; close: number; high?: number; low?: number; volume?: number } }>; color: string }) { const row = payload?.[0]?.payload; return active && row ? <div className="price-tooltip"><b style={{ color }}><i className="series-dot" style={{ background: color }} />{row.date}</b><span>종가 {row.close.toLocaleString()}원</span><span>고가 {(row.high ?? row.close).toLocaleString()}원 · 저가 {(row.low ?? row.close).toLocaleString()}원</span><span>거래량 {(row.volume ?? 0).toLocaleString()}</span></div> : null }
