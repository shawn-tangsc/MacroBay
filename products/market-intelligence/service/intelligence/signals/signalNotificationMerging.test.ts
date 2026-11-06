import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { moduleSignalPolicy, type ModuleSignal } from '../../../contracts/moduleSignal'
import { buildOpenInterestSignalRequest } from './openInterestSignalNotifier'

/**
 * 合并的**结果**，不是参数：同一规则、时间不同 → 一条记录；窗口外 → 新开一行。
 *
 * 这里跑真实 runtime（真目录、真批准表、内存存储、可推进的时钟），因为「窗口」是平台按记录
 * 时间判的——只断言 `dedupeVars` 相等证明不了读者最后看到几条。
 */
const settings: NotificationRuntimeSettings = {
  desktopEnabled: false,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}

function createRuntime(clock: { now: string }) {
  let state: unknown = { records: [], dailyCounters: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => {
      state = JSON.parse(JSON.stringify(next))
    }
  }
  const runtime = createNotificationRuntime({
    storage,
    catalog: createNotificationEventCatalog({
      policy: NOTIFICATION_EVENT_POLICY,
      sources: [
        { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS },
        { productId: 'market-intelligence', events: marketIntelligenceProductManifest.notificationEvents }
      ]
    }),
    getSettings: async () => settings,
    clock: { now: () => new Date(clock.now), timeZone: () => 'Asia/Shanghai' }
  })
  return { runtime, records: () => (state as { records: Array<Record<string, unknown>> }).records }
}

function signal(overrides: Partial<ModuleSignal> = {}): ModuleSignal {
  return {
    version: moduleSignalPolicy.version,
    moduleId: 'open-interest',
    ruleId: 'oi-liquidation-proxy',
    asset: 'btc',
    severity: 'medium',
    observedAt: '2026-11-03T10:15:00.000Z',
    cadence: Object.freeze({ kind: 'intraday' as const, bucketMs: 15 * 60_000 }),
    values: { dropPct: -2.3, volumeMultiple: 3.1, notionalUsd: 850_000_000 },
    dedupeKey: 'module-signal:OI:oi-liquidation-proxy:BTC',
    readiness: 'available',
    triggerOwner: 'module-signal',
    ...overrides
  }
}

describe('signal notification merging', () => {
  it('merges two readings of the same rule at different instants into one record', async () => {
    const clock = { now: '2026-11-03T10:20:00.000Z' }
    const { runtime, records } = createRuntime(clock)

    const first = buildOpenInterestSignalRequest(signal())!
    await runtime.submit({ ...first, occurredAt: '2026-11-03T10:15:00.000Z' })
    clock.now = '2026-11-03T10:40:00.000Z'
    const second = buildOpenInterestSignalRequest(signal({ observedAt: '2026-11-03T10:40:00.000Z' }))!
    await runtime.submit({ ...second, occurredAt: '2026-11-03T10:40:00.000Z' })

    // 旧实现下这两次提交是两个 15 分钟桶 → 两条记录，正是用户收到四条重复消息的根因。
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({ occurrenceCount: 2 })
    // 键里没有时间戳：同一规则怎么变都落在同一条记录上。
    expect(String(records()[0].dedupeKey)).toBe('market-intelligence|module-signal:OI:oi-liquidation-proxy:BTC')
  })

  it('never sends the retired time-bucketed shape: the platform would reject it', () => {
    const intraday = buildOpenInterestSignalRequest(signal())!
    expect('observedAt' in intraday.dedupeVars).toBe(false)
    expect('bucketMs' in intraday.dedupeVars).toBe(false)
  })
})
