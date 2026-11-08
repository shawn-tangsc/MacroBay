import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { notificationDedupeBuilders } from '@platform/notifications/contracts/notificationDedupeKeys'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import {
  createSourceIssueNotifier,
  decideSourceIssue,
  NEWS_SILENCE_MS,
  resolveSilenceWindow,
  silenceWindowFor,
  SOURCE_ISSUE_FAILURE_THRESHOLD,
  WEEKDAY_SILENCE_MS
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
      // 断的是产品事件（来源状态）的批准值 -> 读产品自己那份；平台读平台自己的。
      sources: [
        { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
        { productId: 'market-intelligence', events: marketIntelligenceProductManifest.notificationEvents, approval: marketIntelligenceProductManifest.notificationApproval }
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

  /**
   * BLS 官方日历已被判定为「取不到」（403，自动同步停止）：它既不是「连续失败」（没有可重试的
   * 作业在跑），也不是「这段时间没新数据」（事务本身存在，只是拿不到）。每天再报一条「陈旧」，
   * 等于把停任务的收益还回去。
   */
  it('never calls a source that is declared unavailable stale or failing', () => {
    const veryOld = new Date(Date.parse(NOW) - 400 * HOUR).toISOString()
    expect(decideSourceIssue({ sourceId: 'macro-calendar-bls', consecutiveFailures: 9, lastSuccessAt: veryOld, now: NOW }, 6 * HOUR)).toBeNull()
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

  it('gives a news source 24 hours of silence before calling it stale', () => {
    // 新闻源 15 分钟一轮：24 小时 = 96 轮全部抓到但 0 条新增，不可能用「今天没新闻」解释。
    expect(NEWS_SILENCE_MS).toBe(96 * 15 * 60 * 1000)
    expect(silenceWindowFor('coindesk-rss', NOW, 'UTC')).toBe(NEWS_SILENCE_MS)
    expect(silenceWindowFor('fred-rates-liquidity', NOW, 'UTC')).toBe(WEEKDAY_SILENCE_MS)
    const window = silenceWindowFor('coindesk-rss', NOW, 'UTC')

    // 工作日 12 小时那档不适用于新闻源：13 小时安静还算正常。
    const thirteen = new Date(Date.parse(NOW) - 13 * HOUR).toISOString()
    expect(decideSourceIssue({ sourceId: 'coindesk-rss', consecutiveFailures: 0, lastSuccessAt: NOW, lastNewItemAt: thirteen, now: NOW }, window)).toBeNull()
    // 越过 24 小时才报，且报的是「静默」，不是失败。
    const twentyFive = new Date(Date.parse(NOW) - 25 * HOUR).toISOString()
    expect(decideSourceIssue({ sourceId: 'coindesk-rss', consecutiveFailures: 0, lastSuccessAt: NOW, lastNewItemAt: twentyFive, now: NOW }, window)).toBe('stale')
  })

  it('gives the weekend a longer window: 20 hours of silence on a Sunday is not an alert', () => {
    // 2026-11-08 是周日。实测：2026-11-07（周六）同一刻 CoinDesk 17.7h、Decrypt 16.7h、
    // The Block 16.8h 都没新条目——三家一起安静，是周末低产，不是某一家坏了。
    const sunday = '2026-11-08T00:00:00.000Z'
    const twentyHours = new Date(Date.parse(sunday) - 20 * HOUR).toISOString()
    const window = resolveSilenceWindow(sunday, 'UTC')
    expect(window.weekend).toBe(true)
    expect(decideSourceIssue({ sourceId: SOURCE_ID, consecutiveFailures: 0, lastSuccessAt: sunday, lastNewItemAt: twentyHours, now: sunday }, window.windowMs)).toBeNull()
  })

  it('alerts after 13 silent hours on a weekday', () => {
    // 2026-11-03 是周二；工作日窗口 12 小时。
    const thirteenHours = new Date(Date.parse(NOW) - 13 * HOUR).toISOString()
    const window = resolveSilenceWindow(NOW, 'UTC')
    expect(window.weekend).toBe(false)
    expect(window.windowMs).toBe(WEEKDAY_SILENCE_MS)
    expect(decideSourceIssue({ sourceId: SOURCE_ID, consecutiveFailures: 0, lastSuccessAt: NOW, lastNewItemAt: thirteenHours, now: NOW }, window.windowMs)).toBe('stale')
  })

  it('judges the weekend in the reader\'s time zone, not UTC', () => {
    // 2026-11-07T23:30Z 在 UTC 是周六，在 Asia/Shanghai 已经是周日（11-08 07:30）——两边都算周末，
    // 所以用周日早上那一刻验反方向：UTC 是周六、上海也是周日，窗口必须仍是 24 小时。
    expect(resolveSilenceWindow('2026-11-07T23:30:00.000Z', 'UTC').weekend).toBe(true)
    expect(resolveSilenceWindow('2026-11-07T23:30:00.000Z', 'Asia/Shanghai').weekend).toBe(true)
    // 周一 00:30（上海）而 UTC 还是周日 16:30：按读者时区应判成工作日。
    expect(resolveSilenceWindow('2026-11-08T16:30:00.000Z', 'Asia/Shanghai').weekend).toBe(false)
    expect(resolveSilenceWindow('2026-11-08T16:30:00.000Z', 'UTC').weekend).toBe(true)
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
        return { kind: 'accepted', recordId: 'r1', levels: ['center', 'desktop'], suppressedLevels: [] }
      },
      defaultFreshnessMs: 6 * HOUR,
      timeZone: () => 'UTC'
    })

    await notify(snapshot({ consecutiveFailures: 3 }))
    // NOW 是周二（工作日窗口 12 小时），13 小时前才算陈旧。
    await notify(snapshot({ lastSuccessAt: new Date(Date.parse(NOW) - 13 * HOUR).toISOString() }))

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
        return { kind: 'accepted', recordId: 'r1', levels: ['center'], suppressedLevels: [] }
      },
      defaultFreshnessMs: 6 * HOUR,
      timeZone: () => 'UTC'
    })
    await expect(notify(snapshot({ consecutiveFailures: 1 }))).resolves.toBeNull()
    expect(calls).toBe(0)
  })

  it('writes one diagnostic line with this source and every other source’s silence', async () => {
    // 误报时要能一眼分开「周末低产」与「真异常」：诊断里带各源静默小时数 + 用的是哪档窗口。
    const lines: Array<{ event: string; fields?: Record<string, unknown> }> = []
    const notify = createSourceIssueNotifier({
      submit: async () => ({ kind: 'accepted', recordId: 'r1', levels: ['center'], suppressedLevels: [] }),
      defaultFreshnessMs: 6 * HOUR,
      timeZone: () => 'UTC',
      log: (_level, event, fields) => { lines.push({ event, ...(fields === undefined ? {} : { fields }) }) },
      silenceHours: () => ({ 'coindesk-rss': 17.7, 'decrypt-rss': 16.7 })
    })
    const oldItem = new Date(Date.parse(NOW) - 17 * HOUR).toISOString()
    await notify(snapshot({ lastSuccessAt: NOW, lastNewItemAt: oldItem }))

    expect(lines).toHaveLength(1)
    expect(lines[0]?.event).toBe('intelligence.source.silence')
    expect(lines[0]?.fields).toMatchObject({
      sourceId: SOURCE_ID,
      silentHours: 17,
      weekend: false,
      windowHours: 12,
      sources: { 'coindesk-rss': 17.7, 'decrypt-rss': 16.7 }
    })
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
    const notify = createSourceIssueNotifier({ submit: runtime.submit, defaultFreshnessMs: 6 * HOUR, timeZone: () => 'UTC' })

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
    const notify = createSourceIssueNotifier({ submit: runtime.submit, defaultFreshnessMs: 6 * HOUR, timeZone: () => 'UTC' })

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
