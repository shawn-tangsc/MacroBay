import {
  clockCardCenter, clockCardGeometry, clockFutureAngle, clockRingPoint, clockRingPointSvg, normalizeAngle
} from './clockPlaqueLayout'
import { clockRingCategories, type ClockRingCategory } from './clockRingCategories'

/**
 * 环上的箭头（用户 2026-11）：**每个大类一支，整支收在表盘内侧、朝外指**。
 *
 * 形状沿用原来 12 点那支「现在」小三角：最外点 r72（离彩色流光带内缘 74.4 留 2.4px）、
 * 最内点 r64、长 8、底宽 9。原来那支「现在」箭头删掉——环上只留四支类别箭头，不与任何东西混。
 *
 * 名字是圆角小卡，**径向对准自己的箭头**，中心 r92（落在彩色流光带外面、r101 那根发丝线里面
 * 这条带上；斜角上四角会各越界几像素，界面设计已同意）。相撞时沿顺时针每步 8px 推开，
 * 最多 6 步；推不动就把该名字降级进卡右下那颗 ⓘ，**不叠字、不出卡**。
 */
export const clockArrowGeometry = Object.freeze({
  /**
   * 箭头**整支收在表盘内侧**（用户 2026-11 第三次修正）：最外点 72、离流光带内缘 74.4 留 2.4px，
   * 最内点 64、离中央椭圆最紧的 80° 那支还有 2.5px；长 8、底宽 9、方向朝外不变。
   * 判据是**箭头上没有任何一点落在 r ≥ 74 的彩色流光带里**——探进环里那次真机一眼就看出来了。
   */
  tipRadius: 72,
  /** 箭身内端半径（箭尖 − 8）。 */
  baseRadius: 64,
  /**
   * 底边半宽：**4（底宽 8）**。原型那支 9×10 的尖角是 48.5°，9×8 会变成 58.7°（像楔子），
   * 8×8 是 53.4°（面积 32px²），仍在「同一支箭头」的观感里（界面设计 2026-11 实测）。
   */
  halfWidth: 4,
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
   * 名字盒：**直接按 r92 径向摆**，再夹进卡内（离卡缘 ≥2px）。
   *
   * 不再「按四角 ≥104 往外挪」——那是旧版名字挂在发丝线外面时的规则，留着它会把每张卡
   * 顶到 r106 骑在外圈发丝线上（2026-11-24 Chief 核出来的真错）。斜角上四角会各自越界几像素
   * （实测最远 107，越一条 1px 装饰线），界面设计已同意接受：再收窄就丢内距。
   */
  const boxOf = (angle: number, width: number): ClockNameBox => {
    const halfWidth = width / 2
    const margin = clockArrowGeometry.nameEdgeMargin
    const point = clockRingPoint(angle, clockArrowNameRadius)
    const x = Math.min(Math.max(point.x, halfWidth + margin), clockCardGeometry.cardWidth - halfWidth - margin)
    const y = Math.min(Math.max(point.y, halfHeight + margin), clockCardGeometry.cardHeight - halfHeight - margin)
    return { x, y, width }
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
