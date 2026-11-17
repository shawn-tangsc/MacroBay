import { describe, expect, it } from 'vitest'

import { marketIntelligenceProductManifest } from '../../../products/market-intelligence/product.manifest'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '../contracts/platformNotificationEvents'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

/**
 * 事件级「不进中心」（方案 §5，P2 判据 1–3）。
 *
 * 现在 center 只是**批准档之一**：批准写 `['desktop']` 的事件仍然落一条记录（审计行一直在），
 * 但它不出现在中心列表、也不计未读。反过来，含 center 的事件与今天逐字一致。
 * 老记录没有 `appliedLevels`——它们是 center 必达时代写的，照旧进中心。
 */
const NOW = '2026-11-18T09:00:00.000Z'
const catalog = createNotificationEventCatalog({
  sources: [
    { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
    {
      productId: 'market-intelligence',
      events: marketIntelligenceProductManifest.notificationEvents,
      approval: marketIntelligenceProductManifest.notificationApproval
    }
  ]
})

function harness(seed?: ReturnType<typeof createDefaultNotificationStoreState>) {
  let state = seed ?? createDefaultNotificationStoreState()
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) as typeof state }
  }
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: () => undefined,
    getSettings: async () => ({ ...createDefaultNotificationRuntimeSettings(), desktopEnabled: true }),
    desktopSupported: () => true,
    clock: { now: () => new Date(NOW), timeZone: () => 'Asia/Shanghai' },
    getLanguage: async () => 'zh-CN',
    productIds: ['market-intelligence'],
    deliveryHooks: { desktop: async () => ({ ok: true }) }
  })
  return { runtime, state: () => state }
}

describe('an event approved without center', () => {
  it('still writes its record and notifies the desktop, but never appears in the centre', async () => {
    const { runtime, state } = harness()
    const outcome = await runtime.submit({
      eventTypeId: 'market-intelligence.news.item-arrived',
      actions: [],
      dedupeVars: { builder: 'template', vars: { itemId: 'item-1' } },
      occurredAt: NOW
    })

    expect(outcome.kind).toBe('accepted')
    const records = state().records
    // 记录只有一条，而且**照旧落库**（审计与去重都靠它）；只是不进中心。
    expect(records).toHaveLength(1)
    expect(records[0]?.appliedLevels).toEqual(['desktop'])
    expect(records[0]?.channels).toEqual(['desktop'])
    // 桌面那一档真的排了（钩子同步受理，所以这里是终态；关键是有这一档、没有 center）。
    expect(records[0]?.delivery.desktop).toBeDefined()
    expect(records[0]?.channels).not.toContain('center')
    // 中心 0 行、未读 0。
    await expect(runtime.list({ limit: 10 })).resolves.toMatchObject({ items: [] })
    await expect(runtime.getUnreadState()).resolves.toMatchObject({ unread: 0 })
  })
})

describe('a required-center event is unchanged', () => {
  it('still shows in the centre and counts as unread', async () => {
    const { runtime } = harness()
    const outcome = await runtime.submit({
      eventTypeId: 'market-intelligence.analysis.conclusion',
      actions: [],
      dedupeVars: { builder: 'template', vars: { triggerKey: 'signal-1', cutoff: '2026-11-18T08:00:00.000Z' } },
      occurredAt: NOW
    })
    expect(outcome.kind).toBe('accepted')
    const page = await runtime.list({ limit: 10 })
    expect(page.items).toHaveLength(1)
    await expect(runtime.getUnreadState()).resolves.toMatchObject({ unread: 1 })
  })
})

describe('old records keep their place', () => {
  it('treats a record without appliedLevels as a centre record', async () => {
    const seed = createDefaultNotificationStoreState()
    seed.records.push({
      id: 'notification-legacy-1',
      owner: 'platform',
      sourceId: 'platform.test',
      eventTypeId: 'platform.test',
      delivery: {},
      titleKey: 'notification.test.title' as never,
      severity: 'info',
      priority: 'normal',
      channels: ['center'],
      state: 'unread',
      actions: [],
      occurrenceCount: 1,
      createdAt: NOW,
      updatedAt: NOW
    } as never)
    const { runtime } = harness(seed)
    // 没有 appliedLevels：按含 center 处理，不许从中心凭空消失。
    await expect(runtime.list({ limit: 10 })).resolves.toMatchObject({ items: [expect.objectContaining({ id: 'notification-legacy-1' })] })
    await expect(runtime.getUnreadState()).resolves.toMatchObject({ unread: 1 })
  })
})
