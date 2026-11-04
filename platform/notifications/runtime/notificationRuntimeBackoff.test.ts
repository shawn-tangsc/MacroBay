import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings, NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { createNotificationRuntime } from './notificationRuntime'

/**
 * 熔断进入 / 解除这两条路必须有断言，因为它们**没有任何界面能证明自己发生过**：
 * 推送失败三次之后，读者看到的只是「这条没到手机」，而「30 分钟内不再尝试」和
 * 「到点自动恢复」这两件事只写在状态里。没有用例，代码删掉一半也不会有任何东西变红。
 */

const SUSPEND_TITLE = 'notification.event.platform.channel.push-suspended.title'
const RESUMED_TITLE = 'notification.event.platform.channel.push-resumed.title'

const policy: NotificationEventPolicy = {
  'platform.push-probe': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false },
  'platform.channel.push-suspended': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
  'platform.channel.push-resumed': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
}

const catalog = createNotificationEventCatalog({
  policy,
  sources: [
    {
      productId: 'platform',
      events: [
        {
          id: 'platform.push-probe',
          titleKey: 'notification.test.title',
          bodyKey: 'notification.test.body',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
          requestedDisruptionLevels: ['channel'],
          dedupeKeyTemplate: 'push-probe:{key}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.channel.push-suspended',
          titleKey: SUSPEND_TITLE,
          bodyKey: 'notification.event.platform.channel.push-suspended.body',
          reasonKey: 'notification.event.platform.channel.push-suspended.reason',
          requiresUserAction: true,
          requestedDisruptionLevels: ['toast', 'desktop'],
          dedupeKeyTemplate: 'push-suspended:{channelId}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000
        },
        {
          id: 'platform.channel.push-resumed',
          titleKey: RESUMED_TITLE,
          bodyKey: 'notification.event.platform.channel.push-resumed.body',
          reasonKey: 'notification.event.platform.channel.push-resumed.reason',
          requiresUserAction: false,
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'push-resumed:{channelId}:{day}',
          dedupeUnit: 'occurrence',
        }
      ]
    }
  ]
})

const settings: NotificationRuntimeSettings = {
  desktopEnabled: false,
  toastEnabled: false,
  popupEnabled: false,
  // 出站通道打开：null 就是关（契约 §2），这里要真的走到推送端口。
  push: { channelId: 'channel-1' },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}

let nowMs = Date.parse('2026-11-03T09:00:00.000Z')
let pushOk = false
let pushCalls = 0

function request(key: string): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.push-probe',
    dedupeVars: { builder: 'template', vars: { key } },
    actions: [],
    occurredAt: new Date(nowMs).toISOString()
  }
}

function createHarness() {
  const state = createDefaultNotificationStoreState()
  // 出站推送要读者订阅了 channel 档才会排进投递表（`effectiveLevels` 第 186 行）。
  Object.assign(state, { subscriptions: { 'platform.push-probe': { record: true, channel: true } } })
  const runtime = createNotificationRuntime({
    storage: {
      read: async () => JSON.parse(JSON.stringify(state)),
      write: async (next) => { Object.assign(state, next) }
    },
    catalog,
    getSettings: async () => settings,
    clock: { now: () => new Date(nowMs), timeZone: () => 'UTC' },
    deliveryHooks: {
      push: async () => {
        pushCalls += 1
        return pushOk ? { ok: true, messageId: `m-${pushCalls}` } : { ok: false, reason: 'channel-rejected' }
      }
    }
  })
  return { runtime, records: () => state.records as ReadonlyArray<{ titleKey: string; actions?: ReadonlyArray<{ labelKey: string }> }> }
}

describe('push breaker announces both transitions', () => {
  it('raises the suspended event only on the third failure, with the settings deeplink action', async () => {
    pushOk = false
    pushCalls = 0
    const { runtime, records } = createHarness()

    await runtime.submit(request('first'))
    await runtime.submit(request('second'))
    // 前两次只是记下失败次数：读者不需要知道「一条失败了一次」。
    expect(records().some((record) => record.titleKey === SUSPEND_TITLE)).toBe(false)

    await runtime.submit(request('third'))
    const suspended = records().find((record) => record.titleKey === SUSPEND_TITLE)
    expect(suspended).toBeDefined()
    // 悬停句话要说「去哪儿看」，否则读者知道出了问题但不知道去哪。
    expect(suspended?.actions?.[0]?.labelKey).toBe('notification.channelCheck.action')
    expect(pushCalls).toBe(3)
  })

  it('raises the resumed event after the window passes and a send succeeds', async () => {
    // 必须同一个 harness：熔断状态存在它自己的 store 里，新建一个就等于换了一条没断过的通道。
    pushOk = false
    pushCalls = 0
    const { runtime, records } = createHarness()

    await runtime.submit(request('warm-1'))
    await runtime.submit(request('warm-2'))
    await runtime.submit(request('warm-3'))
    expect(records().some((record) => record.titleKey === SUSPEND_TITLE)).toBe(true)
    expect(records().some((record) => record.titleKey === RESUMED_TITLE)).toBe(false)

    // 越过 30 分钟窗口，下一次发送成功即恢复。
    nowMs += 31 * 60_000
    pushOk = true
    await runtime.submit(request('after-window'))

    const resumed = records().find((record) => record.titleKey === RESUMED_TITLE)
    expect(resumed).toBeDefined()
    // 恢复不需要读者做事，所以不带动作。
    expect(resumed?.actions ?? []).toHaveLength(0)
  })

  it('does not raise the resumed event when the channel was never paused', async () => {
    pushOk = true
    pushCalls = 0
    const { runtime, records } = createHarness()

    await runtime.submit(request('healthy'))

    expect(records().some((record) => record.titleKey === RESUMED_TITLE)).toBe(false)
  })
})
