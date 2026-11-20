import { metricConceptOf } from '../../../contracts/metricKeyConcept'
import type { ClockScheduleMetric } from './clockCardModel'
import { clockDayGap } from './clockCardModel'

/**
 * 时钟卡的挂点输入：**日程给日期、卡片读数给值**。
 *
 * 两样缺一不可，而且各有唯一来源：
 * - **日期与周期 P 只从日程读**（`readCalendarMonth` 那条按月读）。P = 上一期与再上一期的间隔，
 *   这是「同一指标相邻两次发布」的唯一算法；从期次月份推 P 是猜，不做。
 * - **值只从卡片读数读**（`macroIndicatorClient.read(asOf)` 的 facts）——**与抽屉同一次读数**，
 *   两处各读一遍迟早出现「卡上和抽屉里数字不一样」。
 *
 * 政策利率没有「日程 + 值」两份：会议日来自政策读数，值取盘口主推档概率。
 */
/**
 * 环上画哪两个指标：用**概念串**（`US.CPI.YOY`）而不是四段指标码。
 * 同一个概念的季调/未季调变体对读者是同一个指标，匹配时一律走 `metricConceptOf`——
 * 这样新增变体不用改这里，也不会在源码里落一串指标码字面量（门禁 C）。
 */
export const clockRingMetricKeys = Object.freeze([
  { concept: 'US.CPI.YOY', nameKey: 'cpiYoy' },
  { concept: 'US.NONFARM.CHANGE', nameKey: 'nonfarmPayrolls' }
] as const)

/** 日程里这张卡要读的字段；缺 `measureKeys` 的行不参与匹配（不按名字猜）。 */
export type ClockScheduleEvent = Readonly<{ scheduledAt: string; measureKeys?: readonly string[] }>

/** 卡片读数的一行：值、上一期、下一期与预期。字段名与 `MacroIndicatorCardFact` 一致。 */
export type ClockCardFact = Readonly<{
  metricKey: string
  releasedAt?: string
  value?: number
  previousAsPublished?: number
  unit?: 'percent' | 'thousands'
  next?: Readonly<{
    releaseAt: string
    expected?: Readonly<{ value: number }>
  }>
}>

export type ClockPolicyReading = Readonly<{
  meetingDate: string
  probability?: Readonly<{ value?: number }> | undefined
}>

export function clockScheduleMetrics(input: Readonly<{
  /** 显示时区的「今天」（`YYYY-MM-DD`），由调用方给。 */
  today: string
  events: readonly ClockScheduleEvent[]
  facts: readonly ClockCardFact[]
  policy?: ClockPolicyReading
}>): readonly ClockScheduleMetric[] {
  const metrics: ClockScheduleMetric[] = []
  for (const metric of clockRingMetricKeys) {
    const isThisConcept = (metricKey: string): boolean => metricConceptOf(metricKey) === metric.concept
    const fact = input.facts.find((entry) => isThisConcept(entry.metricKey))
    const dates = input.events
      .filter((event) => (event.measureKeys ?? []).some((key) => isThisConcept(key)) && Number.isFinite(Date.parse(event.scheduledAt)))
      .map((event) => clockDateOf(event.scheduledAt))
      .sort()
    const past = dates.filter((date) => date <= input.today)
    const lastDate = past.at(-1) ?? (fact?.releasedAt === undefined ? undefined : clockDateOf(fact.releasedAt))
    const previousDate = past.at(-2)
    // 下一期：日程里「今天之后」最近一条；日程没有就用读数里的 `next.releaseAt`（同一份日历的读模型）。
    const scheduleNext = dates.find((date) => date > input.today)
    const nextDate = scheduleNext ?? (fact?.next === undefined ? undefined : clockDateOf(fact.next.releaseAt))
    const periodDays = lastDate === undefined ? undefined
      : previousDate !== undefined ? clockDayGap(previousDate, lastDate)
        : nextDate !== undefined ? clockDayGap(lastDate, nextDate)
          : undefined
    metrics.push({
      // 牌的身份用概念串：同一概念的两个变体不会在卡上分成两个指标。
      metricKey: metric.concept,
      nameKey: metric.nameKey,
      ...(lastDate === undefined ? {} : {
        lastRelease: {
          date: lastDate,
          ...(fact === undefined ? {} : formatFactValue(fact))
        }
      }),
      ...(nextDate === undefined ? {} : {
        nextRelease: {
          date: nextDate,
          ...(fact?.next?.expected === undefined ? {} : { expected: formatNumber(fact.next.expected.value, fact.unit) })
        }
      }),
      ...(periodDays === undefined || !Number.isFinite(periodDays) || periodDays <= 0 ? {} : { periodDays })
    })
  }
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

/** 牌的数值：这一期有值就写这一期；没有就写上一期（并标明是「之前那次的结果」由文案层决定）。 */
function formatFactValue(fact: ClockCardFact): Readonly<{ value?: string }> {
  const value = fact.value ?? fact.previousAsPublished
  return value === undefined ? {} : { value: formatNumber(value, fact.unit) }
}

/** 数值格式只有一处：百分比两位小数、千人一位千分位带符号；不是这两档就不加单位。 */
export function formatNumber(value: number, unit: ClockCardFact['unit']): string {
  if (unit === 'percent') return `${value.toFixed(2)}%`
  if (unit === 'thousands') return `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value))}K`
  return String(value)
}

/** `2026-11-13T13:30:00.000Z` → `2026-11-13`：日期来自日程，按日程自己的日历日算天数。 */
export function clockDateOf(instant: string): string {
  return instant.slice(0, 10)
}
