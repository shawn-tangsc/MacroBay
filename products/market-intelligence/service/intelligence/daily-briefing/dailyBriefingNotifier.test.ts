import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import type {
  NotificationRuntimeSettings,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { buildBriefingNoticeRequest, notifyDailyBriefing } from './dailyBriefingNotifier'

const NOW = '2026-11-03T00:30:00.000Z'
const DATE = '2026-11-03'
/** 已按 §28 删除的完成类事件 id：留成字面量，才能证明「它现在提交不进去」。 */
const READY_EVENT_ID = 'market-intelligence.briefing.ready'

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

function createRuntime(subscriptions: Record<string, unknown> = {}) {
  let state: StoreState = { records: [], dailyCounters: {}, subscriptions, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) as StoreState }
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
    diagnostics: () => undefined,
    getSettings: async () => settings,
    clock: { now: () => new Date(NOW), timeZone: () => 'UTC' },
    productIds: ['market-intelligence']
  })
  return { runtime, records: () => state.records }
}

describe('daily briefing notifier', () => {
  it('declares the completion notice again, subscribed-only (§28 withdrawn by the reader, 2026-11-04)', () => {
    // The notice was removed when "success is silent" was the rule; the reader changed that rule and
    // wants one notice a day. The declaration is what makes a submission possible at all.
    const events = marketIntelligenceProductManifest.notificationEvents
    const ready = events.find((event) => event.id === READY_EVENT_ID)
    expect(ready).toBeDefined()
    expect(ready).toMatchObject({ notifyOnlyIfSubscribed: true, dedupeKeyTemplate: 'briefing-ready:{date}', dedupeUnit: 'occurrence' })
    expect(createNotificationEventCatalog({
      policy: NOTIFICATION_EVENT_POLICY,
      sources: [{ productId: 'market-intelligence', events }]
    }).has(READY_EVENT_ID)).toBe(true)
  })

  it('builds the completion request with the date alone, so a re-generation cannot repeat it', () => {
    // The reverse criterion: a revision, a generation time or a content hash inside the key would turn
    // the same day's re-generation into a second notice. The key carries the date and nothing else.
    const request = buildBriefingNoticeRequest({ kind: 'ready', date: DATE }, NOW)

    expect(request).toMatchObject({
      eventTypeId: READY_EVENT_ID,
      dedupeVars: { builder: 'template', vars: { date: DATE } },
      occurredAt: NOW
    })
    expect(JSON.stringify(request.dedupeVars)).not.toMatch(/revision|documentId|hash|generatedAt/)
  })

  it('names the two failure bodies by the declared variant and gives the reader the open action', () => {
    // N5 ②：同一 `briefing.failed` 两种文案，不是两个事件；变体名与声明的 `bodyKeyByVariant` 逐字一致。
    const notGenerated = buildBriefingNoticeRequest(
      { kind: 'failed', variant: 'not-generated', date: DATE, periodId: 'default' }, NOW)
    const editorial = buildBriefingNoticeRequest(
      { kind: 'failed', variant: 'editorial-missing', date: DATE, periodId: 'default' }, NOW)

    expect(notGenerated).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.failed',
      producerId: 'market-intelligence.dailyBriefing',
      dedupeVars: { builder: 'template', vars: { date: DATE, period: 'default' } },
      bodyVariant: 'not-generated'
    })
    expect(editorial.bodyVariant).toBe('editorial-missing')
    for (const request of [notGenerated, editorial]) {
      expect(request).not.toHaveProperty('dedupeKey')
      expect(request.actions).toEqual([
        expect.objectContaining({
          labelKey: 'notification.action.open-briefing',
          kind: 'open',
          // 动作与整行都指向日报页：壳层按 pageId 解析，产品不自己拼路由。
          deeplink: { scope: 'product', productId: 'market-intelligence', pageId: 'daily-briefing' }
        })
      ])
      expect(request.deeplink).toEqual({ scope: 'product', productId: 'market-intelligence', pageId: 'daily-briefing' })
    }
  })

  it('sends the timezone notice to the settings panel the reader can actually open', () => {
    const request = buildBriefingNoticeRequest({ kind: 'timezone-invalid', date: DATE }, NOW)

    expect(request).toMatchObject({
      eventTypeId: 'market-intelligence.timezone.invalid',
      producerId: 'market-intelligence.dailyBriefing',
      dedupeVars: { builder: 'template', vars: { date: DATE } },
      deeplink: { scope: 'platform', settingsSectionId: 'preferences' },
      actions: [{
        id: 'open-time-zone-settings',
        labelKey: 'notification.action.open-settings',
        kind: 'open',
        deeplink: { scope: 'platform', settingsSectionId: 'preferences' }
      }]
    })
  })

  it('N5: two failures of one edition stay one row, and the body follows the latest run', async () => {
    const { runtime, records } = createRuntime()
    const submit = (request: Parameters<typeof runtime.submit>[0]) => runtime.submit(request)

    const first = await notifyDailyBriefing(submit, { kind: 'failed', variant: 'not-generated', date: DATE, periodId: 'default' }, NOW)
    const second = await notifyDailyBriefing(submit, { kind: 'failed', variant: 'editorial-missing', date: DATE, periodId: 'default' }, '2026-11-03T01:30:00.000Z')

    expect(first).toMatchObject({ kind: 'accepted' })
    expect(second).toMatchObject({ kind: 'merged' })
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.failed',
      dedupeKey: 'market-intelligence|brief-failed:2026-11-03:default',
      occurrenceCount: 2,
      // 正文取最新一次：合并后记录的键换成第二次提交的变体。
      bodyKey: 'notification.event.market-intelligence.briefing.failed.body.editorial-missing'
    })
  })

  it('N5: a second day starts a second row — 「only one row per edition」 only means something if two editions give two', async () => {
    // 「同一天只有一行」在通知根本没发出去时也成立，所以必须配这条正向用例：
    // 换一个日期必须出现第 2 行，否则那条断言证明的只是「什么都没发生」。
    const { runtime, records } = createRuntime()
    const submit = (request: Parameters<typeof runtime.submit>[0]) => runtime.submit(request)

    await notifyDailyBriefing(submit, { kind: 'failed', variant: 'not-generated', date: '2026-11-02', periodId: 'default' }, NOW)
    await notifyDailyBriefing(submit, { kind: 'failed', variant: 'not-generated', date: DATE, periodId: 'default' }, NOW)

    expect(records()).toHaveLength(2)
    // 记录按最近时间倒序排列，所以这里排序后比键本身，不依赖存储顺序。
    expect(records().map((record) => record.dedupeKey).sort()).toEqual([
      'market-intelligence|brief-failed:2026-11-02:default',
      'market-intelligence|brief-failed:2026-11-03:default'
    ])
    for (const record of records()) expect(record.occurrenceCount).toBe(1)
  })

  it('N14: repeated detections of an unusable zone stay one centre row and never pop a desktop', async () => {
    const { runtime, records } = createRuntime()

    for (let index = 0; index < 3; index += 1) {
      await notifyDailyBriefing((request) => runtime.submit(request), { kind: 'timezone-invalid', date: DATE }, NOW)
    }

    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({
      eventTypeId: 'market-intelligence.timezone.invalid',
      dedupeKey: `market-intelligence|timezone-invalid:${DATE}`,
      occurrenceCount: 1
    })
    expect(records()[0]?.delivery ?? {}).not.toHaveProperty('desktop')
  })

  it('does not fail generation when the notification port throws', async () => {
    const notified = await notifyDailyBriefing(() => { throw new Error('notification store unavailable') },
      { kind: 'failed', variant: 'not-generated', date: DATE, periodId: 'default' }, NOW)

    expect(notified).toBeNull()
  })
})
