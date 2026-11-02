import { describe, expect, it } from 'vitest'

import type { NotificationRecord, NotificationRequest } from '../contracts/notificationContracts'
import { findActiveDuplicate } from './notificationDedupe'

/**
 * T29（契约 §7.2）：合并目标 = **该键最近一条仍在保留期内的记录**。
 *
 * 旧实现用 `records.find`，靠 runtime 头插才碰巧正确；有人改成追加或重排，就会静默并进
 * 一条已过期的旧行 —— 没有报错、没有症状，只是把「这次发生」的正文写进了上一条。
 * 所以这里**两种数组顺序都判**：实现必须按 `createdAt` 取最近一条，不能靠顺序。
 */
const request: NotificationRequest = {
  owner: 'platform',
  sourceId: 'source',
  titleKey: 'notification.taskFailed.title',
  severity: 'warning',
  priority: 'normal',
  requestedChannels: ['center'],
  dedupeKey: 'brief-failed:2026-11-02:daily'
}

function record(id: string, createdAt: string, state: NotificationRecord['state'] = 'unread'): NotificationRecord {
  return {
    id,
    owner: 'platform',
    sourceId: 'source',
    eventTypeId: 'platform.job.failed-terminal',
    delivery: {},
    titleKey: 'notification.taskFailed.title',
    severity: 'warning',
    priority: 'normal',
    channels: ['center'],
    state,
    actions: [],
    dedupeKey: 'brief-failed:2026-11-02:daily',
    occurrenceCount: 1,
    createdAt,
    updatedAt: createdAt
  }
}

const now = '2026-11-02T12:00:00.000Z'
const old = record('n-old', '2026-11-01T09:00:00.000Z')
const latest = record('n-new', '2026-11-02T09:00:00.000Z')

describe('findActiveDuplicate', () => {
  it('merges into the newest active row whichever way the array is ordered', () => {
    expect(findActiveDuplicate([old, latest], request, now)?.id).toBe('n-new')
    expect(findActiveDuplicate([latest, old], request, now)?.id).toBe('n-new')
  })

  it('keeps the old row out of the merge when it is no longer active', () => {
    const expired = record('n-expired', '2026-11-01T09:00:00.000Z', 'expired')
    expect(findActiveDuplicate([expired, latest], request, now)?.id).toBe('n-new')
  })

  it('does not merge when every row with the key has been dismissed or expired', () => {
    expect(findActiveDuplicate([old, latest], request, now)).toBeTruthy()
    const dismissedOld = record('n-old', '2026-11-01T09:00:00.000Z', 'dismissed')
    const expiredNew = record('n-new', '2026-11-02T09:00:00.000Z', 'expired')
    expect(findActiveDuplicate([dismissedOld, expiredNew], request, now)).toBeUndefined()
  })

  it('ignores records with another key and requests without a key', () => {
    expect(findActiveDuplicate([record('n-other', '2026-11-02T11:00:00.000Z')], { ...request, dedupeKey: 'another' }, now)).toBeUndefined()
    expect(findActiveDuplicate([latest], { ...request, dedupeKey: undefined }, now)).toBeUndefined()
  })
})
