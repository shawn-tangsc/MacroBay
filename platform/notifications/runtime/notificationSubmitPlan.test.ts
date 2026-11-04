import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { planNotificationSubmit } from './notificationSubmitPlan'

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
          requestedDisruptionLevels: ['desktop', 'channel'],
          dedupeKeyTemplate: 'ready:{date}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.raw',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
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
