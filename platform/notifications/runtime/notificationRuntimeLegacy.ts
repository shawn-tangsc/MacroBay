/**
 * 旧提交路径（迁移期）：`NotificationRequest` 形状的编译器还在用，迁到新形状前行为不变。
 * 从 runtime 拆出来既是为了体积门禁，也是为了把「旧形状 + 熔断聚合」这一整块放在一处，
 * Wave 3 迁完调用点后整份删除，不必在 runtime 里逐行找。
 */
import type { DeliveryAttempt, DeliveryHooks, NotificationClock } from './notificationRouting'
import {
  createNotificationFromRequest,
  mergeDuplicateNotification,
  type NotificationStoreState
} from '../store/notificationStore'
import {
  decideNotificationBreaker,
  pruneNotificationDailyCounters,
  utcDayOf
} from './notificationBreaker'
import { createNotificationId } from '../store/notificationStore'
import { findActiveDuplicate } from './notificationDedupe'
import { normalizeRequestedChannels, routeTransientDelivery } from './notificationRouting'
import type {
  NotificationChannel,
  NotificationRecord,
  NotificationRequest,
  NotificationRuntimeSettings,
  SafeNotificationRecord
} from '../contracts/notificationContracts'
import { toSafeNotificationRecord } from '../contracts/notificationContracts'
import type { NotificationDeliverySurface } from './notificationRuntimeDelivery'

export type LegacySubmitInput = {
  load: () => Promise<NotificationStoreState>
  persist: (state: NotificationStoreState) => Promise<void>
  notifyChanged: () => void
  deps: {
    getSettings: () => Promise<NotificationRuntimeSettings>
    clock: NotificationClock
    deliveryHooks?: DeliveryHooks
  }
  now: () => string
  delivery: NotificationDeliverySurface
}

export function createLegacySubmit(input: LegacySubmitInput) {
  async function submitLegacy(request: NotificationRequest): Promise<SafeNotificationRecord> {
    const state = await input.load()
    const settings = await input.deps.getSettings()
    const now = input.now()
    const duplicate = findActiveDuplicate(state.records, request, now)

    // 折叠第一层：同 dedupeKey 且仍活跃 → 只累加次数，不新增记录，也不消耗熔断额度。
    if (duplicate) {
      const merged = mergeDuplicateNotification(duplicate, request, now)
      const mergedRecords = state.records.map((item: NotificationRecord) => (item.id === merged.id ? merged : item))
      await input.persist({ ...state, records: mergedRecords })
      input.notifyChanged()
      return toSafeNotificationRecord(merged)
    }

    const ownerId = request.productId ?? 'platform'
    const breaker = decideNotificationBreaker({
      counters: state.dailyCounters ?? {},
      ownerId,
      now
    })
    const dailyCounters = pruneNotificationDailyCounters(breaker.counters, now)

    // 折叠第二层：超过当日上限后原文不落库，只把「今天还出过几条」留在聚合记录上。
    if (breaker.action === 'fold') {
      const folded = foldIntoAggregate(state.records, request, ownerId, now)
      await input.persist({ ...state, records: folded.records, dailyCounters })
      input.notifyChanged()
      return toSafeNotificationRecord(folded.aggregate)
    }

    const record = createNotificationFromRequest(
      {
        ...request,
        requestedChannels: withCenterForDisruptiveChannels(request, normalizeRequestedChannels(request, settings, input.deps.clock))
      },
      now
    )

    await input.persist({ ...state, records: [record, ...state.records], dailyCounters })
    input.notifyChanged()
    await routeTransientDelivery(
      record,
      settings,
      input.deps.deliveryHooks ?? {},
      input.deps.clock,
      await input.delivery.resolveContent(record)
    )

    return toSafeNotificationRecord(record)
  }

  return { submitLegacy }
}

/** 4a「中心必达」：只要这条通知会走任何一个打断式通道，`channels` 就必须含 `center`。 */
export function withCenterForDisruptiveChannels(
  request: NotificationRequest,
  channels: readonly NotificationChannel[]
): NotificationChannel[] {
  const disruptive = channels.some((channel) => channel === 'desktop' || channel === 'toast' || channel === 'popup')
  if (!disruptive || channels.includes('center')) return [...channels]
  return ['center', ...channels]
}

const NOTIFICATION_AGGREGATE_TITLE = 'notification-aggregate'
const NOTIFICATION_AGGREGATE_TITLE_KEY = 'notification.aggregate.title' as const

function aggregateDedupeKey(ownerId: string, now: string): string {
  return `${NOTIFICATION_AGGREGATE_TITLE}|${ownerId}|${utcDayOf(now)}`
}

function foldIntoAggregate(
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
