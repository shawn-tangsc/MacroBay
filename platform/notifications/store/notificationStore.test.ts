/**
 * 时间必须由调用方给：运行时改成注入 `deps.clock` 之后，这里若继续写死「今天」并按真实时间跑，
 * 就会在跨零点后自己变红——那正是这次要修的缺陷，不是被人顺手改的测试。**与本批同笔**：
 * 实现只留一个时钟源，测试也就不再有第二个「现在」。
 */
import { describe, expect, it } from 'vitest'

import type { NotificationRecord, NotificationRequest } from '../contracts/notificationContracts'
import {
  acknowledgeNotification,
  normalizeNotificationRecord,
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

describe('rendered-only records survive a round trip (two-shape contract)', () => {
  it('keeps a record that has rendered copy and no titleKey, through load -> persist -> load', () => {
    // 真实事故：只认 `titleKey` 会把新形状（简报/分析结论/自检）整条丢掉，而丢弃结果还会被写回。
    const withRendered = {
      id: 'notification-1',
      owner: 'product',
      sourceId: 'market-intelligence.briefing.ready',
      eventTypeId: 'market-intelligence.briefing.ready',
      rendered: { 'zh-CN': { title: '标题', body: '正文', reason: '理由' }, 'en-US': { title: 'T', body: 'B', reason: 'R' } },
      channels: ['center'],
      state: 'unread',
      delivery: {},
      createdAt: '2026-11-07T23:01:00.000Z',
      updatedAt: '2026-11-07T23:01:00.000Z',
      occurrenceCount: 0,
      severity: 'info',
      priority: 'normal'
    }
    const once = normalizeNotificationStoreState({ records: [withRendered] })
    expect(once.records).toHaveLength(1)
    const twice = normalizeNotificationStoreState(JSON.parse(JSON.stringify(once)))
    expect(twice.records).toHaveLength(1)
  })
})

describe('归一化：写进去的契约字段必须读得回来', () => {
  /**
   * 真实事故（2026-11-24 架构师核出）：`normalizeNotificationRecord` 逐字段重建记录，`edition`、
   * `editionPoster`、`appliedLevels` 三个契约字段没被复制。每次启动「读 → 归一化 → 回写」就把它们
   * 静默抹掉：新记录重启后又变成「没有 edition」，不进中心的事件重新算成进中心，海报重投永远报版次不符。
   *
   * 这条按「整份契约」判，不逐个列名字——将来契约加字段、归一化忘了抄，它一样红。
   */
  // `Required<NotificationRecord>`：契约加字段时**编译期**就逼着这里补上，夹具不会悄悄落后于契约。
  const FULL: Required<NotificationRecord> = {
    id: 'notification-edition-1',
    owner: 'product' as const,
    productId: 'market-intelligence',
    sourceId: 'market-intelligence.briefing.ready',
    eventTypeId: 'market-intelligence.briefing.ready',
    mergedEventTypes: ['market-intelligence.briefing.ready'],
    delivery: { push: { state: 'sent-accepted' as const, messageId: 'm-1', at: '2026-11-23T12:01:04.232Z' } },
    rendered: { 'en-US': { title: 'Daily brief is ready', body: 'The edition is ready', reason: 'You subscribed.' } },
    titleKey: 'notification.taskFailed.title' as never,
    titleParams: { count: '1' },
    bodyKey: 'notification.taskFailed.body' as never,
    bodyParams: { count: '1' },
    reasonKey: 'notification.taskFailed.body' as never,
    reasonParams: { count: '1' },
    appliedLevels: ['center', 'desktop', 'channel'] as const,
    severity: 'info' as const,
    priority: 'normal' as const,
    channels: ['center' as const, 'desktop' as const],
    state: 'unread' as const,
    deeplink: { scope: 'product' as const, productId: 'market-intelligence', pageId: 'daily-briefing' },
    actions: [{ id: 'open-briefing', kind: 'open' as const, labelRef: { scope: 'platform' as const, key: 'k' } as never }],
    dedupeKey: 'brief-done:2026-11-23:zh-CN',
    correlationId: 'corr-1',
    safeMetadata: { note: 'ok' },
    edition: { editionId: '2026-11-23:en-US:period_1', locale: 'en-US' },
    editionPoster: { contentHash: '1cb80bea36d77b1d' },
    editionPosterRow: { status: 'ready' as const, contentHash: '1cb80bea36d77b1d', failureCode: null },
    occurrenceCount: 2,
    collapsedCount: 3,
    createdAt: '2026-11-23T12:01:04.228Z',
    updatedAt: '2026-11-23T12:01:04.228Z',
    readAt: '2026-11-23T13:00:00.000Z',
    acknowledgedAt: '2026-11-23T13:00:00.000Z',
    dismissedAt: '2026-11-23T13:10:00.000Z',
    snoozedUntil: '2026-11-23T14:00:00.000Z',
    expiresAt: '2026-12-23T12:01:04.228Z'
  }

  it('契约里每个字段都留在归一化结果里，且**值不是 undefined**（新增字段忘了抄 / 抄了键没抄值 → 这条红）', () => {
    const normalized = normalizeNotificationRecord(FULL)
    expect(normalized).not.toBeNull()
    // 不能只判 `in`：`bodyKey: … : undefined` 这类是「键留、值丢」，`in` 照样为真。
    const lost = Object.entries(FULL)
      .filter(([key, value]) => (normalized as unknown as Record<string, unknown>)[key] === undefined && value !== undefined)
      .map(([key]) => key)
    expect(lost).toEqual([])
  })

  it('三个真丢过的字段按原值回来', () => {
    const normalized = normalizeNotificationRecord(FULL)!
    expect(normalized.edition).toEqual({ editionId: '2026-11-23:en-US:period_1', locale: 'en-US' })
    expect(normalized.editionPoster).toEqual({ contentHash: '1cb80bea36d77b1d' })
    expect(normalized.appliedLevels).toEqual(['center', 'desktop', 'channel'])
  })

  it('海报行（#46）的 `null` 与缺席不合并：读回来仍是 null，老记录仍是 undefined', () => {
    // `null` 是「那一刻表里没有行」这个事实；被归一化吞成 undefined 就变成「不知道」，
    // 详情页会把「这一版没有图」藏起来——那是把说过的话收回。
    const noRow = normalizeNotificationRecord({ ...FULL, editionPosterRow: null })!
    expect(noRow.editionPosterRow).toBeNull()
    const legacy = normalizeNotificationRecord({ ...FULL, editionPosterRow: undefined })!
    expect(legacy.editionPosterRow).toBeUndefined()
    // 失败行带着原因码回来；`ready` 没 hash 说不通，整项丢掉而不是留半截。
    expect(normalizeNotificationRecord({ ...FULL, editionPosterRow: { status: 'timeout', contentHash: null, failureCode: 'poster-render-timeout' } })!.editionPosterRow)
      .toEqual({ status: 'timeout', contentHash: null, failureCode: 'poster-render-timeout' })
    expect(normalizeNotificationRecord({ ...FULL, editionPosterRow: { status: 'ready', contentHash: '  ', failureCode: null } })!.editionPosterRow)
      .toBeUndefined()
  })

  it('认不出的值整项丢掉，不返回半截脏数据', () => {
    const normalized = normalizeNotificationRecord({
      ...FULL,
      appliedLevels: ['center', 'nonsense'],
      edition: { editionId: '   ', locale: 'zh-CN' },
      editionPoster: { contentHash: '' }
    })!
    expect(normalized.appliedLevels).toEqual(['center'])
    expect(normalized.edition).toBeUndefined()
    expect(normalized.editionPoster).toBeUndefined()
  })

  it('appliedLevels 一项都不剩时按「不知道」处理，不返回空数组', () => {
    // 空数组的意思是「哪一档都没排上」，与「老记录没有这一项」是两件事，读侧的推断只认后者。
    const normalized = normalizeNotificationRecord({ ...FULL, appliedLevels: ['nonsense'] })!
    expect(normalized.appliedLevels).toBeUndefined()
  })
})

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

  it('ignores a legacy subscription table instead of resurrecting it', () => {
    // 订阅层 2026-11-04 整层撤销：旧文件里还留着 `subscriptions`，读时**忽略**，不回写、不迁移。
    const legacy = normalizeNotificationStoreState({
      records: [],
      subscriptions: { 'market-intelligence.briefing.ready': { record: true } }
    })
    expect(legacy).not.toHaveProperty('subscriptions')
    // 整份重写后也不会把它带回去。
    const rewritten = normalizeNotificationStoreState(JSON.parse(JSON.stringify(legacy)))
    expect(rewritten).not.toHaveProperty('subscriptions')
    expect(rewritten.providerCredentialHealth).toEqual({})
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
