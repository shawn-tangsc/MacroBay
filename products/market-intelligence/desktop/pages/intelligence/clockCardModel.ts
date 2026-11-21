/**
 * 宏观时钟卡的编排：一天里画成什么样——牌挂在哪、中央是哪张面、谁没上环。
 *
 * 拆分（2026-11-21，文件过 500 行硬线）：
 * - 牌子几何、角度、夹取与撞牌的判据 → `clockPlaqueLayout`
 * - 中央两张面与 ±24 小时窗口 → `clockCenterFace`
 *
 * 这里只留编排与对外类型。**导出面不变**：调用方仍从本文件取几何、窗口与牌类型。
 */
import {
  POLICY_METRIC_KEY, clockCardGeometry, clockDayGap, clockFutureAngle, clockFutureOpacity,
  clockPastAngle, clockPeriodIsUsable, clockRepresentativeRank, clockRingPoint, clampPlaqueX,
  rectsIntersect, type ClockPlaque
} from './clockPlaqueLayout'
import { clockCenterFace, selectCenterWindow, type ClockCenterFace } from './clockCenterFace'

export * from './clockPlaqueLayout'
export * from './clockCenterFace'

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

/**
 * 没上环的指标与原因：**必须留一行交代**，不许静默消失。
 * - `no-period`：读不到周期 P；
 * - `period-out-of-range`：P 不在合理区间；
 * - `no-next-release`：没有下一期日程（未来区无处可挂）。
 */
export type ClockUnplacedReason = 'no-period' | 'period-out-of-range' | 'no-next-release' | 'crowded'
/** 环上只放一个指标（用户 2026-11-21）：其余一级指标不是「放不下」，是**没被选中**——原因要分开写。 */
export type ClockUnplaced = Readonly<{
  metricKey: string
  nameKey: string
  reason: ClockUnplacedReason | 'not-selected'
  /** 被撞牌让位时的「还有几天」：交代行要写出来，读者才知道挪走的是哪一条。 */
  daysUntil?: number
  /** 这一项的发布日期（`not-selected` 的溢出清单要写「哪天、几天后」）。 */
  date?: string
}>

/**
 * 环上的代表：**每个发布日一个**。
 *
 * 同一天多个一级指标时，先取有盘口预期的（那是读者抬头要看的数），再按代表优先级，
 * 最后按码字典序（只为可复现）。没有盘口的日期照样返回——牌要挂，只是不显示数字。
 */
export function selectRingMetrics(metrics: readonly ClockScheduleMetric[]): readonly ClockScheduleMetric[] {
  const hasMarket = (metric: ClockScheduleMetric): number => metric.nextRelease?.expectedFromMarket === true ? 0 : 1
  const byDate = new Map<string, ClockScheduleMetric[]>()
  for (const metric of metrics) {
    if (metric.metricKey === POLICY_METRIC_KEY || metric.nextRelease === undefined) continue
    const list = byDate.get(metric.nextRelease.date)
    if (list === undefined) byDate.set(metric.nextRelease.date, [metric])
    else list.push(metric)
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, sameDay]) => [...sameDay].sort((left, right) => hasMarket(left) - hasMarket(right)
      || clockRepresentativeRank(left.metricKey) - clockRepresentativeRank(right.metricKey)
      || left.metricKey.localeCompare(right.metricKey))[0]!)
}

/**
 * 窗口内的指标必须**出现在环上**（中央切成它的时候，环上不能挂着另一个）。
 * 同一发布日就替掉当天的代表；不是同一天就补进去。
 */
function ringWithWindow(ring: readonly ClockScheduleMetric[], windowMetric: ClockScheduleMetric | undefined): readonly ClockScheduleMetric[] {
  if (windowMetric === undefined) return ring
  if (ring.some((metric) => metric.metricKey === windowMetric.metricKey)) return ring
  const day = windowMetric.nextRelease?.date
  if (day === undefined) return [...ring, windowMetric]
  const replaced = ring.map((metric) => (metric.nextRelease?.date === day ? windowMetric : metric))
  return replaced.includes(windowMetric) ? replaced : [...ring, windowMetric]
}

export type ClockCardModel = Readonly<{
  plaques: readonly ClockPlaque[]
  center?: ClockCenterFace
  unplaced: readonly ClockUnplaced[]
}>

/**
 * 一天里这张卡画成什么样：牌挂在哪、中央是哪一张面、谁没上环。
 *
 * `today` 是**显示时区的日期**（`YYYY-MM-DD`）：卡上的天数跟读者看到的那一天走。
 * `now` 是**此刻的 ISO 时刻**（可选）：中央的 ±24 小时窗口按它算；不给就只有利率路径面。
 */
export function buildClockCardModel(input: Readonly<{
  today: string
  now?: string
  metrics: readonly ClockScheduleMetric[]
}>): ClockCardModel {
  const plaques: ClockPlaque[] = []
  const unplaced: ClockUnplaced[] = []
  /**
   * **中央的窗口先于环上那一个**（42 号文件 §二）：窗口内的指标优先上环，
   * 否则会出现「中央已经切成某个指标，环上却挂着另一个」。
   */
  const window = input.now === undefined ? undefined : selectCenterWindow({ now: input.now, metrics: input.metrics })
  /**
   * **环上每个发布日一块牌**（用户 2026-11-21 更正）：CPI、非农不能因为 PCE 更近就消失。
   * 窗口内的指标必须上环（否则中央切成它、环上却没有），同一天以它替掉当天的代表。
   */
  const ring = ringWithWindow(selectRingMetrics(input.metrics), window?.metric)
  const ringKeys = new Set(ring.map((metric) => metric.metricKey))

  for (const metric of input.metrics) {
    const isPolicy = metric.metricKey === POLICY_METRIC_KEY
    const isSelected = ringKeys.has(metric.metricKey)
    // 没被选中的一级指标：**不是放不下**，是没选中；日期与天数也带上，溢出清单要能说清漏的是哪一条。
    if (!isPolicy && !isSelected) {
      // 没有下一期日程的，原因照旧如实写（「没有下一期」不是「没被选中」）。
      if (metric.nextRelease === undefined) {
        unplaced.push({ metricKey: metric.metricKey, nameKey: metric.nameKey, reason: 'no-next-release' })
        continue
      }
      const daysUntil = clockDayGap(input.today, metric.nextRelease.date)
      unplaced.push({
        metricKey: metric.metricKey, nameKey: metric.nameKey, reason: 'not-selected',
        date: metric.nextRelease.date,
        ...(Number.isNaN(daysUntil) ? {} : { daysUntil })
      })
      continue
    }
    const pastDays = metric.lastRelease === undefined ? undefined : clockDayGap(metric.lastRelease.date, input.today)
    const periodUsable = clockPeriodIsUsable(metric.periodDays)
    // 过去区：有上次发布、周期可信、且还在保留期 P/3 内才挂。
    if (metric.lastRelease !== undefined) {
      if (metric.periodDays === undefined || !Number.isFinite(metric.periodDays) || pastDays === undefined || Number.isNaN(pastDays)) {
        unplaced.push({ metricKey: metric.metricKey, nameKey: metric.nameKey, reason: 'no-period' })
      } else if (!periodUsable) {
        unplaced.push({ metricKey: metric.metricKey, nameKey: metric.nameKey, reason: 'period-out-of-range' })
      } else if (pastDays >= 0 && pastDays < metric.periodDays * clockCardGeometry.pastRetentionRatio) {
        const angle = clockPastAngle(pastDays, metric.periodDays!)
        const point = clockRingPoint(angle)
        plaques.push({
          id: `${metric.metricKey}:past`, metricKey: metric.metricKey, nameKey: metric.nameKey, zone: 'past',
          angle, x: clampPlaqueX(point.x), y: point.y, opacity: 1, daysAgo: pastDays,
          ...(metric.lastRelease.value === undefined ? {} : { value: metric.lastRelease.value }),
          ...(metric.policyOutcome === undefined ? {} : { policyOutcome: metric.policyOutcome })
        })
      }
    }

    // 未来区：有下一期就挂；没有就留一行交代。
    if (metric.nextRelease === undefined) {
      unplaced.push({ metricKey: metric.metricKey, nameKey: metric.nameKey, reason: 'no-next-release' })
      continue
    }
    const daysUntil = clockDayGap(input.today, metric.nextRelease.date)
    if (Number.isNaN(daysUntil) || daysUntil < 0) {
      unplaced.push({ metricKey: metric.metricKey, nameKey: metric.nameKey, reason: 'no-next-release' })
      continue
    }
    const angle = clockFutureAngle(daysUntil)
    const point = clockRingPoint(angle)
    plaques.push({
      id: `${metric.metricKey}:future`, metricKey: metric.metricKey, nameKey: metric.nameKey, zone: 'future',
      angle, x: clampPlaqueX(point.x), y: point.y, opacity: round4(clockFutureOpacity(daysUntil)), daysUntil,
      ...(metric.nextRelease.expected === undefined ? {} : { value: metric.nextRelease.expected }),
      ...(metric.policyOutcome === undefined ? {} : { policyOutcome: metric.policyOutcome })
    })
  }

  const center = clockCenterFace({ today: input.today, metrics: input.metrics,
    ...(window === undefined ? {} : { window }) })

  // 撞牌：同一区内部比矩形，保留离「现在」更近的；让位的进交代行。
  const ordered = [...plaques].sort((left, right) => {
    if (left.zone !== right.zone) return left.zone === 'future' ? -1 : 1
    /**
     * 未来区里**窗口内那个指标优先**：它和政策牌撞上时，让位的是政策牌。
     * 否则会出现「中央已经切成某个指标，环上却只有政策牌」——主位与环上同一条就断了。
     */
    if (left.zone === 'future') {
      const windowKey = window?.metric.metricKey
      const leftRing = windowKey !== undefined && left.metricKey === windowKey
      const rightRing = windowKey !== undefined && right.metricKey === windowKey
      if (leftRing !== rightRing) return leftRing ? -1 : 1
      /**
       * **指标发布牌优先于政策牌**（用户 2026-11-21：「CPI、非农怎么没了」）。
       * 政策牌和某天的发布牌撞上时，让位的是政策牌——它的日期在下面那张利率路径卡里还能看到，
       * 而发布牌一旦让位，那天就从环上消失了，读者会以为没有这场发布。
       */
      const leftPolicy = left.metricKey === POLICY_METRIC_KEY ? 1 : 0
      const rightPolicy = right.metricKey === POLICY_METRIC_KEY ? 1 : 0
      if (leftPolicy !== rightPolicy) return leftPolicy - rightPolicy
    }
    const leftDays = left.zone === 'future' ? left.daysUntil ?? Number.POSITIVE_INFINITY : left.daysAgo ?? Number.POSITIVE_INFINITY
    const rightDays = right.zone === 'future' ? right.daysUntil ?? Number.POSITIVE_INFINITY : right.daysAgo ?? Number.POSITIVE_INFINITY
    return leftDays - rightDays || left.metricKey.localeCompare(right.metricKey)
  })
  const kept: ClockPlaque[] = []
  for (const plaque of ordered) {
    const collided = kept.some((other) => rectsIntersect(plaque, other))
    if (!collided) { kept.push(plaque); continue }
    unplaced.push({
      metricKey: plaque.metricKey, nameKey: plaque.nameKey, reason: 'crowded',
      ...(plaque.daysUntil === undefined ? {} : { daysUntil: plaque.daysUntil })
    })
  }
  return { plaques: kept, ...(center === undefined ? {} : { center }), unplaced }
}

/** 透明度落到 4 位小数：原型写 `.914`，多出来的浮点尾巴不该出现在行内样式里。 */
function round4(value: number): number {
  return Number(value.toFixed(4))
}
