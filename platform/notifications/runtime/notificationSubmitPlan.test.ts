import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { planNotificationSubmit } from './notificationSubmitPlan'
import { externalActionUrl } from '../delivery/channelPushPort'

const policy: NotificationEventPolicy = {
  'platform.failed': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.ready': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
  'platform.variant': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'platform.raw': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'other-product.thing': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
}

const catalog = createNotificationEventCatalog({
  policy,
  sources: [
    {
      productId: 'platform',
      events: [
        {
          id: 'platform.failed',
          titleKey: 'notification.taskFailed.title',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: true,
    category: 'reminder',
          requestedDisruptionLevels: ['toast', 'desktop'],
          dedupeKeyTemplate: 'failed:{definitionId}:{date}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000,
        },
        {
          id: 'platform.ready',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: ['desktop', 'channel'],
          dedupeKeyTemplate: 'ready:{date}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.raw',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: '{key}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.variant',
          titleKey: 'notification.test.title',
          bodyKeyByVariant: { failed: 'notification.test.body', 'data-only': 'notification.aggregate.title' },
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'variant:{id}',
          dedupeUnit: 'occurrence',
        }
      ]
    },
    {
      productId: 'other-product',
      events: [
        {
          id: 'other-product.thing',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'thing:{id}',
          dedupeUnit: 'occurrence',
        }
      ]
    }
  ]
})

function request(overrides: Partial<NotificationSubmitRequest> = {}): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.failed',
    dedupeVars: { builder: 'template', vars: { definitionId: 'job-1', date: '2026-11-03' } },
    actions: [{ id: 'open', labelKey: 'notification.taskFailed.open', kind: 'open' }],
    occurredAt: '2026-11-03T00:00:00.000Z',
    ...overrides
  }
}

const base = {
  catalog,
  settings: {
    desktopEnabled: true,
    toastEnabled: false,
    popupEnabled: false,
    push: { channelId: null },
    retentionDays: 30,
    defaultSnoozeMinutes: 60
  },
  desktopSupported: true,
  now: '2026-11-03T00:00:00.000Z'
}

describe('notification submit planner', () => {
  it('rejects an unregistered event type', () => {
    const plan = planNotificationSubmit({ ...base, request: request({ eventTypeId: 'platform.nope' }) })
    expect(plan.kind).toBe('rejected')
    if (plan.kind === 'rejected') expect(plan.outcome.reason).toBe('unknown-event-type')
  })

  it('rejects an event that requires an action when actions are empty', () => {
    const plan = planNotificationSubmit({ ...base, request: request({ actions: [] }) })
    expect(plan.kind).toBe('rejected')
    if (plan.kind === 'rejected') expect(plan.outcome.reason).toBe('missing-action')
  })

  it('always records a completion event now that the subscription layer is gone', () => {
    // 2026-11-04：逐事件订阅整层撤销，「没勾就抑制」这条路不再存在；中心恒记一条。
    const plan = planNotificationSubmit({
      ...base,
      request: request({ eventTypeId: 'platform.ready', dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } }, actions: [] })
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 完成类也照常落库；本机表面同样按「桌面优先」排——没有订阅就不再抑制。
    expect(plan.record.delivery.desktop).toEqual({ state: 'queued', at: base.now })
  })

  it('queues exactly one local surface: desktop when it can show, otherwise the in-app toast', () => {
    const plan = planNotificationSubmit({ ...base, request: request() })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 桌面开关开着且平台支持 → 只排桌面，**不再同时排提示**（只打扰一次）。
    expect(plan.outcome.levels).toEqual(['center', 'desktop'])
    expect(plan.record.delivery).toEqual({ desktop: { state: 'queued', at: base.now } })
    expect(plan.record.dedupeKey).toBe('platform|failed:job-1:2026-11-03')
  })

  it('falls back to the in-app toast when the desktop switch is off', () => {
    const plan = planNotificationSubmit({
      ...base,
      settings: { ...base.settings, desktopEnabled: false, toastEnabled: true },
      request: request()
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.outcome.levels).toEqual(['center', 'toast'])
    expect(plan.record.delivery).toEqual({ toast: { state: 'queued', at: base.now } })
  })

  it('rejects a hand-built key that claims another product prefix', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({
        eventTypeId: 'platform.raw',
        dedupeVars: { builder: 'template', vars: { key: 'other-product|thing:1' } },
        actions: []
      })
    })
    expect(plan.kind).toBe('rejected')
    if (plan.kind === 'rejected') expect(plan.outcome.reason).toBe('cross-product-key')
  })

  it('requires a known body variant when the declaration has variant keys', () => {
    const missing = planNotificationSubmit({
      ...base,
      request: request({ eventTypeId: 'platform.variant', dedupeVars: { builder: 'template', vars: { id: '1' } }, actions: [] })
    })
    expect(missing).toMatchObject({ kind: 'rejected', outcome: { reason: 'unknown-body-variant' } })

    const known = planNotificationSubmit({
      ...base,
      request: request({
        eventTypeId: 'platform.variant',
        bodyVariant: 'failed',
        dedupeVars: { builder: 'template', vars: { id: '1' } },
        actions: []
      })
    })
    expect(known.kind).toBe('new')
    if (known.kind === 'new') expect(known.record.bodyKey).toBe('notification.test.body')
  })
})

describe('「看原文」动作：外链只有一种写法（契约 §7.5 ⑫）', () => {
  const external = (overrides: Record<string, unknown> = {}) => ({
    id: 'read-original',
    labelKey: 'notification.action.open-original' as const,
    kind: 'open-external' as const,
    url: 'https://example.com/news/42',
    ...overrides
  })

  it('accepts one http(s) link and keeps it on the record, untouched', () => {
    const plan = planNotificationSubmit({ ...base, request: request({ actions: [external()] }) })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 中心按钮与手机末尾那一行读的是**同一份**：记录里存原地址，不在正文里再放一份。
    expect(plan.record.actions).toEqual([external()])
  })

  it('normalizes the address once, so the centre button and the phone read the same value', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [external({ url: '  https://example.com/news/42  ' })] })
    })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    // 两端各 trim 一次不算保证：一个带空白的地址会「中心能开、手机打不开」。记录里只存一个值。
    expect(plan.record.actions).toEqual([external()])
    expect(externalActionUrl(plan.record.actions)).toEqual({ url: 'https://example.com/news/42', extra: 0 })
  })

  it('rejects open-external without a url: a button with nowhere to go', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [external({ url: undefined })] })
    })
    expect(plan).toMatchObject({ kind: 'rejected', outcome: { reason: 'external-action-without-url' } })
  })

  it('rejects anything that is not an absolute http(s) address', () => {
    // `http:example.com` 不在这张表里：WHATWG 把 http/https 当「特殊协议」，会把它规范化成
    // `http://example.com/`——那确实是一个能打开的绝对地址，拒它反而会把合法写法挡掉。
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', '/news/42', 'ftp://example.com/a']) {
      const plan = planNotificationSubmit({ ...base, request: request({ actions: [external({ url })] }) })
      expect(plan, url).toMatchObject({ kind: 'rejected', outcome: { reason: 'external-action-bad-url' } })
    }
  })

  it('rejects a url on any other kind: two notions of "outside" must not be mixed', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [external({ kind: 'open', url: 'https://example.com/a' })] })
    })
    expect(plan).toMatchObject({ kind: 'rejected', outcome: { reason: 'url-without-external-action' } })
  })

  it('rejects open-external carrying an in-app deeplink: that cannot be opened on a phone', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [external({ deeplink: { scope: 'platform' as const } })] })
    })
    expect(plan).toMatchObject({ kind: 'rejected', outcome: { reason: 'external-action-with-deeplink' } })
  })

  it('does not echo the whole url into the rejection message', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ actions: [external({ url: 'ftp://secret.example.com/token=abc' })] })
    })
    expect(plan.kind).toBe('rejected')
    if (plan.kind === 'rejected') {
      // 只回协议名：正文里的一次性参数不该被日志再存一份。
      expect(plan.outcome.message).toContain('ftp:')
      expect(plan.outcome.message).not.toContain('token=abc')
    }
  })
})
