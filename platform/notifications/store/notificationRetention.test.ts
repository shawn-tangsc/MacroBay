import { describe, expect, it } from 'vitest'

import type { NotificationRecord } from '../contracts/notificationContracts'
import {
  clampNotificationRetentionDays,
  notificationRetentionPolicy,
  pruneNotificationRecords
} from './notificationRetention'

function record(id: string, createdAt: string): NotificationRecord {
  return {
    id,
    owner: 'platform',
    sourceId: `source-${id}`,
    eventTypeId: 'platform.job.failed-terminal',
    delivery: {},
    titleKey: 'notification.taskFailed.title',
    titleParams: { taskName: `Notification ${id}` },
    severity: 'info',
    priority: 'normal',
    channels: ['center'],
    state: 'unread',
    actions: [],
    occurrenceCount: 1,
    createdAt,
    updatedAt: createdAt
  }
}

const now = '2026-11-01T12:00:00.000Z'

describe('notification retention', () => {
  it('removes records older than the retention window and keeps the rest', () => {
    const records = [
      record('recent', '2026-10-31T00:00:00.000Z'),
      record('stale', '2026-09-01T00:00:00.000Z')
    ]

    const result = pruneNotificationRecords(records, { retentionDays: 30, now })

    expect(result.records.map((item) => item.id)).toEqual(['recent'])
    expect(result.removedByAge).toBe(1)
    expect(result.removedByCount).toBe(0)
  })

  it('caps the record count by dropping the oldest first', () => {
    const records = [
      record('a', '2026-10-30T00:00:00.000Z'),
      record('b', '2026-10-31T00:00:00.000Z'),
      record('c', '2026-11-01T00:00:00.000Z')
    ]

    const result = pruneNotificationRecords(records, { retentionDays: 30, maxRecords: 2, now })

    expect(result.records.map((item) => item.id)).toEqual(['b', 'c'])
    expect(result.removedByCount).toBe(1)
    expect(result.removedByAge).toBe(0)
  })

  it('clamps a retention setting to the policy ceiling instead of trusting it', () => {
    expect(clampNotificationRetentionDays(30)).toBe(30)
    expect(clampNotificationRetentionDays(3650)).toBe(notificationRetentionPolicy.maxRetentionDays)
    expect(clampNotificationRetentionDays(0)).toBe(notificationRetentionPolicy.defaultRetentionDays)
    expect(clampNotificationRetentionDays(Number.NaN)).toBe(notificationRetentionPolicy.defaultRetentionDays)
  })

  it('keeps a record whose createdAt cannot be parsed', () => {
    const records = [record('broken', 'not-a-date'), record('old', '2026-01-01T00:00:00.000Z')]

    const result = pruneNotificationRecords(records, { retentionDays: 30, now })

    expect(result.records.map((item) => item.id)).toEqual(['broken'])
    expect(result.removedByAge).toBe(1)
  })

  it('does not reorder or drop anything when every record is inside both limits', () => {
    const records = [record('first', '2026-10-31T00:00:00.000Z'), record('second', '2026-10-30T00:00:00.000Z')]

    const result = pruneNotificationRecords(records, { retentionDays: 30, now })

    expect(result.records.map((item) => item.id)).toEqual(['first', 'second'])
    expect(result.removedByAge + result.removedByCount).toBe(0)
  })
})
