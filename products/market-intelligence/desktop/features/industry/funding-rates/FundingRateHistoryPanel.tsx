import { useRef, useState } from 'react'

import { dashboardFundingRateHistoryPresentationPolicy, formatDashboardFundingRateHistoryValue, type DashboardFundingRateHistoryPoint, type DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'

import './FundingRateHistoryPanel.css'
import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

type Text = { title: string; pairTitle: string; loading: string; empty: string; unavailable: string; observedAt: string; assets: { btc: string; eth: string }; paymentDirections: Record<'long-pays-short' | 'short-pays-long' | 'neutral', string> }

type ChartPoint = Readonly<{ observedAt: string; btc?: DashboardFundingRateHistoryPoint; eth?: DashboardFundingRateHistoryPoint }>

const fundingRateHistoryTooltipPlacementPolicy = {
  horizontalOffset: 12,
  inset: 4,
  outerWidth: 204
} as const

export function FundingRateHistoryPanel({ state, text }: { state: DashboardFundingRateHistoryState; text: Text }): React.ReactElement {
  if (state.state !== 'available') return <section className="mi-funding-rate-history" data-state={state.state}><h2>{text.pairTitle}</h2>
    {state.state === 'loading' ? <LoadingState label={text.loading} minHeight={140} /> : <p>{text[state.state]}</p>}
  </section>
  const rows = chartRows(state.btc, state.eth)
  return <section className="mi-funding-rate-history" data-state="available"><h2>{text.pairTitle}</h2><div className="mi-funding-rate-history__content"><div className="mi-funding-rate-history__latest"><Latest asset="btc" point={state.btc.at(-1)} text={text} /><Latest asset="eth" point={state.eth.at(-1)} text={text} /></div><FundingChart rows={rows} text={text} /></div></section>
}

function Latest({ asset, point, text }: { asset: 'btc' | 'eth'; point?: DashboardFundingRateHistoryPoint; text: Text }): React.ReactElement {
  const formatTime = useShellTimeFormat()
  return <div data-funding-latest={asset} data-payment-direction={point?.paymentDirection}><strong>{text.assets[asset]}</strong>{point ? <><b>{formatDashboardFundingRateHistoryValue(point.ratePercent)}</b><span>{text.paymentDirections[point.paymentDirection]}</span><small>{text.observedAt} {formatTime(point.observedAt)}</small></> : <span>{text.empty}</span>}</div>
}

function FundingChart({ rows, text }: { rows: readonly ChartPoint[]; text: Text }): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const chart = useRef<HTMLDivElement>(null); const [hover, setHover] = useState<{ row: ChartPoint; crosshairX: number; crosshairY: number; tooltipLeft: number; placement: 'left' | 'right' }>()
  const magnitude = Math.max(...rows.flatMap((row) => [Math.abs(row.btc?.ratePercent ?? 0), Math.abs(row.eth?.ratePercent ?? 0)]), 0)
  const hoverRow = (row: ChartPoint, event: React.MouseEvent<HTMLElement>) => { const rect = chart.current?.getBoundingClientRect(); if (rect) { const crosshairX = event.clientX - rect.left; const placement = tooltipPlacement(crosshairX, rect.width); setHover({ row, crosshairX, crosshairY: event.clientY - rect.top, tooltipLeft: tooltipLeft(crosshairX, rect.width, placement), placement }) } }
  const tickIndexes = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])]
  return <div className="mi-funding-rate-history__chart-wrap"><div className="mi-funding-rate-history__legend"><span><i aria-hidden="true" data-series="btc" />{text.assets.btc}</span><span><i aria-hidden="true" data-series="eth" />{text.assets.eth}</span></div><div className="mi-funding-rate-history__chart" ref={chart} onMouseLeave={() => setHover(undefined)} role="img" aria-label={text.title}><div className="mi-funding-rate-history__axis" aria-hidden="true"><span>{formatDashboardFundingRateHistoryValue(magnitude)}</span><span>0%</span><span>{formatDashboardFundingRateHistoryValue(-magnitude)}</span></div><i className="mi-funding-rate-history__zero" />{hover ? <><i className="mi-funding-rate-history__crosshair mi-funding-rate-history__crosshair--vertical" style={{ left: hover.crosshairX }} /><i className="mi-funding-rate-history__crosshair mi-funding-rate-history__crosshair--horizontal" style={{ top: hover.crosshairY }} /></> : null}{rows.map((row) => <div className="mi-funding-rate-history__day" data-observed-at={row.observedAt} key={row.observedAt} onMouseMove={(event) => hoverRow(row, event)} onMouseEnter={(event) => hoverRow(row, event)}>{(['btc', 'eth'] as const).map((asset) => <FundingBar asset={asset} key={asset} point={row[asset]} maximum={magnitude} />)}</div>)}{hover ? <div className="mi-funding-rate-history__tooltip" data-funding-tooltip data-placement={hover.placement} style={{ left: hover.tooltipLeft, top: hover.crosshairY }}><strong>{formatTime(hover.row.observedAt)}</strong>{(['btc', 'eth'] as const).map((asset) => <span key={asset} data-series={asset}>{text.assets[asset]} {hover.row[asset] ? `${formatDashboardFundingRateHistoryValue(hover.row[asset]!.ratePercent)} · ${text.paymentDirections[hover.row[asset]!.paymentDirection]}` : text.empty}</span>)}</div> : null}</div><div className="mi-funding-rate-history__ticks">{tickIndexes.map((index) => <span key={rows[index]!.observedAt}>{formatTick(rows[index]!.observedAt)}</span>)}</div></div>
}

function FundingBar({ asset, point, maximum }: { asset: 'btc' | 'eth'; point?: DashboardFundingRateHistoryPoint; maximum: number }): React.ReactElement | null {
  if (!point) return null
  const magnitude = maximum > 0 && point.ratePercent !== 0 ? Math.max(dashboardFundingRateHistoryPresentationPolicy.chart.minimumVisibleHeightPercent, Math.abs(point.ratePercent) / maximum * dashboardFundingRateHistoryPresentationPolicy.chart.maximumHeightPercent) : 0
  return <i data-series={asset} data-direction={point.ratePercent > 0 ? 'positive' : point.ratePercent < 0 ? 'negative' : 'zero'} style={{ '--mi-funding-height': `${magnitude}%` } as React.CSSProperties} />
}

function chartRows(btc: readonly DashboardFundingRateHistoryPoint[], eth: readonly DashboardFundingRateHistoryPoint[]): readonly ChartPoint[] {
  const byTime = new Map<string, ChartPoint>()
  for (const [asset, rows] of [['btc', btc], ['eth', eth]] as const) for (const row of rows) byTime.set(row.observedAt, { ...(byTime.get(row.observedAt) ?? { observedAt: row.observedAt }), [asset]: row })
  return [...byTime.values()]
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
    .slice(-dashboardFundingRateHistoryPresentationPolicy.chart.maximumTimestamps)
}

function formatTick(value: string): string { return `${value.slice(5, 10)} ${value.slice(11, 16)}` }

function tooltipPlacement(x: number, width: number): 'left' | 'right' {
  const { horizontalOffset, inset, outerWidth } = fundingRateHistoryTooltipPlacementPolicy
  const rightFits = x + horizontalOffset + outerWidth <= width - inset
  const leftFits = x - horizontalOffset - outerWidth >= inset
  if (rightFits) return 'right'
  if (leftFits) return 'left'
  return x <= width / 2 ? 'right' : 'left'
}

function tooltipLeft(crosshairX: number, width: number, placement: 'left' | 'right'): number {
  const { horizontalOffset, inset, outerWidth } = fundingRateHistoryTooltipPlacementPolicy
  const preferredLeft = placement === 'right'
    ? crosshairX + horizontalOffset
    : crosshairX - outerWidth - horizontalOffset
  return clamp(preferredLeft, inset, Math.max(inset, width - outerWidth - inset))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
