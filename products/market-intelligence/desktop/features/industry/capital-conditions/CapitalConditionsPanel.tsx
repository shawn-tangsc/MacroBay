import { Fragment, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from 'antd'

import { dashboardCapitalConditionsPresentationPolicy, type DashboardCapitalConditionsState, type DashboardEtfCumulativeWindow, type DashboardEtfFlowAsset } from './capitalConditionsModel'
import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

type Text = {
  title: string
  loading: string
  empty: string
  unavailable: string
  stablecoinSupply: string
  change7d: string
  btcEtfLatest: string
  ethEtfLatest: string
  btcEtfCumulative: string
  ethEtfCumulative: string
  cumulativeWindow: string
  cumulativeWindowPartial: string
  cumulativeUnavailable: string
  observedAt: string
  etfFlow: string
  etfUnavailable: string
  funds: string
  btc: string
  eth: string
  flowDirections: Record<'inflow' | 'outflow' | 'zero', string>
  singleDay: string
  consecutiveDays: string
  valueUnavailable: string
  refresh: string
  refreshFailed: string
}

export function CapitalConditionsPanel({ state, text, onRefresh, refreshing = false, refreshFailed = false }: Readonly<{
  state: DashboardCapitalConditionsState
  text: Text
  /** Absent when the host has no collection layer to ask, so the panel stays read-only. */
  onRefresh?: () => void
  refreshing?: boolean
  refreshFailed?: boolean
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  if (state.state !== 'available') return <section className="mi-capital-conditions" data-state={state.state}>
    <div className="mi-capital-conditions__summary">
      <h2>{text.title}</h2>
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

  return <section className="mi-capital-conditions" data-state={state.state}>
    <div className="mi-capital-conditions__content-row">
      <div className="mi-capital-conditions__summary">
        <div className="mi-capital-conditions__header-band">
          <h2>{text.title}</h2>
          <small className="mi-capital-conditions__observed-at">{`${text.observedAt} ${formatTime(state.observedAt)}`}</small>
        </div>
        <div className="mi-capital-conditions__facts"><dl>
          <Fact kind="supply" label={text.stablecoinSupply} value={state.currentUsd} />
          <Fact kind="change" label={text.change7d} value={`${state.change7dUsd} · ${state.change7dPercent}`} direction={flowDirection(state.change7dUsd)} />
          <Fact kind="etf" label={text.btcEtfLatest} value={state.etf === 'unavailable' ? text.valueUnavailable : state.etf.btc.latestNetFlowUsd} direction={state.etf === 'unavailable' ? 'zero' : flowDirection(state.etf.btc.latestNetFlowUsd)} />
          <Fact kind="etf" label={text.ethEtfLatest} value={state.etf === 'unavailable' ? text.valueUnavailable : state.etf.eth.latestNetFlowUsd} direction={state.etf === 'unavailable' ? 'zero' : flowDirection(state.etf.eth.latestNetFlowUsd)} />
          {/* Cumulative rows read the same validated ETF window as the chart. A window the source
              cannot cover keeps its real day count instead of being shown as a full 20 days. */}
          <CumulativeFact label={text.btcEtfCumulative} asset={state.etf === 'unavailable' ? 'unavailable' : state.etf.btc} text={text} />
          <CumulativeFact label={text.ethEtfCumulative} asset={state.etf === 'unavailable' ? 'unavailable' : state.etf.eth} text={text} />
        </dl></div>
        {state.etf !== 'unavailable' ? <EtfFlowSummary etf={state.etf} text={text} /> : null}
      </div>
      <EtfFlow state={state.etf} flowHistory={state.flowHistory} text={text} />
    </div>
  </section>
}

type DashboardEtfFlow = Extract<Extract<DashboardCapitalConditionsState, { state: 'available' }>['etf'], { state: 'available' }>

function EtfFlowSummary({ etf, text }: { etf: DashboardEtfFlow; text: Text }): React.ReactElement {
  return <div className="mi-capital-conditions__etf-summary">
    <EtfFlowConclusion asset={etf.btc} label={text.btc} text={text} />
    <EtfFlowConclusion asset={etf.eth} label={text.eth} text={text} />
  </div>
}

type EtfFlowConclusionAsset = { asset: 'BTC' | 'ETH'; rows: readonly { direction: 'inflow' | 'outflow' | 'zero' }[] }

function CumulativeFact({ label, asset, text }: { label: string; asset: DashboardEtfFlowAsset | 'unavailable'; text: Text }): React.ReactElement {
  return <div className="mi-capital-conditions__cumulative" data-capital-fact="etf-cumulative">
    <dt>{label}</dt>
    {asset === 'unavailable'
      ? <dd className="mi-capital-conditions__cumulative-unavailable">{text.cumulativeUnavailable}</dd>
      : asset.cumulative.map((window, index) => (
        <Fragment key={window.windowDays}>
          <dd className="mi-capital-conditions__cumulative-window"><CumulativeWindow window={window} text={text} /></dd>
          {index === 0 ? <span className="mi-capital-conditions__cumulative-separator" aria-hidden="true"> · </span> : null}
        </Fragment>
      ))}
  </div>
}

/**
 * The day label and the covered-day caveat stay muted; only the formatted amount carries the
 * direction color. Splitting on `{amount}` keeps translator word order intact when the number is
 * not at the end of the sentence.
 */
function CumulativeWindow({ window, text }: { window: DashboardEtfCumulativeWindow; text: Text }): React.ReactElement {
  const template = window.complete ? text.cumulativeWindow : text.cumulativeWindowPartial
  const [before = '', after = ''] = template.split('{amount}')
  const values = { days: window.windowDays, coveredDays: window.coveredDays }
  return <span className="mi-capital-conditions__cumulative-window">
    <span className="mi-capital-conditions__cumulative-days">{format(before, values)}</span>
    <span data-flow-direction={flowDirection(window.netFlowUsd)}>{window.netFlowUsd}</span>
    {after ? <span className="mi-capital-conditions__cumulative-caveat">{format(after, values)}</span> : null}
  </span>
}

function EtfFlowConclusion({ asset, label, text }: { asset: EtfFlowConclusionAsset; label: string; text: Text }): React.ReactElement | null {
  const latest = asset.rows.at(-1)
  if (!latest) return null
  const days = consecutiveDirectionDays(asset.rows, latest.direction)
  const duration = days === 1 ? text.singleDay : format(text.consecutiveDays, { count: days })
  return <div data-etf-summary-asset={asset.asset.toLowerCase()}>
    <strong><i aria-hidden="true" data-series={asset.asset.toLowerCase()} />{label}</strong>
    <span data-flow-direction={latest.direction}>{text.flowDirections[latest.direction]} · {duration}</span>
  </div>
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
  return <section className="mi-capital-conditions__etf-flow" data-etf-flow="available"><header><h3>{text.etfFlow}</h3></header><div className="mi-capital-conditions__chart-legend"><span><i data-series="funds" />{text.funds}</span><span><i data-series="btc" />{text.btc}</span><span><i data-series="eth" />{text.eth}</span></div><div className="mi-capital-conditions__chart" ref={chartRef} role="img" aria-label={text.etfFlow} onMouseLeave={() => setHoveredFlow(null)}><div className="mi-capital-conditions__chart-axis" aria-hidden="true" data-zero-axis={maximumMagnitude === 0 ? 'true' : undefined}>{axisMagnitude ? <><span>{axisMagnitude}</span><span>$0</span><span>-{axisMagnitude.slice(1)}</span></> : <span>$0</span>}</div><div className="mi-capital-conditions__chart-zero" />{hoveredFlow ? <><div className="mi-capital-conditions__chart-crosshair" data-flow-crosshair="vertical" style={{ left: hoveredFlow.x }} /><div className="mi-capital-conditions__chart-crosshair" data-flow-crosshair="horizontal" style={{ top: hoveredFlow.y }} /></> : null}{visibleRows.map((row) => <div className="mi-capital-conditions__chart-day" data-trading-date={row.tradingDate} key={row.tradingDate} onMouseEnter={(event) => updateHover(row, event)} onMouseMove={(event) => updateHover(row, event)}><div className="mi-capital-conditions__chart-half" data-flow-half="inflow">{dashboardCapitalConditionsPresentationPolicy.flowChart.series.filter((series) => row[series] >= 0).map((series) => <Bar key={series} series={series} value={row[series]} maximumMagnitude={maximumMagnitude} />)}</div><div className="mi-capital-conditions__chart-half" data-flow-half="outflow">{dashboardCapitalConditionsPresentationPolicy.flowChart.series.filter((series) => row[series] < 0).map((series) => <Bar key={series} series={series} value={row[series]} maximumMagnitude={maximumMagnitude} />)}</div></div>)}{hoveredFlow ? <div className="mi-capital-conditions__chart-tooltip" data-flow-tooltip style={{ left: hoveredFlow.tooltipLeft, top: hoveredFlow.tooltipTop }}><strong>{hoveredFlow.row.tradingDate}</strong><span><i data-series="funds" />{text.funds}<b>{formatFlowValue(hoveredFlow.row.funds)}</b></span><span><i data-series="btc" />{text.btc}<b>{formatFlowValue(hoveredFlow.row.btc)}</b></span><span><i data-series="eth" />{text.eth}<b>{formatFlowValue(hoveredFlow.row.eth)}</b></span></div> : null}</div><div className="mi-capital-conditions__chart-ticks" aria-hidden="true">{tickIndexes.map((index) => <span key={visibleRows[index].tradingDate}>{visibleRows[index].tradingDate}</span>)}</div></section>
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
