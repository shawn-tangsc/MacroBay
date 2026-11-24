import {
  clockCardCenter, clockCardGeometry, clockFutureAngle, clockRingPoint, clockRingPointSvg, normalizeAngle
} from './clockPlaqueLayout'
import { clockRingCategories, type ClockRingCategory } from './clockRingCategories'

/**
 * 环上的箭头（用户 2026-11 第三版）：**每个大类一支，从轨道内侧朝外指**。
 *
 * 形状沿用原来 12 点那支「现在」小三角，翻过来朝外：箭尖落在轨道 r101 上，箭身向内到 r91，
 * 底边宽 9（半宽 4.5）。原来那支「现在」箭头删掉——环上只留四支类别箭头，不与任何东西混。
 *
 * 名字挂在**轨道外侧**（箭头正外侧、水平居中）：外侧只需「名字高 15 + 间距 2」，
 * 环到卡边有 23/25px，放得下；名字之间相撞就沿顺时针每步 8px 推开，最多 6 步，
 * 仍不行就把该名字降级进卡右下那颗 ⓘ，**不叠字、不出卡**。
 */
export const clockArrowGeometry = Object.freeze({
  /**
   * 箭尖半径：**指刻度那圈**（流光真正跑的位置 r74.4–81.2），不是外面那根发丝线 r101
   * （用户 2026-11 定 B 版）。箭尖 81 落在流光带外缘，底边 71 在刻度圈里。
   */
  tipRadius: 81,
  /** 箭身内端半径（箭尖 − 10）。 */
  baseRadius: 71,
  /** 底边半宽（原三角底边 9）。 */
  halfWidth: 4.5,
  /** 名字卡高（11px 一行 + 上下内距与描边）。 */
  nameHeight: 15,
  /** 名字卡左右内距合计（两侧 2px 内距）：宽度估算要加进去。 */
  namePaddingX: 4,
  /** 名字卡的径向中心：放在流光外面、发丝线里面那条带上（用户 2026-11 定的 r92）。 */
  nameRadius: 92,
  /** 名字与轨道之间的间距。 */
  nameGap: 2,
  /** 名字盒离卡缘的最小内距（判据：≥4px）。 */
  nameEdgeMargin: 4,
  /** 相撞时每步沿环推开的像素与上限步数。 */
  nudgeStep: 8,
  nudgeMaxSteps: 6,
  /** 两个名字盒之间要留的缝（界面设计 2026-11：推开到 ≥4px）。 */
  nameNudgeGapPx: 4
})

/** 名字卡中心离圆心的半径：模型给的 `nameRadius`（r92），不由箭头半径推——两条带子不是一条。 */
export const clockArrowNameRadius = clockArrowGeometry.nameRadius

export type ClockRingArrowEntry = Readonly<{
  metricKey: string
  nameKey: string
  date: string
  daysUntil: number
  /** 当期值（已格式化，如 `3.7%`）；没有就不给。 */
  value?: string
  /** 利率类：主推档概率（已格式化）；没有不给。 */
  probability?: string
}>

export type ClockRingArrow = Readonly<{
  category: ClockRingCategory
  /** 箭尖所在角度（12 点起顺时针）。 */
  angle: number
  /** 这一类的**最近一期**发布：箭头挂这天，其余日期只在浮层里。 */
  date: string
  daysUntil: number
  /** 箭尖坐标（卡坐标）。 */
  tip: Readonly<{ x: number; y: number }>
  /** 朝外三角的 SVG 路径（SVG 用户坐标）。 */
  path: string
  /** 名字盒（卡坐标，已夹进卡内并避开别的名字）；降级时不渲染。 */
  name?: Readonly<{ x: number; y: number; width: number }>
  /** 浮层内容：这一类的全部指标，按日期由近到远。 */
  entries: readonly ClockRingArrowEntry[]
}>

/** 环上没画出来的原因：进卡右下那颗 ⓘ，不许因为删了溢出行就把信息丢掉。 */
export type ClockRingNote = Readonly<{ category: ClockRingCategory; reason: 'schedule-unreadable' | 'no-release' | 'name-demoted' }>

export type ClockRingArrowModel = Readonly<{
  arrows: readonly ClockRingArrow[]
  notes: readonly ClockRingNote[]
}>

/**
 * 名字宽度估算：11px 字号下中日韩字 11px、ASCII 6.2px。
 * 与旧牌宽估算是同一条口径（`--font-meta` 是这张卡唯一可用档），但这里的盒子只包一行名字。
 */
export function clockNameWidth(name: string): number {
  let width = 0
  for (const char of name) width += (char.codePointAt(0) ?? 0) >= 0x2E80 ? 11 : 6.2
  return Math.ceil(width) + clockArrowGeometry.namePaddingX
}

/** 朝外三角：箭尖在轨道上，底边向内 10px、宽 9。角度按 12 点起顺时针。 */
export function clockArrowPath(angle: number): string {
  // SVG 里的路径用**SVG 用户坐标**（不含卡内距）：拿卡坐标画会整体偏 9px。
  const tip = clockRingPointSvg(angle, clockArrowGeometry.tipRadius)
  const base = clockRingPointSvg(angle, clockArrowGeometry.baseRadius)
  const radians = angle * Math.PI / 180
  // 切向单位向量（顺时针方向）：沿 +θ 走。
  const tangentX = Math.cos(radians)
  const tangentY = Math.sin(radians)
  const half = clockArrowGeometry.halfWidth
  const left = { x: base.x - tangentX * half, y: base.y - tangentY * half }
  const right = { x: base.x + tangentX * half, y: base.y + tangentY * half }
  return `M${format(tip.x)} ${format(tip.y)} L${format(left.x)} ${format(left.y)} L${format(right.x)} ${format(right.y)} Z`
}

/**
 * 摆名字：以箭头正外侧为中心，先夹进卡内（离卡缘 ≥4px），再依次与已摆好的名字比；
 * 相交就沿顺时针每步 8px 推开（等价于角度每步 +`8 / 名字半径` 弧度），最多 6 步。
 * 六步之后仍相交就把这一块降级（不渲染名字，记一条 note）。
 */
export function placeClockNames(
  inputs: readonly Readonly<{ category: ClockRingCategory; angle: number; width: number }>[]
): Readonly<{ names: Readonly<Record<string, Readonly<{ x: number; y: number; width: number }>>>; demoted: readonly ClockRingCategory[] }> {
  const placed: Array<Readonly<{ x: number; y: number; width: number }>> = []
  const names: Record<string, Readonly<{ x: number; y: number; width: number }>> = {}
  const demoted: ClockRingCategory[] = []
  const halfHeight = clockArrowGeometry.nameHeight / 2
  /**
   * 名字盒：径向中心先按 r110.4，若四角伸进 r104 以内就一点点往外挪（最多到贴边为止）。
   *
   * 两条约束在**近水平角度**上会打架：3 点方向环到卡边只有 25px，横排名字 22px 宽，
   * 想同时「四角 ≥104」与「离卡缘 ≥2」是不可能的（需要 114.7 半径、但那里只剩 13px）。
   * 这时以「不出卡」为准——名字被切掉比压一点环更糟；其余角度都满足四角 ≥104。
   */
  const boxOf = (angle: number, width: number): ClockNameBox => {
    const halfWidth = width / 2
    const margin = clockArrowGeometry.nameEdgeMargin
    const fits = (radius: number): ClockNameBox | undefined => {
      const point = clockRingPoint(angle, radius)
      const x = Math.min(Math.max(point.x, halfWidth + margin), clockCardGeometry.cardWidth - halfWidth - margin)
      const y = Math.min(Math.max(point.y, halfHeight + margin), clockCardGeometry.cardHeight - halfHeight - margin)
      const box = { x, y, width }
      if (x !== point.x || y !== point.y) return box
      return Math.hypot(x - clockCardCenter.cardX, y - clockCardCenter.cardY) === 0 ? box : box
    }
    for (let radius = clockArrowNameRadius; radius <= clockArrowNameRadius + 14; radius += 1) {
      const box = fits(radius)
      if (box !== undefined && cornersOutsideRing(box)) return box
    }
    // 走到这里说明「四角 ≥104」与「不出卡」在这条角度上不可兼得：取能放下的最外一档。
    return fits(clockArrowNameRadius + 14) ?? fits(clockArrowNameRadius)!
  }
  const step = clockArrowGeometry.nudgeStep / clockArrowNameRadius * 180 / Math.PI
  for (const input of inputs) {
    let accepted: Readonly<{ x: number; y: number; width: number }> | undefined
    for (let index = 0; index <= clockArrowGeometry.nudgeMaxSteps; index += 1) {
      const candidate = boxOf(normalizeAngle(input.angle + step * index), input.width)
      if (placed.every((other) => !boxesIntersect(candidate, other))) { accepted = candidate; break }
    }
    if (accepted === undefined) { demoted.push(input.category); continue }
    placed.push(accepted)
    names[input.category] = accepted
  }
  return { names, demoted }
}

type ClockNameBox = Readonly<{ x: number; y: number; width: number }>

/** 名字盒四角是否都在 r104 之外（环上的箭头在 r91–101，盒子不许压到环）。 */
function cornersOutsideRing(box: ClockNameBox): boolean {
  const halfWidth = box.width / 2
  const halfHeight = clockArrowGeometry.nameHeight / 2
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([signX, signY]) =>
    Math.hypot(box.x + signX! * halfWidth - clockCardCenter.cardX, box.y + signY! * halfHeight - clockCardCenter.cardY) >= 104)
}

function boxesIntersect(left: ClockNameBox, right: ClockNameBox): boolean {
  // 两盒之间要留 `nameGapPx` 的缝；沿任一轴让开就算不撞。
  const gap = clockArrowGeometry.nameNudgeGapPx
  const apartX = Math.abs(left.x - right.x) >= (left.width + right.width) / 2 + gap
  const apartY = Math.abs(left.y - right.y) >= clockArrowGeometry.nameHeight + gap
  return !apartX && !apartY
}

function format(value: number): string {
  return Number(value.toFixed(2)).toString()
}
