import type { NotificationDailyCounters } from '../store/notificationStore'

/**
 * 熔断计数：**独立持久化，不能从记录反推**（类型定义在 store，随记录存同一份 JSON）。
 *
 * 键按**世界标准时间**的日界分桶：这是「计数的一天」，不是读者的一天——
 * 改成读者时区会让换时区重置当天配额。
 */

export const notificationBreakerPolicy = Object.freeze({
  defaultDailyLimit: 50,
  /** 计数只保留最近几天，超出上限的记录本身已经被保留期剪掉了，计数没有长期价值。 */
  counterRetentionDays: 7
})

export function utcDayOf(instant: string): string {
  const date = new Date(instant)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
}

export function notificationCounterKey(ownerId: string, instant: string): string {
  return `${ownerId}|${utcDayOf(instant)}`
}

export type NotificationBreakerDecision =
  | { action: 'write'; counters: NotificationDailyCounters; used: number; limit: number }
  | { action: 'fold'; counters: NotificationDailyCounters; used: number; limit: number }

/**
 * 记一次写入并给出处置：`write` = 正常落库，`fold` = 只写聚合记录、原文不落库。
 *
 * 判据是「写入后是否超过上限」：上限 50 时第 51 条开始折叠，前 50 条正常落库。
 */
export function decideNotificationBreaker(input: Readonly<{
  counters: NotificationDailyCounters
  ownerId: string
  now: string
  limit?: number
}>): NotificationBreakerDecision {
  const limit = normalizeLimit(input.limit)
  const key = notificationCounterKey(input.ownerId, input.now)
  const used = Math.max(0, input.counters[key] ?? 0)
  const nextUsed = used + 1
  const counters = { ...input.counters, [key]: nextUsed }
  return {
    action: nextUsed > limit ? 'fold' : 'write',
    counters,
    used: nextUsed,
    limit
  }
}

/** 丢掉超出保留期的计数桶；坏键一并丢弃，避免一份脏数据让文件永远不缩。 */
export function pruneNotificationDailyCounters(
  counters: NotificationDailyCounters,
  now: string,
  retentionDays = notificationBreakerPolicy.counterRetentionDays
): NotificationDailyCounters {
  const todayMs = Date.parse(`${utcDayOf(now)}T00:00:00.000Z`)
  if (!Number.isFinite(todayMs)) return { ...counters }
  const cutoffDay = new Date(todayMs - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const kept: NotificationDailyCounters = {}
  for (const [key, value] of Object.entries(counters)) {
    const day = key.split('|')[1] ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < cutoffDay) continue
    kept[key] = value
  }
  return kept
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return notificationBreakerPolicy.defaultDailyLimit
  return Math.max(1, Math.floor(value as number))
}
