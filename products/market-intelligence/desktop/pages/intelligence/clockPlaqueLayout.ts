/**
 * 宏观时钟卡的几何与挂点计算。
 *
 * 唯一依据：`docs-private/05-desktop/ui-audit/prototypes/FINAL-时钟卡-实现依据.html`。
 * 这里只算「放哪儿、多透」，不碰 DOM：组件照算出来的角度与坐标摆，样式照原型原样搬。
 *
 * 三条不能被改掉的口径（原型里逐字写过）：
 * 1. **圆心只有一处来源**：卡 252×248、内距 9 → 卡圆心 (126,124)、SVG 圆心 (117,115)；
 *    牌、色带、刻度、流光、主位全由这两个常量算，不许各自写死。
 * 2. **两区不等速**：未来区 240° = 30 天（1 天 8°）；过去区按各自周期 P 算
 *    （`360 − 距上次发布天数 ÷ P × 360`，月度约 12°/天）。同一个「1 天」在两区角度不同，
 *    不许为对齐去改任一区。
 * 3. **透明度是位置驱动的静态值**：`0.5 + (天数÷30)²×0.5`，不是动画、没有定时器。
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
  /** 轨道半径：指标牌挂在这条圆上（环直径 202）。 */
  orbitRadius: 101,
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

/**
 * 原型那张卡的轨道半径（336×330、SVG 圆心 (156,153)、r135）。
 * A 方案等比缩小时**以它为分母**算系数，SVG 里的弧与刻度都照这个系数重算——
 * 手绘路径不重写，只按比例搬（见 `clockCardSvg.ts`）。
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
  /** 未来牌的发布日（`YYYY-MM-DD`）。 */
  date?: string
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
 * 角度 → 卡片坐标（相对 12 点顺时针，半径默认轨道 101）。
 * 原型的四个点按同一比例缩到这张卡上就是判据（见 `clockCardModel.test.ts`）。
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

/**
 * 牌子最大宽度（用户 2026-11-21：「这个事件面板太宽了」，长名字顶出卡右缘被裁）。
 *
 * 卡 252 宽、圆心 126、轨道 r101 → 环最左 25、最右 227。牌子居中挂在环上，半宽超过 25 就会出卡。
 * 96 是 128 按 0.75 缩下来的（用户 2026-11 拍板 A 方案）：仍装得下两行名字，又不越过环。
 * **盒子与位置两侧都要管**，只改 `max-width` 不夹位置，牌仍会被推到卡外一半。
 */
export const clockPlaqueMaxWidth = 96

/** 牌子在卡内留的边距：牌虽然贴着环，但不许贴到卡边（截图里就是贴上去被裁的）。 */
const PLAQUE_EDGE_MARGIN = 8

/**
 * 牌子的横向夹取：按最大宽算半宽，保证**整块**留在 `[0, 252]` 内。
 * 只夹横向——纵向是环的几何，一点不动。
 */
export function clampPlaqueX(x: number): number {
  const half = clockPlaqueMaxWidth / 2
  return Math.min(Math.max(x, half + PLAQUE_EDGE_MARGIN), clockCardGeometry.cardWidth - half - PLAQUE_EDGE_MARGIN)
}

/**
 * 牌子的纵向夹取：**整块留在卡内**。
 *
 * A 方案（卡 248 高）之后，1 天后那块牌挂在 8° 上、卡顶只隔 24px，而两行名字的牌有 50 高，
 * 上半截会被 `overflow: hidden` 切掉。横向早就有夹取，纵向也必须有——两者都只挪位置，不动环的几何。
 */
export function clampPlaqueY(y: number, size: ClockPlaqueSize): number {
  const half = size.height / 2
  return Math.min(Math.max(y, half + PLAQUE_EDGE_MARGIN), clockCardGeometry.cardHeight - half - PLAQUE_EDGE_MARGIN)
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
 * 牌子的最小盒：与 CSS 的 `min-width: 62px` / `min-height: 37px` 同一个数（守卫用例盯着）。
 * 牌子的实际宽度**随名字文字量走**（`min-width..max-width` 之间），布局要按这个估，不许按上限一把算。
 */
export const clockPlaqueMinWidth = 62
/** 名字占一行的牌高。 */
export const clockPlaqueOneLineHeight = 37
/** 名字折两行的牌高（界面设计 2026-11-21 探针：两行名字那块 49.9）。 */
export const clockPlaqueTwoLineHeight = 50
/** 牌内左右内距（CSS `padding: 2px 4px` + 1px 边框，两侧合计 12）。 */
const PLAQUE_PADDING_WIDTH = 12
/** 11px 字号下的字宽估算：中日韩字 11px、ASCII 6.2px（`--font-meta` 是这张卡唯一可用档）。 */
const CJK_CHAR_WIDTH = 11
const ASCII_CHAR_WIDTH = 6.2

/** 一块牌的盒子尺寸（不含位置）。 */
export type ClockPlaqueSize = Readonly<{ width: number; height: number }>

/**
 * 牌子的盒子：宽度由名字算——名字越长盒子越宽，超过上限就折两行、盒子到上限。
 *
 * 为什么按名字估而不是按 CSS 最大值一把算：`min-width 62 / max-width 96` 之间差别也不小，
 * 按上限算会把 62 宽的短牌当成 128 宽，明明不叠的两块被判成要错开；按最小值算又会漏判。
 * 估价只服务于「叠了多少」，与真实渲染的差由 `clockPlaqueOverlapCap` 兜住。
 */
export function clockPlaqueBox(name: string): ClockPlaqueSize {
  let textWidth = 0
  for (const char of name) {
    textWidth += (char.codePointAt(0) ?? 0) >= 0x2E80 ? CJK_CHAR_WIDTH : ASCII_CHAR_WIDTH
  }
  const wanted = Math.round(textWidth) + PLAQUE_PADDING_WIDTH
  if (wanted > clockPlaqueMaxWidth) {
    return { width: clockPlaqueMaxWidth, height: clockPlaqueTwoLineHeight }
  }
  return { width: Math.max(clockPlaqueMinWidth, wanted), height: clockPlaqueOneLineHeight }
}

/** 盒子摆到画布上：位置取牌心（CSS `translate(-50%,-50%)`）。 */
export type ClockPlaqueRect = Readonly<{ x: number; y: number; width: number; height: number }>

export function clockPlaqueRect(plaque: ClockPlaque, size: ClockPlaqueSize): ClockPlaqueRect {
  return { x: plaque.x, y: plaque.y, width: size.width, height: size.height }
}

/**
 * 两块牌的重叠占比：**分母是较小那块**的面积（用户 2026-11-21：任意一块至少露出四分之一）。
 * 不相交返回 0。
 */
export function plaqueOverlapRatio(left: ClockPlaqueRect, right: ClockPlaqueRect): number {
  const overlapWidth = Math.min(left.x + left.width / 2, right.x + right.width / 2) -
    Math.max(left.x - left.width / 2, right.x - right.width / 2)
  const overlapHeight = Math.min(left.y + left.height / 2, right.y + right.height / 2) -
    Math.max(left.y - left.height / 2, right.y - right.height / 2)
  if (overlapWidth <= 0 || overlapHeight <= 0) return 0
  const smallerArea = Math.min(left.width * left.height, right.width * right.height)
  return overlapWidth * overlapHeight / smallerArea
}

/**
 * 两块牌最多叠住多少（按**较小那块**算）：任意一块至少露出 1/4。
 *
 * **0.75 定稿，不再收**（用户 2026-11 定）：他要的交互就是「默认前面的盖住后面的，鼠标移上去就浮起」，
 * 界面设计实测「叠到 75% 时被盖那块的名字一个字读不出」是提醒、不是否决。信息靠另外两条兜住：
 * 悬停把那一块抬到最前、牌上的名字与天数是真实文本（读屏照读，遮挡只是视觉）。
 *
 * 它只在这里写一份：改值就改这一处，用例断的是「算出来的读数 ≤ 这个常量」，不写 0.75。
 *
 * **与下面两个错开常量是一组**（改这个数要同时核错开步数够不够把两块都留在环上）：
 * 今天这一对（12-09 / 12-10，62×37 的牌）错开满 6 步 = 24px 时读数约 0.20；
 * 上限压到 0.20 以下就会有一块进下沿交代行——那是「可错开的距离不够」，不是摆不下。
 */
export const clockPlaqueOverlapCap = 0.75

/** 超限时沿径向每次错开多少（用户 2026-11-21：每次 4px，直到达标或到边界）。 */
export const clockPlaqueNudgeStep = 4
/** 每个方向最多错开几步（6 步 = 24px）：再远就离开环了，此时算位置不足。 */
export const clockPlaqueNudgeMaxSteps = 6
/**
 * 一组最多几块牌互相叠住（界面设计 2026-11-21：三块连叠时静止几乎读不出任何名字，
 * 而一次悬停只能救一块）。超出的那块进下沿「还有 N 个发布不在环上」并说明位置不足。
 */
export const clockPlaqueOverlapGroupMax = 2
/** 抬起来那块（悬停/聚焦）的层级：必须高于卡内所有牌子，也高于环上的按钮与说明行。 */
export const clockPlaqueRaisedZ = 200
/** 环上按钮、溢出行、说明行、状态行的层级：高于所有牌子，低于抬起的那块。 */
export const clockPlaqueOverlayZ = 100

/** 一块牌最终落在哪：位置、层级。 */
export type ClockPlaqueStacked = ClockPlaque & Readonly<{ z: number }>

/**
 * 把牌摆到环上（用户 2026-11-21 口径）：**不合并**，近了就叠，但
 *
 * 1. 两块之间叠住的面积不超过较小那块的 `clockPlaqueOverlapCap`；
 * 2. 超过就沿径向每次 4px 错开，直到达标且不越出卡的安全边；
 * 3. 一组最多两块互相叠住，第三块算位置不足（进交代行，不静默消失）；
 * 4. 层级按「离现在近的在上」，中央主位那块沉到最下（中央已完整显示它）。
 */
export function arrangePlaques(
  plaques: readonly ClockPlaque[],
  options: Readonly<{
    sizeOf: (plaque: ClockPlaque) => ClockPlaqueSize
    /** 摆放次序：先放的占住原位，后放的让位（窗内指标、非政策牌优先，见调用处）。 */
    order: (left: ClockPlaque, right: ClockPlaque) => number
    /** 中央主位那一块：沉到最下层。 */
    sinkId?: string
  }>
): Readonly<{ plaques: readonly ClockPlaqueStacked[]; crowded: readonly ClockPlaque[] }> {
  const ordered = [...plaques].sort(options.order)
  const placed: Array<{ plaque: ClockPlaque; rect: ClockPlaqueRect }> = []
  const crowded: ClockPlaque[] = []
  for (const plaque of ordered) {
    const resolved = placePlaque(plaque, options.sizeOf(plaque), placed)
    if (resolved === undefined) { crowded.push(plaque); continue }
    placed.push(resolved)
  }
  // 层级：离现在近的在上面。过去牌与未来牌用各自的「离现在多远」比，浮点小=近。
  const proximity = (plaque: ClockPlaque): number => (plaque.zone === 'future'
    ? plaque.daysUntil ?? Number.POSITIVE_INFINITY
    : plaque.daysAgo ?? Number.POSITIVE_INFINITY)
  const stacked = [...placed].sort((left, right) => proximity(left.plaque) - proximity(right.plaque)
    || left.plaque.metricKey.localeCompare(right.plaque.metricKey))
  const zById = new Map<string, number>()
  stacked.forEach((entry, index) => { zById.set(entry.plaque.id, 4 + stacked.length - 1 - index) })
  return {
    plaques: placed.map((entry) => ({
      ...entry.plaque,
      z: entry.plaque.id === options.sinkId ? 3 : zById.get(entry.plaque.id) ?? 4
    })),
    crowded
  }
}

function placePlaque(
  plaque: ClockPlaque,
  size: ClockPlaqueSize,
  placed: readonly Readonly<{ plaque: ClockPlaque; rect: ClockPlaqueRect }>[]
): Readonly<{ plaque: ClockPlaque; rect: ClockPlaqueRect }> | undefined {
  // 先保证整块在卡内（横向既有夹取、纵向按这块自己的高），再谈叠多少；错开也从夹好的位置起算。
  const anchor: ClockPlaque = { ...plaque, x: clampPlaqueX(plaque.x), y: clampPlaqueY(plaque.y, size) }
  const base = { plaque: anchor, rect: clockPlaqueRect(anchor, size) }
  const neighbours = placed.filter((other) => plaqueOverlapRatio(base.rect, other.rect) > 0)
  if (neighbours.length === 0) return base
  // 一组最多两块：一上来就叠到两块上，位置不足。
  if (neighbours.length >= clockPlaqueOverlapGroupMax) return undefined
  if (plaqueOverlapRatio(base.rect, neighbours[0]!.rect) <= clockPlaqueOverlapCap) return base
  for (let step = 1; step <= clockPlaqueNudgeMaxSteps; step += 1) {
    // 先朝圆心、再朝外：朝里更容易避开邻牌，也不容易把牌推出卡边。
    for (const direction of [-1, 1] as const) {
      const moved = nudgeRadially(anchor, direction * step * clockPlaqueNudgeStep, size)
      if (moved === undefined) continue
      const rect = clockPlaqueRect(moved, size)
      const blockers = placed.filter((other) => plaqueOverlapRatio(rect, other.rect) > 0)
      if (blockers.length >= clockPlaqueOverlapGroupMax) continue
      if (blockers.every((other) => plaqueOverlapRatio(rect, other.rect) <= clockPlaqueOverlapCap)) {
        return { plaque: moved, rect }
      }
    }
  }
  return undefined
}

/** 沿径向挪 `distance` 像素（正=离圆心更远）；越出卡的安全边就不给位置。 */
function nudgeRadially(plaque: ClockPlaque, distance: number, size: ClockPlaqueSize): ClockPlaque | undefined {
  const radians = plaque.angle * Math.PI / 180
  const y = plaque.y - distance * Math.cos(radians)
  const half = size.height / 2
  if (y - half < PLAQUE_EDGE_MARGIN || y + half > clockCardGeometry.cardHeight - PLAQUE_EDGE_MARGIN) return undefined
  return { ...plaque, x: clampPlaqueX(plaque.x + distance * Math.sin(radians)), y }
}

function clampDays(days: number): number {
  return Number.isFinite(days) && days > 0 ? days : 0
}
