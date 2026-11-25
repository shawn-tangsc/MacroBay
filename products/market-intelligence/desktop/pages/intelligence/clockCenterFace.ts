/**
 * 中央的两张面与 ±24 小时窗口（用户 2026-11-21 拍板，42 号文件 §二／§四）。
 *
 * 从 `clockCardModel` 拆出来：这个文件只管「今天是哪一张面、窗口怎么判」，
 * 牌子的几何与撞牌在 `clockPlaqueLayout`，编排在 `clockCardModel`。行为一项没改。
 */
import { clockDayGap, clockRingRepresentativeConcepts, POLICY_METRIC_KEY } from './clockPlaqueLayout'
import type { ClockScheduleMetric } from './clockCardModel'

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

/**
 * 中央今天是哪一张面：**窗口内是指标面，窗口外是利率路径面**（42 号文件 §四 的判定顺序——
 * 先问「有没有这条发布」，再问「政策读到没有」；反过来会把「不在窗口」说成「读不到」）。
 *
 * 政策牌不在（未启用/没配）时中央空着：卡面不画一个大数字假装有读数。
 */
export function clockCenterFace(input: Readonly<{
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
