import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { createDefaultNotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS } from '../../../contracts/notificationApprovals'
import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { buildNewsArrivalRequest, type NewsArrivalNoticeInput } from './newsArrivalNotice'

/**
 * 判据④（R40 §2）：**免打扰时段一条桌面都不弹**，而同一条在免打扰外照发。
 *
 * 这条判的是**读者能感知的结果**，不是配置字段：真的走平台的通知运行时（同一份事件目录、
 * 同一份批准表、同一个免打扰判定），夜里提交一次，桌面投递钩子不许被调到，回执还要写明
 * 「没试」的原因是免打扰——「没试」与「试了没到」不是同一件事。
 *
 * **中心这一条不在本文件判**：平台的 `effectiveLevels` 把 `center` 写死成必达记录
 * （`notificationSurfaceLevels.ts:16`），批准表撤不掉它。所以「舆情不进中心」需要的是一条平台能力，
 * 不是这一层能改的——见本轮汇报里的卡点。
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
  return { runtime, desktop, records: () => state.records as Array<{ levels?: readonly string[] }> }
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
})
