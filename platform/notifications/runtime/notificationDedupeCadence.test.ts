/**
 * 键的 cadence 分工（契约 v2.43 §7.4）：日内键不带时间、交易日键带交易日。
 *
 * 判据都是机械的：
 * - 同一规则两次提交、时刻不同 → **键相同**（旧实现把 15 分钟桶折进键，于是两次推送）；
 * - 跨交易日的两次提交 → 键不同；
 * - 日内键还带 `observedAt` / `bucketMs`（旧形状）→ **拒收并给具名原因**，不静默忽略；
 * - 键相同不等于永远合并：**窗口外必须开新行**，否则第二天的新读数会并进昨天的记录。
 */
import { describe, expect, it } from 'vitest'

import {
  createDefaultNotificationRuntimeSettings,
  type NotificationSubmitRequest
} from '../contracts/notificationContracts'
import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { createNotificationRuntime } from './notificationRuntime'

/** 可拨的「现在」：跨窗口要真的把时钟往前拨，不能靠改请求假装。 */
function clockAt(iso: string) {
  return { now: () => new Date(iso), timeZone: () => 'UTC' }
}

const catalog = createNotificationEventCatalog({
  policy: {
    'platform.signal': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
    'platform.etf': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
  },
  sources: [
    {
      productId: 'platform',
      events: [
        {
          id: 'platform.signal',
          titleKey: 'notification.taskFailed.title',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
          category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyBuilder: 'moduleSignal',
          dedupeUnit: 'condition',
          // 两小时的滚动窗口：窗口由它判，不由键判。
          conditionWindowMs: 2 * 3_600_000
        },
        {
          id: 'platform.etf',
          titleKey: 'notification.taskFailed.title',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
          category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyBuilder: 'moduleSignal',
          dedupeUnit: 'occurrence'
        }
      ]
    }
  ]
})

function runtimeAt(iso: string) {
  const state = createDefaultNotificationStoreState()
  const runtime = createNotificationRuntime({
    storage: {
      read: async () => JSON.parse(JSON.stringify(state)),
      write: async (next) => { Object.assign(state, next) }
    },
    catalog,
    getSettings: async () => createDefaultNotificationRuntimeSettings(),
    clock: clockAt(iso),
    getLanguage: async () => 'zh-CN'
  })
  return { runtime, records: () => state.records }
}

const intraday = (occurredAt: string): NotificationSubmitRequest => ({
  eventTypeId: 'platform.signal',
  producerId: 'platform',
  dedupeVars: { builder: 'moduleSignal', moduleId: 'OI', ruleId: 'oi-drop', asset: 'BTC', cadence: 'intraday' },
  titleParams: { taskName: 'BTC' },
  actions: [],
  occurredAt
})

describe('日内键不带时间', () => {
  it('同一规则两次提交、时刻不同 → 合并进同一条记录', async () => {
    const { runtime, records } = runtimeAt('2026-11-06T09:00:00.000Z')
    await runtime.submit(intraday('2026-11-06T09:00:00.000Z'))
    await runtime.submit(intraday('2026-11-06T09:40:00.000Z'))

    expect(records()).toHaveLength(1)
    expect(records()[0]?.occurrenceCount).toBe(2)
    expect(records()[0]?.dedupeKey).toBe('platform|module-signal:OI:oi-drop:BTC')
  })

  it('窗口外必须开新行：第二天的新读数不许并进昨天那条', async () => {
    const { runtime, records } = runtimeAt('2026-11-06T09:00:00.000Z')
    await runtime.submit(intraday('2026-11-06T09:00:00.000Z'))

    // 同一个键、但已经过去一天：窗口（2 小时）外 → 新行。
    const next = runtimeAt('2026-11-07T09:00:00.000Z')
    await next.runtime.submit(intraday('2026-11-07T09:00:00.000Z'))

    expect(next.records()).toHaveLength(1)
    expect(next.records()[0]?.occurrenceCount).toBe(1)
    expect(records()).toHaveLength(1)
  })

  it('旧形状（日内带 observedAt / bucketMs）被拒，原因具名', async () => {
    const { runtime, records } = runtimeAt('2026-11-06T09:00:00.000Z')
    const outcome = await runtime.submit({
      ...intraday('2026-11-06T09:00:00.000Z'),
      dedupeVars: {
        builder: 'moduleSignal',
        moduleId: 'OI',
        ruleId: 'oi-drop',
        asset: 'BTC',
        cadence: 'intraday',
        observedAt: '2026-11-06T09:00:00.000Z',
        bucketMs: 900_000
      } as never
    })

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'stale-signal-dedupe-vars' })
    expect(records()).toHaveLength(0)
  })
})

describe('交易日键带交易日', () => {
  it('同一交易日两次 → 合并；跨交易日 → 两条', async () => {
    const { runtime, records } = runtimeAt('2026-11-06T09:00:00.000Z')
    const trading = (occurredAt: string): NotificationSubmitRequest => ({
      eventTypeId: 'platform.etf',
      producerId: 'platform',
      dedupeVars: {
        builder: 'moduleSignal',
        moduleId: 'ETF',
        ruleId: 'etf-outflow',
        asset: 'market',
        observedAt: occurredAt,
        cadence: 'trading-day'
      },
      titleParams: { taskName: 'BTC' },
      actions: [],
      occurredAt
    })

    await runtime.submit(trading('2026-11-06T09:00:00.000Z'))
    await runtime.submit(trading('2026-11-06T15:00:00.000Z'))
    expect(records()).toHaveLength(1)
    // `occurrence` 的合并**不累加次数**（那是 `condition` 的语义）：一天一条，第二次只是同一条。
    expect(records()[0]?.occurrenceCount).toBe(1)

    await runtime.submit(trading('2026-11-09T09:00:00.000Z'))
    expect(records()).toHaveLength(2)
  })
})
