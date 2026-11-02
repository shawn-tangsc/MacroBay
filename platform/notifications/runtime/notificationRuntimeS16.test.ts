import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings } from '../contracts/notificationContracts'
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

const catalog = createNotificationEventCatalog({
  policy: {
    'platform.done': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
    'platform.other': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false }
  },
  sources: [
    {
      productId: 'platform',
      events: [
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
          id: 'platform.other',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
          requestedDisruptionLevels: ['desktop'],
          dedupeKeyTemplate: 'other:{date}',
          dedupeUnit: 'occurrence',
          notifyOnlyIfSubscribed: false
        }
      ]
    }
  ]
})

function record(index: number) {
  return {
    id: `record-${String(index).padStart(3, '0')}`,
    owner: 'platform' as const,
    sourceId: 's',
    eventTypeId: 'platform.other',
    delivery: {},
    titleKey: 'notification.test.title' as const,
    severity: 'info' as const,
    priority: 'normal' as const,
    channels: ['center' as const],
    state: 'read' as const,
    actions: [],
    occurrenceCount: 1,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z'
  }
}

function createRuntime(records: readonly ReturnType<typeof record>[]) {
  let state: any = {
    records,
    dailyCounters: {},
    subscriptions: {},
    pushBackoff: {}
  }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) }
  }
  return {
    runtime: createNotificationRuntime({ storage, catalog, getSettings: async () => settings, clock }),
    state: () => state
  }
}

describe('S16: prune keeps subscriptions and caps records', () => {
  it('keeps the subscription table exactly as the reader left it', async () => {
    const { runtime, state } = createRuntime([record(0), record(1)])
    await runtime.setSubscription('platform.done', { record: true })
    await runtime.setSubscription('platform.other', { desktop: true })

    const result = await runtime.prune()

    expect(result).toEqual({ removedRecords: 0, removedCounters: 0 })
    expect(await runtime.getSubscriptions()).toEqual({
      'platform.done': { record: true },
      'platform.other': { desktop: true }
    })
    expect(state().records).toHaveLength(2)
  })

  it('caps the record list at 500 on the runtime, not only in the pure function', async () => {
    const records = Array.from({ length: 501 }, (_, index) => record(index))
    const { runtime, state } = createRuntime(records)
    await runtime.setSubscription('platform.done', { record: true })

    const result = await runtime.prune()

    expect(result.removedRecords).toBe(1)
    expect(state().records).toHaveLength(500)
    expect(await runtime.getSubscriptions()).toEqual({ 'platform.done': { record: true } })
  })
})
