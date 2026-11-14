import type { ClockScheduleMetric } from './clockCardModel'
import { clockDayGap } from './clockCardModel'

/**
 * 日历读数 → 时钟卡的挂点输入。
 *
 * 只用一处的数据：看板已经读到的那个按月事件列表（`readMarketEvents` / `projection`），
 * 加上政策路径那次读数。**不新建客户端、不新开 IPC、不自己 `new Date()`**。
 *
 * 一个指标一行，字段全部来自日程：
 * - 上一期：`at <= today` 里最近的一条，值取它的公布值；
 * - 下一期：`at > today` 里最近的一条，值取它的市场预期；
 * - 周期 P：**上一期与再上一期的间隔**（日程里两条已发生发布之间的距离）；
 *   只有一条已发生发布时，退而取「上一期 → 下一期」的间隔；都拿不到就不给 P，
 *   卡上照规则不上环、留一行交代。
 *
 * 指标码是唯一的判据；名字、国家这些一律不看（名字会随语言变，码不会）。
 */
export const clockRingMetricKeys = Object.freeze([
  { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy' },
  { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls' }
] as const)

/** 看板那一行事件里，这张卡要读的字段；缺字段的行整条跳过，不猜。 */
export type ClockSourceEvent = Readonly<{
  scheduledAt: string
  measureKeys?: readonly string[]
  eventNameKey?: string
  providerActual?: Readonly<{ displayValue?: string }>
  consensus?: Readonly<{ displayValue?: string }>
}>

export type ClockPolicyReading = Readonly<{
  /** 下一次会议日（`YYYY-MM-DD`）。 */
  meetingDate: string
  /** 盘口主推那一档的概率，0–1。 */
  probability?: Readonly<{ value?: number }> | undefined
}>

/** 取显示时区里的日期（`YYYY-MM-DD`）；由调用方给，别在这里挑时区。 */
export type ClockToday = string

export function clockScheduleMetrics(input: Readonly<{
  today: ClockToday
  events: readonly ClockSourceEvent[]
  policy?: ClockPolicyReading
}>): readonly ClockScheduleMetric[] {
  const metrics: ClockScheduleMetric[] = []
  for (const metric of clockRingMetricKeys) {
    const covering = input.events
      .filter((event) => (event.measureKeys ?? []).includes(metric.metricKey))
      .filter((event) => Number.isFinite(Date.parse(event.scheduledAt)))
      .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt))
    const past = covering.filter((event) => clockDateOf(event.scheduledAt) <= input.today)
    const future = covering.filter((event) => clockDateOf(event.scheduledAt) > input.today)
    const last = past.at(-1)
    const previous = past.at(-2)
    const next = future[0]
    const periodDays = last === undefined ? undefined
      : previous !== undefined ? clockDayGap(clockDateOf(previous.scheduledAt), clockDateOf(last.scheduledAt))
        : next !== undefined ? clockDayGap(clockDateOf(last.scheduledAt), clockDateOf(next.scheduledAt))
          : undefined
    metrics.push({
      metricKey: metric.metricKey,
      nameKey: metric.nameKey,
      ...(last === undefined ? {} : {
        lastRelease: {
          date: clockDateOf(last.scheduledAt),
          ...(last.providerActual?.displayValue === undefined ? {} : { value: last.providerActual.displayValue })
        }
      }),
      ...(next === undefined ? {} : {
        nextRelease: {
          date: clockDateOf(next.scheduledAt),
          ...(next.consensus?.displayValue === undefined ? {} : { expected: next.consensus.displayValue })
        }
      }),
      ...(periodDays === undefined || !Number.isFinite(periodDays) || periodDays <= 0 ? {} : { periodDays })
    })
  }
  // 政策利率：只有下一期（会议日），值取盘口主推档的概率。过去牌不挂——会议不在保留期内时它本来就不该出现。
  const policy = input.policy
  if (policy !== undefined && Number.isFinite(Date.parse(policy.meetingDate))) {
    const probability = policy.probability?.value
    metrics.push({
      metricKey: 'US.TARGET_RATE.DECISION',
      nameKey: 'policyRate',
      nextRelease: {
        date: clockDateOf(policy.meetingDate),
        ...(probability === undefined ? {} : { expected: `${(probability * 100).toFixed(1)}%` })
      }
    })
  }
  return metrics
}

/** `2026-11-13T13:30:00.000Z` → `2026-11-13`（日程日期按 UTC 记，卡上按同一份日程算天数）。 */
export function clockDateOf(instant: string): string {
  return instant.slice(0, 10)
}
