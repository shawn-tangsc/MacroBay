import { useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from 'antd'

import { etfCumulativeFlowPolicy } from '../../../../contracts/etfCumulativeFlow'
import { dashboardCapitalConditionsPresentationPolicy, type DashboardCapitalConditionsState, type DashboardEtfFlowAsset } from './capitalConditionsModel'
import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

type Text = {
  ariaLabel: string
  loading: string
  empty: string
  unavailable: string
  stablecoin: string
  asset: string
  totalSupply: string
  change1d: string
  change7d: string
  change30d: string
  latest: string
  windowDays: string
  coverage: string
  streakColumn: string
  streak: string
  streakSingle: string
  etfTableUnavailable: string
  observedAt: string
  etfFlow: string
  recent7TradingDays: string
  etfUnavailable: string
  funds: string
  btc: string
  eth: string
  flowDirections: Record<'inflow' | 'outflow' | 'zero', string>
  refresh: string
  refreshFailed: string
}

type AvailableState = Extract<DashboardCapitalConditionsState, { state: 'available' }>

export function CapitalConditionsPanel({ state, text, onRefresh, refreshing = false, refreshFailed = false }: Readonly<{
  state: DashboardCapitalConditionsState
  text: Text
  /** Absent when the host has no collection layer to ask, so the panel stays read-only. */
  onRefresh?: () => void
  refreshing?: boolean
  refreshFailed?: boolean
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  if (state.state !== 'available') return <section className="mi-capital-conditions" data-state={state.state} aria-label={text.ariaLabel}>
    <div className="mi-capital-conditions__summary">
      {state.state === 'loading'
        ? <LoadingState label={text.loading} minHeight={140} />
        : <p>{text[state.state]}</p>}
      {/* The state above is what the last read returned. Re-reading it changes nothing, so the
          only useful action here is to ask the sources to be collected again. */}
      {onRefresh ? <Button className="mi-capital-conditions__refresh" disabled={refreshing || state.state === 'loading'}
        icon={<RefreshCw aria-hidden="true" size={13} />} loading={refreshing} onClick={onRefresh} size="small" type="link">{text.refresh}</Button> : null}
      {refreshFailed ? <p className="mi-capital-conditions__refresh-error" role="alert">{text.refreshFailed}</p> : null}
    </div>
  </section>

  return <section className="mi-capital-conditions" data-state={state.state} aria-label={text.ariaLabel}>
    <div className="mi-capital-conditions__content-row">
      <div className="mi-capital-conditions__summary">
        <div className="mi-capital-conditions__header-band">
          <small className="mi-capital-conditions__observed-at">{`${text.observedAt} ${formatTime(state.observedAt)}`}</small>
        </div>
        <StablecoinTable state={state} text={text} />
        <EtfTable etf={state.etf} text={text} />
      </div>
      <EtfFlow state={state.etf} flowHistory={state.flowHistory} text={text} />
    </div>
  </section>
}

/** Stock and flow share one compact table language: supply plus its 1D / 7D / 30D changes. */
function StablecoinTable({ state, text }: { state: AvailableState; text: Text }): React.ReactElement {
  return <table className="mi-capital-conditions__etf-table mi-capital-conditions__stable-table">
    <colgroup>
      <col className="mi-capital-conditions__etf-col-asset" />
      <col span={3} />
      <col className="mi-capital-conditions__etf-col-supply" />
    </colgroup>
    <thead><tr>
      <th scope="col">{text.asset}</th>
      <th scope="col">{text.change1d}<span className="mi-capital-conditions__pct" data-flow-direction={flowDirection(state.change1dUsd)}>({state.change1dPercent})</span></th>
      <th scope="col">{text.change7d}<span className="mi-capital-conditions__pct" data-flow-direction={flowDirection(state.change7dUsd)}>({state.change7dPercent})</span></th>
      <th scope="col">{text.change30d}<span className="mi-capital-conditions__pct" data-flow-direction={flowDirection(state.change30dUsd)}>({state.change30dPercent})</span></th>
      <th scope="col">{text.totalSupply}</th>
    </tr></thead>
    <tbody><tr>
      <th scope="row">{text.stablecoin}</th>
      <td data-flow-direction={flowDirection(state.change1dUsd)}>{state.change1dUsd}</td>
      <td data-flow-direction={flowDirection(state.change7dUsd)}>{state.change7dUsd}</td>
      <td data-flow-direction={flowDirection(state.change30dUsd)}>{state.change30dUsd}</td>
      <td className="mi-capital-conditions__stable-supply">{state.currentUsd}</td>
    </tr></tbody>
  </table>
}


/** One row per asset, one column per horizon: no label repeats inside the body. */
function EtfTable({ etf, text }: { etf: AvailableState['etf']; text: Text }): React.ReactElement {
  const coverage = etf === 'unavailable' ? undefined : etf.coverage
  return <table className="mi-capital-conditions__etf-table">
    <colgroup>
      <col className="mi-capital-conditions__etf-col-asset" />
      <col span={3} />
      <col className="mi-capital-conditions__etf-col-streak" />
    </colgroup>
    <thead><tr>
      <th scope="col">{text.asset}</th>
      <th scope="col">{text.latest}</th>
      {etfCumulativeFlowPolicy.windows.map((days) => {
        const windowCoverage = coverage?.find((candidate) => candidate.windowDays === days)
        return <th scope="col" key={days}>
          {format(text.windowDays, { days })}
          {windowCoverage && !windowCoverage.complete
            ? <> <span className="mi-capital-conditions__coverage">{format(text.coverage, { days: windowCoverage.coveredDays })}</span></>
            : null}
        </th>
      })}
      <th scope="col">{text.streakColumn}</th>
    </tr></thead>
    <tbody>
      {etf === 'unavailable'
        ? <tr><td className="mi-capital-conditions__etf-unavailable" colSpan={5}>{text.etfTableUnavailable}</td></tr>
        : <><EtfRow asset={etf.btc} label={text.btc} text={text} /><EtfRow asset={etf.eth} label={text.eth} text={text} /></>}
    </tbody>
  </table>
}

function EtfRow({ asset, label, text }: { asset: DashboardEtfFlowAsset; label: string; text: Text }): React.ReactElement {
  const latest = asset.rows.at(-1)
  const days = latest ? consecutiveDirectionDays(asset.rows, latest.direction) : 0
  const streak = latest && days > 0
    ? format(days === 1 ? text.streakSingle : text.streak, { flow: text.flowDirections[latest.direction], count: days })
    : ''
  return <tr>
    <th scope="row"><i className="mi-capital-conditions__asset-dot" data-series={asset.asset.toLowerCase()} aria-hidden="true" />{label}</th>
    <td data-flow-direction={flowDirection(asset.latestNetFlowUsd)}>{asset.latestNetFlowUsd}</td>
    {asset.cumulative.map((window) => <td key={window.windowDays} data-flow-direction={flowDirection(window.netFlowUsd)}>{window.netFlowUsd}</td>)}
    <td className="mi-capital-conditions__streak" data-flow-direction={latest?.direction}>{streak}</td>
  </tr>
}

function consecutiveDirectionDays(rows: readonly { direction: 'inflow' | 'outflow' | 'zero' }[], direction: 'inflow' | 'outflow' | 'zero'): number {
  let days = 0
  for (let index = rows.length - 1; index >= 0 && rows[index]?.direction === direction; index -= 1) days += 1
  return days
}

function EtfFlow({ state, flowHistory, text }: { state: Extract<DashboardCapitalConditionsState, { state: 'available' }>['etf']; flowHistory?: Extract<DashboardCapitalConditionsState, { state: 'available' }>['flowHistory']; text: Text }): React.ReactElement {
  const chartRef = useRef<HTMLDivElement>(null)
  const [hoveredFlow, setHoveredFlow] = useState<HoveredFlow | null>(null)
  if (state === 'unavailable' || !flowHistory) return <section className="mi-capital-conditions__etf-flow" data-etf-flow="unavailable"><h3>{text.etfFlow}</h3><p>{text.etfUnavailable}</p></section>
  const visibleRows = flowHistory.rows.slice(-dashboardCapitalConditionsPresentationPolicy.flowChart.defaultVisibleRows)
  const maximumMagnitude = Math.max(...visibleRows.flatMap((row) => [Math.abs(row.funds), Math.abs(row.btc), Math.abs(row.eth)]))
  const axisMagnitude = maximumMagnitude === 0 ? undefined : formatFlowValue(maximumMagnitude)
  const tickIndexes = [0, Math.floor((visibleRows.length - 1) / 2), visibleRows.length - 1]
  const updateHover = (row: FlowChartRow, event: React.MouseEvent<HTMLElement>) => {
    const rect = chartRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clamp(event.clientX - rect.left, 0, rect.width)
    const y = clamp(event.clientY - rect.top, 0, rect.height)
    setHoveredFlow({ row, x, y, ...placeTooltip(x, y, rect.width, rect.height) })
  }
  return <section className="mi-capital-conditions__etf-flow" data-etf-flow="available"><header><h3>{text.etfFlow}</h3><span className="mi-capital-conditions__chart-window">{text.recent7TradingDays}</span></header><div className="mi-capital-conditions__chart-legend"><span><i data-series="funds" />{text.funds}</span><span><i data-series="btc" />{text.btc}</span><span><i data-series="eth" />{text.eth}</span></div><div className="mi-capital-conditions__chart" ref={chartRef} role="img" aria-label={text.etfFlow} onMouseLeave={() => setHoveredFlow(null)}><div className="mi-capital-conditions__chart-axis" aria-hidden="true" data-zero-axis={maximumMagnitude === 0 ? 'true' : undefined}>{axisMagnitude ? <><span>{axisMagnitude}</span><span>$0</span><span>-{axisMagnitude.slice(1)}</span></> : <span>$0</span>}</div><div className="mi-capital-conditions__chart-zero" />{hoveredFlow ? <><div className="mi-capital-conditions__chart-crosshair" data-flow-crosshair="vertical" style={{ left: hoveredFlow.x }} /><div className="mi-capital-conditions__chart-crosshair" data-flow-crosshair="horizontal" style={{ top: hoveredFlow.y }} /></> : null}{visibleRows.map((row) => <div className="mi-capital-conditions__chart-day" data-trading-date={row.tradingDate} key={row.tradingDate} onMouseEnter={(event) => updateHover(row, event)} onMouseMove={(event) => updateHover(row, event)}><div className="mi-capital-conditions__chart-half" data-flow-half="inflow">{dashboardCapitalConditionsPresentationPolicy.flowChart.series.filter((series) => row[series] >= 0).map((series) => <Bar key={series} series={series} value={row[series]} maximumMagnitude={maximumMagnitude} />)}</div><div className="mi-capital-conditions__chart-half" data-flow-half="outflow">{dashboardCapitalConditionsPresentationPolicy.flowChart.series.filter((series) => row[series] < 0).map((series) => <Bar key={series} series={series} value={row[series]} maximumMagnitude={maximumMagnitude} />)}</div></div>)}{hoveredFlow ? <div className="mi-capital-conditions__chart-tooltip" data-flow-tooltip style={{ left: hoveredFlow.tooltipLeft, top: hoveredFlow.tooltipTop }}><strong>{hoveredFlow.row.tradingDate}</strong><span><i data-series="funds" />{text.funds}<b>{formatFlowValue(hoveredFlow.row.funds)}</b></span><span><i data-series="btc" />{text.btc}<b>{formatFlowValue(hoveredFlow.row.btc)}</b></span><span><i data-series="eth" />{text.eth}<b>{formatFlowValue(hoveredFlow.row.eth)}</b></span></div> : null}</div><div className="mi-capital-conditions__chart-ticks" aria-hidden="true">{tickIndexes.map((index) => <span key={visibleRows[index].tradingDate}>{visibleRows[index].tradingDate}</span>)}</div></section>
}

type FlowChartRow = { tradingDate: string; funds: number; btc: number; eth: number }
type HoveredFlow = { row: FlowChartRow; x: number; y: number; tooltipLeft: number; tooltipTop: number }

const chartTooltipPlacementPolicy = { offset: 14, inset: 4, estimatedWidth: 176, estimatedHeight: 86 } as const

function placeTooltip(x: number, y: number, width: number, height: number): Pick<HoveredFlow, 'tooltipLeft' | 'tooltipTop'> {
  const maxLeft = Math.max(chartTooltipPlacementPolicy.inset, width - chartTooltipPlacementPolicy.estimatedWidth - chartTooltipPlacementPolicy.inset)
  const maxTop = Math.max(chartTooltipPlacementPolicy.inset, height - chartTooltipPlacementPolicy.estimatedHeight - chartTooltipPlacementPolicy.inset)
  const left = clamp(x + chartTooltipPlacementPolicy.offset, chartTooltipPlacementPolicy.inset, maxLeft)
  const above = y - chartTooltipPlacementPolicy.estimatedHeight - chartTooltipPlacementPolicy.offset
  const below = y + chartTooltipPlacementPolicy.offset
  const top = clamp(above >= chartTooltipPlacementPolicy.inset ? above : below, chartTooltipPlacementPolicy.inset, maxTop)
  return { tooltipLeft: left, tooltipTop: top }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function formatFlowValue(value: number, includeSign = true): string {
  const normalized = Object.is(value, -0) ? 0 : value
  const absolute = Math.abs(normalized)
  const unit = dashboardCapitalConditionsPresentationPolicy.usd.compactUnits.find((candidate) => absolute >= candidate.threshold)
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: dashboardCapitalConditionsPresentationPolicy.usd.maximumFractionDigits, useGrouping: false }).format(absolute / (unit?.threshold ?? 1))
  return `${includeSign && normalized > 0 ? '+' : normalized < 0 ? '-' : ''}$${formatted}${unit?.suffix ?? ''}`
}

function Bar({ series, value, maximumMagnitude }: { series: typeof dashboardCapitalConditionsPresentationPolicy.flowChart.series[number]; value: number; maximumMagnitude: number }): React.ReactElement {
  const magnitudePercent = value === 0 ? 0 : maximumMagnitude > 0
    ? Math.max(dashboardCapitalConditionsPresentationPolicy.flowChart.minimumVisibleMagnitudePercent, Math.min(dashboardCapitalConditionsPresentationPolicy.flowChart.maximumMagnitudePercent, Math.abs(value) / maximumMagnitude * dashboardCapitalConditionsPresentationPolicy.flowChart.maximumMagnitudePercent))
    : 0
  return <i data-series={series} data-flow={value > 0 ? 'inflow' : value < 0 ? 'outflow' : 'zero'} style={{ '--mi-flow-height': `${magnitudePercent}%` } as React.CSSProperties} />
}

function Fact({ kind, label, value, direction }: { kind: 'change' | 'supply' | 'etf'; label: string; value: string; direction?: 'inflow' | 'outflow' | 'zero' }): React.ReactElement {
  return <div data-capital-fact={kind}><dt>{label}</dt>{value ? <dd data-flow-direction={direction}>{value}</dd> : null}</div>
}

function flowDirection(value: string): 'inflow' | 'outflow' | 'zero' {
  return value.startsWith('+') ? 'inflow' : value.startsWith('-') ? 'outflow' : 'zero'
}

function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''))
}
