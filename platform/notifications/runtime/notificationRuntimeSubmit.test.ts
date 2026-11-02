import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings, NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

const settings: NotificationRuntimeSettings = {
  desktopEnabled: true,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}
const clock = { now: () => new Date('2026-11-03T00:00:00.000Z'), timeZone: () => 'UTC' }

const policy: NotificationEventPolicy = {
  'platform.failed': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'platform.done': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'platform.merge-a': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'platform.merge-b': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'platform.merge-c': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
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
          bodyKey: 'notification.taskFailed.body',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
          requestedDisruptionLevels: ['desktop'],
          dedupeKeyTemplate: 'failed:{id}:{date}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000,
          notifyOnlyIfSubscribed: false
        },
        {
          id: 'platform.done',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
          requestedDisruptionLevels: ['desktop'],
          dedupeKeyTemplate: 'done:{date}',
          dedupeUnit: 'occurrence',
          notifyOnlyIfSubscribed: true
        },
        {
          id: 'platform.merge-a',
          titleKey: 'notification.taskFailed.title',
          bodyKey: 'notification.taskFailed.body',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'shared:{id}',
          dedupeUnit: 'occurrence',
          notifyOnlyIfSubscribed: false
        },
        {
          id: 'platform.merge-b',
          titleKey: 'notification.test.title',
          bodyKey: 'notification.aggregate.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'shared:{id}',
          dedupeUnit: 'occurrence',
          notifyOnlyIfSubscribed: false
        },
        {
          id: 'platform.merge-c',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'shared:{id}',
          dedupeUnit: 'occurrence',
          notifyOnlyIfSubscribed: false
        }
      ]
    }
  ]
})

function createRuntime(
  initial?: unknown,
  extra: {
    producerOwnership?: Record<string, 'platform' | { productId: string }>
    productIds?: readonly string[]
  } = {}
) {
  let state: any = initial ?? { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => {
      state = JSON.parse(JSON.stringify(next))
    }
  }
  const diagnostics: string[] = []
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: (entry) => diagnostics.push(entry.code),
    ...(extra.producerOwnership === undefined ? {} : { producerOwnership: extra.producerOwnership }),
    ...(extra.productIds === undefined ? {} : { productIds: extra.productIds }),
    getSettings: async () => settings,
    clock
  })
  return { runtime, state: () => state, diagnostics }
}

function request(overrides: Partial<NotificationSubmitRequest> = {}): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.failed',
    dedupeVars: { builder: 'template', vars: { id: 'job-1', date: '2026-11-03' } },
    actions: [],
    occurredAt: '2026-11-03T00:00:00.000Z',
    ...overrides
  }
}

describe('notification runtime submit', () => {
  it('rejects an unregistered event type without writing a row', async () => {
    const { runtime, state } = createRuntime()
    await expect(runtime.submit(request({ eventTypeId: 'platform.nope' }))).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'unknown-event-type'
    })
    expect(state().records).toHaveLength(0)
  })

  it('suppresses a completion event when the reader has not subscribed', async () => {
    const { runtime, state } = createRuntime()
    const outcome = await runtime.submit(
      request({ eventTypeId: 'platform.done', dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } } })
    )
    expect(outcome).toMatchObject({ kind: 'suppressed', reason: 'not-subscribed' })
    expect(state().records).toHaveLength(0)
  })

  it('records a completion event once the record column is ticked', async () => {
    const { runtime, state } = createRuntime({
      records: [],
      dailyCounters: {},
      subscriptions: { 'platform.done': { record: true } },
      pushBackoff: {}
    })
    const outcome = await runtime.submit(
      request({ eventTypeId: 'platform.done', dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } } })
    )
    expect(outcome).toMatchObject({ kind: 'accepted', levels: ['center'] })
    expect(state().records).toHaveLength(1)
  })

  it('T27: merges two event types under one key, keeping title/actions of the first and body of the latest', async () => {
    const { runtime, state } = createRuntime()
    const first = await runtime.submit(
      request({ eventTypeId: 'platform.merge-a', dedupeVars: { builder: 'template', vars: { id: 'x' } } })
    )
    expect(first.kind).toBe('accepted')

    const second = await runtime.submit(
      request({ eventTypeId: 'platform.merge-b', dedupeVars: { builder: 'template', vars: { id: 'x' } } })
    )
    expect(second).toMatchObject({
      kind: 'merged',
      occurrenceCount: 1,
      mergedEventTypes: ['platform.merge-a', 'platform.merge-b']
    })
    expect(state().records).toHaveLength(1)
    const record = state().records[0]
    expect(record.titleKey).toBe('notification.taskFailed.title')
    expect(record.bodyKey).toBe('notification.aggregate.title')
  })

  it('T28: a later submission without a body keeps the existing body', async () => {
    const { runtime, state } = createRuntime()
    await runtime.submit(
      request({ eventTypeId: 'platform.merge-b', dedupeVars: { builder: 'template', vars: { id: 'y' } } })
    )
    await runtime.submit(
      request({ eventTypeId: 'platform.merge-c', dedupeVars: { builder: 'template', vars: { id: 'y' } } })
    )
    expect(state().records[0].bodyKey).toBe('notification.aggregate.title')
  })

  it('S10: a claimed producer is delegated to its product, with one diagnostic', async () => {
    const { runtime, state, diagnostics } = createRuntime(undefined, {
      producerOwnership: { 'market-intelligence.dailyBriefing': { productId: 'market-intelligence' } },
      productIds: ['market-intelligence']
    })
    await expect(
      runtime.submit(request({ producerId: 'market-intelligence.dailyBriefing' }))
    ).resolves.toMatchObject({
      kind: 'delegated',
      producerId: 'market-intelligence.dailyBriefing',
      ownerProductId: 'market-intelligence'
    })
    expect(state().records).toHaveLength(0)
    expect(diagnostics).toEqual(['delegated'])
  })

  it('S10: a product-prefixed unclaimed producer is sent by the platform and diagnosed once', async () => {
    const { runtime, diagnostics } = createRuntime(undefined, { productIds: ['market-intelligence'] })
    await runtime.submit(request({ producerId: 'market-intelligence.new-job' }))
    await runtime.submit(request({ producerId: 'market-intelligence.new-job', dedupeVars: { builder: 'template', vars: { id: 'job-2', date: '2026-11-04' } } }))
    expect(diagnostics).toEqual(['unclaimed-producer'])
  })

  it('S10: a handler with no product prefix is platform-owned and never diagnosed', async () => {
    const { runtime, diagnostics } = createRuntime()
    await runtime.submit(request({ producerId: 'assistant.sessionRetention' }))
    expect(diagnostics).toEqual([])
  })

  it('T19: unchecking the desktop column returns the record to suppressed', async () => {
    const { runtime } = createRuntime()
    await expect(
      runtime.submit(
        request({ eventTypeId: 'platform.done', dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } } })
      )
    ).resolves.toMatchObject({ kind: 'suppressed' })
  })
})
