/**
 * 宏观时钟卡的几何与挂点计算。
 *
 * 唯一依据：`docs-private/05-desktop/ui-audit/prototypes/FINAL-时钟卡-实现依据.html`。
 * 这里只算「放哪儿、多透」，不碰 DOM：组件照算出来的角度与坐标摆，样式照原型原样搬。
 *
 * 三条不能被改掉的口径（原型里逐字写过）：
 * 1. **圆心只有一处来源**：卡 336×330、内距 12 → 卡圆心 (168,165)、SVG 圆心 (156,153)；
 *    牌、色带、刻度、流光、主位全由这两个常量算，不许各自写死。
 * 2. **两区不等速**：未来区 240° = 30 天（1 天 8°）；过去区按各自周期 P 算
 *    （`360 − 距上次发布天数 ÷ P × 360`，月度约 12°/天）。同一个「1 天」在两区角度不同，
 *    不许为对齐去改任一区。
 * 3. **透明度是位置驱动的静态值**：`0.5 + (天数÷30)²×0.5`，不是动画、没有定时器。
 */

export const clockCardGeometry = Object.freeze({
  /** 卡宽高与内距：圆心的唯一来源。 */
  cardWidth: 336,
  cardHeight: 330,
  pad: 12,
  /** SVG 画布：卡扣掉两侧内距（312×306），圆心由它和 pad 一起决定。 */
  svgWidth: 336 - 2 * 12,
  svgHeight: 330 - 2 * 12,
  /** 刻度环半径（里面那圈带短线的环）。 */
  scaleRadius: 104,
  /** 轨道半径：指标牌挂在这条圆上。 */
  orbitRadius: 135,
  /** 未来区：240° 对应 30 天。 */
  futureArcDegrees: 240,
  futureHorizonDays: 30,
  /**
   * 过去区的保留期 = P/3（P = 同一指标相邻两次发布间隔，从日程读，不写死天数）。
   * 距上次发布超过 P/3 就不挂过去牌——这是规则，不是漏画。
   */
  pastRetentionRatio: 1 / 3,
  /**
   * 周期的合理区间：小于 1 天或大于一年都算读不出可信周期，该指标不上过去区，
   * 但要留一行交代（`unplaced`），不许悄悄消失。
   */
  periodDaysRange: Object.freeze({ min: 1, max: 366 })
})

/** 卡圆心：只有这一处算它（原型 (168,165) 与 SVG (156,153) 都由 CARD/PAD 得出）。 */
export const clockCardCenter = Object.freeze({
  cardX: clockCardGeometry.cardWidth / 2,
  cardY: clockCardGeometry.cardHeight / 2,
  svgX: clockCardGeometry.cardWidth / 2 - clockCardGeometry.pad,
  svgY: clockCardGeometry.cardHeight / 2 - clockCardGeometry.pad
})

export type ClockZone = 'past' | 'future'

export type ClockPlaque = Readonly<{
  id: string
  metricKey: string
  nameKey: string
  zone: ClockZone
  /** 相对 12 点、顺时针的角度。 */
  angle: number
  /** 卡片坐标系里的位置（原型的 `left/top`，已含内距）。 */
  x: number
  y: number
  /** 未来区按位置算；过去区固定 1（原型：过去牌不参与）。 */
  opacity: number
  /** 牌上第二行：过去区写上次结果，未来区写预期值；都没有就不给（牌仍画，值那行留空）。 */
  value?: string
  /** 未来牌的天数：撞牌时按「离现在更近」留一块，也写进交代行。 */
  daysUntil?: number
  /** 过去牌距上次发布的天数（同样参与撞牌判定：更近的那块留下）。 */
  daysAgo?: number
  /** 政策牌：主推档，牌名按它生成（写死档位名会出错）。 */
  policyOutcome?: string
}>

/**
 * 环上的牌子：**每个即将发布的日期一块**（用户 2026-11-21 更正）。
 *
 * 「只一个」指的是**同一天里只留一个**，不是整环只留一个：CPI、非农不能因为 PCE 更近就被挤掉。
 *
 * 同一天多个一级指标：
 * 1. 先取**有盘口预期**（`expectedFromMarket`）的；
 * 2. 再按代表优先级：PCE→核心 PCE 年率、CPI→CPI 年率、就业→非农；
 * 3. 仍并列按码字典序（只为可复现）。
 *
 * **没有盘口预期的日期也挂**（用户最初就是「一级指标都要放」），只是牌上不显示数字——
 * 不拿一个编出来的数顶上。
 */
export const clockRingRepresentativeConcepts = Object.freeze([
  'US.CORE_PCE.YOY', 'US.CPI.YOY', 'US.NONFARM.CHANGE'
] as const)

/** 代表优先级：不在清单里的排在最后（同为「非代表」时按码字典序再定，见调用处）。 */
export function clockRepresentativeRank(metricKey: string): number {
  const index = (clockRingRepresentativeConcepts as readonly string[]).indexOf(metricKey)
  return index === -1 ? clockRingRepresentativeConcepts.length : index
}

/** 政策利率不是一级指标，不参与「那一个」的挑选，也不计入「还有 N 个发布不在环上」。 */
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

/**
 * 未来区透明度：`0.5 + (天数÷30)²×0.5`。
 * 平方曲线是刻意的——线性公式在 20–30 天区间斜率太平，几天之差肉眼无感。
 */
export function clockFutureOpacity(daysUntil: number): number {
  const ratio = clampDays(daysUntil) / clockCardGeometry.futureHorizonDays
  return 0.5 + ratio * ratio * 0.5
}

/** 过去区角度：`360 − 距上次发布天数 ÷ P × 360`（速率 360/P °/天）。 */
export function clockPastAngle(daysSince: number, periodDays: number): number {
  if (!(periodDays > 0)) return Number.NaN
  return normalizeAngle(360 - daysSince / periodDays * 360)
}

/**
 * 角度 → 卡片坐标（相对 12 点顺时针，半径默认轨道 135）。
 * 原型的四个点就是这条公式的判据：176.8° → (175.54, 299.79)、218.4° → (84.15, 270.80)…
 */
export function clockRingPoint(angle: number, radius: number = clockCardGeometry.orbitRadius):
Readonly<{ x: number; y: number }> {
  const radians = angle * Math.PI / 180
  return {
    x: clockCardCenter.svgX + radius * Math.sin(radians) + clockCardGeometry.pad,
    y: clockCardCenter.svgY - radius * Math.cos(radians) + clockCardGeometry.pad
  }
}

/**
 * 牌子最大宽度（用户 2026-11-21：「这个事件面板太宽了」，长名字顶出卡右缘被裁）。
 *
 * 336 卡宽、圆心 168、轨道 r135 → 环最左 33、最右 303。牌子居中挂在环上，半宽超过 33 就会出卡。
 * 128 是折中：两行装得下「核心 PCE 年率（季调）」这类长名字，又不越过环。**盒子与位置两侧都要管**，
 * 只改 `max-width` 不夹位置，牌仍会被推到卡外一半。
 */
export const clockPlaqueMaxWidth = 128

/** 牌子在卡内留的边距：牌虽然贴着环，但不许贴到卡边（截图里就是贴上去被裁的）。 */
const PLAQUE_EDGE_MARGIN = 8

/**
 * 牌子的横向夹取：按最大宽算半宽，保证**整块**留在 `[0, 336]` 内。
 * 只夹横向——纵向是环的几何，一点不动。
 */
export function clampPlaqueX(x: number): number {
  const half = clockPlaqueMaxWidth / 2
  return Math.min(Math.max(x, half + PLAQUE_EDGE_MARGIN), clockCardGeometry.cardWidth - half - PLAQUE_EDGE_MARGIN)
}

/** 角度归一到 [0, 360)：过去区算出来可能是负数或 ≥360。 */
export function normalizeAngle(angle: number): number {
  const normalized = angle % 360
  return normalized < 0 ? normalized + 360 : normalized
}

/** 周期是否可信：读不到、≤0、或超出一年的都不算。 */
export function clockPeriodIsUsable(periodDays: number | undefined): boolean {
  if (periodDays === undefined || !Number.isFinite(periodDays)) return false
  return periodDays >= clockCardGeometry.periodDaysRange.min && periodDays <= clockCardGeometry.periodDaysRange.max
}

/**
 * 牌的假定矩形：宽按**上限** `clockPlaqueMaxWidth`（128）、高 `min-height 37`，居中于挂点
 * （`translate(-50%,-50%)`），另加 4px 主档间隔（界面设计 2026-11-15 基线 J 节）。
 *
 * 为什么不按 `min-width 62` 估：牌子现在可以长到 128（长名字两行），按 62 估会漏判一对相交，
 * 两块长牌就压在一起。宁可多判一对，也不留叠牌。
 */
const PLAQUE_BOX = { width: clockPlaqueMaxWidth, height: 37, gap: 4 } as const

/**
 * 撞牌判据：**全环统一按矩形相交**，不分区。
 * 未来区 0°–240°、过去区 240°–360° 在 12 点的「现在」和 8 点的断口两处相接，
 * 「只同区比」会在这两处各留一个叠牌口子（界面设计扫 241×121 组命中 670 对）。
 */
export function rectsIntersect(left: ClockPlaque, right: ClockPlaque): boolean {
  return Math.abs(left.x - right.x) < PLAQUE_BOX.width + PLAQUE_BOX.gap &&
    Math.abs(left.y - right.y) < PLAQUE_BOX.height + PLAQUE_BOX.gap
}

function clampDays(days: number): number {
  return Number.isFinite(days) && days > 0 ? days : 0
}
