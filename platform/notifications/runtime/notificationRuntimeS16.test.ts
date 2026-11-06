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
    category: 'reminder',
          requestedDisruptionLevels: ['desktop'],
          dedupeKeyTemplate: 'done:{date}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.other',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: ['desktop'],
          dedupeKeyTemplate: 'other:{date}',
          dedupeUnit: 'occurrence',
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
    pushBackoff: {}
  }
  // 设置与记录同一份 JSON：这是 `getSettings`/`updateSettings` 的替身，写入后必须读得回。
  // 频道事件表也在这份设置里：清理**不许**把它抹掉（三条缺省即开，这里显式存一个 false）。
  let settings: any = {
    desktopEnabled: false,
    toastEnabled: false,
    channelEvents: { 'market-intelligence.signal.triggered': false }
  }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) }
  }
  return {
    runtime: createNotificationRuntime({
      storage,
      catalog,
      getSettings: async () => settings,
      updateSettings: async (patch) => {
        settings = { ...settings, ...patch }
      },
      clock
    }),
    state: () => state,
    settings: () => settings
  }
}

describe('S16: prune keeps subscriptions and caps records', () => {
  it('keeps the switches and the three channel events exactly as the reader left them', async () => {
    const { runtime, state, settings } = createRuntime([record(0), record(1)])
    await runtime.setDesktopEnabled(true)

    const result = await runtime.prune()

    expect(result).toEqual({ removedRecords: 0, removedCounters: 0 })
    // 清理只碰记录与计数；两个开关与频道事件表原样留着（设置与记录同一份 JSON）。
    expect(settings()).toMatchObject({
      desktopEnabled: true,
      channelEvents: { 'market-intelligence.signal.triggered': false }
    })
    expect(state().records).toHaveLength(2)
  })

  it('actually deletes a record older than the window and keeps subscriptions through the write', async () => {
    const old = { ...record(0), createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }
    const fresh = record(1)
    const { runtime, state, settings } = createRuntime([old, fresh])
    await runtime.setDesktopEnabled(true)

    const result = await runtime.prune()

    // removedRecords === 1 证明这次真写了盘，不是「没东西删」的早退分支。
    expect(result.removedRecords).toBe(1)
    expect(state().records).toHaveLength(1)
    expect(settings()).toMatchObject({ desktopEnabled: true })
  })

  it('caps the record list at 500 on the runtime, not only in the pure function', async () => {
    const records = Array.from({ length: 501 }, (_, index) => record(index))
    const { runtime, state, settings } = createRuntime(records)
    await runtime.setDesktopEnabled(true)

    const result = await runtime.prune()

    expect(result.removedRecords).toBe(1)
    expect(state().records).toHaveLength(500)
    expect(settings()).toMatchObject({ desktopEnabled: true })
  })
})
