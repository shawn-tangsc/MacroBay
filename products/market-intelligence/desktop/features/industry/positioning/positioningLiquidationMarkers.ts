import { formatDashboardChange, type DashboardPositioningViewState } from '../../../pages/intelligence/dashboardOpenInterestModel'
import type { PositioningPanelText } from './positioningText'

/**
 * 图的几何：**像素坐标**，按容器实测的宽高算（用户 2026-11-24：字被整体缩小，换成国债卡那套）。
 *
 * 原来是一块固定 1000×300 的坐标系、`width:100%; height:auto` 整幅等比缩放——图列 700 时缩放 0.7，
 * 9px 的牌字与轴标签实际只有 6.3px。现在 svg 按容器像素画（`width/height` 就是实测值），
 * 字 9px 就是 9px，高度也跟着卡片走，不再靠调 viewBox 去猜。
 *
 * 牌带在顶部按像素钉死（`markerTop` 3 到 `markerRow` 29，两排各 13 高的牌）；下面两条车道与
 * 刻度带按剩余高度分，OI : 费率 = 55 : 45。
 */
export type PositioningChartGeometry = Readonly<{
  width: number
  height: number
  left: number
  right: number
  markerTop: number
  markerRow: number
  upperTop: number
  upperBottom: number
  zero: number
}>

/** 还没量到容器时的坐标系（静态渲染与首帧）：与真图同一个比例，量到就换真像素。 */
export const POSITIONING_CHART_FALLBACK = Object.freeze({ width: 1000, height: 300 })

/** 一枚牌：13 高、圆角 4、同一排内间隔 6px；牌带两排，先出现的贴下半排，溢出的往上排。 */
export const MARKER_CHIP = Object.freeze({
  height: 13,
  radius: 4,
  gap: 6,
  /** 牌带里的两排：第 1 排在下（底贴 `markerRow`），第 2 排在上（顶贴 `markerTop`）。 */
  rowTops: [16, 3] as const,
  /** 文字基线相对牌顶的偏移（字号走 `--mi-chart-label-size`）。 */
  baseline: 12
})

export function positioningChartGeometry(width: number, height: number): PositioningChartGeometry {
  const safeWidth = Math.max(120, Math.round(width))
  const safeHeight = Math.max(120, Math.round(height))
  const left = 32
  const right = Math.max(left + 40, safeWidth - 8)
  const markerTop = 3
  const markerRow = markerTop + MARKER_CHIP.height * 2
  const upperTop = markerRow + 12
  const tickBand = 26
  const lanes = Math.max(48, safeHeight - upperTop - tickBand)
  const upperBottom = upperTop + Math.round(lanes * 0.55)
  return { width: safeWidth, height: safeHeight, left, right, markerTop, markerRow, upperTop, upperBottom, zero: upperTop + lanes }
}

export type LiquidationMark = Readonly<{
  key: string
  asset: 'btc' | 'eth'
  direction: 'long' | 'short'
  x: number
  notionalUsd: number
  /** 这条命中自己的价格变动（牌上的 ±p%）。 */
  pct: string
  volumeMultiple: number
}>

/**
 * 一枚牌＝一次命中（同资产同向、牌放不下的一小段仍并成 `×N`，那才是「同一市场的同类事件发生了 N 次」）。
 * 牌只写一个市场、一个方向、一句话。
 */
export type LiquidationChip = Readonly<{
  key: string
  marks: readonly LiquidationMark[]
  /** 牌就是这次命中的市场（不再「取第一个成员」）。 */
  asset: 'btc' | 'eth'
  direction: 'long' | 'short'
  text: string
  left: number
  width: number
  /** 牌带里的第几排：0 先用的下半排，1 溢出的上半排。 */
  row: 0 | 1
  top: number
  height: number
  /** 浮层与可访问名：单个命中再加一句量。 */
  summary: string
}>

export type LiquidationMarkLayout = Readonly<{
  chips: readonly LiquidationChip[]
  /**
   * 这一窗里排不下、连牌带线一起没画的命中数。面板把它**加到** DTO 的截断数上，
   * 两句出口合成一个数字（「图上还有 N 次」不许有两套数）。
   */
  hidden: number
}>

/** Rough advance widths at the 9px chart-label size: a CJK glyph ~9px, latin ~5.2px. */
export function chipWidthFor(label: string): number {
  let width = 0
  for (const character of label) width += /[\u3000-\u9fff]/.test(character) ? 9 : 5.2
  return Math.round(width + 12)
}

/** 横轴：窗口内全部命中都算一次（与通知不是同一个源，这里只画账本）。 */
function axisOf(positioning: Extract<DashboardPositioningViewState, { state: 'available' }>, geometry: PositioningChartGeometry): Readonly<{
  startMs: number
  span: number
  xOf: (ms: number) => number
}> {
  const rows = positioning.btc.length >= positioning.eth.length ? positioning.btc : positioning.eth
  const startMs = rows.length > 0 ? Date.parse(rows[0]!.observedAt) : 0
  const endMs = rows.length > 0 ? Date.parse(rows.at(-1)!.observedAt) : 0
  const span = Math.max(1, endMs - startMs)
  return {
    startMs,
    span,
    xOf: (ms: number) => geometry.left + ((ms - startMs) / span) * (geometry.right - geometry.left)
  }
}

/** 窗口内的全部命中，按横坐标排序。 */
export function liquidationMarks(positioning: Extract<DashboardPositioningViewState, { state: 'available' }>, geometry: PositioningChartGeometry): readonly LiquidationMark[] {
  const axis = axisOf(positioning, geometry)
  return positioning.hints
    .map(hint => {
      const markMs = Date.parse(hint.observedAt)
      if (!(markMs >= axis.startMs && markMs <= axis.startMs + axis.span)) return undefined
      return {
        key: `${hint.asset}-${hint.direction}-${hint.observedAt}`,
        asset: hint.asset,
        direction: hint.direction,
        x: axis.xOf(markMs),
        notionalUsd: hint.notionalUsd,
        pct: formatDashboardChange(hint.pricePct ?? hint.dropPct),
        volumeMultiple: hint.volumeMultiple
      }
    })
    .filter((entry): entry is LiquidationMark => entry !== undefined)
    .sort((left, right) => left.x - right.x)
}

/** 四个类：一枚牌只属于一个市场、一个方向。跨资产、跨方向都不许并（界面设计 2026-11-24）。 */
const LIQUIDATION_CLASSES = [['btc', 'long'], ['btc', 'short'], ['eth', 'long'], ['eth', 'short']] as const

function chipTextOf(members: readonly LiquidationMark[], text: PositioningPanelText): string {
  const direction = members[0]!.direction
  if (members.length === 1) {
    return (direction === 'long' ? text.markLong : text.markShort).replace('{pct}', members[0]!.pct)
  }
  return (direction === 'long' ? text.markLongMany : text.markShortMany).replace('{count}', String(members.length))
}

/** 牌心贴边内收的唯一位移：最多半枚牌宽，用来把牌留在绘图区里。 */
function clampLeft(centre: number, width: number, geometry: PositioningChartGeometry): number {
  const { left, right } = geometry
  return Math.max(left, Math.min(centre - width / 2, right - width))
}

/**
 * 成簇 + 排布（界面设计 2026-11-24 定稿）：
 *
 * - **成簇只发生在同一市场同一方向**：牌放不下时并进下一枚，写 `×N`——那是「同一市场的同类事件
 *   发生了 N 次」；跨资产、跨方向都不并，一枚牌只说一个市场一个方向；
 * - 牌心 = 这枚牌自己那几条竖线的中点（N=1 就是那根线），**不做横向挪位**，只有贴边内收；
 * - 两排：先出现的贴下半排（`rowTops[0]`），本排放不下就往上一排，**一旦用了上一排，后面都进上一排**；
 * - 两排都放不下 → 这枚牌连它那些竖线一起不画，计入 `hidden`（与 DTO 的截断数在面板里相加）。
 */
export function layoutLiquidationMarks(
  positioning: Extract<DashboardPositioningViewState, { state: 'available' }>,
  text: PositioningPanelText,
  geometry: PositioningChartGeometry
): LiquidationMarkLayout {
  const marks = liquidationMarks(positioning, geometry)

  // 一、按类成簇：同类里牌放不下的连续命中并成一张牌（×N），类与类之间永不合并。
  const drafts: { members: LiquidationMark[]; asset: 'btc' | 'eth'; direction: 'long' | 'short'; text: string; width: number; centre: number }[] = []
  for (const [asset, direction] of LIQUIDATION_CLASSES) {
    const own = marks.filter(mark => mark.asset === asset && mark.direction === direction)
    let cursor = 0
    while (cursor < own.length) {
      let members: LiquidationMark[] = [own[cursor]!]
      let label = chipTextOf(members, text)
      let width = chipWidthFor(label)
      let centre = members[0]!.x
      while (cursor + members.length < own.length) {
        const next = own[cursor + members.length]!
        const nextWidth = chipWidthFor(chipTextOf([next], text))
        // 两枚牌之间至少留 6px：放不下就并进这张牌。
        if (next.x - centre >= (width + nextWidth) / 2 + MARKER_CHIP.gap) break
        members = [...members, next]
        label = chipTextOf(members, text)
        width = chipWidthFor(label)
        centre = (members[0]!.x + members.at(-1)!.x) / 2
      }
      drafts.push({ members, asset, direction, text: label, width, centre })
      cursor += members.length
    }
  }

  // 二、按牌心从左到右排两排。
  drafts.sort((first, second) => first.centre - second.centre)
  const rowEnds: (number | undefined)[] = [undefined, undefined]
  let overflowed = false
  const chips: LiquidationChip[] = []
  let hidden = 0
  for (const draft of drafts) {
    const left = clampLeft(draft.centre, draft.width, geometry)
    const rows = overflowed ? ([1] as const) : ([0, 1] as const)
    const row = rows.find(candidate => rowEnds[candidate] === undefined || left >= rowEnds[candidate]! + MARKER_CHIP.gap)
    if (row === undefined) {
      // 牌与线是一体的：丢牌就一起丢线，数量交给面板那句统一记账。
      hidden += draft.members.length
      continue
    }
    rowEnds[row] = left + draft.width
    if (row === 1) overflowed = true
    const single = draft.members.length === 1 ? draft.members[0]! : undefined
    chips.push({
      key: draft.members.map(mark => mark.key).join('+'),
      marks: draft.members,
      asset: draft.asset,
      direction: draft.direction,
      text: draft.text,
      left,
      width: draft.width,
      row,
      top: MARKER_CHIP.rowTops[row]!,
      height: MARKER_CHIP.height,
      // 浮层与牌同一句话，单个再加一句量；成簇时量各不相同，不编一个数出来。
      summary: single === undefined ? draft.text : `${draft.text} · ${single.volumeMultiple.toFixed(1)}×`
    })
  }
  return { chips, hidden }
}