import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings, NotificationSubmitRequest } from '../contracts/notificationContracts'
import { PLATFORM_NOTIFICATION_EVENTS } from '../contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'


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
    eventTypeId: 'platform.narrow.probe',
    dedupeVars: { builder: 'template', vars: { date: '2026-11-08' } },
    actions: [],
    occurredAt: '2026-11-08T00:00:00.000Z',
    ...overrides
  }
}

function harnessWith(catalogOverride?: ReturnType<typeof createNotificationEventCatalog>) {
  let state: any = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = { read: async () => JSON.parse(JSON.stringify(state)), write: async (next) => { state = JSON.parse(JSON.stringify(next)) } }
  const runtime = createNotificationRuntime({
    storage,
    catalog: catalogOverride ?? createNotificationEventCatalog({
      // **合成声明 + 合成批准**：收窄是通用机制，不拿真实事件的档位当夹具（真实档位会变）。
      sources: [{
        productId: 'platform',
        events: [{
          id: 'platform.narrow.probe', titleKey: 'notification.test.title', bodyKey: 'notification.test.body',
          reasonKey: 'notification.test.body', requiresUserAction: false, category: 'reminder',
          requestedDisruptionLevels: ['channel'], dedupeKeyTemplate: 'probe:{date}', dedupeUnit: 'occurrence'
        }],
        approval: { 'platform.narrow.probe': { approvedDisruptionLevels: ['center', 'toast', 'desktop', 'channel'], approvedBypassQuietHours: false } }
      }]
    }),
    diagnostics: () => undefined,
    resolvePushChannel: async () => ({ ok: true, channelId: 'telegram', channelName: 'Telegram · test' }),
    getSettings: async () => settings,
    clock,
    deliveryHooks: { push: async (record) => ({ ok: true, messageId: record.id }) }
  })
  return { runtime, state: () => state }
}

function harness() { return harnessWith() }

function harnessWithDiagnostics() {
  const catalogOverride = undefined
  let state: any = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const entries: { code: string; eventTypeId?: string }[] = []
  const runtime = createNotificationRuntime({
    storage: { read: async () => JSON.parse(JSON.stringify(state)), write: async (next) => { state = JSON.parse(JSON.stringify(next)) } },
    catalog: catalogOverride ?? createNotificationEventCatalog({
      // **合成声明 + 合成批准**：收窄是通用机制，不拿真实事件的档位当夹具（真实档位会变）。
      sources: [{
        productId: 'platform',
        events: [{
          id: 'platform.narrow.probe', titleKey: 'notification.test.title', bodyKey: 'notification.test.body',
          reasonKey: 'notification.test.body', requiresUserAction: false, category: 'reminder',
          requestedDisruptionLevels: ['channel'], dedupeKeyTemplate: 'probe:{date}', dedupeUnit: 'occurrence'
        }],
        approval: { 'platform.narrow.probe': { approvedDisruptionLevels: ['center', 'toast', 'desktop', 'channel'], approvedBypassQuietHours: false } }
      }]
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
    // 真实事件的档位以后还会变，所以这里**自己造一份合成声明**：只批 center，收窄到 desktop 必须被拒。
    const synthetic = createNotificationEventCatalog({
      policy: { 'platform.narrow.synthetic': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false } },
      sources: [{
        productId: 'platform',
        events: [{
          id: 'platform.narrow.synthetic', titleKey: 'notification.test.title', bodyKey: 'notification.test.body',
          reasonKey: 'notification.test.body', requiresUserAction: false, category: 'reminder',
          requestedDisruptionLevels: [], dedupeKeyTemplate: 'synthetic:{date}', dedupeUnit: 'occurrence'
        }]
      }]
    })
    const { runtime, state } = harnessWith(synthetic)
    await expect(runtime.submit(request({ eventTypeId: 'platform.narrow.synthetic', dedupeVars: { builder: 'template', vars: { date: '2026-11-08' } }, narrowedDisruptionLevels: ['center', 'desktop'] }))).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'surface-not-approved'
    })
    expect(state().records).toHaveLength(0)
  })

  it('absent means exactly today: the approved levels go out unchanged', async () => {
    const { runtime, state } = harness()
    await runtime.submit(request())
    // 断事实：合成载体四档全批，桌面优先互斥后应用内是 center+desktop，手机那一档体现在 `delivery.push` 上。
    // 不传收窄时，批准表里的每一档都照原样排上（这条不变量与换夹具之前**同一力度**）。
    expect(new Set(state().records[0].channels)).toEqual(new Set(['center', 'desktop']))
    expect(state().records[0].delivery.push).toMatchObject({ state: expect.any(String) })
  })
})
