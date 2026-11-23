import { formatDashboardChange, type DashboardPositioningViewState } from '../../../pages/intelligence/dashboardOpenInterestModel'
import type { PositioningPanelText } from './positioningText'

/**
 * 图的几何：一张表，牌带、车道、基线都从这里取。
 *
 * 牌带从 16 抬到 29（界面设计 2026-11-24 定稿的形态 B）：混向一簇是一块牌、两行字，
 * 牌高 26（基线 12 / 23），牌底正好落在 `markerRow`；单行牌仍高 13、贴底放。
 * 上面那条名义车道 66 个单位不动——不是拿压扁图换牌高；空态骨架用同一份 `VIEW`，卡高不跳。
 */
export const POSITIONING_CHART_VIEW = Object.freeze({
  width: 1000,
  height: 199,
  left: 32,
  right: 992,
  markerTop: 3,
  markerRow: 29,
  upperTop: 39,
  upperBottom: 105,
  zero: 155
})

/** 一枚牌：两行各 13 高、横排间隔 6px；行内文字基线 12 / 23。 */
export const MARKER_CHIP = Object.freeze({
  height: 13,
  twoLineHeight: 26,
  baselines: [12, 23] as const,
  radius: 4,
  gap: 6
})

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

/** 牌上的一行字：一个方向一行；行序 = 该方向最早一次命中的先后。 */
export type LiquidationChipLine = Readonly<{ direction: 'long' | 'short'; text: string }>

export type LiquidationChip = Readonly<{
  key: string
  marks: readonly LiquidationMark[]
  /** 牌挂在哪个市场的线上：混向时仍取第一根线（`data-hint` 的既有语义）。 */
  asset: 'btc' | 'eth'
  /** 混向仍是 `mixed`：牌框与竖线保持中性，颜色只落在每一行字上。 */
  direction: 'long' | 'short' | 'mixed'
  lines: readonly LiquidationChipLine[]
  left: number
  width: number
  /** 牌底对齐 `markerRow`：单行牌 13 高，混向牌 26 高。 */
  top: number
  height: number
  /** 浮层与可访问名：两行用「 · 」连成一句，单个命中再加一句量。 */
  summary: string
}>

/** Rough advance widths at the 9px chart-label size: a CJK glyph ~9px, latin ~5.2px. */
export function chipWidthFor(label: string): number {
  let width = 0
  for (const character of label) width += /[\u3000-\u9fff]/.test(character) ? 9 : 5.2
  return Math.round(width + 12)
}

/** 横轴：窗口内全部命中都算一次（与通知不是同一个源，这里只画账本）。 */
function axisOf(positioning: Extract<DashboardPositioningViewState, { state: 'available' }>): Readonly<{
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
    xOf: (ms: number) => POSITIONING_CHART_VIEW.left + ((ms - startMs) / span) * (POSITIONING_CHART_VIEW.right - POSITIONING_CHART_VIEW.left)
  }
}

/** 窗口内的全部命中，按横坐标排序。 */
export function liquidationMarks(positioning: Extract<DashboardPositioningViewState, { state: 'available' }>): readonly LiquidationMark[] {
  const axis = axisOf(positioning)
  return positioning.hints
    .map(hint => {
      const markMs = Date.parse(hint.observedAt)
      if (!(markMs >= axis.startMs && markMs <= axis.startMs + axis.span)) return undefined
      return {
        key: `${hint.asset}-${hint.observedAt}`,
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

/**
 * 成簇 + 牌上文字（界面设计 2026-11-24 定稿的形态 B）：
 *
 * - 牌放不下就把下一条并进来（贪心，和以前一样）——**混向也并**，因为一块牌能写两行字；
 * - 一行 = 一个方向，行序取该方向**最早一次命中**的先后；单次写 `疑似多/空头爆仓 ±p%`，
 *   同一方向多次写 `… ×N`（×N 只在同一方向内，才是「这一小段发生了 N 次」）；
 * - 牌框与竖线中性，颜色只落在每一行字上（由调用点按 `data-line-direction` 上色）；
 * - 每簇的每条命中仍留自己的竖线——不存在只画线的命中，也不存在没有线的牌。
 */
export function layoutLiquidationMarks(
  positioning: Extract<DashboardPositioningViewState, { state: 'available' }>,
  text: PositioningPanelText
): readonly LiquidationChip[] {
  const marks = liquidationMarks(positioning)
  const linesOf = (cluster: readonly LiquidationMark[]): readonly LiquidationChipLine[] => {
    const order: ('long' | 'short')[] = []
    const buckets = new Map<'long' | 'short', LiquidationMark[]>()
    for (const mark of cluster) {
      if (!buckets.has(mark.direction)) {
        buckets.set(mark.direction, [])
        order.push(mark.direction)
      }
      buckets.get(mark.direction)!.push(mark)
    }
    return order.map(direction => {
      const members = buckets.get(direction)!
      const only = members.length === 1 ? members[0]! : undefined
      if (only !== undefined) {
        return { direction, text: (direction === 'long' ? text.markLong : text.markShort).replace('{pct}', only.pct) }
      }
      const template = direction === 'long' ? text.markLongMany : text.markShortMany
      return { direction, text: template.replace('{count}', String(members.length)) }
    })
  }
  const widthOf = (lines: readonly LiquidationChipLine[]): number =>
    Math.max(...lines.map(line => chipWidthFor(line.text)))
  const leftOf = (cluster: readonly LiquidationMark[], width: number): number => {
    const center = (cluster[0]!.x + cluster.at(-1)!.x) / 2
    const { left, right } = POSITIONING_CHART_VIEW
    return Math.max(left, Math.min(center - width / 2, right - width))
  }

  const chips: LiquidationChip[] = []
  let cursor = 0
  while (cursor < marks.length) {
    let members: LiquidationMark[] = [marks[cursor]!]
    let lines = linesOf(members)
    let width = widthOf(lines)
    let left = leftOf(members, width)
    while (cursor + members.length < marks.length) {
      const next = marks[cursor + members.length]!
      const nextWidth = chipWidthFor(linesOf([next])[0]!.text)
      if (leftOf([next], nextWidth) >= left + width + MARKER_CHIP.gap) break
      members = [...members, next]
      lines = linesOf(members)
      width = widthOf(lines)
      left = leftOf(members, width)
    }
    const direction = lines.length > 1 ? 'mixed' as const : members[0]!.direction
    const single = members.length === 1 ? members[0]! : undefined
    const joined = lines.map(line => line.text).join(' · ')
    const height = lines.length > 1 ? MARKER_CHIP.twoLineHeight : MARKER_CHIP.height
    chips.push({
      key: members.map(mark => mark.key).join('+'),
      marks: members,
      asset: members[0]!.asset,
      direction,
      lines,
      left,
      width,
      top: POSITIONING_CHART_VIEW.markerRow - height,
      height,
      // 浮层与牌同一句话，单个再加一句量；成簇时量各不相同，不编一个数出来。
      summary: single === undefined ? joined : `${joined} · ${single.volumeMultiple.toFixed(1)}×`
    })
    cursor += members.length
  }
  return chips
}