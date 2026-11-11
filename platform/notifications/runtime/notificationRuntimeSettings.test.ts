import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings, NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

const catalog = createNotificationEventCatalog({
  sources: [
    {
      productId: 'platform',
      // 批准值随声明走（b2）：值原样。
      approval: {
        'platform.done': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
        'platform.channel.push-suspended': { approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false },
        'platform.channel.push-resumed': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
      },
      events: [
        {
          id: 'platform.channel.push-suspended',
          titleKey: 'notification.event.platform.channel.push-suspended.title',
          bodyKey: 'notification.event.platform.channel.push-suspended.body',
          reasonKey: 'notification.event.platform.channel.push-suspended.reason',
          requiresUserAction: true,
    category: 'reminder',
          requestedDisruptionLevels: ['toast', 'desktop'],
          dedupeKeyTemplate: 'push-suspended:{channelId}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000,
        },
        {
          id: 'platform.channel.push-resumed',
          titleKey: 'notification.event.platform.channel.push-resumed.title',
          bodyKey: 'notification.event.platform.channel.push-resumed.body',
          reasonKey: 'notification.event.platform.channel.push-resumed.reason',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'push-resumed:{channelId}:{day}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.done',
          titleKey: 'notification.test.title',
          bodyKey: 'notification.test.body',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: ['desktop', 'channel'],
          dedupeKeyTemplate: 'done:{date}',
          dedupeUnit: 'occurrence',
        }
      ]
    },
    {
      // **合成夹具，与任何真实产品无关**：这个文件要两个不同 productId 的来源，才能测「跨产品」
      // 那条规则（同一 id 两个声明者、以及事件前缀归属）。改成平台前缀会把这个场景本身抹掉，
      // 所以名字保持非平台——它不是在冒充某个产品，它就是一个假产品。
      productId: 'other-product',
      events: [
        {
          id: 'other-product.thing',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'thing:{id}',
          dedupeUnit: 'occurrence',
        }
      ]
    }
  ]
})
const clock = { now: () => new Date('2026-11-03T00:00:00.000Z'), timeZone: () => 'UTC' }

function request(date: string): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.done',
    dedupeVars: { builder: 'template', vars: { date } },
    actions: [],
    occurredAt: '2026-11-03T00:00:00.000Z'
  }
}

function createRuntime(options: {
  subscriptions?: Record<string, unknown>
  settings?: Partial<NotificationRuntimeSettings>
  push?: (record: unknown, content: unknown) => Promise<{ ok: boolean; reason?: string; messageId?: string }>
  lastDelivery?: (channelId: string) => { status: 'delivered' | 'failed' | 'unknown-after-send'; at: string; conversationLabel: string | null } | null
} = {}) {
  let state: any = {
    records: [],
    dailyCounters: {},
    pushBackoff: {}
  }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) }
  }
  const updates: Partial<NotificationRuntimeSettings>[] = []
  // 目标通道由派生入口给出（技术方案 §1）：这个夹具要真的走到推送端口，所以给它一条 runtime-ready。
  const resolvePushChannel = async () => ({ ok: true as const, channelId: 'telegram', channelName: 'Telegram · test' })
  const runtime = createNotificationRuntime({
    resolvePushChannel,
    ...(options.lastDelivery === undefined ? {} : { lastDelivery: options.lastDelivery }),
    diagnostics: () => undefined,
    storage,
    catalog,
    getSettings: async () => ({
      desktopEnabled: true,
      toastEnabled: false,
      popupEnabled: false,
      push: { channelId: 'telegram' },
      retentionDays: 30,
      defaultSnoozeMinutes: 60,
      ...options.settings
    }),
    updateSettings: async (patch) => { updates.push(patch) },
    clock,
    deliveryHooks: options.push === undefined ? {} : { push: options.push }
  })
  return { runtime, state: () => state, updates }
}

describe('notification settings surface', () => {
  it('projects the catalog with the approved disruption levels', async () => {
    const { runtime } = createRuntime()
    const entries = await runtime.listEventCatalog()
    const entry = entries.find((candidate) => candidate.id === 'platform.done')
    // 订阅层撤销后，目录只剩「批准档位」这一份上限；不再有逐事件的订阅标记。
    expect(entry?.approvedDisruptionLevels).toContain('center')
    expect(entry).not.toHaveProperty('notifyOnlyIfSubscribed')
  })

  it('writes the three channel events and refuses an id that is not approved for the phone', async () => {
    const { runtime, updates } = createRuntime()
    expect(await runtime.getChannelEvents()).toEqual({})

    await expect(runtime.setChannelEvent('platform.done', false)).resolves.toEqual({
      eventId: 'platform.done',
      enabled: false
    })
    expect(updates.at(-1)).toMatchObject({ channelEvents: { 'platform.done': false } })

    // 未批准 channel 的 id：**抛错**，不静默忽略——静默会让调用方以为存上了。
    await expect(runtime.setChannelEvent('platform.nope', true)).rejects.toThrow(
      'notification-channel-event-not-allowed: platform.nope'
    )
  })

  it('reports the last real delivery, and says "no record" instead of "not ready" when there is none', async () => {
    const withRecord = createRuntime({
      lastDelivery: () => ({ status: 'delivered' as const, at: '2026-11-10T12:02:06.805Z', conversationLabel: 'Tang' })
    })
    expect((await withRecord.runtime.getDeliverySettings()).lastDelivery).toEqual({
      status: 'delivered',
      at: '2026-11-10T12:02:06.805Z',
      conversationLabel: 'Tang'
    })

    // 一次都没投过：null 就是 null，界面据此说「还没有记录」，不许说成「未就绪」。
    const never = createRuntime({ lastDelivery: () => null })
    expect((await never.runtime.getDeliverySettings()).lastDelivery).toBeNull()
  })

  it('reports the desktop switch and the real push wiring, not a constant', async () => {
    const withoutPush = createRuntime()
    expect(await withoutPush.runtime.getDeliverySettings()).toMatchObject({
      toastEnabled: false,
      desktopEnabled: true,
      pushWired: false,
      channels: []
    })
    const withPush = createRuntime({ push: async () => ({ ok: true }) })
    expect((await withPush.runtime.getDeliverySettings()).pushWired).toBe(true)
  })

  it('writes both switches through the injected settings port', async () => {
    const { runtime, updates } = createRuntime()
    await runtime.setToastEnabled(true)
    await runtime.setDesktopEnabled(true)
    expect(updates).toEqual([{ toastEnabled: true }, { desktopEnabled: true }])
  })

  it('pauses push after three consecutive failures and skips with push-backoff', async () => {
    let calls = 0
    const { runtime, state } = createRuntime({
      push: async () => {
        calls += 1
        return { ok: false, reason: 'channel-rejected' }
      }
    })

    for (const date of ['2026-11-01', '2026-11-02', '2026-11-03']) {
      await runtime.submit(request(date))
    }
    expect(calls).toBe(3)
    expect(state().pushBackoff.telegram).toMatchObject({ failures: 3 })
    expect(state().pushBackoff.telegram.pausedUntil).toBeTypeOf('string')

    await runtime.submit(request('2026-11-04'))
    expect(calls).toBe(3)
    const latest = state().records.find((record: any) => record.dedupeKey === 'platform|done:2026-11-04')
    expect(latest?.delivery.push).toMatchObject({ state: 'failed', reason: 'push-backoff' })
    // P6a：进入暂停时发一条平台事件，记录里有它。
    expect(
      state().records.some((record: any) => record.eventTypeId === 'platform.channel.push-suspended')
    ).toBe(true)
    expect((await runtime.getDeliverySettings()).lastPushFailureAt).toBe('2026-11-03T00:00:00.000Z')
    // 原因与时刻来自同一条记录：这条最近失败是 `push-backoff`，不是前面那次的 `channel-rejected`。
    expect((await runtime.getDeliverySettings()).lastPushFailureReason).toBe('push-backoff')
  })

  it('keeps the preferences and the records when they alternate twenty times', async () => {
    const { runtime, state, updates } = createRuntime()
    for (let index = 0; index < 20; index += 1) {
      await runtime.setChannelEvent('platform.done', index % 2 === 0)
      await runtime.submit(request(`2026-11-${String(index + 1).padStart(2, '0')}`))
    }
    // 偏好与记录走两个入口、同一份 state：二十轮交替之后，最后一次写的是关，记录也都在。
    expect(updates.at(-1)).toMatchObject({ channelEvents: { 'platform.done': false } })
    await runtime.setChannelEvent('platform.done', true)
    expect(updates.at(-1)).toMatchObject({ channelEvents: { 'platform.done': true } })
    expect(state().records.length).toBeGreaterThan(0)
  })

  it('reads the current toast switch, not just a write port', async () => {
    const { runtime } = createRuntime({ settings: { toastEnabled: true } })
    expect((await runtime.getDeliverySettings()).toastEnabled).toBe(true)
  })

  it('does not count unknown-after-send as a failure anywhere: no backoff, no "last failure"', async () => {
    const { runtime, state } = createRuntime({
      push: async () => ({ ok: false, reason: 'unknown-after-send' })
    })
    for (const date of ['2026-11-01', '2026-11-02', '2026-11-03']) await runtime.submit(request(date))
    // 「拿不到确认」不是「失败」：不累计、不暂停、也不算「最近一次失败」。
    // 以前它在新提交路径被写成 `failed`（那一刻它就出现在「最近一次失败」里），
    // 与重投路径的 `sent-unconfirmed` 是同一件事的两种说法。
    expect(state().pushBackoff.telegram).toBeUndefined()
    expect((await runtime.getDeliverySettings()).lastPushFailureAt).toBeNull()
    expect(state().records.every((record: { delivery?: { push?: { state?: string } } }) => record.delivery?.push?.state !== 'failed')).toBe(true)
  })

  it('clears the backoff after a successful send', async () => {
    let calls = 0
    const { runtime, state } = createRuntime({
      push: async () => {
        calls += 1
        return calls < 3 ? { ok: false, reason: 'channel-rejected' } : { ok: true, messageId: 'm-1' }
      }
    })
    for (const date of ['2026-11-01', '2026-11-02', '2026-11-03']) await runtime.submit(request(date))
    expect(state().pushBackoff.telegram).toMatchObject({ failures: 0, pausedUntil: null })
  })
})
