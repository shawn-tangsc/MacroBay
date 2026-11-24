/**
 * 宏观时钟卡的几何：圆心、角度、环上的点。**只有这一处算坐标。**
 *
 * 依据：`FINAL-时钟卡-实现依据.html`，按用户 2026-11 拍板的 A 方案等比缩到 252×248。
 *
 * 两条不能被改掉的口径：
 * 1. **圆心只有一处来源**：卡 252×248、内距 9 → 卡圆心 (126,124)、SVG 圆心 (117,115)；
 *    环、刻度、箭头、名字卡全由这两个常量算，不许各自写死。
 * 2. **角度就是日期**：未来区 8°/天（240° = 30 天），过去区按各指标自己的周期 P
 *    （`360 − 距上次发布天数 ÷ P × 360`）。**箭头不吸附到 30° 的刻度上**——
 *    今天四类落在 8°/80°/120°/128°，本来就在两根刻度线之间，那正是「指针指向真实日期」的样子。
 *
 * 牌子（宽度上限、重叠、错开、叠放层级）在用户 2026-11 换四类箭头时整套删除了，别在这里复活。
 */

export const clockCardGeometry = Object.freeze({
  /** 卡宽高与内距：圆心的唯一来源。 */
  cardWidth: 252,
  cardHeight: 248,
  pad: 9,
  /** SVG 画布：卡扣掉两侧内距（234×230），圆心由它和 pad 一起决定。 */
  svgWidth: 252 - 2 * 9,
  svgHeight: 248 - 2 * 9,
  /** 刻度环半径（里面那圈带短线的环）。 */
  scaleRadius: 78,
  /** 轨道半径：环上那根 1px 发丝线（直径 202）。 */
  orbitRadius: 101,
  /** 未来区：240° 对应 30 天。 */
  futureArcDegrees: 240,
  futureHorizonDays: 30
})

/**
 * 原型那张卡的轨道半径（336×330、SVG 圆心 (156,153)、r135）。
 * A 方案等比缩小时**以它为分母**算系数，SVG 里的弧与刻度都照这个系数重算。
 */
export const prototypeOrbitRadius = 135

/** 等比重算系数：这张卡的轨道 ÷ 原型轨道（252 宽时 = 101 / 135 ≈ 0.748）。 */
export const clockCardSvgScale = clockCardGeometry.orbitRadius / prototypeOrbitRadius

/** 卡圆心：只有这一处算它（原型 (168,165) 与 SVG (156,153) 都由 CARD/PAD 得出）。 */
export const clockCardCenter = Object.freeze({
  cardX: clockCardGeometry.cardWidth / 2,
  cardY: clockCardGeometry.cardHeight / 2,
  svgX: clockCardGeometry.cardWidth / 2 - clockCardGeometry.pad,
  svgY: clockCardGeometry.cardHeight / 2 - clockCardGeometry.pad
})

/**
 * 中央窗口在两条指标都进窗口时按这个优先级挑一条（PCE→CPI→非农）。
 * 环上不再用「同一天代表」那套（四类箭头后作废），只有中央这一处还在用。
 */
export const clockRingRepresentativeConcepts = Object.freeze([
  'US.CORE_PCE.YOY', 'US.CPI.YOY', 'US.NONFARM.CHANGE'
] as const)

/** 政策利率不是一级指标：它归「利率」这一类，也参与四支箭头里的一支。 */
export const POLICY_METRIC_KEY = 'US.TARGET_RATE.DECISION'

export function clockDayGap(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`)
  const end = Date.parse(`${to}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN
  return Math.round((end - start) / 86_400_000)
}

/** 未来区角度：天数 ÷ 30 × 240（投影口径，1 天 8°）。 */
export function clockFutureAngle(daysUntil: number): number {
  return clampDays(daysUntil) / clockCardGeometry.futureHorizonDays * clockCardGeometry.futureArcDegrees
}

/** 过去区角度：`360 − 距上次发布天数 ÷ P × 360`（速率 360/P °/天）。 */
export function clockPastAngle(daysSince: number, periodDays: number): number {
  if (!(periodDays > 0)) return Number.NaN
  return normalizeAngle(360 - daysSince / periodDays * 360)
}

/**
 * 角度 → 卡片坐标（相对 12 点顺时针，半径默认发丝线 101）。
 * 原型那四个点按同一比例缩到这张卡上就是判据（见 `clockCardModel.test.ts`）。
 */
export function clockRingPoint(angle: number, radius: number = clockCardGeometry.orbitRadius):
Readonly<{ x: number; y: number }> {
  const radians = angle * Math.PI / 180
  return {
    x: clockCardCenter.svgX + radius * Math.sin(radians) + clockCardGeometry.pad,
    y: clockCardCenter.svgY - radius * Math.cos(radians) + clockCardGeometry.pad
  }
}

/** 角度 → **SVG 用户坐标**（不加卡内距）：SVG 里的箭头按这个画。 */
export function clockRingPointSvg(angle: number, radius: number): Readonly<{ x: number; y: number }> {
  const radians = angle * Math.PI / 180
  return {
    x: clockCardCenter.svgX + radius * Math.sin(radians),
    y: clockCardCenter.svgY - radius * Math.cos(radians)
  }
}

/** 角度归一到 [0, 360)：过去区算出来可能是负数或 ≥360。 */
export function normalizeAngle(angle: number): number {
  const normalized = angle % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function clampDays(days: number): number {
  return Number.isFinite(days) && days > 0 ? days : 0
}
