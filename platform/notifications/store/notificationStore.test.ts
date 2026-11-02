import { describe, expect, it } from 'vitest'

import type { NotificationRequest } from '../contracts/notificationContracts'
import {
  acknowledgeNotification,
  createNotificationFromRequest,
  dismissNotification,
  expireDueNotifications,
  isActiveNotification,
  markNotificationRead,
  mergeDuplicateNotification,
  normalizeNotificationStoreState,
  reactivateSnoozedNotifications,
  resetNotificationIdCounterForTests,
  snoozeNotification
} from './notificationStore'
import { findActiveDuplicate } from '../runtime/notificationDedupe'

describe('notification store', () => {
  it('dedupes active notifications by dedupeKey and increments occurrence count', () => {
    resetNotificationIdCounterForTests()
    const request: NotificationRequest = {
      owner: 'product',
      productId: 'sample-product',
      sourceId: 'source-a',
      titleKey: 'notification.taskFailed.title', titleParams: { taskName: 'Important event' },
      severity: 'warning',
      priority: 'high',
      requestedChannels: ['center', 'toast'],
      dedupeKey: 'sample-product:source-a:important-event:connection-1:entity-1'
    }

    const first = createNotificationFromRequest(request)
    const duplicate = findActiveDuplicate(
      [first],
      { ...request, severity: 'critical', priority: 'urgent' },
      first.createdAt
    )
    expect(duplicate?.id).toBe(first.id)

    const merged = mergeDuplicateNotification(first, { ...request, severity: 'critical', priority: 'urgent' }, '2026-07-05T11:00:00.000Z')
    expect(merged.occurrenceCount).toBe(2)
    expect(merged.severity).toBe('critical')
    expect(merged.priority).toBe('urgent')
  })

  it('supports idempotent read, acknowledge, dismiss, and snooze transitions', () => {
    resetNotificationIdCounterForTests()
    const record = createNotificationFromRequest({
      owner: 'platform',
      sourceId: 'jobs',
      titleKey: 'notification.taskFailed.title', titleParams: { taskName: 'Sync failed' },
      severity: 'warning',
      priority: 'normal',
      requestedChannels: ['center']
    })

    const read = markNotificationRead(record)
    expect(read.state).toBe('read')
    expect(markNotificationRead(read).state).toBe('read')

    const acknowledged = acknowledgeNotification(read)
    expect(acknowledged.state).toBe('acknowledged')

    const dismissed = dismissNotification(acknowledged)
    expect(dismissed.state).toBe('dismissed')

    const snoozed = snoozeNotification(record, '2026-07-05T12:00:00.000Z')
    expect(snoozed.state).toBe('snoozed')
    const reactivated = reactivateSnoozedNotifications([snoozed], '2026-07-05T12:01:00.000Z')[0]
    expect(reactivated?.state).toBe('unread')
  })

  it('expires due notifications and excludes them from active lists', () => {
    resetNotificationIdCounterForTests()
    const record = createNotificationFromRequest({
      owner: 'product',
      productId: 'sample-product',
      sourceId: 'source-b',
      titleKey: 'notification.taskFailed.title', titleParams: { taskName: 'Expired notice' },
      severity: 'info',
      priority: 'low',
      requestedChannels: ['center'],
      expiresAt: '2026-07-05T09:00:00.000Z'
    })

    const expired = expireDueNotifications([record], '2026-07-05T10:00:00.000Z')[0]
    expect(expired?.state).toBe('expired')
    expect(isActiveNotification(expired!, '2026-07-05T10:00:00.000Z')).toBe(false)
  })

  it('keeps daily breaker counters across a JSON round-trip and drops malformed buckets', () => {
    const state = normalizeNotificationStoreState({
      records: [],
      dailyCounters: {
        'product-a|2026-11-01': 7,
        'broken-key': 3,
        'product-b|2026-11-02': 'many',
        'product-c|2026-11-03': -1
      }
    })

    expect(state.dailyCounters).toEqual({ 'product-a|2026-11-01': 7 })
    const restored = normalizeNotificationStoreState(JSON.parse(JSON.stringify(state)))
    expect(restored.dailyCounters).toEqual({ 'product-a|2026-11-01': 7 })
  })

  it('defaults to an empty counter map so a fresh file has nothing to fold from', () => {
    expect(normalizeNotificationStoreState({ records: [] }).dailyCounters).toEqual({})
  })
})
