import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { UstCurveMode, UstCurveView } from './ustCurveModel'

/**
 * 五条期限的曲线。只画 `view` 里给的线（价差与实际利率不进这里），窗口是模型切好的同一份。
 *
 * 三条几何规则照原型，不在这里重新发明：右缘留 112（线末读数要写「期限 + 值」，96 会把多的那位裁掉）、
 * 值域取自**画出来的**那组数（归一模式是 bp，拿水平值定域会把线画到框外）、归一模式必有 0 线。
 *
 * 文案全部由调用方格式化后传进来（日期、百分数、基点、期限名），组件不拼句子。
 */
export type UstCurveFormat = Readonly<{
  /** `4.28%` */
  level: (value: number) => string
  /** `+18bp` / `−33bp` / `0bp` */
  bp: (value: number) => string
  /** `11-19` */
  monthDay: (period: string) => string
  /** `2025-11-18`（跨年时第一根刻度带年份） */
  fullDay: (period: string) => string
  /** 期限名：`3M` / `10Y` … */
  tenor: (id: string) => string
}>

export type UstCurveChartProps = Readonly<{
  view: UstCurveView
  mode: UstCurveMode
  ariaLabel: string
  format: UstCurveFormat
}>

const GUTTER_LEFT = 52
const GUTTER_RIGHT = 112
const TOP = 8
const BOTTOM_GAP = 18
const LABEL_GAP = 14

export function UstCurveChart({ view, mode, ariaLabel, format }: UstCurveChartProps): ReactElement {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [hover, setHover] = useState<number | undefined>(undefined)

  useEffect(() => {
    const node = frameRef.current
    if (!node) return
    const measure = (): void => setBox({ width: Math.round(node.clientWidth), height: Math.round(node.clientHeight) })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const geometry = useMemo(() => layout(view, mode, box.width, box.height, format), [view, mode, box.width, box.height, format])
  const day = hover === undefined ? undefined : view.days[hover]

  return <div className="mi-ust__frame" ref={frameRef}>
    <svg
      className="mi-ust__svg"
      viewBox={`0 0 ${Math.max(1, box.width)} ${Math.max(1, box.height)}`}
      width={box.width}
      height={box.height}
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
      onMouseMove={(event) => {
        if (box.width === 0) return
        const local = event.clientX - event.currentTarget.getBoundingClientRect().left - geometry.plotLeft
        if (local < -8 || local > geometry.plotWidth + 8) { setHover(undefined); return }
        const ratio = Math.max(0, Math.min(1, local / Math.max(1, geometry.plotWidth)))
        setHover(Math.round(ratio * Math.max(0, view.days.length - 1)))
      }}
      onMouseLeave={() => setHover(undefined)}
      onFocus={() => setHover(Math.max(0, view.days.length - 1))}
      onBlur={() => setHover(undefined)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const last = Math.max(0, view.days.length - 1)
        const from = hover ?? last
        setHover(event.key === 'Home' ? 0 : event.key === 'End' ? last
          : Math.max(0, Math.min(last, from + (event.key === 'ArrowLeft' ? -1 : 1))))
      }}>
      {geometry.ticks.map((tick) => <g key={`tick-${tick.value}`}>
        <line className="mi-ust__grid" x1={geometry.plotLeft} x2={geometry.plotRight} y1={tick.y} y2={tick.y} />
        <text className="mi-ust__axis" x={GUTTER_LEFT - 8} y={tick.y + 3} textAnchor="end">{tick.label}</text>
      </g>)}
      {geometry.zeroY !== undefined
        ? <line className="mi-ust__zero" x1={geometry.plotLeft} x2={geometry.plotRight} y1={geometry.zeroY} y2={geometry.zeroY} />
        : null}
      {geometry.xTicks.map((tick) => <text
        key={`xtick-${tick.index}`} className="mi-ust__axis" x={tick.x} y={Math.max(1, box.height) - 4} textAnchor={tick.anchor}>
        {tick.label}
      </text>)}

      {geometry.series.map((entry) => <path key={`line-${entry.id}`} className="mi-ust__line" data-tenor={entry.id} d={entry.path} />)}

      {geometry.ends.map((end) => <g key={`end-${end.id}`} data-tenor={end.id}>
        <path className="mi-ust__leader" data-tenor={end.id}
          d={`M${end.lineX},${end.lineY} L${geometry.plotRight + 8},${end.lineY} L${geometry.plotRight + 8},${end.y}`} />
        <text className="mi-ust__axis mi-ust__axis--end" x={geometry.plotRight + 12} y={end.y + 4} data-tenor={end.id}>
          <tspan fill="var(--ust-color)">{format.tenor(end.id)}</tspan>
          <tspan dx="4" fill="var(--text-strong)">{end.label}</tspan>
        </text>
      </g>)}

      {hover !== undefined && day !== undefined
        ? <g>
          <line className="mi-ust__crosshair" x1={geometry.xAt(hover)} x2={geometry.xAt(hover)} y1={TOP} y2={geometry.bottom} />
          {geometry.series.map((entry) => {
            const value = entry.values[hover]
            if (value === null || value === undefined) return null
            return <circle key={`dot-${entry.id}`} className="mi-ust__dot" data-tenor={entry.id}
              r={2.5} cx={geometry.xAt(hover)} cy={geometry.yAt(value)} />
          })}
        </g>
        : null}
    </svg>

    {hover !== undefined && day !== undefined
      ? <div className="mi-ust__tooltip" data-ust-tooltip="true"
        style={{ left: `${Math.min(Math.max(6, geometry.xAt(hover) + 12), Math.max(6, box.width - 216))}px`, top: `${TOP}px` }}>
        <time>{format.fullDay(day)}</time>
        {geometry.series.map((entry) => {
          const value = entry.values[hover]
          if (value === null || value === undefined) return null
          return <span key={`tip-${entry.id}`} data-tenor={entry.id}>
            <i /><span>{format.tenor(entry.id)}</span>
            <b>{mode === 'level' ? format.level(value) : format.bp(value)}</b>
          </span>
        })}
      </div>
      : null}
  </div>
}

type Geometry = Readonly<{
  plotLeft: number
  plotRight: number
  plotWidth: number
  bottom: number
  ticks: readonly Readonly<{ value: number; y: number; label: string }>[]
  xTicks: readonly Readonly<{ index: number; x: number; label: string; anchor: 'start' | 'middle' | 'end' }>[]
  zeroY?: number
  series: readonly Readonly<{ id: string; path: string; values: readonly (number | null)[] }>[]
  ends: readonly Readonly<{ id: string; y: number; lineX: number; lineY: number; label: string }>[]
  xAt: (index: number) => number
  yAt: (value: number) => number
}>

function layout(view: UstCurveView, mode: UstCurveMode, width: number, height: number, format: UstCurveFormat): Geometry {
  const plotLeft = GUTTER_LEFT
  const plotRight = Math.max(GUTTER_LEFT + 40, width - GUTTER_RIGHT)
  const plotWidth = Math.max(40, plotRight - plotLeft)
  const bottom = Math.max(TOP + 40, height - BOTTOM_GAP)
  const xAt = (index: number): number => plotLeft + (index / Math.max(1, view.days.length - 1)) * plotWidth

  const plotted = view.series.flatMap((entry) => entry.values.filter((value): value is number => value !== null))
  let min = plotted.length ? Math.min(...plotted) : 0
  let max = plotted.length ? Math.max(...plotted) : 1
  if (mode === 'normalized') { min = Math.min(0, min); max = Math.max(0, max) }
  const pad = (max - min) * 0.12 || 0.05
  min -= pad
  max += pad
  const yAt = (value: number): number => bottom - ((value - min) / Math.max(1e-9, max - min)) * (bottom - TOP)

  const step = mode === 'level' ? niceStep(max - min, [0.05, 0.1, 0.2, 0.25, 0.5]) : niceStep(max - min, [2, 5, 10, 20, 25, 50, 100])
  const ticks: { value: number; y: number; label: string }[] = []
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) {
    const rounded = Number(value.toFixed(6))
    ticks.push({ value: rounded, y: yAt(rounded), label: mode === 'level' ? format.level(rounded) : format.bp(rounded) })
  }

  const tickCount = Math.min(4, Math.max(1, view.days.length))
  const crossYear = (view.days[0] ?? '').slice(0, 4) !== (view.days.at(-1) ?? '').slice(0, 4)
  const xTicks = Array.from({ length: tickCount }, (_, order) => {
    const index = tickCount === 1 ? 0 : Math.round((order * (view.days.length - 1)) / (tickCount - 1))
    const period = view.days[index] ?? ''
    return {
      index,
      x: xAt(index),
      label: order === 0 && crossYear ? format.fullDay(period) : format.monthDay(period),
      anchor: (order === 0 ? 'start' : order === tickCount - 1 ? 'end' : 'middle') as 'start' | 'middle' | 'end'
    }
  })

  const series = view.series.map((entry) => {
    let path = ''
    let previous = false
    entry.values.forEach((value, index) => {
      if (value === null) { previous = false; return }
      path += `${previous ? 'L' : 'M'}${xAt(index).toFixed(2)},${yAt(value).toFixed(2)} `
      previous = true
    })
    return { id: entry.id, path: path.trim(), values: entry.values }
  })

  const ends: { id: string; y: number; lineX: number; lineY: number; label: string }[] = []
  for (const entry of view.series) {
    let index = entry.values.length - 1
    while (index >= 0 && entry.values[index] === null) index -= 1
    const value = index >= 0 ? entry.values[index] : null
    if (value === null || value === undefined) continue
    ends.push({
      id: entry.id, y: yAt(value), lineX: xAt(index), lineY: yAt(value),
      label: mode === 'level' ? format.level(value) : format.bp(value)
    })
  }
  ends.sort((left, right) => left.y - right.y)

  // 线末读数互相挤开：14px 是 11 号字一行的最小间距，再小两行会叠在一起。
  for (let index = 1; index < ends.length; index += 1) {
    if (ends[index]!.y - ends[index - 1]!.y < LABEL_GAP) ends[index]!.y = ends[index - 1]!.y + LABEL_GAP
  }
  const overflowBottom = ends.length ? ends[ends.length - 1]!.y - (bottom - 4) : 0
  if (overflowBottom > 0) for (const end of ends) end.y -= overflowBottom
  const overflowTop = ends.length ? TOP + 6 - ends[0]!.y : 0
  if (overflowTop > 0) for (const end of ends) end.y += overflowTop

  return {
    plotLeft, plotRight, plotWidth, bottom, ticks, xTicks,
    ...(mode === 'normalized' ? { zeroY: yAt(0) } : {}),
    series, ends, xAt, yAt
  }
}

function niceStep(range: number, candidates: readonly number[]): number {
  return candidates.find((candidate) => range / candidate <= 7) ?? candidates[candidates.length - 1]!
}
