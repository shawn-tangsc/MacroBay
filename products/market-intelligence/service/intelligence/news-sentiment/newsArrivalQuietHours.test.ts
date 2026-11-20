import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { createDefaultNotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'
import { isCenterRecord } from '@platform/notifications/runtime/notificationRuntimeQuery'

import { MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS } from '../../../contracts/notificationApprovals'
import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { buildNewsArrivalRequest, type NewsArrivalNoticeInput } from './newsArrivalNotice'
import { buildSentimentAlertRequest } from './newsSentimentAlertRequest'

/**
 * 判据④（R40 §2）：**免打扰时段一条桌面都不弹**，而同一条在免打扰外照发。
 *
 * 这条判的是**读者能感知的结果**，不是配置字段：真的走平台的通知运行时（同一份事件目录、
 * 同一份批准表、同一个免打扰判定），夜里提交一次，桌面投递钩子不许被调到，回执还要写明
 * 「没试」的原因是免打扰——「没试」与「试了没到」不是同一件事。
 *
 * 判据②（R40 §2「不进中心」）：平台 2026-11-18 把 `center` 改成普通批准档（`5ba7944`、`8081b5f`），
 * 审批表里没有 `center` 的事件**不再进中心**。这条事件只批 `desktop`，所以中心里不该有它。
 */
const catalog = createNotificationEventCatalog({
  sources: [{
    productId: 'market-intelligence',
    events: marketIntelligenceProductManifest.notificationEvents ?? [],
    approval: MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS
  }]
})

/** 2026-11-18T12:00Z = 上海时间 20:00，落在 20:00–23:59 的免打扰窗口里。 */
const NIGHT = '2026-11-18T12:00:00.000Z'
/** 2026-11-18T04:00Z = 上海时间 12:00，窗口外。 */
const DAY = '2026-11-18T04:00:00.000Z'

const STORY: NewsArrivalNoticeInput = {
  itemId: 'item-a',
  headline: 'SEC Approves Spot Ethereum ETF Options',
  sourceName: 'CoinDesk RSS',
  polarity: 'bullish',
  publishedAt: '2026-11-18T11:40:00.000Z',
  timeZone: 'Asia/Shanghai'
}

function settings(): NotificationRuntimeSettings {
  return {
    ...createDefaultNotificationRuntimeSettings(),
    toastEnabled: true,
    desktopEnabled: true,
    quietHours: { enabled: true, startLocalTime: '20:00', endLocalTime: '23:59' }
  }
}

function harness(now: string) {
  let state: {
    records: unknown[]
    dailyCounters: Record<string, unknown>
    subscriptions: Record<string, unknown>
    pushBackoff: Record<string, unknown>
  } = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) }
  }
  const desktop: string[] = []
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: () => undefined,
    getSettings: async () => settings(),
    clock: { now: () => new Date(now), timeZone: () => 'Asia/Shanghai' },
    desktopSupported: () => true,
    deliveryHooks: {
      desktop: async () => { desktop.push('desktop'); return { ok: true } }
    },
    resolvePushChannels: async () => ({ ok: true, channels: [] }),
    getLanguage: async () => 'zh-CN'
  })
  return {
    runtime,
    desktop,
    records: () => state.records as Array<{ levels?: readonly string[]; appliedLevels?: readonly string[]; eventTypeId?: string }>
  }
}

describe('a new story reaching the desktop respects quiet hours', () => {
  it('tries nothing at night, and the receipt says the surface was not tried because of quiet hours', async () => {
    const { runtime, desktop, records } = harness(NIGHT)
    // 事件 id 与生产路径同形：提交那一刻的实参里带它（构建函数只给除 id 以外的内容）。
    const request = { eventTypeId: 'market-intelligence.news.item-arrived', ...buildNewsArrivalRequest(STORY)! }
    const outcome = await runtime.submit(request)

    expect(outcome).toMatchObject({ kind: 'accepted' })
    if (outcome.kind !== 'accepted') return
    expect(desktop).toEqual([])
    expect(outcome.suppressedLevels).toEqual(expect.arrayContaining([
      { level: 'desktop', reason: 'quiet-hours' }
    ]))
    expect(records()).toHaveLength(1)
  })

  it('shows the same story on the desktop outside quiet hours', async () => {
    const { runtime, desktop } = harness(DAY)
    // 事件 id 与生产路径同形：提交那一刻的实参里带它（构建函数只给除 id 以外的内容）。
    const request = { eventTypeId: 'market-intelligence.news.item-arrived', ...buildNewsArrivalRequest(STORY)! }
    const outcome = await runtime.submit(request)

    expect(outcome.kind).toBe('accepted')
    if (outcome.kind !== 'accepted') return
    expect(desktop).toEqual(['desktop'])
    expect(catalog.get('market-intelligence.news.item-arrived')?.approvedDisruptionLevels).toEqual(['desktop'])
  })

  it('lands in no notification centre at all — the record exists, but it is not a centre record', async () => {
    // 记录还是照写（审计与去重都要它），只是**不进中心、不计未读**：批准表里没有 center。
    const { runtime, records } = harness(DAY)
    const request = buildNewsArrivalRequest(STORY)!
    await runtime.submit({ ...request, eventTypeId: 'market-intelligence.news.item-arrived' })

    const [record] = records()
    expect(record?.eventTypeId).toBe('market-intelligence.news.item-arrived')
    expect(record?.appliedLevels).not.toContain('center')
    expect(isCenterRecord(record as never)).toBe(false)
  })

  it('the threshold alert is out of the centre too, and keeps the phone leg', async () => {
    // `sentiment.alert` 只批 `channel`：中心不该再有它，手机照旧（R40 §3）。走真实的提交请求，
    // 不是拿批准值拼一个假记录。
    const { runtime, records } = harness(DAY)
    const alert = buildSentimentAlertRequest({
      storyKey: 'story:2026-11-18:item-a',
      strength: 'high',
      headline: STORY.headline,
      sourceName: 'CoinDesk RSS',
      url: 'https://www.coindesk.com/x',
      publishedAt: STORY.publishedAt
    })!
    await runtime.submit({ ...alert, eventTypeId: 'market-intelligence.sentiment.alert' })

    const [record] = records()
    expect(record?.appliedLevels).toContain('channel')
    expect(record?.appliedLevels).not.toContain('center')
    expect(isCenterRecord(record as never)).toBe(false)
  })
})
