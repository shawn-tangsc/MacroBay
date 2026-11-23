import { useRef, useState, type CSSProperties } from 'react'
import { Button } from 'antd'
import type { CrossAssetId, CrossAssetMacroProxyId, CrossAssetSnapshot } from '../../../../contracts/crossAssetObservationContracts'
import type { CrossAssetEventLine } from './crossAssetEventLines'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

/**
 * 图上能画的线。行 id 与线 id 在这五条上同名，是刻意的：一格关掉，那一行与那条线一起消失。
 *
 * **合成线的口径**：美元 / 黄金一行背后是主源 + 备用源两个格（`quotes:usd` + `quotes:usd-fallback`），
 * 只有两个格都关掉时这一行才进 `hideStatusRows`，也才把这条线交给 `hiddenLines`——主源关、
 * 备用源还开着时线照旧画，因为它读的仍是一份开着的格。
 */
export const crossAssetChartLines = ['index', 'btc', 'eth', 'dxy', 'gold'] as const

export type CrossAssetChartLineId = (typeof crossAssetChartLines)[number]

/** 按「哪些行被关掉」给出去掉哪些线；行 id 与线 id 同名，映射只此一处。 */
export function chartLinesHiddenBy(hiddenRows: readonly string[]): readonly CrossAssetChartLineId[] {
  return crossAssetChartLines.filter((line) => hiddenRows.includes(line))
}

const isCryptoLine = (line: LineId): line is CrossAssetId => line === 'index' || line === 'btc' || line === 'eth'

/** A line's points on the window grid: the crypto legs from their own curves, the dollar and gold from the macro ones. */
function pointsOfLine(
  curves: CrossAssetSnapshot['curves'], macroCurves: CrossAssetSnapshot['macroCurves'], line: LineId
): readonly { at: string; returnPercent: number | null }[] {
  return isCryptoLine(line) ? curves[line] ?? [] : macroCurves?.[line] ?? []
}

/**
 * 本段没有可比数据的线：这条线一个点都没有值，也没有仍在形成的尾巴。
 *
 * 说的是**数据**，不是渲染——线画不出来是结果，读者要的是「这一段的数据怎么了」。**读失败不在这里**：
 * 整条通道没读到、或某一格没启用/读不到时，线根本不进图例（调用点的 `hiddenLines` 与状态分支各管各的）。
 * 美元/黄金两条线只在真有曲线时才进图例，所以空数组不算「本段无数据」——那是这一腿压根没有数据。
 *
 * 图例后面那句话与图标题 ⓘ 里的原因都从这里来：一个判据，两处转述。
 */
export function linesWithoutComparableData(input: Readonly<{
  curves: CrossAssetSnapshot['curves']
  macroCurves?: CrossAssetSnapshot['macroCurves']
  forming?: CrossAssetSnapshot['forming']
}>): readonly CrossAssetChartLineId[] {
  return crossAssetChartLines.filter(line => {
    const points = pointsOfLine(input.curves, input.macroCurves, line)
    if (points.length === 0) return isCryptoLine(line)
    if (points.some(point => point.returnPercent !== null)) return false
    // 仍在形成的那一段也是画得出来的点：没有收盘值不等于这条线什么都没有。
    return !isCryptoLine(line) || (input.forming?.[line]?.returnPercent ?? null) === null
  })
}

export const crossAssetChartPolicy = Object.freeze({ width: 1000, height: 200, inset: 8, tooltipWidth: 210, tooltipHeight: 128, offset: 12,
  tickSlots: 3,
  assets: ['index', 'btc', 'eth'] as const,
  /**
   * The macro lines drawn beside them. They are always drawn last and always below the crypto rows in
   * the legend, because they are the *reference*: the reader looks at the dollar line to explain the
   * three rows beside it, never the other way round.
   */
  macroProxies: ['dxy', 'gold'] as const })
type LineId = CrossAssetId | CrossAssetMacroProxyId
type Text = {
  chart: string; assets: Record<CrossAssetId, string>; macroAssets: Record<CrossAssetMacroProxyId, string>
  noData: string; forming: string
  /** 图例里那条本段没有可比数据的线，名字后面说一句（原因在图标题的 ⓘ 里）。说的是数据，不是渲染。 */
  lineNoComparableData: string
  /** What a line's tooltip and its accessible name read: the time, then what happened. */
  eventLine: string; eventsCollapsed: string
  /** 同一分钟里官方与 provider 都在、却没能确认是同一条发布时，线上要说明这件事（设计 145 §8 B）。 */
  eventLineIdentityUnconfirmed: string
}
const percent = (value: number) => `${value < 0 ? '−' : value > 0 ? '+' : ''}${Math.abs(value) > 0 && Math.abs(value) < .01 ? '<0.01' : Math.abs(value).toFixed(2)}%`

export function CrossAssetReturnChart({ curves, macroCurves, forming, events, eventsCollapsed, onSelectEvent, text, hiddenLines }: {
  curves: CrossAssetSnapshot['curves']; macroCurves?: CrossAssetSnapshot['macroCurves']
  /**
   * 读者在设置里关掉的格：这些线连同图例一起不画（不是画 0、不是灰掉）。
   * 与图内那颗「点图例隐藏」是两件事：那个是读者临时看图，这个是这一格根本不读。
   */
  hiddenLines?: readonly CrossAssetChartLineId[]
  forming?: CrossAssetSnapshot['forming']; text: Text
  /** The window's high-importance calendar events, already reduced to one line per minute. */
  events?: readonly CrossAssetEventLine[]
  /** How many lines the cap left out, so the reader is told the plot is not the whole calendar. */
  eventsCollapsed?: number
  onSelectEvent?: (line: CrossAssetEventLine) => void
}): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const policy = crossAssetChartPolicy
  /**
   * A line is listed once it has points, and hidden only when the reader hides it.
   *
   * The chart's first render happens before the snapshot arrives, so a `visible` list seeded from what
   * exists at mount would never include the macro lines that arrive with it. A hidden set has the
   * opposite default: everything that has data is drawn, and the legend is what takes it away.
   */
  const [hidden, setHidden] = useState<readonly LineId[]>([])
  const [hover, setHover] = useState<{ index: number; tooltipLeft: number; tooltipTop: number }>()
  const plotRef = useRef<HTMLDivElement>(null)
  /**
   * 浮层的定位与高度都以**图那一栏**（图框 + 刻度）为准，不是以绘图区为准。
   *
   * 绘图区只有 104–171 高（行高 44 之后），而五条线的浮层要 140 出头：按绘图区算
   * `max-height` 会把五行裁 3、四行 25、三行 27 像素并长出一条滚动条（用户 2026-11-23 真机）。
   * 挂在这一栏上，三、四行时浮层可以压到刻度那一行上，仍不越过图例。
   */
  const chartAreaRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  /** Macro lines are drawn only when the wire carried them, and only when they have a curve at all. */
  const listed: readonly LineId[] = [...policy.assets, ...policy.macroProxies.filter(proxy => (macroCurves?.[proxy]?.length ?? 0) > 0)]
    .filter(id => hiddenLines?.includes(id as CrossAssetChartLineId) !== true)
  const visible = listed.filter(id => !hidden.includes(id))
  /** 本窗内没有可比数据的线：图例名字后面说一句，图标题的 ⓘ 说原因——同一个判据（见 `linesWithoutComparableData`）。 */
  const withoutComparableData = linesWithoutComparableData({
    curves, ...(macroCurves === undefined ? {} : { macroCurves }), ...(forming === undefined ? {} : { forming })
  })
  const pointsOf = (id: LineId): readonly { at: string; returnPercent: number | null }[] =>
    pointsOfLine(curves, macroCurves, id)
  /** The macro legs have no live tail: their provider publishes a close, it does not stream one. */
  const formingOf = (id: LineId) => id in curves ? forming?.[id as CrossAssetId] : undefined
  const labelOf = (id: LineId): string => id in curves ? text.assets[id as CrossAssetId] : text.macroAssets[id as CrossAssetMacroProxyId]
  const times = curves.index.map(point => Date.parse(point.at))
  const start = times[0] ?? 0
  const closedEnd = times.at(-1) ?? start
  const end = Math.max(closedEnd, ...policy.assets.map(asset => forming?.[asset] ? Date.parse(forming[asset]!.at) : closedEnd))
  const values = visible.flatMap(id => [...pointsOf(id).map(point => point.returnPercent), formingOf(id)?.returnPercent]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const min = Math.min(0, ...values); const max = Math.max(0, ...values)
  const x = (at: number) => end === start ? policy.width / 2 : (at - start) / (end - start) * policy.width
  const y = (value: number) => max === min ? policy.height / 2 : policy.height - (value - min) / (max - min) * policy.height
  const tickWidth = policy.width / policy.tickSlots
  const tickLabels: { index: number; anchor: number; left: number }[] = []
  for (const index of [...new Set([0, Math.floor((times.length - 1) / 2), times.length - 1])]) {
    if (index < 0 || !times.length) continue
    const anchor = x(times[index])
    const left = Math.max(0, Math.min(anchor - tickWidth / 2, policy.width - tickWidth))
    const previous = tickLabels.at(-1)
    if (!previous || left >= previous.left + tickWidth) tickLabels.push({ index, anchor, left })
  }
  const tails = visible.flatMap(id => {
    const tail = formingOf(id); const last = pointsOf(id).at(-1)
    return tail && last && last.returnPercent !== null ? [{ asset: id, ...tail }] : []
  })
  const inspectionTimes = [...new Set([...times, ...tails.map(tail => Date.parse(tail.at))])].sort((a,b) => a-b)
  const inspectedAt = hover ? inspectionTimes[hover.index] : undefined
  const inspectedClosedIndex = inspectedAt === undefined ? -1 : times.indexOf(inspectedAt)
  const inspectedForming = inspectedAt !== undefined && tails.some(tail => Date.parse(tail.at) === inspectedAt)
  function path(id: LineId) {
    let previous = false
    return pointsOf(id).map(point => {
      if (point.returnPercent === null) { previous = false; return '' }
      const command = `${previous ? 'L' : 'M'}${x(Date.parse(point.at))},${y(point.returnPercent)}`
      previous = true
      return command
    }).join(' ')
  }
  function inspect(index: number, mouseY: number) {
    const box = plotRef.current?.getBoundingClientRect()
    if (!box || !inspectionTimes.length) return
    /**
     * 高度按**那一栏**算，横向仍按绘图区算：栏比绘图区多出纵轴与间距，横向放进去浮层会压到
     * 轴标签上。取不到栏（单测里没铺版）时退回绘图区，行为与原来一致。
     */
    const area = chartAreaRef.current?.getBoundingClientRect()
    const measured = area !== undefined && area.height > 0
    const bounds = measured ? area : box
    const offsetLeft = measured ? box.left - area.left : 0
    const offsetTop = measured ? box.top - area.top : 0
    const tooltip = tooltipRef.current?.getBoundingClientRect()
    const width = Math.min(tooltip?.width || policy.tooltipWidth, Math.max(0, box.width - 2 * policy.inset))
    const height = Math.min(tooltip?.height || policy.tooltipHeight, Math.max(0, bounds.height - 2 * policy.inset))
    const anchorX = x(inspectionTimes[index]) / policy.width * box.width
    const preferred = anchorX + policy.offset + width <= box.width - policy.inset ? anchorX + policy.offset : anchorX - policy.offset - width
    setHover({ index, tooltipLeft: offsetLeft + Math.max(policy.inset, Math.min(preferred, box.width - width - policy.inset)),
      tooltipTop: Math.max(policy.inset, Math.min(offsetTop + mouseY + policy.offset, bounds.height - height - policy.inset)) })
  }
  return <div className="mi-cross-asset__chart">
    <div className="mi-cross-asset__legend">{listed.map(id => (
      // 本段没有可比数据的那一条不是控件：这条线本来就没有画出来，点它没有任何可见结果，留着就是假控件
      // （界面设计 2026-11-16）。它只说这条线的数据怎么了——没有颜色点、不可点、没有按下态；
      // 为什么没有仍在图标题那颗 ⓘ 里，不在这里开第二个入口。有数据的照旧是切换按钮。
      withoutComparableData.includes(id)
        ? <span className="mi-cross-asset__legend-no-data" data-asset={id} data-no-comparable-data={id} key={id}>
            {labelOf(id)}<small>{text.lineNoComparableData}</small>
          </span>
        : <Button key={id} type="text" size="small" data-asset={id} aria-pressed={visible.includes(id)} disabled={visible.length === 1 && visible.includes(id)}
            onClick={() => setHidden(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])}><i />{labelOf(id)}</Button>
    ))}</div>
    <div ref={chartAreaRef} className="mi-cross-asset__chart-area">
      <div className="mi-cross-asset__chart-frame">
        <div className="mi-cross-asset__y-axis">{(max === min ? [0] : [max, 0, min].filter((value, index, all) => all.indexOf(value) === index)).map(value => <span key={value} style={{ top: `${y(value) / policy.height * 100}%` }}>{percent(value)}</span>)}</div>
        <div ref={plotRef} data-cross-asset-plot className="mi-cross-asset__plot" role="group" aria-label={text.chart} tabIndex={0}
          onMouseLeave={() => setHover(undefined)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHover(undefined) }}
          onMouseMove={event => {
            const box = event.currentTarget.getBoundingClientRect()
            const localX = event.clientX - box.left
            if (localX < 0 || localX > box.width) { setHover(undefined); return }
            const at = start + Math.max(0, Math.min(1, localX / box.width)) * (end - start)
            let index = 0
            inspectionTimes.forEach((time, candidate) => { if (Math.abs(time - at) < Math.abs(inspectionTimes[index] - at)) index = candidate })
            inspect(index, event.clientY - box.top)
          }}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            inspect(event.key === 'End' ? inspectionTimes.length - 1 : event.key === 'Home' ? 0 : Math.max(0, Math.min(inspectionTimes.length - 1, (hover?.index ?? 0) + (event.key === 'ArrowLeft' ? -1 : 1))), 0)
          }}>
          <svg aria-hidden="true" viewBox={`0 0 ${policy.width} ${policy.height}`} preserveAspectRatio="none">
            <line className="mi-cross-asset__zero" x1="0" x2={policy.width} y1={y(0)} y2={y(0)} />
            {visible.map(id => <path key={id} data-asset-line={id} d={path(id)} />)}
            {visible.map(id => {
              const tail = formingOf(id); const last = pointsOf(id).at(-1)
              return tail && last?.returnPercent !== null && last ? <g key={id} data-forming-line={id} aria-label={text.forming}><title>{text.forming}</title><path d={`M${x(Date.parse(last.at))},${y(last.returnPercent)} L${x(Date.parse(tail.at))},${y(tail.returnPercent)}`} /><circle cx={x(Date.parse(tail.at))} cy={y(tail.returnPercent)} r="3" /></g> : null
            })}
          </svg>
          {/*
            The calendar's own events, drawn over the curves: a line answers "when", the shape beside it
            answers "how much", and a reader looking at a step at 14:05 needs both to say what happened.
            Solid once something in that minute was published, dashed while it is all still ahead — only
            the first kind explains a move that has already happened. HTML rather than SVG so they are
            focusable and announce themselves the way every other control here does.

            例外（用户 2026-11-09 定）：这条竖线是**图上的可视标记**，不是控件。它的可点区域本来就是一块
            透明、可聚焦、有名字的元素（`aria-label` 写明时刻与事件名，`:hover` / `:focus-visible` 各加深
            竖线并露出标签），换成平台按钮会把一个 12px 宽、绝对定位的图形层包成一枚按钮，图形就散了。
            保留并登记，别硬改。
          */}
          {(events ?? []).map(line => <button
            aria-label={`${text.eventLine} ${formatTime(new Date(line.atMs).toISOString(), 'second')}：${line.label}${line.identityUnconfirmed ? ` · ${text.eventLineIdentityUnconfirmed}` : ''}`}
            className="mi-cross-asset__event-line"
            data-event-line={line.atMs}
            data-identity={line.identityUnconfirmed ? 'unconfirmed' : 'confirmed'}
            data-published={line.published ? 'true' : 'false'}
            key={line.atMs}
            onClick={() => onSelectEvent?.(line)}
            style={{ left: `${x(line.atMs) / policy.width * 100}%` }}
            type="button"
          ><i aria-hidden="true" /><span className="mi-cross-asset__event-line-label">{line.label}</span></button>)}
          {eventsCollapsed && eventsCollapsed > 0
            ? <p className="mi-cross-asset__event-line-note">{text.eventsCollapsed.replace('{count}', String(eventsCollapsed))}</p>
            : null}
          {hover && inspectedAt !== undefined
            ? <i data-crosshair className="mi-cross-asset__crosshair" style={{ left: `${x(inspectedAt) / policy.width * 100}%` }} />
            : null}
        </div>
      </div>
      <div className="mi-cross-asset__ticks" style={{ '--mi-cross-asset-tick-count': policy.tickSlots } as CSSProperties}>{tickLabels.map(({ index, anchor, left }) => <time key={index} style={{ left: `${anchor / policy.width * 100}%`, transform: `translateX(${(left - anchor) / tickWidth * 100}%)`, textAlign: left === 0 ? 'left' : left + tickWidth === policy.width ? 'right' : 'center' }}>{formatTime(curves.index[index].at)}</time>)}</div>
      {/* 浮层挂在这一栏上，**不挂绘图区**：`max-height: 100%` 分辨率的是这里的栏高。 */}
      {hover && inspectedAt !== undefined
        ? <div ref={tooltipRef} role="tooltip" className="mi-cross-asset__tooltip" style={{ left: hover.tooltipLeft, top: hover.tooltipTop }}>
            <time>{formatTime(new Date(inspectedAt).toISOString(), 'second')}</time>
            {inspectedForming ? <small>{text.forming}</small> : null}
            {visible.map(id => {
              const tail = tails.find(tail => tail.asset === id && Date.parse(tail.at) === inspectedAt)
              const value = tail?.returnPercent ?? pointsOf(id)[inspectedClosedIndex]?.returnPercent
              return <span key={id} data-asset={id}><i />{labelOf(id)}<b>{value == null ? text.noData : percent(value)}</b></span>
            })}
          </div>
        : null}
    </div>
  </div>
}
