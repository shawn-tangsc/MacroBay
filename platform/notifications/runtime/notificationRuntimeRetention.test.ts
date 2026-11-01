import { describe, expect, it, vi } from 'vitest'

import type { NotificationRuntimeSettings, NotificationRequest } from '../contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

const settings: NotificationRuntimeSettings = {
  centerEnabled: true,
  desktopEnabled: true,
  toastEnabled: true,
  popupEnabled: true,
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}

const clock = { now: () => new Date('2026-11-01T12:00:00.000Z'), timeZone: () => 'UTC' }

function createMemoryStorage(initial?: unknown): NotificationStorage & { dump: () => any } {
  let state: any = initial ?? { records: [], dailyCounters: {} }
  return {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => {
      state = JSON.parse(JSON.stringify(next))
    },
    dump: () => state
  }
}

function request(index: number): NotificationRequest {
  return {
    owner: 'product',
    productId: 'sample-product',
    sourceId: `source-${index}`,
    title: `Event ${index}`,
    severity: 'info',
    priority: 'normal',
    requestedChannels: ['center']
  }
}

describe('notification runtime retention and breaker', () => {
  it('folds writes above the daily cap and keeps the count across a restart', async () => {
    const storage = createMemoryStorage()
    const first = createNotificationRuntime({ storage, getSettings: async () => settings, clock })

    for (let index = 0; index < 51; index += 1) await first.submit(request(index))

    const afterFirstRun = storage.dump()
    const originals = afterFirstRun.records.filter((record: any) => record.collapsedCount === undefined)
    const aggregate = afterFirstRun.records.find((record: any) => record.collapsedCount !== undefined)
    expect(originals).toHaveLength(50)
    expect(aggregate.collapsedCount).toBe(1)
    expect(afterFirstRun.dailyCounters['sample-product|2026-11-01']).toBe(51)
    // 折叠掉的是原文：聚合记录不保留标题/正文内容。
    expect(aggregate.body).toBeUndefined()

    // 重启：新的运行时读回同一份 JSON，计数仍在，第 52 条继续折叠。
    const second = createNotificationRuntime({ storage, getSettings: async () => settings, clock })
    await second.submit(request(52))

    const afterRestart = storage.dump()
    expect(afterRestart.records.find((record: any) => record.collapsedCount !== undefined).collapsedCount).toBe(2)
    expect(afterRestart.dailyCounters['sample-product|2026-11-01']).toBe(52)
  })

  it('prunes expired records and counter buckets, and only notifies when something changed', async () => {
    const onChange = vi.fn()
    const storage = createMemoryStorage({
      records: [
        {
          id: 'old',
          owner: 'platform',
          sourceId: 's',
          title: 'Old',
          severity: 'info',
          priority: 'normal',
          channels: ['center'],
          state: 'read',
          actions: [],
          occurrenceCount: 1,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z'
        }
      ],
      dailyCounters: { 'sample-product|2026-08-01': 3, 'sample-product|2026-11-01': 1 }
    })

    const runtime = createNotificationRuntime({ storage, getSettings: async () => settings, clock, onChanged: onChange })
    const first = await runtime.prune()

    expect(first.removedRecords).toBe(1)
    expect(first.removedCounters).toBe(1)
    expect(storage.dump().dailyCounters).toEqual({ 'sample-product|2026-11-01': 1 })
    expect(onChange).toHaveBeenCalledOnce()

    const second = await runtime.prune()
    expect(second).toEqual({ removedRecords: 0, removedCounters: 0 })
    expect(onChange).toHaveBeenCalledOnce()
  })
})
