import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { notificationDedupeBuilders } from '@platform/notifications/contracts/notificationDedupeKeys'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import {
  createSourceIssueNotifier,
  decideSourceIssue,
  SOURCE_ISSUE_FAILURE_THRESHOLD
} from './sourceIssueNotifier'

const HOUR = 60 * 60 * 1000
const NOW = '2026-11-03T00:00:00.000Z'
const SOURCE_ID = 'fred-rates'

const settings: NotificationRuntimeSettings = {
  desktopEnabled: true,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}

function createRuntime(
  extra: { producerOwnership?: Record<string, { productId: string }>; productIds?: readonly string[] } = {}
) {
  let state: unknown = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => {
      state = JSON.parse(JSON.stringify(next))
    }
  }
  const diagnostics: string[] = []
  const runtime = createNotificationRuntime({
    storage,
    catalog: createNotificationEventCatalog({
      policy: NOTIFICATION_EVENT_POLICY,
      sources: [
        { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS },
        { productId: 'market-intelligence', events: marketIntelligenceProductManifest.notificationEvents }
      ]
    }),
    diagnostics: (entry) => diagnostics.push(entry.code),
    getSettings: async () => settings,
    clock: { now: () => new Date(NOW), timeZone: () => 'UTC' },
    ...(extra.producerOwnership === undefined ? {} : { producerOwnership: extra.producerOwnership }),
    ...(extra.productIds === undefined ? {} : { productIds: extra.productIds })
  })
  return { runtime, records: () => (state as { records: Array<Record<string, unknown>> }).records, diagnostics }
}

const snapshot = (overrides: Partial<Parameters<typeof decideSourceIssue>[0]> = {}) => ({
  sourceId: SOURCE_ID,
  consecutiveFailures: 0,
  lastSuccessAt: NOW,
  now: NOW,
  ...overrides
})

describe('source issue decision', () => {
  it('stays silent below three consecutive failures', () => {
    expect(decideSourceIssue(snapshot({ consecutiveFailures: 1 }), 6 * HOUR)).toBeNull()
    expect(decideSourceIssue(snapshot({ consecutiveFailures: 2 }), 6 * HOUR)).toBeNull()
  })

  it('reports consecutive failure at the declared threshold', () => {
    expect(SOURCE_ISSUE_FAILURE_THRESHOLD).toBe(3)
    expect(decideSourceIssue(snapshot({ consecutiveFailures: 3 }), 6 * HOUR)).toBe('consecutive-failed')
  })

  it('reports stale data once the source freshness window has passed', () => {
    const old = new Date(Date.parse(NOW) - 7 * HOUR).toISOString()
    expect(decideSourceIssue(snapshot({ lastSuccessAt: old }), 6 * HOUR)).toBe('stale')
    const fresh = new Date(Date.parse(NOW) - 5 * HOUR).toISOString()
    expect(decideSourceIssue(snapshot({ lastSuccessAt: fresh }), 6 * HOUR)).toBeNull()
  })

  it('calls a source stale when collection keeps succeeding but brings nothing new', () => {
    // 2026-11-07 的真实形状：coindesk-rss 每 15 分钟都 `completed`、`lastSuccessAt` 永远是刚才，
    // 但最新条目停在 17 小时前。按 lastSuccessAt 判永远不会 stale —— 用户看到的是「今天没新闻」。
    const oldItem = new Date(Date.parse(NOW) - 17 * HOUR).toISOString()
    expect(decideSourceIssue(snapshot({ lastSuccessAt: NOW, lastNewItemAt: oldItem }), 6 * HOUR)).toBe('stale')
  })

  it('stays silent while new items keep arriving, even if a fetch failed in between', () => {
    const recent = new Date(Date.parse(NOW) - 1 * HOUR).toISOString()
    expect(decideSourceIssue(snapshot({ lastSuccessAt: NOW, lastNewItemAt: recent }), 6 * HOUR)).toBeNull()
  })

  it('does not call a never-collected source stale: that is “waiting for first collection”', () => {
    expect(decideSourceIssue({ sourceId: SOURCE_ID, consecutiveFailures: 0, now: NOW }, 6 * HOUR)).toBeNull()
  })

  it('prefers the concrete failure over “no new data” when both are true', () => {
    const old = new Date(Date.parse(NOW) - 48 * HOUR).toISOString()
    expect(decideSourceIssue(snapshot({ consecutiveFailures: 3, lastSuccessAt: old }), 6 * HOUR)).toBe(
      'consecutive-failed'
    )
  })
})

describe('source issue submission', () => {
  it('sends the platform-owned dedupe inputs, never a hand-built key', async () => {
    const seen: Array<Record<string, unknown>> = []
    const notify = createSourceIssueNotifier({
      submit: async (request) => {
        seen.push(request as unknown as Record<string, unknown>)
        return { kind: 'accepted', recordId: 'r1', levels: ['center', 'desktop'] }
      },
      defaultFreshnessMs: 6 * HOUR
    })

    await notify(snapshot({ consecutiveFailures: 3 }))
    await notify(snapshot({ lastSuccessAt: new Date(Date.parse(NOW) - 7 * HOUR).toISOString() }))

    expect(seen.map((request) => request.eventTypeId)).toEqual([
      'market-intelligence.source.consecutive-failed',
      'market-intelligence.source.stale'
    ])
    for (const request of seen) {
      expect(request.dedupeVars).toEqual({ builder: 'sourceIssue', sourceId: SOURCE_ID })
      expect(request).not.toHaveProperty('dedupeKey')
      expect(request.producerId).toBe('market-intelligence.collectSource')
      expect((request.actions as unknown[]).length).toBeGreaterThan(0)
      expect(request.occurredAt).toBe(NOW)
    }
  })

  it('does not submit anything when nothing is due', async () => {
    let calls = 0
    const notify = createSourceIssueNotifier({
      submit: async () => {
        calls += 1
        return { kind: 'accepted', recordId: 'r1', levels: ['center'] }
      },
      defaultFreshnessMs: 6 * HOUR
    })
    await expect(notify(snapshot({ consecutiveFailures: 1 }))).resolves.toBeNull()
    expect(calls).toBe(0)
  })

  it('N8: equivalent spellings of one source yield one key, and that key is the platform builder’s', () => {
    const plain = notificationDedupeBuilders.sourceIssue({ sourceId: SOURCE_ID })
    const padded = notificationDedupeBuilders.sourceIssue({ sourceId: ` ${SOURCE_ID} ` })
    expect(plain).toBeDefined()
    expect(padded).toBe(plain)
    // 大小写不同不是“等价写法”，是脏输入：构造不出键，平台据此拒收，不许悄悄归一。
    expect(notificationDedupeBuilders.sourceIssue({ sourceId: 'FRED-Rates' })).toBeUndefined()
  })

  it('still records the product’s own notice when the handler is claimed for delegation', async () => {
    // 让渡只吞平台事件（platform.*）：claim 了 collectSource 之后，来源两条自有事件必须照落库，
    // 否则一次坏源会变成「平台不发 + 产品也不发」，读者什么都收不到。
    const { runtime, records } = createRuntime({
      producerOwnership: { 'market-intelligence.collectSource': { productId: 'market-intelligence' } },
      productIds: ['market-intelligence']
    })
    const notify = createSourceIssueNotifier({ submit: runtime.submit, defaultFreshnessMs: 6 * HOUR })

    await expect(notify(snapshot({ consecutiveFailures: 3 }))).resolves.toMatchObject({ kind: 'accepted' })
    expect(records()).toHaveLength(1)

    // 同一个 producerId 上的平台事件仍被让渡——这一格由平台不落库来证明。
    const delegated = await runtime.submit({
      eventTypeId: 'platform.job.failed-terminal',
      producerId: 'market-intelligence.collectSource',
      dedupeVars: { builder: 'template', vars: { definitionId: 'job-1', date: '2026-11-03' } },
      actions: [],
      occurredAt: NOW
    })
    expect(delegated).toMatchObject({ kind: 'delegated' })
    expect(records()).toHaveLength(1)
  })

  it('N6: failure then stale on one source folds into one centre row inside the 24h window', async () => {
    const { runtime, records } = createRuntime()
    const notify = createSourceIssueNotifier({ submit: runtime.submit, defaultFreshnessMs: 6 * HOUR })

    const first = await notify(snapshot({ consecutiveFailures: 3 }))
    const second = await notify(
      snapshot({
        consecutiveFailures: 0,
        lastSuccessAt: new Date(Date.parse(NOW) - 30 * HOUR).toISOString(),
        now: '2026-11-03T01:00:00.000Z'
      })
    )
    const third = await notify(
      snapshot({ consecutiveFailures: 4, now: '2026-11-03T02:00:00.000Z' })
    )

    expect(first).toMatchObject({ kind: 'accepted' })
    expect(second).toMatchObject({ kind: 'merged' })
    expect(third).toMatchObject({ kind: 'merged' })
    const rows = records()
    expect(rows).toHaveLength(1)
    // 跨类型合并只补 mergedEventTypes、不加次数（契约 §16.2）；同类型再提交才累加（§16.2.1）。
    expect(rows[0]).toMatchObject({
      eventTypeId: 'market-intelligence.source.consecutive-failed',
      occurrenceCount: 2,
      mergedEventTypes: [
        'market-intelligence.source.consecutive-failed',
        'market-intelligence.source.stale'
      ]
    })
    // 键里带 productId 是平台补的（契约 §7.1），产品只给 builder 参数。
    expect(rows[0].dedupeKey).toBe(
      `market-intelligence|${notificationDedupeBuilders.sourceIssue({ sourceId: SOURCE_ID })}`
    )
  })
})
