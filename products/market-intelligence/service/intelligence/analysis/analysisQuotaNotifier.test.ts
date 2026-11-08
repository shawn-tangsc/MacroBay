import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'
import { notificationCopyText } from '@platform/i18n/notificationCopy'

import { buildAnalysisQuotaRequest, notifyAnalysisQuota, utcDayOf } from './analysisQuotaNotifier'

const NOW = '2026-11-03T09:30:00.000Z'

const settings: NotificationRuntimeSettings = {
  desktopEnabled: true,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}

type StoreState = {
  records: Array<Record<string, unknown>>
  dailyCounters: Record<string, unknown>
  subscriptions: Record<string, unknown>
  pushBackoff: Record<string, unknown>
}

function createRuntime() {
  let state: StoreState = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) as StoreState }
  }
  /** 一次桌面投递就是一次「打扰」，合并不许再多打扰一次——所以要数它被调了几次。 */
  let desktopDeliveries = 0
  const runtime = createNotificationRuntime({
    storage,
    catalog: createNotificationEventCatalog({
      // 断的是平台事件（额度通知）的行为 -> 读平台自己的批准值。
      sources: [{ productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS }]
    }),
    diagnostics: () => undefined,
    getSettings: async () => settings,
    clock: { now: () => new Date(NOW), timeZone: () => 'UTC' },
    deliveryHooks: {
      desktop: async () => {
        desktopDeliveries += 1
        return { ok: true }
      }
    }
  })
  return { runtime, records: () => state.records, desktopDeliveries: () => desktopDeliveries }
}

describe('analysis quota notifier (P3)', () => {
  it('keys the notice by the UTC day and carries today’s used / limit', () => {
    const request = buildAnalysisQuotaRequest({ used: 48, limit: 48, occurredAt: NOW })

    expect(request).toBeDefined()
    const shaped = request!
    expect(shaped).toMatchObject({
      eventTypeId: 'platform.analysis.quota-exhausted',
      producerId: 'market-intelligence.runMarketAnalysis',
      // 记账按 UTC 日切，不跟读者时区：同一个「今天」跨时区不能算出两个键。
      dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } },
      actions: [],
      occurredAt: NOW
    })
    expect(shaped).not.toHaveProperty('dedupeKey')
    // 句子在源头拼好（契约 v2.56）：两种语言各一份，记录里没有文案键。
    expect(shaped).not.toHaveProperty('bodyParams')
    // 正文必须真的出现两个数：少了哪一格，读者就只看到一句「用完了」。
    expect(shaped.rendered?.['zh-CN']?.body).toContain('今天已用 48 次')
    expect(shaped.rendered?.['zh-CN']?.body).toContain('上限 48 次')
    expect(shaped.rendered?.['en-US']?.body).toContain('Used 48 of 48 analyses')
    expect(JSON.stringify(shaped.rendered)).not.toMatch(/\{\w+\}/)
  })

  it('takes the day from the instant, so a rejection just after UTC midnight is the next day', () => {
    expect(utcDayOf('2026-11-03T23:59:59.999Z')).toBe('2026-11-03')
    expect(utcDayOf('2026-11-04T00:00:00.001Z')).toBe('2026-11-04')
  })

  it('keeps one row a day: the second refusal merges, does not disturb the reader twice, and updates the pair', async () => {
    const { runtime, records, desktopDeliveries } = createRuntime()

    const first = await notifyAnalysisQuota((request) => runtime.submit(request), { used: 47, limit: 48, occurredAt: NOW })
    expect(first).toMatchObject({ kind: 'accepted' })
    expect(records()).toHaveLength(1)
    const firstRecordId = records()[0]?.id
    expect(records()[0]).toMatchObject({
      eventTypeId: 'platform.analysis.quota-exhausted',
      dedupeKey: 'platform|quota-exhausted:2026-11-03'
    })
    expect((records()[0]?.rendered as Record<string, { body: string }>)['zh-CN']?.body).toContain('今天已用 47 次')
    // 第一次被拒时打扰过一次；同一天再被拒不许打扰第二次。
    expect(desktopDeliveries()).toBe(1)

    const second = await notifyAnalysisQuota((request) => runtime.submit(request), { used: 48, limit: 48, occurredAt: '2026-11-03T10:30:00.000Z' })
    expect(second).toMatchObject({ kind: 'merged', recordId: firstRecordId })
    expect(records()).toHaveLength(1)
    // 正文跟着**最新一次**取数。第二次换了一对数是夹具：真实链路里同一天通常都是 48/48，
    // 但合并若保留第一次的数，读者就会看到过期的「已用」——这里钉的正是「取最新」。
    expect(records()[0]).toMatchObject({
      id: firstRecordId,
      // `occurrenceCount` 是「这件事发生了几次」，不是「今天被拒了几次」——界面不许拿它当计数展示。
      occurrenceCount: 1
    })
    // 合并只换正文（标题/理由取第一次），所以「已用」跟着最新这次走。
    const merged = records()[0]?.rendered as Record<string, { title: string; body: string }>
    expect(merged['zh-CN']?.body).toContain('今天已用 48 次')
    expect(merged['zh-CN']?.title).toBe(notificationCopyText('zh-CN', 'notification.event.platform.analysis.quota-exhausted.title'))
    // 一份记录只有一个正文来源。
    expect(records()[0]).not.toHaveProperty('bodyKey')
    expect(desktopDeliveries()).toBe(1)
  })

  it('starts the next UTC day as a second row', async () => {
    const { runtime, records } = createRuntime()
    await notifyAnalysisQuota((request) => runtime.submit(request), { used: 48, limit: 48, occurredAt: NOW })
    await notifyAnalysisQuota((request) => runtime.submit(request), { used: 48, limit: 48, occurredAt: '2026-11-04T09:30:00.000Z' })

    expect(records()).toHaveLength(2)
    expect(records().map((record) => record.dedupeKey).sort()).toEqual([
      'platform|quota-exhausted:2026-11-03',
      'platform|quota-exhausted:2026-11-04'
    ])
  })

  it('does nothing without a notification port', async () => {
    await expect(notifyAnalysisQuota(undefined, { used: 48, limit: 48, occurredAt: NOW })).resolves.toBeNull()
  })

  it('does not fail the refusal when the notification port throws', async () => {
    await expect(notifyAnalysisQuota(() => { throw new Error('notification store unavailable') }, { used: 48, limit: 48, occurredAt: NOW }))
      .resolves.toBeNull()
  })
})
