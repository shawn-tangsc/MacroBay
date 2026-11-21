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
 * 中央的两张面（用户 2026-11-21 拍板，42 号文件）：
 * - 平时显示**利率路径**（版本一：「档名 + 概率」大字，下面「会议日 · 天数」）；
 * - 只在某个一级指标发布**前后各 24 小时**内切成该指标的**指标面**。
 *
 * 几何一点不动：中央块仍是那 160×? 的 `mi-clock__core`，只换里面的行。
 */
export type ClockCenterPhase = 'upcoming' | 'released' | 'overdue'

/** 中央政策面（平时那张）：档名按主推档生成，不写死。 */
export type ClockCenterPolicyFace = Readonly<{
  kind: 'policy'
  /** 主推档（`hike-25` 等）；读不到就不给，卡面只写「政策利率」不编档位。 */
  outcome?: string
  /** 主推档概率，如 `91.7%`；取不到就不给（**不写 0%**）。 */
  probability?: string
  /** 会议日 `12–09`；取不到就不给，那一行整行不显示。 */
  meetingDate?: string
  /** 距会议天数；会议日读不到时没有。 */
  daysUntil?: number
}>

/** 中央指标面（±24 小时窗口内）：名字与倒计时是同一件事。 */
export type ClockCenterMetricFace = Readonly<{
  kind: 'metric'
  metricKey: string
  nameKey: string
  /** 这次发布的时刻（ISO）；窗口就是围着它算的。 */
  at: string
  /** 正数＝已过多少小时，负数＝还有多少小时（pill 用）。 */
  hoursFromNow: number
  phase: ClockCenterPhase
  /** 这次发布的市场预期；没有就写「暂无预期（盘未开）」，不拿别的数顶。 */
  expected?: string
  /** 上一期公布值。 */
  previous?: string
  /** 这次发布的结果（有值才有）。 */
  result?: string
  /** 本期共识（数据商问卷）：发布后用来算「高于/低于预期」与副行。 */
  consensus?: string
  /** 实际与共识的差（带符号），如 `+0.10pp`；只有两个值都齐才给。 */
  delta?: string
  deltaDirection?: 'above' | 'below'
}>

export type ClockCenterFace = ClockCenterPolicyFace | ClockCenterMetricFace

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
 * **环上那一个指标的选法**（用户 2026-11-21，唯一口径）：
 * 1. 候选池 = 一级指标里**下一期有盘口预期**（`expectedFromMarket`）的；
 * 2. 多于一个 → 下一期发布最近的；
 * 3. 同一发布日 → 代表优先级：PCE→核心 PCE 年率、CPI→CPI 年率、就业→非农；
 * 4. 一个都没有盘口 → 不硬挂（`undefined`），由卡面走「暂无预期」，不许拿没有盘口的顶上去。
 */
export const clockRingRepresentativeConcepts = Object.freeze([
  'US.CORE_PCE.YOY', 'US.CPI.YOY', 'US.NONFARM.CHANGE'
] as const)

/** 政策利率不是一级指标，不参与「那一个」的挑选。 */
const POLICY_METRIC_KEY = 'US.TARGET_RATE.DECISION'

/**
 * 中央窗口：发布时刻**前后各 24 小时**（42 号文件 §二）。
 *
 * 两个窗口不是同一个数，别混：中央窗口管「它什么时候占据视觉中心」，
 * 环上那一个由「有盘口预期优先」驱动。将来改任何一个都不许顺手改另一个。
 */
export const clockCenterWindowHours = 24

export type ClockCenterWindow = Readonly<{
  metric: ClockScheduleMetric
  at: string
  /** 正数＝已过多少小时，负数＝还有多少小时。 */
  hoursFromNow: number
  phase: ClockCenterPhase
}>

/**
 * 窗口命中：`now ∈ [发布时刻 − 24h, 发布时刻 + 24h]`，**按时刻算**。
 *
 * 只有日期没有时刻的发布**不参与窗口**：替它造一个时刻就是推算，我们一直在禁；
 * 那种发布留在环上与溢出清单里，中央继续显示利率路径（宁可不说，不编）。
 *
 * 两个及以上指标同时进窗口：取离现在最近的；同一时刻按代表优先级；再并列按码字典序（只为可复现）。
 */
export function selectCenterWindow(input: Readonly<{
  now: string
  metrics: readonly ClockScheduleMetric[]
}>): ClockCenterWindow | undefined {
  const nowMs = Date.parse(input.now)
  if (!Number.isFinite(nowMs)) return undefined
  const windowMs = clockCenterWindowHours * 3_600_000
  const hits: ClockCenterWindow[] = []
  for (const metric of input.metrics) {
    if (metric.metricKey === POLICY_METRIC_KEY) continue
    for (const at of [metric.nextRelease?.at, metric.lastRelease?.at]) {
      if (at === undefined) continue
      const atMs = Date.parse(at)
      if (!Number.isFinite(atMs)) continue
      const deltaMs = nowMs - atMs
      if (Math.abs(deltaMs) > windowMs) continue
      const isPast = deltaMs >= 0
      // 「已过时刻、仍无值」不是「已发布」：后者要有这一期的实际值，而且属于刚过去的那一条。
      const hasResult = isPast && metric.actualValue !== undefined && metric.lastRelease?.at === at
      hits.push({
        metric, at, hoursFromNow: deltaMs / 3_600_000,
        phase: isPast ? (hasResult ? 'released' : 'overdue') : 'upcoming'
      })
    }
  }
  if (hits.length === 0) return undefined
  const rank = (metric: ClockScheduleMetric): number => {
    const index = (clockRingRepresentativeConcepts as readonly string[]).indexOf(metric.metricKey)
    return index === -1 ? clockRingRepresentativeConcepts.length : index
  }
  const sorted = hits.sort((left, right) => Math.abs(left.hoursFromNow) - Math.abs(right.hoursFromNow)
    || rank(left.metric) - rank(right.metric)
    || left.metric.metricKey.localeCompare(right.metric.metricKey))
  return sorted[0]
}

export function selectRingMetric(metrics: readonly ClockScheduleMetric[]): ClockScheduleMetric | undefined {
  const candidates = metrics.filter((metric) => metric.metricKey !== POLICY_METRIC_KEY
    && metric.nextRelease !== undefined && metric.nextRelease.expectedFromMarket === true)
  if (candidates.length === 0) return undefined
  const rank = (metric: ClockScheduleMetric): number => {
    const index = (clockRingRepresentativeConcepts as readonly string[]).indexOf(metric.metricKey)
    return index === -1 ? clockRingRepresentativeConcepts.length : index
  }
  const sorted = [...candidates].sort((left, right) => {
    const leftDays = clockDayGap('1970-01-01', left.nextRelease!.date)
    const rightDays = clockDayGap('1970-01-01', right.nextRelease!.date)
    return leftDays - rightDays || rank(left) - rank(right) || left.metricKey.localeCompare(right.metricKey)
  })
  return sorted[0]
}

export type ClockCardModel = Readonly<{
  plaques: readonly ClockPlaque[]
  center?: ClockCenterFace
  unplaced: readonly ClockUnplaced[]
}>

/** 两段日期（`YYYY-MM-DD`）之间相差几天；按 UTC 日算，不受读者时区影响。 */
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
   * **环上只放一个指标**（用户 2026-11-21）：窗口内跟随中央；否则候选=有盘口预期的一级指标，取最近的一个；
   * 其余全部进溢出清单。政策利率不是一级指标，照旧单独一块牌。
   */
  const selected = window?.metric ?? selectRingMetric(input.metrics)

  for (const metric of input.metrics) {
    const isPolicy = metric.metricKey === POLICY_METRIC_KEY
    const isSelected = selected !== undefined && selected.metricKey === metric.metricKey
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
          angle, x: point.x, y: point.y, opacity: 1, daysAgo: pastDays,
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
      angle, x: point.x, y: point.y, opacity: round4(clockFutureOpacity(daysUntil)), daysUntil,
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
     * 未来区里**环上那一个指标优先**：它和政策牌撞上时，让位的是政策牌。
     * 否则会出现「选中了 PCE，环上却只有政策牌」——主位与环上同一个这条就断了。
     */
    if (left.zone === 'future') {
      const leftRing = selected !== undefined && left.metricKey === selected.metricKey
      const rightRing = selected !== undefined && right.metricKey === selected.metricKey
      if (leftRing !== rightRing) return leftRing ? -1 : 1
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

/**
 * 中央今天是哪一张面：**窗口内是指标面，窗口外是利率路径面**（42 号文件 §四 的判定顺序——
 * 先问「有没有这条发布」，再问「政策读到没有」；反过来会把「不在窗口」说成「读不到」）。
 *
 * 政策牌不在（未启用/没配）时中央空着：卡面不画一个大数字假装有读数。
 */
function clockCenterFace(input: Readonly<{
  today: string
  metrics: readonly ClockScheduleMetric[]
  window?: ClockCenterWindow
}>): ClockCenterFace | undefined {
  if (input.window !== undefined) return metricCenterFace(input.window)
  const policy = input.metrics.find((metric) => metric.metricKey === POLICY_METRIC_KEY)
  if (policy?.nextRelease === undefined) return undefined
  const daysUntil = clockDayGap(input.today, policy.nextRelease.date)
  return {
    kind: 'policy',
    ...(policy.policyOutcome === undefined ? {} : { outcome: policy.policyOutcome }),
    ...(policy.nextRelease.expected === undefined ? {} : { probability: policy.nextRelease.expected }),
    meetingDate: policy.nextRelease.date,
    ...(Number.isNaN(daysUntil) ? {} : { daysUntil })
  }
}

function metricCenterFace(entry: ClockCenterWindow): ClockCenterMetricFace {
  const { metric, at, hoursFromNow, phase } = entry
  const base = { kind: 'metric' as const, metricKey: metric.metricKey, nameKey: metric.nameKey, at, hoursFromNow, phase }
  // 还没发布：大字是**市场预期**，前值是上一期（`previousValue` 没有时退回上一次发布的值）。
  if (phase === 'upcoming') {
    const previous = metric.previousValue ?? metric.lastRelease?.value
    return {
      ...base,
      ...(metric.nextRelease?.expected === undefined ? {} : { expected: metric.nextRelease.expected }),
      ...(previous === undefined ? {} : { previous })
    }
  }
  return {
    ...base,
    ...(metric.consensusValue === undefined ? {} : { consensus: metric.consensusValue }),
    ...(metric.actualValue === undefined ? {} : { result: metric.actualValue }),
    ...(metric.previousValue === undefined ? {} : { previous: metric.previousValue }),
    ...(metric.deltaAmount === undefined ? {} : { delta: metric.deltaAmount }),
    ...(metric.deltaDirection === undefined ? {} : { deltaDirection: metric.deltaDirection })
  }
}

/**
 * 牌的假定矩形：`min-width 62` × `min-height 37`，居中于挂点（`translate(-50%,-50%)`），
 * 另加 4px 主档间隔（界面设计 2026-11-15 基线 J 节）。名字更宽时牌会变宽，这里按最小宽算——
 * 偏保守：宁可多判一对相交，也不留两块压在一起。
 */
const PLAQUE_BOX = { width: 62, height: 37, gap: 4 } as const

/**
 * 撞牌判据：**全环统一按矩形相交**，不分区。
 * 未来区 0°–240°、过去区 240°–360° 在 12 点的「现在」和 8 点的断口两处相接，
 * 「只同区比」会在这两处各留一个叠牌口子（界面设计扫 241×121 组命中 670 对）。
 */
function rectsIntersect(left: ClockPlaque, right: ClockPlaque): boolean {
  return Math.abs(left.x - right.x) < PLAQUE_BOX.width + PLAQUE_BOX.gap &&
    Math.abs(left.y - right.y) < PLAQUE_BOX.height + PLAQUE_BOX.gap
}

/** 透明度落到 4 位小数：原型写 `.914`，多出来的浮点尾巴不该出现在行内样式里。 */
function round4(value: number): number {
  return Number(value.toFixed(4))
}

function clampDays(days: number): number {
  return Number.isFinite(days) && days > 0 ? days : 0
}
