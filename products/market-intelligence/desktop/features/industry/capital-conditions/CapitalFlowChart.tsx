import { useLayoutEffect, useRef, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { dashboardCapitalConditionsPresentationPolicy } from './capitalConditionsModel'
import { flowAccessibleName, type FlowAccessibleText } from './capitalFlowAccessibleName'
import { formatFlowUsd } from './capitalFlowFormat'
import { pickFlowLabelIndexes, placeFlowLabels, type FlowLabelAnchor, type FlowLabelBox } from './capitalFlowLabels'
import type { FlowChartRow } from './capitalFlowRows'

type ChartText = FlowAccessibleText & {
  etfFlow: string
  chartWindow: string
  fundsColumn: string
  fundsScope: string
  btc: string
  eth: string
}

type HoveredFlow = { row: FlowChartRow; x: number; y: number; tooltipLeft: number; tooltipTop: number }

type ChartGeometry = { labelHeight: number; gap: number; inset: number; maxLanes: number }

/** Pixels only: measured boxes are compared against measured bars, never against a fixed offset. */
const labelGeometry: ChartGeometry = { labelHeight: 14, gap: 2, inset: 4, maxLanes: 3 }

const tooltipPlacement = { offset: 14, inset: 4, estimatedWidth: 176, estimatedHeight: 86 } as const

/**
 * The flow chart. Three readings are labelled on the stablecoin series (largest inflow,
 * largest outflow, last day); the rest are reachable by hovering, and the daily table below is
 * the full, keyboard-reachable copy of the same rows.
 *
 * The frame is a `group`, not an `img`: an image role would make every label inside it
 * decoration, and the labels have to carry their own accessible names.
 */
export function CapitalFlowChart({ rows, text }: Readonly<{ rows: readonly FlowChartRow[]; text: ChartText }>): React.ReactElement {
  const language = useShellLanguage()
  const chartRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef<Record<number, HTMLElement | null>>({})
  const [hoveredFlow, setHoveredFlow] = useState<HoveredFlow | null>(null)
  const [labelBoxes, setLabelBoxes] = useState<readonly FlowLabelBox[]>([])

  const maximumMagnitude = Math.max(0, ...rows.flatMap((row) => [Math.abs(row.funds), Math.abs(row.btc), Math.abs(row.eth)]))
  const axisMagnitude = maximumMagnitude === 0 ? undefined : formatFlowUsd(maximumMagnitude, { signed: false })
  const tickIndexes = rows.length === 0 ? [] : [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])]
  const labelIndexes = pickFlowLabelIndexes(rows)

  useLayoutEffect(() => {
    const chart = chartRef.current
    if (!chart) return undefined
    const measure = (): void => {
      const chartRect = chart.getBoundingClientRect()
      if (!chartRect.width || !chartRect.height) return
      const anchors: FlowLabelAnchor[] = []
      for (const index of labelIndexes) {
        const bar = chart.querySelector<HTMLElement>(`[data-flow-bar="${index}"]`)
        const label = labelRefs.current[index]
        if (!bar || !label) continue
        const barRect = bar.getBoundingClientRect()
        const direction = directionOf(rows[index]?.funds ?? 0)
        anchors.push({
          index,
          centerX: barRect.left - chartRect.left + barRect.width / 2,
          edgeY: direction === 'outflow' ? barRect.bottom - chartRect.top : barRect.top - chartRect.top,
          direction,
          width: label.offsetWidth
        })
      }
      setLabelBoxes(placeFlowLabels(anchors, { ...labelGeometry, chartWidth: chartRect.width, chartHeight: chartRect.height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(chart)
    return () => observer.disconnect()
  }, [rows])

  const updateHover = (row: FlowChartRow, event: React.MouseEvent<HTMLElement>): void => {
    const rect = chartRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clamp(event.clientX - rect.left, 0, rect.width)
    const y = clamp(event.clientY - rect.top, 0, rect.height)
    setHoveredFlow({ row, x, y, ...placeTooltip(x, y, rect.width, rect.height) })
  }

  return <>
    <div className="mi-capital-conditions__chart" ref={chartRef} role="group" aria-label={`${text.etfFlow} · ${text.chartWindow}`} onMouseLeave={() => setHoveredFlow(null)}>
      <div className="mi-capital-conditions__chart-axis" aria-hidden="true" data-zero-axis={maximumMagnitude === 0 ? 'true' : undefined}>
        {axisMagnitude ? <><span>{axisMagnitude}</span><span>$0</span><span>-{axisMagnitude}</span></> : <span>$0</span>}
      </div>
      <div className="mi-capital-conditions__chart-zero" />
      {hoveredFlow ? <>
        <div className="mi-capital-conditions__chart-crosshair" data-flow-crosshair="vertical" style={{ left: hoveredFlow.x }} />
        <div className="mi-capital-conditions__chart-crosshair" data-flow-crosshair="horizontal" style={{ top: hoveredFlow.y }} />
      </> : null}
      {rows.map((row, index) => <div className="mi-capital-conditions__chart-day" data-trading-date={row.tradingDate} key={row.tradingDate}
        onMouseEnter={(event) => updateHover(row, event)} onMouseMove={(event) => updateHover(row, event)}>
        <div className="mi-capital-conditions__chart-half" data-flow-half="inflow">
          {dashboardCapitalConditionsPresentationPolicy.flowChart.series.filter((series) => row[series] >= 0).map((series) =>
            <Bar key={series} dayIndex={index} series={series} value={row[series]} maximumMagnitude={maximumMagnitude} />)}
        </div>
        <div className="mi-capital-conditions__chart-half" data-flow-half="outflow">
          {dashboardCapitalConditionsPresentationPolicy.flowChart.series.filter((series) => row[series] < 0).map((series) =>
            <Bar key={series} dayIndex={index} series={series} value={row[series]} maximumMagnitude={maximumMagnitude} />)}
        </div>
      </div>)}
      <div className="mi-capital-conditions__chart-labels">
        {labelIndexes.map((index) => {
          const value = rows[index]?.funds ?? 0
          const direction = directionOf(value)
          const box = labelBoxes.find((candidate) => candidate.index === index)
          return <span className="mi-capital-conditions__chart-label" data-flow-label={index} key={`label-${index}`}
            ref={(node) => { labelRefs.current[index] = node }}
            style={{ left: box?.left ?? 0, top: box?.top ?? 0, visibility: box ? 'visible' : 'hidden' }}
            aria-label={flowAccessibleName(text, value, direction, text.fundsScope, language)}>
            {formatFlowUsd(value)}
          </span>
        })}
      </div>
      {hoveredFlow ? <div className="mi-capital-conditions__chart-tooltip" data-flow-tooltip style={{ left: hoveredFlow.tooltipLeft, top: hoveredFlow.tooltipTop }}>
        <strong>{hoveredFlow.row.tradingDate}</strong>
        <span><i data-series="funds" />{text.fundsColumn}<b>{formatFlowUsd(hoveredFlow.row.funds)}</b></span>
        <span><i data-series="btc" />{text.btc}<b>{formatFlowUsd(hoveredFlow.row.btc)}</b></span>
        <span><i data-series="eth" />{text.eth}<b>{formatFlowUsd(hoveredFlow.row.eth)}</b></span>
      </div> : null}
    </div>
    <div className="mi-capital-conditions__chart-ticks" aria-hidden="true">
      {tickIndexes.map((index) => <span key={rows[index]?.tradingDate}>{rows[index]?.tradingDate}</span>)}
    </div>
  </>
}

function Bar({ series, value, maximumMagnitude, dayIndex }: {
  series: string
  value: number
  maximumMagnitude: number
  dayIndex: number
}): React.ReactElement {
  const magnitudePercent = value === 0 ? 0 : maximumMagnitude > 0
    ? Math.max(dashboardCapitalConditionsPresentationPolicy.flowChart.minimumVisibleMagnitudePercent, Math.min(dashboardCapitalConditionsPresentationPolicy.flowChart.maximumMagnitudePercent, Math.abs(value) / maximumMagnitude * dashboardCapitalConditionsPresentationPolicy.flowChart.maximumMagnitudePercent))
    : 0
  return <i data-series={series} data-flow={directionOf(value)} data-flow-bar={series === 'funds' ? dayIndex : undefined}
    style={{ '--mi-flow-height': `${magnitudePercent}%` } as React.CSSProperties} />
}

function directionOf(value: number): 'inflow' | 'outflow' | 'zero' {
  return value > 0 ? 'inflow' : value < 0 ? 'outflow' : 'zero'
}

function placeTooltip(x: number, y: number, width: number, height: number): Pick<HoveredFlow, 'tooltipLeft' | 'tooltipTop'> {
  const maxLeft = Math.max(tooltipPlacement.inset, width - tooltipPlacement.estimatedWidth - tooltipPlacement.inset)
  const maxTop = Math.max(tooltipPlacement.inset, height - tooltipPlacement.estimatedHeight - tooltipPlacement.inset)
  const left = clamp(x + tooltipPlacement.offset, tooltipPlacement.inset, maxLeft)
  const above = y - tooltipPlacement.estimatedHeight - tooltipPlacement.offset
  const below = y + tooltipPlacement.offset
  const top = clamp(above >= tooltipPlacement.inset ? above : below, tooltipPlacement.inset, maxTop)
  return { tooltipLeft: left, tooltipTop: top }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
