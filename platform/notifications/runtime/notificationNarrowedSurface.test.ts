import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from '../contracts/notificationEventPolicy'
import type { NotificationRuntimeSettings, NotificationSubmitRequest } from '../contracts/notificationContracts'
import { PLATFORM_NOTIFICATION_EVENTS } from '../contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'
import { marketIntelligenceProductManifest } from '@products/market-intelligence/product.manifest'

/**
 * `narrowedDisruptionLevels` 的四条语义（架构师 a 方案）：只能收窄、`center` 不可排除、
 * 合并不许升级、缺省同今天。事件用 `analysis.conclusion` 本身——它是这次要补通的那条。
 */
const settings: NotificationRuntimeSettings = {
  desktopEnabled: true,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}
const clock = { now: () => new Date('2026-11-08T00:00:00.000Z'), timeZone: () => 'UTC' }

function request(overrides: Partial<NotificationSubmitRequest> = {}): NotificationSubmitRequest {
  return {
    eventTypeId: 'market-intelligence.analysis.conclusion',
    dedupeVars: { builder: 'template', vars: { triggerKey: 'k1', cutoff: '2026-11-08T00:00:00.000Z' } },
    actions: [],
    occurredAt: '2026-11-08T00:00:00.000Z',
    ...overrides
  }
}

function harness() {
  let state: any = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = { read: async () => JSON.parse(JSON.stringify(state)), write: async (next) => { state = JSON.parse(JSON.stringify(next)) } }
  const runtime = createNotificationRuntime({
    storage,
    catalog: createNotificationEventCatalog({
      policy: NOTIFICATION_EVENT_POLICY,
      sources: [
        { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS },
        { productId: 'market-intelligence', events: marketIntelligenceProductManifest.notificationEvents }
      ]
    }),
    diagnostics: () => undefined,
    resolvePushChannel: async () => ({ ok: true, channelId: 'telegram', channelName: 'Telegram · test' }),
    getSettings: async () => settings,
    clock,
    deliveryHooks: { push: async (record) => ({ ok: true, messageId: record.id }) }
  })
  return { runtime, state: () => state }
}

function harnessWithDiagnostics() {
  let state: any = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const entries: { code: string; eventTypeId?: string }[] = []
  const runtime = createNotificationRuntime({
    storage: { read: async () => JSON.parse(JSON.stringify(state)), write: async (next) => { state = JSON.parse(JSON.stringify(next)) } },
    catalog: createNotificationEventCatalog({
      policy: NOTIFICATION_EVENT_POLICY,
      sources: [
        { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS },
        { productId: 'market-intelligence', events: marketIntelligenceProductManifest.notificationEvents }
      ]
    }),
    diagnostics: (entry) => entries.push(entry),
    resolvePushChannel: async () => ({ ok: true, channelId: 'telegram', channelName: 'Telegram · test' }),
    getSettings: async () => settings,
    clock,
    deliveryHooks: { push: async (record) => ({ ok: true, messageId: record.id }) }
  })
  return { runtime, state: () => state, entries }
}

describe('narrowedDisruptionLevels', () => {
  it('keeps the first narrowing and logs exactly one diagnostic when a later submission is wider', async () => {
    const { runtime, state, entries } = harnessWithDiagnostics()
    await runtime.submit(request({ narrowedDisruptionLevels: ['center'] }))
    // 同一键第二次提交不传收窄（＝按批准全档）：合并**不升级**，仍按第一次只进中心。
    await runtime.submit(request())
    expect(state().records).toHaveLength(1)
    expect(state().records[0].appliedLevels).toEqual(['center'])
    expect(entries.filter((entry) => entry.code === 'narrowing-widened')).toHaveLength(1)
  })

  it('narrows to the centre only, and the phone leg is not even planned', async () => {
    const { runtime, state } = harness()
    await runtime.submit(request({ narrowedDisruptionLevels: ['center'] }))
    expect(state().records[0].channels).toEqual(['center'])
    expect(state().records[0].delivery.push).toBeUndefined()
  })

  it('cannot exclude the centre: asking for channel alone still keeps it', async () => {
    const { runtime, state } = harness()
    await runtime.submit(request({ narrowedDisruptionLevels: ['channel'] }))
    expect(state().records[0].channels).toContain('center')
  })

  it('refuses a narrowed level the approval table never approved, instead of silently intersecting', async () => {
    const { runtime, state } = harness()
    // 这条事件只批了 center + channel；要桌面就是生产者写错了——**拒收**，不静默求交。
    await expect(runtime.submit(request({ narrowedDisruptionLevels: ['center', 'desktop'] }))).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'surface-not-approved'
    })
    expect(state().records).toHaveLength(0)
  })

  it('absent means exactly today: the approved levels go out unchanged', async () => {
    const { runtime, state } = harness()
    await runtime.submit(request())
    // `channels` 只装应用内表面（中心/提示/桌面）；手机那一档体现在 `delivery.push` 上。
    expect(state().records[0].channels).toEqual(['center'])
    expect(state().records[0].delivery.push).toMatchObject({ state: expect.any(String) })
  })
})
