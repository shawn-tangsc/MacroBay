import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationDiagnosticsEntry, NotificationSubmitRequest } from '../contracts/notificationContracts'
import type { PushChannelResolution } from '../delivery/pushChannelResolution'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

/**
 * 推送失败**四种处境必须可分**（2026-11-08）。以前它们都长成读者侧一个 `push-unavailable`、
 * 日志里一行都不记：装配漏了钩子、漏了派生入口、一条通道都没配、配了但没有 `runtime-ready`。
 *
 * 读者可见的闭集不在这里扩张：这四个是**诊断码**，只进日志。
 */
const catalog = createNotificationEventCatalog({
  sources: [{
    productId: 'platform',
    events: [{
      id: 'platform.demo-push',
      titleKey: 'notification.event.platform.demo-push.title',
      reasonKey: 'notification.event.platform.demo-push.reason',
      bodyKey: 'notification.event.platform.demo-push.body',
      requiresUserAction: false,
      category: 'reminder',
      requestedDisruptionLevels: ['channel'],
      dedupeKeyTemplate: 'demo:{id}',
      dedupeUnit: 'occurrence'
    }],
    approval: { 'platform.demo-push': { approvedDisruptionLevels: ['center', 'channel'] as const, approvedBypassQuietHours: false } }
  }]
})

function request(): NotificationSubmitRequest {
  return { eventTypeId: 'platform.demo-push', actions: [], dedupeVars: { builder: 'template', vars: { id: 'one' } }, occurredAt: '2026-11-08T12:00:00.000Z' }
}

function harness(input: {
  resolution?: () => Promise<PushChannelResolution>
  withHook?: boolean
}) {
  const diagnostics: NotificationDiagnosticsEntry[] = []
  let state: any = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) }
  }
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: (entry) => diagnostics.push(entry),
    ...(input.resolution === undefined ? {} : { resolvePushChannel: input.resolution }),
    ...(input.withHook === false ? {} : { deliveryHooks: { push: async () => ({ ok: true, messageId: 'm-1' }) } }),
    getSettings: async () => createDefaultNotificationRuntimeSettings(),
    clock: { now: () => new Date('2026-11-08T12:00:00.000Z'), timeZone: () => 'Asia/Shanghai' },
    getLanguage: async () => 'zh-CN'
  })
  return { runtime, diagnostics }
}

describe('push diagnostics say which of the four situations it is', () => {
  it('names a missing resolver', async () => {
    const { runtime, diagnostics } = harness({})
    await runtime.submit(request())
    expect(diagnostics.map((entry) => entry.code)).toContain('push-resolver-missing')
  })

  it('names an empty channel list, separately from a channel that is merely not ready', async () => {
    const { runtime, diagnostics } = harness({
      resolution: async () => ({ ok: false, reason: 'push-unavailable', enabledChannelCount: 0, multiple: false, states: {} })
    })
    await runtime.submit(request())
    expect(diagnostics.map((entry) => entry.code)).toContain('push-target-none')
  })

  it('names a channel that exists but is not runtime-ready, with the state histogram', async () => {
    const { runtime, diagnostics } = harness({
      resolution: async () => ({
        ok: false,
        reason: 'push-unavailable',
        enabledChannelCount: 0,
        multiple: false,
        states: { 'credential-missing': 1, 'runtime-ready': 0 }
      })
    })
    await runtime.submit(request())
    const entry = diagnostics.find((candidate) => candidate.code === 'push-target-not-ready')
    expect(entry).toBeDefined()
    expect(entry?.count).toBe(0)
    // 只有状态词与条数，**不含通道名与凭据**。
    expect(entry?.states).toEqual({ 'credential-missing': 1, 'runtime-ready': 0 })
  })

  it('names a missing push hook (assembly forgot the outbound port)', async () => {
    const { runtime, diagnostics } = harness({
      withHook: false,
      resolution: async () => ({ ok: true, channelId: 'channel-a', channelName: 'Telegram · test' })
    })
    await runtime.submit(request())
    expect(diagnostics.map((entry) => entry.code)).toContain('push-hook-missing')
  })
})
