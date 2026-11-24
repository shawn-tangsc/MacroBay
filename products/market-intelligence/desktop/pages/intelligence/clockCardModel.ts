/**
 * 宏观时钟卡的编排：一天里画成什么样——四支大类箭头挂在哪、中央是哪张面、哪一类没画出来。
 *
 * 用户 2026-11 改了形态：环上不再挂指标牌，改成**四个大类各一支箭头**（利率 / CPI / 非农 / PCE），
 * 名字挂在轨道外侧，鼠标移到名字上才显示该类当期看板的具体值。牌那一套（宽度上限、重叠、
 * 径向错开、叠放层级）连同它的常量与用例一起删掉了——新形态没有宽度问题。
 *
 * 模块分工：
 * - 几何、角度、圆心 → `clockPlaqueLayout`
 * - 箭头形状、名字摆放与避让 → `clockRingArrows`
 * - 大类归属 → `clockRingCategories`
 * - 中央两张面与 ±24 小时窗口 → `clockCenterFace`
 */
import {
  POLICY_METRIC_KEY, clockDayGap, clockFutureAngle, clockRingPoint
} from './clockPlaqueLayout'
import { clockCenterFace, selectCenterWindow, type ClockCenterFace } from './clockCenterFace'
import {
  clockArrowGeometry, clockArrowPath, clockNameWidth,
  placeClockNames, type ClockRingArrow, type ClockRingArrowEntry, type ClockRingNote
} from './clockRingArrows'
import { clockCategoryOf, clockRingCategories, type ClockRingCategory } from './clockRingCategories'

export * from './clockPlaqueLayout'
export * from './clockCenterFace'
export * from './clockRingCategories'
export * from './clockRingArrows'

export type ClockScheduleMetric = Readonly<{
  /** 指标码（`US.CPI.NSA.YOY` 这类）；同一指标可以同时挂过去与未来两块。 */
  metricKey: string
  /** 牌上第一行用的文案键（指标缩写）；文案内容由文案表给，判据不在这里。 */
  nameKey: string
  /** 上一次发布：日期取日程，值取这一期已公布的结果；这一期没有值就不给 `value`。 */
  lastRelease?: Readonly<{ date: string; value?: string
    /** 发布时刻（ISO）。中央的 ±24 小时窗口**按时刻算，不按日期算**（42 号文件 §二）。 */
    at?: string }>
  /** 下一期发布：只给出日期与预期值；没有预期值（比如盘未开）就不给 `expected`。 */
  nextRelease?: Readonly<{ date: string; at?: string; expected?: string
    /** 预期来自盘口（`market-implied`）：环上只从这类候选里挑一个。 */
    expectedFromMarket?: true }>
  /** 同一指标相邻两次发布的间隔（天）；从日程算，不许写死。 */
  periodDays?: number
  /** 政策利率那一格：主推档（`hike-25` 等），牌名按它生成——档位会变，名字不能写死。 */
  policyOutcome?: string
  /** 读数里这一期的实际值（发布后才有）。窗口内「有结果」那一态的大字就是它。 */
  actualValue?: string
  /** 上一期公布值（`previousAsPublished`）：窗口内「前值」那一行。 */
  previousValue?: string
  /** 本期共识（数据商问卷）：窗口内「预期」那一行。**不是盘口**，盘口在 `nextRelease.expected`。 */
  consensusValue?: string
  /** 本期实际减本期共识（带符号的数值差，如 `+0.10pp`）；方向由文案表说。 */
  deltaAmount?: string
  deltaDirection?: 'above' | 'below'
}>

export type ClockCardModel = Readonly<{
  arrows: readonly ClockRingArrow[]
  center?: ClockCenterFace
  notes: readonly ClockRingNote[]
}>

/**
 * 一天里这张卡画成什么样：四支大类箭头、中央那张面、哪一类没画出来。
 *
 * `today` 是**显示时区的日期**（`YYYY-MM-DD`）：卡上的天数跟读者看到的那一天走。
 * `now` 是**此刻的 ISO 时刻**（可选）：中央的 ±24 小时窗口按它算；不给就只有利率路径面。
 * `names` 是名字文字（名字键 → 文字）：名字盒宽度只能按文字算，拿键顶会算错。
 */
export function buildClockCardModel(input: Readonly<{
  today: string
  now?: string
  metrics: readonly ClockScheduleMetric[]
  /** 指标名（`nameKey` → 文字）：浮层里逐条写名字用。 */
  names: Readonly<Record<string, string>>
  /** 四个大类名（利率 / CPI / 非农 / PCE）：只有这四个词上环。 */
  categoryNames: Readonly<Record<ClockRingCategory, string>>
}>): ClockCardModel {
  const window = input.now === undefined ? undefined : selectCenterWindow({ now: input.now, metrics: input.metrics })
  const center = clockCenterFace({ today: input.today, metrics: input.metrics,
    ...(window === undefined ? {} : { window }) })
  return {
    ...buildRingArrows(input),
    ...(center === undefined ? {} : { center })
  }
}

/** 摆好位置前的一个大类：角度、日期、这一类的全部指标。 */
type ClockRingAnchor = Readonly<{
  category: ClockRingCategory
  angle: number
  date: string
  daysUntil: number
  entries: readonly ClockRingArrowEntry[]
}>

/** 每个大类一支箭头：位置取该类**最近一期**发布，其余日期只在浮层里。 */
function buildRingArrows(input: Readonly<{
  today: string
  metrics: readonly ClockScheduleMetric[]
  names: Readonly<Record<string, string>>
  categoryNames: Readonly<Record<ClockRingCategory, string>>
}>): Readonly<{ arrows: readonly ClockRingArrow[]; notes: readonly ClockRingNote[] }> {
  const notes: ClockRingNote[] = []
  const grouped = new Map<ClockRingCategory, ClockRingArrowEntry[]>()
  const unreadable = new Set<ClockRingCategory>()
  for (const metric of input.metrics) {
    const category = clockCategoryOf(metric.metricKey)
    const next = metric.nextRelease
    if (next === undefined) continue
    const daysUntil = clockDayGap(input.today, next.date)
    if (Number.isNaN(daysUntil)) { unreadable.add(category); continue }
    // 过去期不挂箭头：只有「今天及以后」的那一期才算下一期。
    if (daysUntil < 0) continue
    const entry: ClockRingArrowEntry = {
      metricKey: metric.metricKey,
      nameKey: metric.nameKey,
      date: next.date,
      daysUntil,
      ...(next.expected === undefined ? {} : { value: next.expected }),
      // 政策没有「预期值」，那个数是盘口主推档的概率——同一格，浮层里按概率说。
      ...(metric.metricKey === POLICY_METRIC_KEY && next.expected !== undefined
        ? { probability: next.expected } : {})
    }
    const list = grouped.get(category)
    if (list === undefined) {
      grouped.set(category, [entry])
    } else {
      list.push(entry)
    }
  }

  const anchors: ClockRingAnchor[] = []
  for (const category of clockRingCategories) {
    const entries = (grouped.get(category) ?? []).slice()
      .sort((left, right) => left.daysUntil - right.daysUntil || left.metricKey.localeCompare(right.metricKey))
    if (entries.length === 0) {
      notes.push({ category, reason: unreadable.has(category) ? 'schedule-unreadable' : 'no-release' })
      continue
    }
    const nearest = entries[0]!
    anchors.push({ category, angle: clockFutureAngle(nearest.daysUntil), date: nearest.date,
      daysUntil: nearest.daysUntil, entries })
  }

  // 名字只能容纳「大类名」：宽度按文案表里那一行算（英文 Rate/CPI/Jobs/PCE 也走同一条）。
  const placed = placeClockNames(anchors.map((anchor) => ({
    category: anchor.category,
    angle: anchor.angle,
    width: clockNameWidth(input.categoryNames?.[anchor.category] ?? anchor.category)
  })))
  for (const category of placed.demoted) notes.push({ category, reason: 'name-demoted' })

  const arrows: ClockRingArrow[] = anchors.map((anchor) => {
    const name = placed.names[anchor.category]
    const tip = clockRingPoint(anchor.angle, clockArrowGeometry.tipRadius)
    return {
      category: anchor.category,
      angle: anchor.angle,
      date: anchor.date,
      daysUntil: anchor.daysUntil,
      tip,
      path: clockArrowPath(anchor.angle),
      ...(name === undefined ? {} : { name }),
      entries: anchor.entries
    }
  })
  return { arrows, notes }
}
