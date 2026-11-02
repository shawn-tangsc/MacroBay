import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings, NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

const policy: NotificationEventPolicy = {
  'platform.done': { approvedDisruptionLevels: ['center', 'desktop', 'channel'], approvedBypassQuietHours: false },
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
          id: 'platform.channel.push-suspended',
          titleKey: 'notification.event.platform.channel.push-suspended.title',
          bodyKey: 'notification.event.platform.channel.push-suspended.body',
          reasonKey: 'notification.event.platform.channel.push-suspended.reason',
          requiresUserAction: true,
          requestedDisruptionLevels: ['toast', 'desktop'],
          dedupeKeyTemplate: 'push-suspended:{channelId}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000,
          notifyOnlyIfSubscribed: false
        },
        {
          id: 'platform.channel.push-resumed',
          titleKey: 'notification.event.platform.channel.push-resumed.title',
          bodyKey: 'notification.event.platform.channel.push-resumed.body',
          reasonKey: 'notification.event.platform.channel.push-resumed.reason',
          requiresUserAction: false,
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'push-resumed:{channelId}:{day}',
          dedupeUnit: 'occurrence',
          notifyOnlyIfSubscribed: false
        },
        {
          id: 'platform.done',
          titleKey: 'notification.test.title',
          bodyKey: 'notification.test.body',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
          requestedDisruptionLevels: ['desktop', 'channel'],
          dedupeKeyTemplate: 'done:{date}',
          dedupeUnit: 'occurrence',
          notifyOnlyIfSubscribed: true
        }
      ]
    },
    {
      productId: 'other-product',
      events: [
        {
          id: 'other-product.thing',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'thing:{id}',
          dedupeUnit: 'occurrence',
          notifyOnlyIfSubscribed: false
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
} = {}) {
  let state: any = {
    records: [],
    dailyCounters: {},
    subscriptions: options.subscriptions ?? {},
    pushBackoff: {}
  }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) }
  }
  const updates: Partial<NotificationRuntimeSettings>[] = []
  const runtime = createNotificationRuntime({
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
  it('projects the catalog with notifyOnlyIfSubscribed', async () => {
    const { runtime } = createRuntime()
    const entries = await runtime.listEventCatalog()
    expect(entries.find((entry) => entry.id === 'platform.done')?.notifyOnlyIfSubscribed).toBe(true)
  })

  it('writes a subscription and derives record from a delivery column', async () => {
    const { runtime, state } = createRuntime()
    expect(await runtime.getSubscriptions()).toEqual({})
    await expect(runtime.setSubscription('platform.done', { record: true })).resolves.toMatchObject({
      ok: true,
      subscription: { record: true }
    })
    expect(state().subscriptions).toEqual({ 'platform.done': { record: true } })

    // 勾桌面 → 记录格视为已记录；取消桌面 → 回到显式值（没有隐藏 true）。
    await runtime.setSubscription('platform.done', { desktop: true })
    expect(state().subscriptions['platform.done']).toEqual({ record: true, desktop: true })
    await runtime.setSubscription('platform.done', { record: false, desktop: false })
    expect(state().subscriptions['platform.done']).toBeUndefined()
  })

  it('rejects an unregistered event and a product-writing another product row', async () => {
    const { runtime } = createRuntime()
    await expect(runtime.setSubscription('platform.nope', { desktop: true })).resolves.toEqual({
      ok: false,
      reasonCode: 'unknown-event-type'
    })
    await expect(
      runtime.setSubscription('platform.done', { desktop: true }, { productId: 'other-product' })
    ).resolves.toEqual({ ok: false, reasonCode: 'scope-mismatch' })
  })

  it('returns the current toast switch and the real push wiring, not a constant', async () => {
    const withoutPush = createRuntime()
    expect(await withoutPush.runtime.getDeliverySettings()).toEqual({
      toastEnabled: false,
      channelId: 'telegram',
      pushWired: false,
      channels: [],
      lastPushFailureAt: null
    })
    const withPush = createRuntime({ push: async () => ({ ok: true }) })
    expect((await withPush.runtime.getDeliverySettings()).pushWired).toBe(true)
  })

  it('writes the toast switch and the push channel through the injected settings port', async () => {
    const { runtime, updates } = createRuntime()
    await runtime.setToastEnabled(true)
    await runtime.setPushChannel('telegram')
    expect(updates).toEqual([{ toastEnabled: true }, { push: { channelId: 'telegram' } }])
  })

  it('pauses push after three consecutive failures and skips with push-backoff', async () => {
    let calls = 0
    const { runtime, state } = createRuntime({
      subscriptions: { 'platform.done': { channel: true } },
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
  })

  it('keeps subscriptions and records when they alternate twenty times', async () => {
    const { runtime, state } = createRuntime()
    for (let index = 0; index < 20; index += 1) {
      await runtime.setSubscription('platform.done', { desktop: index % 2 === 0 })
      await runtime.submit(request(`2026-11-${String(index + 1).padStart(2, '0')}`))
    }
    // 最后一次是关，行被删掉；再写一次仍能落到同一份 state，证明没有互相覆盖。
    expect(state().subscriptions['platform.done']).toBeUndefined()
    await runtime.setSubscription('platform.done', { desktop: true })
    expect(state().subscriptions['platform.done']).toEqual({ desktop: true })
    expect(state().records.length).toBeGreaterThan(0)
  })

  it('reads the current toast switch, not just a write port', async () => {
    const { runtime } = createRuntime({ settings: { toastEnabled: true } })
    expect((await runtime.getDeliverySettings()).toastEnabled).toBe(true)
  })

  it('does not count unknown-after-send as a failure and does not clear the backoff', async () => {
    const { runtime, state } = createRuntime({
      subscriptions: { 'platform.done': { channel: true } },
      push: async () => ({ ok: false, reason: 'unknown-after-send' })
    })
    for (const date of ['2026-11-01', '2026-11-02', '2026-11-03']) await runtime.submit(request(date))
    // 「拿不到确认」不是「失败」：不累计、不暂停。
    expect(state().pushBackoff.telegram).toBeUndefined()
    expect((await runtime.getDeliverySettings()).lastPushFailureAt).toBe('2026-11-03T00:00:00.000Z')
  })

  it('clears the backoff after a successful send', async () => {
    let calls = 0
    const { runtime, state } = createRuntime({
      subscriptions: { 'platform.done': { channel: true } },
      push: async () => {
        calls += 1
        return calls < 3 ? { ok: false, reason: 'channel-rejected' } : { ok: true, messageId: 'm-1' }
      }
    })
    for (const date of ['2026-11-01', '2026-11-02', '2026-11-03']) await runtime.submit(request(date))
    expect(state().pushBackoff.telegram).toMatchObject({ failures: 0, pausedUntil: null })
  })
})
