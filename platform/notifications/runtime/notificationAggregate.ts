/**
 * 容量第三层：当日写入上限触发时，把被折叠的原文压成一条聚合记录（runtime §9）。
 *
 * 原文**不落库**，但「今天还出过几条」必须留下；聚合记录本身受同一保留期约束。
 * 从 legacy 提交路径拆出来，新的 `submit()` 也走这一处，删旧路径时不会把行为一起删掉。
 */
import { createNotificationId } from '../store/notificationStore'
import type {
  NotificationChannel,
  NotificationRecord,
  NotificationRequest
} from '../contracts/notificationContracts'
import {
  decideNotificationBreaker,
  pruneNotificationDailyCounters,
  utcDayOf
} from './notificationBreaker'
import type { NotificationDailyCounters } from '../store/notificationStore'

const NOTIFICATION_AGGREGATE_TITLE = 'notification-aggregate'
const NOTIFICATION_AGGREGATE_TITLE_KEY = 'notification.aggregate.title' as const

function aggregateDedupeKey(ownerId: string, now: string): string {
  return `${NOTIFICATION_AGGREGATE_TITLE}|${ownerId}|${utcDayOf(now)}`
}

export function foldIntoAggregate(
  records: readonly NotificationRecord[],
  request: NotificationRequest,
  ownerId: string,
  now: string
): { records: NotificationRecord[]; aggregate: NotificationRecord } {
  const dedupeKey = aggregateDedupeKey(ownerId, now)
  const existing = records.find((record) => record.dedupeKey === dedupeKey)
  if (existing) {
    const aggregate: NotificationRecord = {
      ...existing,
      collapsedCount: (existing.collapsedCount ?? 0) + 1,
      occurrenceCount: existing.occurrenceCount + 1,
      updatedAt: now
    }
    return {
      records: records.map((record) => (record.id === aggregate.id ? aggregate : record)),
      aggregate
    }
  }

  const aggregate: NotificationRecord = {
    id: createNotificationId(),
    owner: request.owner,
    productId: request.productId,
    sourceId: NOTIFICATION_AGGREGATE_TITLE,
    eventTypeId: 'legacy.aggregate',
    delivery: {},
    titleKey: NOTIFICATION_AGGREGATE_TITLE_KEY,
    severity: 'warning',
    priority: 'low',
    channels: ['center'],
    state: 'unread',
    actions: [],
    dedupeKey,
    safeMetadata: { aggregate: true },
    occurrenceCount: 1,
    collapsedCount: 1,
    createdAt: now,
    updatedAt: now
  }
  return { records: [aggregate, ...records], aggregate }
}

/**
 * 今天（UTC 自然日）这个事件已经落了几条、最近一条什么时候。
 *
 * 从**记录本身**数，不另存计数器：一份配额只允许有一个账本，记录就是那个账本。
 * 用 UTC 日而不是读者的「今天」——否则改一下时区就能多拿额度。
 */
export function countSameEventToday(
  records: readonly NotificationRecord[],
  eventTypeId: string,
  now: string
): { count: number; lastOccurredAt: string | null } {
  const day = utcDayOf(now)
  let count = 0
  let lastOccurredAt: string | null = null
  for (const record of records) {
    if (record.eventTypeId !== eventTypeId) continue
    if (utcDayOf(record.createdAt) !== day) continue
    count += 1
    if (lastOccurredAt === null || record.createdAt > lastOccurredAt) lastOccurredAt = record.createdAt
  }
  return { count, lastOccurredAt }
}

/**
 * 当日上限（或最小间隔）拒了这一条时，把「今天还出过一次」记进最后那条同事件记录，
 * 而不是让它彻底消失：读者看到的是「共 N 次」，排障在记录上能读到被压掉的原因。
 *
 * 这不新建记录、不重推，只更新计数与原因——所以它不会绕过上限，也不会多出一条。
 */
export function foldSuppressedIntoLatest(input: {
  records: readonly NotificationRecord[]
  eventTypeId: string
  now: string
  reason: 'daily-limit-reached' | 'minimum-gap-active'
}): { records: NotificationRecord[]; record: NotificationRecord } | undefined {
  const day = utcDayOf(input.now)
  let latest: NotificationRecord | undefined
  for (const record of input.records) {
    if (record.eventTypeId !== input.eventTypeId) continue
    if (utcDayOf(record.createdAt) !== day) continue
    if (latest === undefined || record.createdAt > latest.createdAt) latest = record
  }
  if (latest === undefined) return undefined
  const folded: NotificationRecord = {
    ...latest,
    occurrenceCount: latest.occurrenceCount + 1,
    updatedAt: input.now,
    safeMetadata: { ...latest.safeMetadata, lastSuppressedReason: input.reason, lastSuppressedAt: input.now }
  }
  return {
    records: input.records.map((record) => (record.id === folded.id ? folded : record)),
    record: folded
  }
}

/** 4a「中心必达」：凡走打断式通道的通知，`channels` 恒含 `center`。 */
export function withCenterForDisruptiveChannels(
  request: NotificationRequest,
  channels: readonly NotificationChannel[]
): NotificationChannel[] {
  const disruptive = channels.some((channel) => channel === 'desktop' || channel === 'toast' || channel === 'popup')
  if (!disruptive || channels.includes('center')) return [...channels]
  return ['center', ...channels]
}


/**
 * 当日写入上限判定：超过就折叠，否则只把新计数交回去。runtime 只管落库/广播，
 * 决策与聚合都在这里，删旧提交路径时不会把 T2/T10 的行为一起删掉。
 */
export function decideDailyCap(input: {
  records: readonly NotificationRecord[]
  request: NotificationRequest
  ownerId: string
  counters: NotificationDailyCounters
  now: string
}):
  | { fold: true; records: NotificationRecord[]; aggregate: NotificationRecord; counters: NotificationDailyCounters }
  | { fold: false; counters: NotificationDailyCounters } {
  const breaker = decideNotificationBreaker({
    counters: input.counters,
    ownerId: input.ownerId,
    now: input.now
  })
  const counters = pruneNotificationDailyCounters(breaker.counters, input.now)
  if (breaker.action !== 'fold') return { fold: false, counters }
  const folded = foldIntoAggregate(input.records, input.request, input.ownerId, input.now)
  return { fold: true, records: folded.records, aggregate: folded.aggregate, counters }
}
