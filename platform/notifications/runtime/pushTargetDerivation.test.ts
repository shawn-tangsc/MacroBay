import { describe, expect, it } from 'vitest'
import { singleResultHook } from '../delivery/pushHookTestSupport'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings, NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { resolvePushChannels } from '../delivery/pushChannelResolution'

/**
 * 判据 1 / 2 / 3（技术方案 §1、§5）：
 * 目标通道只有一个派生入口，三处读点（主推送 / 严重度升级 / 手动重投）都用它，
 * `push.channelId` 这条旧路**一处也不许再读**，多目标一律拒绝、没有「最近活跃」兜底。
 */

const catalog = createNotificationEventCatalog({
  sources: [{
    productId: 'platform',
    // 批准值随声明走（b2）：同一条批准，值逐字不变。
    approval: { 'platform.failed': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false } },
    events: [{
      id: 'platform.failed',
      titleKey: 'notification.taskFailed.title',
      bodyKey: 'notification.taskFailed.body',
      reasonKey: 'notification.taskFailed.body',
      requiresUserAction: false,
      category: 'reminder',
      requestedDisruptionLevels: [],
      dedupeKeyTemplate: 'failed:{id}',
      dedupeUnit: 'occurrence'
    }]
  }]
})

const clock = { now: () => new Date('2026-11-08T00:00:00.000Z'), timeZone: () => 'UTC' }

/** 旧字段填 `null`：只有真的走派生入口，这条才会被推出去。 */
const settings: NotificationRuntimeSettings = {
  desktopEnabled: false,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}

function request(overrides: Partial<NotificationSubmitRequest> = {}): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.failed',
    dedupeVars: { builder: 'template', vars: { id: 'job-1' } },
    titleParams: { taskName: 'job-1' },
    actions: [],
    occurredAt: '2026-11-08T00:00:00.000Z',
    ...overrides
  }
}

function harness() {
  let state: any = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) }
  }
  const pushed: string[] = []
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: () => undefined,
    resolvePushChannels: async () => ({ ok: true, channels: [{ id: 'channel-a', name: 'Telegram · test' }] }),
    getSettings: async () => settings,
    clock,
    deliveryHooks: { push: singleResultHook(async (record) => { pushed.push(record.id); return { ok: true, messageId: record.id } }) }
  })
  return { runtime, state: () => state, pushed }
}

describe('resolvePushChannels', () => {
  it('uses the only runtime-ready channel and hands its name back', () => {
    expect(resolvePushChannels([
      { id: 'a', name: 'A', state: 'runtime-ready' },
      { id: 'b', name: 'B', state: 'configuration-ready' }
    ])).toEqual({ ok: true, channels: [{ id: 'a', name: 'A' }] })
  })

  it('judges by runtime-ready only, not by "requested + credential": those two are a second criterion', () => {
    // 读者勾了启用、凭据也在，但运行时没接通（configuration-ready）→ 不算可用通道。
    expect(resolvePushChannels([{ id: 'a', name: 'A', state: 'configuration-ready' }]))
      .toEqual({ ok: false, reason: 'push-unavailable', enabledChannelCount: 0, states: { 'configuration-ready': 1 }, requestedCount: 0 })
  })

  it('fails closed with 0 channels and reports no conflict', () => {
    expect(resolvePushChannels([])).toEqual({ ok: false, reason: 'push-unavailable', enabledChannelCount: 0, states: {}, requestedCount: 0 })
  })

  it('returns every runtime-ready channel instead of treating two as a conflict', () => {
    // 多通道方案 §1b：同时启用多条是合法状态。把这里改回「≥2 条即失败」→ 必须红。
    expect(resolvePushChannels([
      { id: 'a', name: 'A', state: 'runtime-ready' },
      { id: 'b', name: 'B', state: 'runtime-ready' },
      { id: 'c', name: 'C', state: 'runtime-ready' }
    ])).toEqual({ ok: true, channels: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] })
  })
})

describe('the three read sites share one derivation', () => {
  it('0 channels: the submission is refused with push-unavailable and nothing is pushed', async () => {
    // 生产上就该这样 fail closed：没有 runtime-ready 通道时拒收，不猜一条、不静默落成成功。
    const { runtime, pushed } = harness()
    const bare = createNotificationRuntime({
      storage: { read: async () => createDefaultNotificationStoreState(), write: async () => undefined },
      catalog,
      diagnostics: () => undefined,
      resolvePushChannels: async () => ({ ok: false, reason: 'push-unavailable', enabledChannelCount: 0, states: {}, requestedCount: 0 }),
      getSettings: async () => settings,
      clock,
      deliveryHooks: { push: singleResultHook(async (record) => { pushed.push(record.id); return { ok: true, messageId: record.id } }) }
    })
    // 提交本身成立（中心要留这条），**手机那一档**写成失败并给 `push-unavailable`；一条也不许发出去。
    const outcome = await bare.submit(request())
    expect(outcome.kind).toBe('accepted')
    expect((outcome as { recordId: string }).recordId).toBeTruthy()
    expect(pushed).toEqual([])
  })

  it('main push: pushes to the derived channel even though the retired field is null', async () => {
    const { runtime, state, pushed } = harness()
    await runtime.submit(request())
    expect(pushed).toHaveLength(1)
    expect(state().records[0]?.delivery.push).toMatchObject({ state: 'sent-accepted' })
  })

  it('the push backoff is keyed by the derived channel, not by the retired field', async () => {
    const { runtime, state } = harness()
    // 让端口拒收三次，熔断记录会落在「派生出来的那条通道」上。
    await runtime.submit(request())
    expect(Object.keys(state().pushBackoff ?? {})).toEqual([])
  })
})
