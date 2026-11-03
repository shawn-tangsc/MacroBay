import { describe, expect, it } from 'vitest'

import type { NotificationEventCatalogEntry } from '@platform/notifications/contracts/notificationEventCatalog'

import { buildSubscriptionRows, recordedViaDeliveryReason, rowHasControl } from './subscriptionMatrix'

function entry(overrides: Partial<NotificationEventCatalogEntry> = {}): NotificationEventCatalogEntry {
  return {
    id: 'platform.job.failed-terminal',
    titleKey: 'notification.job.failed',
    reasonKey: 'notification.reason.failed',
    requiresUserAction: true,
    requestedDisruptionLevels: ['desktop'],
    dedupeUnit: 'occurrence',
    notifyOnlyIfSubscribed: false,
    productId: 'platform',
    approvedDisruptionLevels: ['center', 'desktop'],
    approvedBypassQuietHours: false,
    ...overrides
  }
}

const build = (entries: readonly NotificationEventCatalogEntry[], subscriptions = {}) =>
  buildSubscriptionRows({ entries, subscriptions })

describe('subscription matrix', () => {
  it('gives an unconditionally recorded event the fixed label instead of a control', () => {
    const [row] = build([entry()])
    // 「固定开启」不是勾：画成勾会让读者以为能关掉中心。
    expect(row!.record).toEqual({ kind: 'fixed' })
  })

  it('lets a result-type event be recorded by hand, and keeps it off by default', () => {
    const [row] = build([entry({ notifyOnlyIfSubscribed: true })])
    expect(row!.record).toEqual({ kind: 'checkbox', level: 'record', checked: false, disabled: false })
  })

  it('shows the record column as already recorded when a delivery column is ticked', () => {
    const [row] = build([entry({ notifyOnlyIfSubscribed: true })], { 'platform.job.failed-terminal': { desktop: true } })
    // 生效值是 record ∨ desktop ∨ channel，所以这一格不能是可关的勾；
    // 带上 surfaces 是为了让读屏说出「因勾了桌面」，而不只一个状态。
    expect(row!.record).toEqual({ kind: 'recorded-via-delivery', surfaces: ['desktop'] })
  })

  it('keeps an explicitly ticked record tickable, because the reader can still un-tick it there', () => {
    const [row] = build([entry({ notifyOnlyIfSubscribed: true })], {
      'platform.job.failed-terminal': { record: true, desktop: true }
    })
    expect(row!.record).toEqual({ kind: 'checkbox', level: 'record', checked: true, disabled: false })
  })

  it('draws an unapproved column as a dash rather than a disabled checkbox', () => {
    const [row] = build([entry({ approvedDisruptionLevels: ['center'] })])
    // 禁用复选框等于承诺「以后能开」；批准表是本版上限，所以只有「不会有这一格」。
    expect(row!.desktop).toEqual({ kind: 'not-approved' })
  })

  it('says why the record column is filled, so the reader hears the reason not just the state', () => {
    const target = entry({ notifyOnlyIfSubscribed: true })
    expect(recordedViaDeliveryReason(target, { [target.id]: { desktop: true } })).toBe('desktop')
    expect(recordedViaDeliveryReason(target, {})).toBeNull()
  })

  it('draws no channel column at all until the channel is ready', () => {
    // 未就绪时整列不出现：一串禁用的勾等于承诺「勾上就能推到手机」。
    expect(build([entry()])[0]!.channel).toBeNull()
    expect(buildSubscriptionRows({ entries: [entry()], subscriptions: {}, channelReady: false })[0]!.channel).toBeNull()
  })

  it('gives an approved event a real channel tick and everybody else a dash', () => {
    const rows = buildSubscriptionRows({
      entries: [
        entry({ id: 'platform.signal', approvedDisruptionLevels: ['center', 'desktop', 'channel'] }),
        entry({ id: 'platform.other', approvedDisruptionLevels: ['center', 'desktop'] })
      ],
      subscriptions: {},
      channelReady: true
    })
    // 批准含 channel 的才是控件；其余是灰色「—」，不是置灰的勾。
    expect(rows[0]!.channel).toEqual({ kind: 'checkbox', level: 'channel', checked: false, disabled: false })
    expect(rows[1]!.channel).toEqual({ kind: 'not-approved' })
  })

  it('counts a ticked channel as a delivery, so the record column cannot be turned off underneath it', () => {
    const target = entry({ notifyOnlyIfSubscribed: true, approvedDisruptionLevels: ['center', 'channel'] })
    const [row] = buildSubscriptionRows({
      entries: [target],
      subscriptions: { [target.id]: { channel: true } },
      channelReady: true
    })
    // 生效值是 record ∨ desktop ∨ channel：勾了频道之后，记录格就不是可关的勾了。
    expect(row!.record).toEqual({ kind: 'recorded-via-delivery', surfaces: ['channel'] })
  })

  it('knows a row with nothing left to operate, so the list does not pretend it is interactive', () => {
    expect(rowHasControl(build([entry()])[0]!)).toBe(true)
    expect(rowHasControl(build([entry({ approvedDisruptionLevels: ['center'] })])[0]!)).toBe(false)
  })
})
