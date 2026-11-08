import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationRuntimeSettings, NotificationSubmitRequest } from '../contracts/notificationContracts'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '../contracts/platformNotificationEvents'
import { composeSelfTestSurface } from './notificationSelfTestSurface'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

/**
 * 免打扰**只算一次**，规划器与投递路由共用同一个决定（2026-11-08，Chief 定）。
 *
 * 这一组判的是读者能感知的结果：
 * - 夜里点诊断自检（已批穿透 + 测试命名空间）→ 手机与桌面**都真的试了**；
 * - 同一事件同一时刻**不带**测试命名空间 → 一档都不试，且 `suppressedLevels` 记「免打扰」；
 * - 白天的同一路径与改动前逐字一致；
 * - 桌面开关关着 → `suppressedLevels` 记「开关关着」，回执说「没测」不说「没到」。
 */
const catalog = createNotificationEventCatalog({
  sources: [{ productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS }]
})

/** 2026-11-08T12:00Z = 读者时区（Asia/Shanghai）20:00 → 窗口 20:00–23:59 内。 */
const NIGHT = '2026-11-08T12:00:00.000Z'
/** 2026-11-08T04:00Z = 12:00 本地 → 窗口外。 */
const DAY = '2026-11-08T04:00:00.000Z'

function settingsFor(overrides: Partial<NotificationRuntimeSettings> = {}): NotificationRuntimeSettings {
  return {
    ...createDefaultNotificationRuntimeSettings(),
    toastEnabled: true,
    desktopEnabled: true,
    quietHours: { enabled: true, startLocalTime: '20:00', endLocalTime: '23:59' },
    ...overrides
  }
}

function harness(input: { now: string; settings?: NotificationRuntimeSettings }) {
  let state: any = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) }
  }
  const desktop: string[] = []
  const push: string[] = []
  const toast: string[] = []
  const settings = input.settings ?? settingsFor()
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: () => undefined,
    getSettings: async () => settings,
    clock: { now: () => new Date(input.now), timeZone: () => 'Asia/Shanghai' },
    desktopSupported: () => true,
    deliveryHooks: {
      desktop: async () => { desktop.push('desktop'); return { ok: true } },
      push: async () => { push.push('push'); return { ok: true, messageId: 'm1' } },
      toast: () => { toast.push('toast') }
    },
    resolvePushChannel: async () => ({ ok: true, channelId: 'channel-a', channelName: 'Telegram · test' }),
    getLanguage: async () => 'zh-CN'
  })
  return { runtime, state: () => state, desktop, push, toast }
}

/** 自检那条事件：诊断 + 已批穿透，走真实声明与批准。 */
function selfTestRequest(namespace: 'test' | undefined, now: string): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.notification.self-test',
    actions: [],
    dedupeVars: { builder: 'template', vars: { date: now.slice(0, 10), seq: String(Date.parse(now)) } },
    occurredAt: now,
    ...(namespace === undefined ? {} : { namespace })
  }
}

describe('quiet hours: one decision, shared by the planner and the delivery router', () => {
  it('at night, a reader-initiated diagnostic that is approved for a bypass really tries the phone and the desktop', async () => {
    const { runtime, state, desktop, push } = harness({ now: NIGHT })
    const outcome = await runtime.submit(selfTestRequest('test', NIGHT))
    expect(outcome).toMatchObject({ kind: 'accepted', suppressedLevels: [] })
    // 两档都真的试了：钩子被调到，记录里各有一条真实结果。
    expect(desktop).toEqual(['desktop'])
    expect(push).toEqual(['push'])
    const record = state().records[0]
    expect(record.delivery.desktop.state).toBe('sent-accepted')
    expect(record.delivery.push.state).toBe('sent-accepted')
  })

  it('at the same moment without the test namespace, nothing transient is tried and the suppression is recorded', async () => {
    const { runtime, state, desktop, push, toast } = harness({ now: NIGHT })
    const outcome = await runtime.submit(selfTestRequest(undefined, NIGHT))
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    // 手机不投、桌面不弹（提示同理）：免打扰内只有中心。
    expect(push).toEqual([])
    expect(desktop).toEqual([])
    expect(toast).toEqual([])
    // 「没试」要有证据，且原因写明是免打扰。
    expect(outcome.suppressedLevels).toEqual(expect.arrayContaining([
      { level: 'desktop', reason: 'quiet-hours' },
      { level: 'push', reason: 'quiet-hours' }
    ]))
    expect(state().records[0].delivery.desktop).toBeUndefined()
    expect(state().records[0].delivery.push).toBeUndefined()
  })

  it('in the daytime the very same path behaves exactly as before', async () => {
    const { runtime, state, desktop, push } = harness({ now: DAY })
    const outcome = await runtime.submit(selfTestRequest('test', DAY))
    expect(outcome).toMatchObject({ kind: 'accepted', suppressedLevels: [] })
    expect(desktop).toEqual(['desktop'])
    expect(push).toEqual(['push'])
    expect(state().records[0].delivery.desktop.state).toBe('sent-accepted')
    expect(state().records[0].delivery.push.state).toBe('sent-accepted')
  })

  it('with the desktop switch off, the suppression names the switch and the receipt says "not tested"', async () => {
    const { runtime } = harness({ now: DAY, settings: settingsFor({ desktopEnabled: false }) })
    const outcome = await runtime.submit(selfTestRequest('test', DAY))
    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    expect(outcome.suppressedLevels).toEqual(expect.arrayContaining([
      { level: 'desktop', reason: 'desktop-disabled' }
    ]))
    // 回执：这一档根本没试过 → 说「没测」，不说「没到」。
    const surface = composeSelfTestSurface({
      resolvePushChannel: async () => ({ ok: true, channelId: 'channel-a', channelName: 'Telegram · test' }),
      submitRequest: (request) => runtime.submit(request),
      // 与上面那次提交错开一秒：自检每次点击都是新键，同键会被合并（那属于另一条用例）。
      now: () => '2026-11-08T04:00:01.000Z'
    })
    await expect(surface.sendTestNotice()).resolves.toEqual({ state: 'unavailable', reasonCode: 'suppressed' })
  })
})
