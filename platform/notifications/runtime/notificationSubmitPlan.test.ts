import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { emptySubscriptionTable, type NotificationSubscriptionTable } from '../contracts/notificationSubscriptions'
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
          notifyOnlyIfSubscribed: false
        },
        {
          id: 'platform.ready',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
          requestedDisruptionLevels: ['desktop', 'channel'],
          dedupeKeyTemplate: 'ready:{date}',
          dedupeUnit: 'occurrence',
          notifyOnlyIfSubscribed: true
        },
        {
          id: 'platform.raw',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: '{key}',
          dedupeUnit: 'occurrence',
          notifyOnlyIfSubscribed: false
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
          notifyOnlyIfSubscribed: false
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
          notifyOnlyIfSubscribed: false
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
  subscriptions: emptySubscriptionTable() as NotificationSubscriptionTable,
  settings: {
    desktopEnabled: true,
    toastEnabled: false,
    popupEnabled: false,
    push: { channelId: null },
    retentionDays: 30,
    defaultSnoozeMinutes: 60
  },
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

  it('suppresses a completion event when the record column is not ticked', () => {
    const plan = planNotificationSubmit({
      ...base,
      request: request({ eventTypeId: 'platform.ready', dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } }, actions: [] })
    })
    expect(plan).toMatchObject({ kind: 'suppressed', outcome: { reason: 'not-subscribed' } })
  })

  it('creates a record and queues only the approved + subscribed local surfaces', () => {
    const subscriptions = { 'platform.failed': { desktop: true } }
    const plan = planNotificationSubmit({ ...base, subscriptions, request: request() })
    expect(plan.kind).toBe('new')
    if (plan.kind !== 'new') return
    expect(plan.outcome.levels).toEqual(['center', 'toast', 'desktop'])
    expect(plan.record.eventTypeId).toBe('platform.failed')
    expect(plan.record.productId).toBeUndefined()
    expect(plan.record.delivery).toEqual({
      toast: { state: 'queued', at: base.now },
      desktop: { state: 'queued', at: base.now }
    })
    expect(plan.record.dedupeKey).toBe('platform|failed:job-1:2026-11-03')
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
