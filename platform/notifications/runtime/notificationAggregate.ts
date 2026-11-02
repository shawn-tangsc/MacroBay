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
