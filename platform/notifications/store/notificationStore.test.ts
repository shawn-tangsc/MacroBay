/**
 * 时间必须由调用方给：运行时改成注入 `deps.clock` 之后，这里若继续写死「今天」并按真实时间跑，
 * 就会在跨零点后自己变红——那正是这次要修的缺陷，不是被人顺手改的测试。**与本批同笔**：
 * 实现只留一个时钟源，测试也就不再有第二个「现在」。
 */
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

  it('keeps the subscription table in the same file and normalizes it without inventing rows', () => {
    // 契约 §5.1：订阅与记录同一份 JSON（一份真相），旧文件没有该字段 → 空表、不预置。
    const fresh = normalizeNotificationStoreState({ records: [] })
    expect(fresh.subscriptions).toEqual({})

    const stored = normalizeNotificationStoreState({
      records: [],
      subscriptions: {
        'market-intelligence.briefing.ready': { record: true },
        'platform.job.failed-terminal': { desktop: true, record: 'yes' },
        'market-intelligence.calibration.result': {}
      }
    })
    expect(stored.subscriptions).toEqual({
      'market-intelligence.briefing.ready': { record: true },
      'platform.job.failed-terminal': { desktop: true }
    })
    // 整份重写后仍是同一张表：空行不复活、不按批准表预置。
    expect(normalizeNotificationStoreState(JSON.parse(JSON.stringify(stored))).subscriptions).toEqual(stored.subscriptions)
  })

  it('normalizes old records to a legacy event type and an empty delivery map', () => {
    // 契约 §6：旧记录缺 eventTypeId / delivery → 读时归一化，不回写。
    const state = normalizeNotificationStoreState({
      records: [
        {
          id: 'legacy-1',
          owner: 'platform',
          sourceId: 'old-source',
          titleKey: 'notification.taskFailed.title',
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z'
        }
      ]
    })
    expect(state.records[0]?.eventTypeId).toBe('legacy.untyped')
    expect(state.records[0]?.delivery).toEqual({})
  })

  it('keeps push backoff across a JSON round-trip and drops malformed entries', () => {
    const state = normalizeNotificationStoreState({
      records: [],
      pushBackoff: {
        telegram: { channelId: 'telegram', failures: 3, pausedUntil: '2026-11-01T13:00:00.000Z' },
        'bad id': { channelId: 'bad id', failures: 1, pausedUntil: null },
        other: { channelId: 'other', failures: -1, pausedUntil: null }
      }
    })
    expect(state.pushBackoff).toEqual({
      telegram: { channelId: 'telegram', failures: 3, pausedUntil: '2026-11-01T13:00:00.000Z' }
    })
    expect(normalizeNotificationStoreState(JSON.parse(JSON.stringify(state))).pushBackoff).toEqual(state.pushBackoff)
  })

  it('merges by the four signed rules: title/actions first, body latest, no empty overwrite', () => {
    const first = createNotificationFromRequest({
      owner: 'platform',
      sourceId: 'signal',
      eventTypeId: 'market-intelligence.signal.triggered',
      titleKey: 'notification.taskFailed.title',
      titleParams: { taskName: 'first-title' },
      bodyKey: 'notification.taskFailed.body',
      bodyParams: { taskName: 'first-body' },
      severity: 'warning',
      priority: 'normal',
      requestedChannels: ['center'],
      actions: [{ id: 'first-action', labelKey: 'notification.taskFailed.open', kind: 'open' }],
      dedupeKey: 'module-signal:OI:rule:BTC:2026-11-02'
    })

    const merged = mergeDuplicateNotification(first, {
      owner: 'platform',
      sourceId: 'interpreted',
      eventTypeId: 'market-intelligence.signal.interpreted',
      titleKey: 'notification.test.title',
      titleParams: { taskName: 'second-title' },
      bodyKey: 'notification.aggregate.title',
      bodyParams: { taskName: 'second-body' },
      severity: 'critical',
      priority: 'urgent',
      requestedChannels: ['center', 'desktop'],
      actions: [{ id: 'second-action', labelKey: 'notification.test.title', kind: 'open' }],
      dedupeKey: 'module-signal:OI:rule:BTC:2026-11-02'
    }, '2026-11-02T12:00:00.000Z')

    // 标题与动作取第一次，正文取最新，跨类型不增次数。
    expect(merged.titleKey).toBe('notification.taskFailed.title')
    expect(merged.titleParams).toEqual({ taskName: 'first-title' })
    expect(merged.actions.map((action) => action.id)).toEqual(['first-action'])
    expect(merged.bodyKey).toBe('notification.aggregate.title')
    expect(merged.occurrenceCount).toBe(1)
    expect(merged.mergedEventTypes).toEqual([
      'market-intelligence.signal.triggered',
      'market-intelligence.signal.interpreted'
    ])

    // 最新一次没有正文：保留既有正文，不被空值覆盖（T28）。
    const withoutBody = mergeDuplicateNotification(merged, {
      owner: 'platform',
      sourceId: 'signal',
      eventTypeId: 'market-intelligence.signal.triggered',
      titleKey: 'notification.test.title',
      severity: 'warning',
      priority: 'normal',
      requestedChannels: ['center'],
      dedupeKey: 'module-signal:OI:rule:BTC:2026-11-02'
    }, '2026-11-02T12:05:00.000Z')
    expect(withoutBody.bodyKey).toBe('notification.aggregate.title')
    expect(withoutBody.bodyParams).toEqual({ taskName: 'second-body' })
  })
})
