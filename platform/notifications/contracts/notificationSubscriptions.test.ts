import { describe, expect, it } from 'vitest'

import {
  applySubscriptionPatch,
  deriveRecord,
  emptySubscriptionTable,
  isSubscribed,
  normalizeSubscriptionTable,
  type NotificationSubscriptionTable
} from './notificationSubscriptions'
import type { NotificationEventCatalogEntry } from './notificationEventCatalog'

/** 订阅表（契约 §5.1）：空表 = 一条都不勾；记录列是派生的；生效 = 批准 ∩ 订阅。 */
function entry(overrides: Partial<NotificationEventCatalogEntry> = {}): NotificationEventCatalogEntry {
  return {
    id: 'platform.job.failed-terminal',
    productId: 'platform',
    titleKey: 'notification.jobFailed.title',
    reasonKey: 'notification.jobFailed.reason',
    requiresUserAction: true,
    requestedDisruptionLevels: ['desktop'],
    approvedDisruptionLevels: ['center', 'desktop'],
    approvedBypassQuietHours: false,
    dedupeUnit: 'occurrence',
    notifyOnlyIfSubscribed: false,
    ...overrides
  }
}

describe('notification subscriptions', () => {
  it('starts empty: no row, nothing subscribed, nothing recorded', () => {
    const table = emptySubscriptionTable()
    expect(table).toEqual({})
    expect(isSubscribed(entry(), 'center', table)).toBe(true) // 无条件记录类恒记录
    expect(isSubscribed(entry(), 'desktop', table)).toBe(false)
  })

  it('derives the record column from any chosen delivery level, and keeps no hidden true', () => {
    expect(deriveRecord(undefined)).toBe(false)
    expect(deriveRecord({ desktop: true })).toBe(true)
    expect(deriveRecord({ channel: true })).toBe(true)
    expect(deriveRecord({ record: true })).toBe(true)
    expect(deriveRecord({ record: false, desktop: false })).toBe(false)
  })

  it('never reports a surface the approval table does not allow', () => {
    const table: NotificationSubscriptionTable = { 'platform.job.failed-terminal': { desktop: true, channel: true } }
    // 批准表没有 channel：读者表里就算有 true，生效值也只认批准——上限不是禁用态。
    expect(isSubscribed(entry(), 'channel', table)).toBe(false)
    expect(isSubscribed(entry(), 'desktop', table)).toBe(true)
  })

  it('records result-type events only when the reader asked for them', () => {
    const resultEntry = entry({ id: 'market-intelligence.briefing.ready', notifyOnlyIfSubscribed: true })
    expect(isSubscribed(resultEntry, 'center', emptySubscriptionTable())).toBe(false)
    expect(isSubscribed(resultEntry, 'center', { 'market-intelligence.briefing.ready': { record: true } })).toBe(true)
    // 只勾投递档也等于「这条要」：记录列因此显示「已记录」，不可关。
    expect(isSubscribed(resultEntry, 'center', { 'market-intelligence.briefing.ready': { desktop: true } })).toBe(true)
  })

  it('writes the row, ignores record on always-record events, and empties it when everything is off', () => {
    const resultEntry = entry({ id: 'market-intelligence.calibration.result', notifyOnlyIfSubscribed: true })

    const on = applySubscriptionPatch(resultEntry, { record: true }, undefined)
    expect(on).toEqual({ ok: true, subscription: { record: true } })

    const off = applySubscriptionPatch(resultEntry, { record: false }, { record: true })
    expect(off).toEqual({ ok: true, subscription: null })

    // 无条件记录的事件没有 record 这一位：传了也不落（界面本来就不给这个控件）。
    const alwaysRecord = applySubscriptionPatch(entry(), { record: true, desktop: true }, undefined)
    expect(alwaysRecord).toEqual({ ok: true, subscription: { desktop: true } })

    const invalid = applySubscriptionPatch(entry(), { desktop: 'yes' as unknown as boolean }, undefined)
    expect(invalid).toEqual({ ok: false, reasonCode: 'invalid-patch' })
  })

  it('normalizes a stored table: booleans only, empty rows dropped, non-objects become empty', () => {
    expect(normalizeSubscriptionTable(undefined)).toEqual({})
    expect(normalizeSubscriptionTable([])).toEqual({})
    expect(normalizeSubscriptionTable({
      'platform.job.failed-terminal': { desktop: true, record: 'yes', channel: false },
      'platform.job.repeated-failed': {},
      '': { desktop: true }
    })).toEqual({ 'platform.job.failed-terminal': { desktop: true, channel: false } })
  })
})
