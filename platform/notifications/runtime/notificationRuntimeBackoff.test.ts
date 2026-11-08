import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings, NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { notificationCopy } from '../../i18n/notificationCopy'
import { createNotificationRuntime } from './notificationRuntime'

const zhText = (key: keyof typeof notificationCopy['zh-CN']): string => notificationCopy['zh-CN'][key]

/**
 * 熔断进入 / 解除这两条路必须有断言，因为它们**没有任何界面能证明自己发生过**：
 * 推送失败三次之后，读者看到的只是「这条没到手机」，而「30 分钟内不再尝试」和
 * 「到点自动恢复」这两件事只写在状态里。没有用例，代码删掉一半也不会有任何东西变红。
 */

const SUSPEND_TITLE = 'notification.event.platform.channel.push-suspended.title'
const RESUMED_TITLE = 'notification.event.platform.channel.push-resumed.title'

const catalog = createNotificationEventCatalog({
  // 批准值随声明走（b2）：五条批准原样挪到来源上，值逐字不变。
  sources: [
    {
      productId: 'platform',
      approval: {
        'platform.push-probe': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false },
        'platform.channel.push-suspended': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
        'platform.channel.push-resumed': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
        // 凭据翻转两条也要在目录里：不在目录里的提交会被拒成「事件没登记」。
        'platform.provider.credential-invalid': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
        'platform.provider.credential-recovered': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
      },
      events: [
        {
          id: 'platform.push-probe',
          titleKey: 'notification.test.title',
          bodyKey: 'notification.test.body',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
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
    category: 'reminder',
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
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'push-resumed:{channelId}:{day}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.provider.credential-invalid',
          titleKey: 'notification.event.platform.provider.credential-invalid.title',
          bodyKey: 'notification.event.platform.provider.credential-invalid.body',
          reasonKey: 'notification.event.platform.provider.credential-invalid.reason',
          requiresUserAction: true,
          category: 'needs-action',
          requestedDisruptionLevels: ['toast', 'desktop'],
          dedupeKeyTemplate: 'credential-invalid:{providerId}',
          dedupeUnit: 'condition',
          conditionWindowMs: 3_600_000
        },
        {
          id: 'platform.provider.credential-recovered',
          titleKey: 'notification.event.platform.provider.credential-recovered.title',
          bodyKey: 'notification.event.platform.provider.credential-recovered.body',
          reasonKey: 'notification.event.platform.provider.credential-recovered.reason',
          requiresUserAction: false,
    category: 'completed',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'credential-recovered:{providerId}:{day}',
          dedupeUnit: 'occurrence',
        }
      ]
    }
  ]
})

/** 目标通道现在由派生入口给出（技术方案 §1）：沿用夹具的 `push.channelId` 意图，换成一次 `runtime-ready`。 */
async function resolvePushChannelFromSettings() {
  const channelId = settings.push.channelId
  return channelId === null
    ? { ok: false as const, reason: 'push-unavailable' as const, enabledChannelCount: 0, multiple: false, states: {} }
    : { ok: true as const, channelId, channelName: 'channel-1' }
}

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
    resolvePushChannel: resolvePushChannelFromSettings,
    diagnostics: () => undefined,
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
  return { runtime, records: () => state.records }
}

describe('push breaker announces both transitions', () => {
  it('raises the suspended event only on the third failure, with the settings deeplink action', async () => {
    pushOk = false
    pushCalls = 0
    const { runtime, records } = createHarness()

    await runtime.submit(request('first'))
    await runtime.submit(request('second'))
    // 前两次只是记下失败次数：读者不需要知道「一条失败了一次」。
    // 成品记录不再挂文案键：按事件 id 定位，再断言读者看得到的那句话。
    expect(records().some((record) => record.eventTypeId === 'platform.channel.push-suspended')).toBe(false)

    await runtime.submit(request('third'))
    const suspended = records().find((record) => record.eventTypeId === 'platform.channel.push-suspended')
    expect(suspended).toBeDefined()
    // 源头拼好的成品：读者看到的是句子，不是键。
    expect(suspended?.rendered?.['zh-CN']?.title).toBe('已暂停推送到手机')
    expect(suspended?.titleKey).toBeUndefined()
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
    expect(records().some((record) => record.eventTypeId === 'platform.channel.push-suspended')).toBe(true)
    expect(records().some((record) => record.eventTypeId === 'platform.channel.push-resumed')).toBe(false)

    // 越过 30 分钟窗口，下一次发送成功即恢复。
    nowMs += 31 * 60_000
    pushOk = true
    await runtime.submit(request('after-window'))

    const resumed = records().find((record) => record.eventTypeId === 'platform.channel.push-resumed')
    expect(resumed).toBeDefined()
    expect(resumed?.rendered?.['zh-CN']?.title).toBe(zhText('notification.event.platform.channel.push-resumed.title'))
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

describe('P4a/P4b: credential health announces only flips', () => {
  it('sends invalid once, then recovery once, and does not repeat after a restart', async () => {
    const state = createDefaultNotificationStoreState()
    const make = (): ReturnType<typeof createNotificationRuntime> =>
      createNotificationRuntime({
        resolvePushChannel: resolvePushChannelFromSettings,
        diagnostics: () => undefined,
        storage: {
          read: async () => JSON.parse(JSON.stringify(state)),
          write: async (next) => { Object.assign(state, next) }
        },
        catalog,
        getSettings: async () => settings,
        clock: { now: () => new Date(nowMs), timeZone: () => 'UTC' }
      })

    const runtime = make()
    expect(await runtime.reportProviderCredential({ providerId: 'silicon', providerName: 'OpenAI', state: 'invalid' })).toEqual({ changed: true })
    // 持续失败不重复发：状态没翻转就什么都不做。
    expect(await runtime.reportProviderCredential({ providerId: 'silicon', providerName: 'OpenAI', state: 'invalid' })).toEqual({ changed: false })

    const announced = (state as { records: Array<{ eventTypeId?: string; rendered?: Record<string, { title: string }> }> }).records
      .filter((record) => record.eventTypeId === 'platform.provider.credential-invalid')
    expect(announced).toHaveLength(1)
    // 名字是读者看到的那一个：不是 id，也不是「未知」。
    expect(announced[0]?.rendered?.['zh-CN']?.title).toBe('OpenAI 的密钥失效了')

    // 重启：同一份 state 读回来，仍然不重发。
    const restarted = make()
    expect(await restarted.reportProviderCredential({ providerId: 'silicon', providerName: 'OpenAI', state: 'invalid' })).toEqual({ changed: false })

    // 从 invalid 翻回 ok：发一条恢复。
    expect(await restarted.reportProviderCredential({ providerId: 'silicon', providerName: 'OpenAI', state: 'ok' })).toEqual({ changed: true })
    expect(await restarted.reportProviderCredential({ providerId: 'silicon', providerName: 'OpenAI', state: 'ok' })).toEqual({ changed: false })
  })

  it('never prints the provider id: no display name means no notice, and the flip is still recorded', async () => {
    const state = createDefaultNotificationStoreState()
    const runtime = createNotificationRuntime({
      resolvePushChannel: resolvePushChannelFromSettings,
      diagnostics: () => undefined,
      storage: {
        read: async () => JSON.parse(JSON.stringify(state)),
        write: async (next) => { Object.assign(state, next) }
      },
      catalog,
      getSettings: async () => settings,
      clock: { now: () => new Date(nowMs), timeZone: () => 'UTC' }
    })

    // 判定状态照旧翻转（否则下一次真实翻转会被当成「已经报过」而吞掉）。
    expect(await runtime.reportProviderCredential({ providerId: 'silicon', state: 'invalid' })).toEqual({ changed: true })
    expect((state as { providerCredentialHealth?: Record<string, string> }).providerCredentialHealth).toEqual({
      silicon: 'invalid'
    })
    // 没有名字 → 不提交：宁可不发，也不把 `silicon` 摆到读者面前。
    expect((state as { records: unknown[] }).records).toEqual([])
    expect(JSON.stringify(state)).not.toContain('silicon 的密钥')
  })

  it('keeps the health state when records are pruned', async () => {
    const state = createDefaultNotificationStoreState()
    state.providerCredentialHealth = { silicon: 'invalid' }
    const runtime = createNotificationRuntime({
      resolvePushChannel: resolvePushChannelFromSettings,
      diagnostics: () => undefined,
      storage: {
        read: async () => JSON.parse(JSON.stringify(state)),
        write: async (next) => { Object.assign(state, next) }
      },
      catalog,
      getSettings: async () => settings,
      clock: { now: () => new Date(nowMs), timeZone: () => 'UTC' }
    })

    await runtime.prune()

    // 清记录不许顺手清掉判定状态，否则重启后会再发一遍失效。
    expect((state as { providerCredentialHealth?: Record<string, string> }).providerCredentialHealth).toEqual({
      silicon: 'invalid'
    })
  })
})
