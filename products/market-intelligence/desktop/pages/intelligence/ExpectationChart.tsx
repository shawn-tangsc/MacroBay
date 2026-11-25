import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellCompactInstant, formatShellDay } from '@platform/ui/time/shellTimeFormat'

import { expectationBp, type PolicyPathDistribution, type PolicyPathOutcome } from '../../../contracts/policyPath'
import { pickReadoutWidth, placeReadout, READOUT_TIP_WIDTH } from './readoutPlacement'

/**
 * 「利率数学期望」曲线。
 *
 * **绘制本身是从 `2026-11-13-K11-b.html` 搬过来的**：坐标函数、两条 `userSpaceOnUse` 渐变
 * （0 轴 0.02 → 曲线 0.40，红 `#B3362B` / 蓝 `#2E5F9E`）、零轴、红面积、2px 柠绿曲线、
 * 事件虚线 + 圆点 + 贴顶标注、纵轴刻度与 0 轴线。
 *
 * 三处改写（与原型不同，且必须不同）：
 * 1. 横轴是**绝对时刻**：原型把点按下标等距铺开，真实观测的间隔并不等距（有 10 分钟一段，
 *    也有 9 小时的空档），按下标铺会把空档压没、把密集段拉长。这里按时刻线性铺开。
 * 2. **按像素分箱**（见 `binExpectationPoints`）：1662 个点全画是噪点墙，而分箱必须按图宽做。
 * 3. 事件标注按时刻落位，标签宽度用估算（SVG 里量字要等布局，这里不需要精确到像素）。
 *
 * 读数面板（`mk-tip`）跟着鼠标走，键盘用左右键移点。它是**图自己的绝对定位子元素**，
 * 不开 portal、不是全局浮层，也不改变页面布局：每次移动只改面板里的 text 和它的 transform。
 */
const L = 52
const RM = 12
/**
 * 绘图区在卡片里的左右内距：**只有这一份**。
 * 卡片本身还给 12 内距（见 `cryptoDashboard.css` 的 `.mk-dash-expectation`），左边那份**不许再给一遍**——
 * 用户 2026-11 反馈「图在卡片里两边有好多空」，就是 52 在容器与图里各出现了一次。
 */
export const EXPECTATION_PLOT_INSET = Object.freeze({ left: L, right: RM })
const T0 = 16
const B = 34
/** 面板与光标之间的距离：横向留出的这段空隙，才是「不遮住那一点」的保证。 */
const TIP_OFFSET = 10

/** 刻度：正数带 `+`，负数带 `−`（U+2212，不是连字符），零不带符号。 */
export function formatTick(value: number): string {
  const rounded = Math.round(value)
  if (rounded === 0) return '0bp'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}bp`
}

/** 曲线上的一个点：绝对时刻、那一刻的加权期望（bp）以及算出它的五桶概率。 */
export type ExpectationPoint = Readonly<{ at: string; bp: number; values: PolicyPathDistribution }>

/**
 * 标注文字的宽度估算：**按字符类别逐字累加**，不是「长度 × 一个数」。
 *
 * 9.5px 字号下，一个汉字/全角字符约 9.5px，西文与数字半角约 5.2px。只按 5.2 估，
 * 一条中文事件名会少算一半，夹边按估出来的宽度算、实际画出来更宽，就压到旁边的卡片上。
 * 上限 160px：超了截断加省略号——图上的标注是索引，不是标题。
 */
export const EVENT_LABEL_MAX_WIDTH = 160

export function estimateEventLabelWidth(text: string): number {
  let width = 0
  for (const character of text) width += isWideCharacter(character) ? 9.5 : 5.2
  return width
}

export function fitEventLabel(text: string, maxWidth = EVENT_LABEL_MAX_WIDTH): string {
  if (estimateEventLabelWidth(text) <= maxWidth) return text
  const ellipsis = '…'
  const budget = maxWidth - estimateEventLabelWidth(ellipsis)
  let trimmed = ''
  let used = 0
  for (const character of text) {
    const next = isWideCharacter(character) ? 9.5 : 5.2
    if (used + next > budget) break
    trimmed += character
    used += next
  }
  return `${trimmed}${ellipsis}`
}

function isWideCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  // CJK 统一表意文字、假名、全角标点/字母数字都在这些区段里。
  return code >= 0x2e80
}

/** 一个事件标注：时刻、事件名（已本地化）、推动量（bp）、标注处曲线的高度（bp）。 */
export type ExpectationEvent = Readonly<{ at: string; label: string; changeBp: number; bp: number }>

/**
 * 分箱规则——**这是唯一一处定义，改图宽不会得到另一条曲线**：
 *
 * - 箱数 = `max(1, floor(绘图区像素宽 / 3))`，即每箱 3px。在 13 天半的窗口上，一箱约 2 小时；
 *   现有 1662 条观测（中位间隔 10 分钟）大约是每箱 10–11 条。
 * - 每箱取**箱内时刻最晚的一条**（as-of 语义：读者看到的是「那一刻市场的最新判断」），
 *   **不取平均**——平均会把盘中抖动抹成一条并不存在的平滑线。
 * - 箱内没有观测 → 留空（`null`），**不插值、不跨箱借用**。采集停过的地方必须看得出是停过。
 *
 * 返回的是每个箱的 bp 值，下标就是箱号；坐标由调用方按箱中心换算。
 */
export const EXPECTATION_BIN_PX = 3

export function binExpectationPoints(
  points: readonly ExpectationPoint[],
  plotWidth: number
): readonly (number | null)[] {
  const width = Math.max(1, Math.floor(plotWidth))
  const count = Math.max(1, Math.floor(width / EXPECTATION_BIN_PX))
  const bins: (number | null)[] = Array.from({ length: count }, () => null)
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return bins
  const fromMs = Date.parse(first.at)
  const toMs = Date.parse(last.at)
  const spanMs = toMs - fromMs
  for (const point of points) {
    const at = Date.parse(point.at)
    if (!Number.isFinite(at) || !Number.isFinite(point.bp)) continue
    const fraction = spanMs > 0 ? (at - fromMs) / spanMs : 0.5
    const index = Math.min(count - 1, Math.max(0, Math.floor(fraction * count)))
    bins[index] = point.bp
  }
  return bins
}

/** 面板里的五档顺序：加息 25 / 加息 50+ / 不动 / 降息 25 / 降息 50+。 */
const PANEL_ORDER: readonly PolicyPathOutcome[] = ['hike-25', 'hike-50-plus', 'no-change', 'cut-25', 'cut-50-plus']

export type ExpectationChartText = Readonly<{
  aria: string
  /** 五档的短名，与政策卡同一套词（`policyText.shortOutcomes`）。 */
  outcomes: Readonly<Record<PolicyPathOutcome, string>>
  expectation: string
  vsYesterday: string
  flat: string
  noHistory: string
}>

type Selection = Readonly<{ index: number; pointer?: Readonly<{ x: number; y: number }>; keyboard: boolean }>

export function ExpectationChart({ points, events, height, width, text, latest }: Readonly<{
  points: readonly ExpectationPoint[]
  events: readonly ExpectationEvent[]
  height: number
  width: number
  /** 图与读数面板的全部文案都由调用方给：图表组件里不写死任何一句可见文案。 */
  text: ExpectationChartText
  /**
   * 最后一点的「较上一日」。只有 hover/选中最后一点时才用得上。
   *
   * 传对象是为了把两件事分开：`undefined` = 不是最后一点（不显示这一行）；
   * `{}` = 是最后一点但没有 24 小时基准（显示「无历史可比」，不是 +0.0bp）。
   */
  latest?: Readonly<{ changeBp?: number }>
}>): React.ReactElement {
  const timeZone = useShellTimeZone()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [tipHeight, setTipHeight] = useState(0)

  const geometry = useMemo(() => {
    // 原样画收到的宽度：**不许**在这里给自己一个地板宽度。给了，图就比容器宽，
    // 横向滚动条就是这么来的。容器窄到不可读是版式的事，不是 SVG 去撑开。
    const W = Math.max(1, Math.floor(width))
    const H = height
    const plotW = Math.max(0, W - L - RM)
    const firstMs = Date.parse(points[0]?.at ?? '')
    const lastMs = Date.parse(points[points.length - 1]?.at ?? '')
    const spanMs = Number.isFinite(firstMs) && Number.isFinite(lastMs) ? lastMs - firstMs : 0
    const xOfMs = (ms: number): number => spanMs > 0 ? L + ((ms - firstMs) / spanMs) * plotW : L + plotW / 2

    // The axis is scaled from **every** observation, not from the binned sample: resizing the drawer
    // must not change the vertical scale, or the same day would read differently at another width.
    const absoluteMax = points.reduce((most, point) => Math.max(most, Math.abs(point.bp)), 0)
    const min = points.reduce((least, point) => Math.min(least, point.bp), Number.POSITIVE_INFINITY)
    const positiveOnly = min >= 0
    const span = Math.max(30, Math.ceil((absoluteMax * 1.25) / 10) * 10)
    const HI = span
    const LO = positiveOnly ? 0 : -span
    const Y = (value: number): number => T0 + ((HI - value) / (HI - LO)) * (H - T0 - B)

    const bins = binExpectationPoints(points, plotW)
    // 箱号 → 该箱最后一条观测的下标。分箱只留了 bp，而面板要五档概率，所以这一遍必须做；
    // 规则与 `binExpectationPoints` 完全一致（同一个起止时刻、同一个箱数）。
    const binObservation: number[] = Array.from({ length: bins.length }, () => -1)
    for (let index = 0; index < points.length; index += 1) {
      const at = Date.parse(points[index]!.at)
      if (!Number.isFinite(at) || !Number.isFinite(points[index]!.bp)) continue
      const fraction = spanMs > 0 ? (at - firstMs) / spanMs : 0.5
      binObservation[Math.min(bins.length - 1, Math.max(0, Math.floor(fraction * bins.length)))] = index
    }

    const binWidth = plotW / bins.length
    const binX = (index: number): number => L + (index + 0.5) * binWidth
    // Consecutive non-empty bins form one segment; a gap breaks the line instead of bridging it.
    const segments: number[][] = []
    let current: number[] = []
    for (let index = 0; index < bins.length; index += 1) {
      if (bins[index] === null) {
        if (current.length) segments.push(current)
        current = []
      } else {
        current.push(index)
      }
    }
    if (current.length) segments.push(current)

    const lineOf = (segment: readonly number[]): string => segment
      .map((index, position) => `${position === 0 ? 'M' : 'L'}${binX(index).toFixed(1)} ${Y(bins[index]!).toFixed(1)}`)
      .join(' ')
    const areaPathOf = (segment: readonly number[]): string => {
      const head = segment[0]!
      const tail = segment[segment.length - 1]!
      const body = segment.map((index) => `L${binX(index).toFixed(1)} ${Y(bins[index]!).toFixed(1)}`).join(' ')
      return `M${binX(head).toFixed(1)} ${Y(0).toFixed(1)} ${body} L${binX(tail).toFixed(1)} ${Y(0).toFixed(1)} Z`
    }

    const ticks = positiveOnly ? [0, HI / 4, HI / 2, HI * 0.75, HI] : [LO, LO / 2, 0, HI / 2, HI]

    // Labels are placed right to left so the later ones keep their leader; 8px between labels, never
    // outside the plot. The same rule the prototype applies, with the measured width replaced by an
    // estimate (a 9.5px CJK glyph is about 5.2px wide on average at this size).
    let limit = W - RM
    const labels = [...events]
      .filter((event) => Number.isFinite(Date.parse(event.at)))
      .sort((left, right) => xOfMs(Date.parse(right.at)) - xOfMs(Date.parse(left.at)))
      .map((event) => {
        // 图上只放短名 + 推动量；完整标题不上图（正文不许长句）。
        const label = fitEventLabel(`${event.changeBp >= 0 ? '↑ +' : '↓ −'}${Math.abs(event.changeBp).toFixed(1)}bp ${event.label}`)
        const approxWidth = estimateEventLabelWidth(label)
        const x = Math.max(L, Math.min(xOfMs(Date.parse(event.at)) - approxWidth / 2, limit - approxWidth))
        limit = x - 8
        return { label, x }
      })

    const dates = axisDates(firstMs, lastMs, plotW, timeZone)
    return { W, H, plotW, xOfMs, Y, HI, LO, positiveOnly, bins, binObservation, binX, segments, lineOf, areaPathOf, ticks, labels, dates }
  }, [points, events, height, width, timeZone])

  // 只有「箱内有值」的位置可以被选中：命中按横向最近，不要求压在 2px 的线上。
  const selectable = useMemo(
    () => geometry.bins.flatMap((value, index) => value === null ? [] : [{ index, x: geometry.binX(index), y: geometry.Y(value) }]),
    [geometry]
  )

  // 舞台的盒子必须**量**出来，渲染期不许读 ref、也不许退回 prop 尺寸：
  // 夹边用的盒子一旦不是面板真正的容器，面板就会顺着越出 `.mk-plot` 压到下面的卡片上。
  useLayoutEffect(() => {
    const host = stageRef.current
    if (!host) return
    const measure = () => {
      const width = Math.floor(host.clientWidth)
      const height = Math.floor(host.clientHeight)
      setStageSize((previous) => previous.width === width && previous.height === height ? previous : { width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // 量不到舞台或量不到面板高度时**不显示面板**：拿假尺寸硬算，就是把「没量到」变成「画错地方」。
  const measured = stageSize.width > 0 && stageSize.height > 0 && tipHeight > 0
  const panelVisible = selection !== null && measured
  // 宽度由 `pickReadoutWidth` 决定（降级时会换行），所以只量高度：它决定上下往哪边翻。
  const tipWidth = measured
    ? pickReadoutWidth({
      stageWidth: stageSize.width,
      ...(selection?.pointer ? { pointerX: selection.pointer.x } : {})
    })
    : READOUT_TIP_WIDTH
  useLayoutEffect(() => {
    const element = tipRef.current
    if (!element) return
    const next = element.offsetHeight
    if (next > 0 && next !== tipHeight) setTipHeight(next)
  }, [selection?.index, tipWidth, tipHeight])

  if (!points.length) return <div className="mk-plot__stage" />

  const selected = selection ? selectable.find((item) => item.index === selection.index) : undefined
  const panelPoint = selection ? points[geometry.binObservation[selection.index]!] : undefined
  const isLast = selection !== null && geometry.binObservation[selection.index] === points.length - 1

  const placeTip = (): Readonly<{ left: number; top: number }> => {
    if (!selection || !measured) return { left: 0, top: 0 }
    const point = selected ?? selectable[0]!
    const rect = placeReadout({
      // 用舞台**真实**的盒子，而不是 SVG 的逻辑高度：两者在首帧或动画中可能差几个像素，
      // 差出来的那几像素正好会让面板底部越过绘图区，被上层或裁切吃掉。
      stage: { width: stageSize.width, height: stageSize.height },
      tip: { width: tipWidth, height: tipHeight },
      point: { x: point.x, y: point.y },
      ...(selection.pointer ? { pointer: selection.pointer } : {})
    })
    return { left: rect.left, top: rect.top }
  }

  const nearestByX = (x: number): number => {
    let best = selectable[0]!
    for (const item of selectable) if (Math.abs(item.x - x) < Math.abs(best.x - x)) best = item
    return best.index
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const host = stageRef.current
    if (!host || !selectable.length) return
    const rect = host.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const index = nearestByX(x)
    // 同一个箱、位移不到 1px 就保持原 state：鼠标在箱内滑动不会触发重绘。
    setSelection((previous) => previous && previous.index === index && previous.pointer
      && Math.abs(previous.pointer.x - x) < 1 && Math.abs(previous.pointer.y - y) < 1
      ? previous
      : { index, pointer: { x, y }, keyboard: false })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      setSelection(null)
      return
    }
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    if (!selectable.length) return
    event.preventDefault()
    const current = selection && selection.keyboard ? selectable.findIndex((item) => item.index === selection.index) : -1
    const next = current < 0
      ? (event.key === 'ArrowRight' ? 0 : selectable.length - 1)
      : clamp(current + (event.key === 'ArrowRight' ? 1 : -1), 0, selectable.length - 1)
    setSelection({ index: selectable[next]!.index, keyboard: true })
  }

  const tip = placeTip()

  return <div
    className="mk-plot__stage"
    ref={stageRef}
    tabIndex={0}
    role="group"
    aria-label={text.aria}
    onPointerMove={onPointerMove}
    onPointerLeave={() => setSelection(null)}
    onKeyDown={onKeyDown}
  >
      <svg className="mk-plot__svg" width={geometry.W} height={geometry.H}
        viewBox={`0 0 ${geometry.W} ${geometry.H}`} aria-hidden="true">
        <defs>
          <linearGradient id="mk-g-red" gradientUnits="userSpaceOnUse" x1={0} y1={geometry.Y(0)} x2={0} y2={geometry.Y(geometry.HI)}>
            <stop offset="0" stopColor="#B3362B" stopOpacity="0.02" />
            <stop offset="1" stopColor="#B3362B" stopOpacity="0.40" />
          </linearGradient>
          <linearGradient id="mk-g-blue" gradientUnits="userSpaceOnUse" x1={0} y1={geometry.Y(0)} x2={0} y2={geometry.Y(geometry.LO)}>
            <stop offset="0" stopColor="#2E5F9E" stopOpacity="0.02" />
            <stop offset="1" stopColor="#2E5F9E" stopOpacity="0.40" />
          </linearGradient>
        </defs>
        {geometry.positiveOnly ? null
          : <rect x={L} y={geometry.Y(0)} width={geometry.plotW} height={geometry.Y(geometry.LO) - geometry.Y(0)} fill="url(#mk-g-blue)" />}
        {geometry.segments.map((segment) => <path key={`area-${segment[0]}`} d={geometry.areaPathOf(segment)} fill="url(#mk-g-red)" />)}
        {geometry.segments.map((segment) => <path key={`line-${segment[0]}`} d={geometry.lineOf(segment)} fill="none"
          stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />)}
        {geometry.ticks.map((value) => {
          const isZero = Math.abs(value) < 1e-9
          return <g key={value}>
            <line x1={L} y1={geometry.Y(value)} x2={geometry.W - RM} y2={geometry.Y(value)}
              stroke="var(--text-strong)" strokeWidth={1} opacity={isZero ? 0.4 : 0.08} />
            <text x={L - 8} y={geometry.Y(value) + 3} fontSize={9} fill={isZero ? 'var(--text)' : 'var(--muted)'} textAnchor="end">
              {formatTick(value)}
            </text>
          </g>
        })}
        {events.map((event) => {
          const x = geometry.xOfMs(Date.parse(event.at))
          return <g key={`mark-${event.at}`}>
            <line x1={x} y1={T0} x2={x} y2={geometry.H - B} stroke="rgba(255,255,255,0.28)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x} cy={geometry.Y(event.bp)} r={3} fill="var(--accent)" />
          </g>
        })}
        {geometry.labels.map((label) => <text key={label.label} x={label.x.toFixed(1)} y={T0 + 10} fontSize={9.5}
          textAnchor="start" fill="var(--accent)">{label.label}</text>)}
        {geometry.dates.map((date) => <text key={date.at} x={date.x.toFixed(1)} y={geometry.H - B + 16} fontSize={9}
          fill="var(--muted)" textAnchor={date.anchor}>{date.label}</text>)}
        {selected ? <g className="mk-plot__cross">
          <line x1={selected.x} y1={T0} x2={selected.x} y2={geometry.H - B} stroke="var(--accent)" strokeWidth={1} opacity={0.45} />
          <circle cx={selected.x} cy={selected.y} r={3.5} fill="var(--accent)" />
        </g> : null}
      </svg>

    <div
      className="mk-tip"
      ref={tipRef}
      data-active={panelVisible ? 'true' : 'false'}
      style={{
        ...(measured ? { width: `${tipWidth}px` } : {}),
        transform: `translate(${tip.left.toFixed(1)}px, ${tip.top.toFixed(1)}px)`
      }}
      aria-live={selection?.keyboard ? 'polite' : 'off'}
    >
      {panelPoint ? <PanelContent point={panelPoint} text={text} latest={isLast ? latest : undefined} timeZone={timeZone} /> : null}
    </div>
  </div>
}

/** 面板内容：时刻、五档概率各一行、加权期望；最后一个点再加「较上一日」。 */
function PanelContent({ point, text, latest, timeZone }: Readonly<{
  point: ExpectationPoint
  text: ExpectationChartText
  latest: Readonly<{ changeBp?: number }> | undefined
  timeZone: string
}>): React.ReactElement {
  const bp = expectationBp(point.values)
  return <>
    <span className="mk-tip__time">{formatShellCompactInstant(point.at, { timeZone })}</span>
    <dl className="mk-tip__mix">
      {PANEL_ORDER.map((outcome) => <div key={outcome}>
        <dt>{text.outcomes[outcome]}</dt>
        <dd>{(point.values[outcome] * 100).toFixed(1)}%</dd>
      </div>)}
    </dl>
    <div className="mk-tip__sum">
      <span>{text.expectation}</span>
      <b>{formatSignedBp(bp)}</b>
    </div>
    {latest === undefined ? null : <div className="mk-tip__delta">
      <span>{text.vsYesterday}</span>
      {latest.changeBp === undefined
        ? <b data-flat="true">{text.noHistory}</b>
        : <b data-flat={Math.abs(latest.changeBp) < 0.05 ? 'true' : 'false'}>
          {Math.abs(latest.changeBp) < 0.05 ? text.flat : formatSignedBp(latest.changeBp)}
        </b>}
    </div>}
  </>
}

/** 期望值带符号，一位小数：`+27.8bp` / `−1.4bp`（负号是 U+2212）。 */
function formatSignedBp(value: number): string {
  const magnitude = Math.abs(value)
  if (magnitude < 0.05) return '0.0bp'
  return `${value > 0 ? '+' : '−'}${magnitude.toFixed(1)}bp`
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/**
 * Evenly spaced date labels, absolute times formatted in the reader's zone.
 *
 * `labelCount` follows the width (~one every 96px, at least two) so a narrow drawer does not stack
 * labels on top of each other, and a wider one is not left with three lonely dates.
 */
function axisDates(fromMs: number, toMs: number, plotWidth: number, timeZone: string): readonly Readonly<{ at: string; x: number; label: string; anchor: 'start' | 'middle' | 'end' }>[] {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return []
  const count = Math.max(2, Math.min(8, Math.floor(plotWidth / 96) + 1))
  const out: Array<{ at: string; x: number; label: string; anchor: 'start' | 'middle' | 'end' }> = []
  let previous = ''
  for (let index = 0; index < count; index += 1) {
    const fraction = index / (count - 1)
    const ms = fromMs + (toMs - fromMs) * fraction
    const at = new Date(ms).toISOString()
    // `formatShellDay` is the same wall-clock split the rest of the product uses; only the year is
    // dropped, because an axis spanning two weeks does not need it twice.
    const day = formatShellDay(at, timeZone)
    if (!day) continue
    const label = day.slice(5)
    if (label === previous) continue
    previous = label
    // 首尾两条贴住绘图区边线，用左/右对齐：居中会把首尾各切掉半个字（截图里那个「11-」）。
    const edge = index === 0 ? 'start' as const : index === count - 1 ? 'end' as const : 'middle' as const
    const x = edge === 'start' ? L : edge === 'end' ? L + plotWidth : L + fraction * plotWidth
    out.push({ at, x, label, anchor: edge })
  }
  return out
}
