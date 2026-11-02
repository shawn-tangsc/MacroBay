import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { buildBriefingNoticeRequest, notifyDailyBriefing } from './dailyBriefingNotifier'

const NOW = '2026-11-03T00:30:00.000Z'
const DATE = '2026-11-03'

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
  it('asks for the ready notice with parameters only — the key stays in the declaration', () => {
    const request = buildBriefingNoticeRequest({ kind: 'ready', date: DATE, periodId: 'default' }, NOW)

    expect(request).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.ready',
      // 让渡表是静态的，claims 按 handler 登记（契约 §14.1）：带期号的 definition id 只会让它永远对不上。
      producerId: 'market-intelligence.dailyBriefing',
      dedupeVars: { builder: 'template', vars: { date: DATE, period: 'default' } },
      actions: [],
      occurredAt: NOW
    })
    expect(request).not.toHaveProperty('dedupeKey')
    expect(request).not.toHaveProperty('bodyVariant')
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
        expect.objectContaining({ labelKey: 'notification.action.open-briefing', kind: 'open' })
      ])
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

  it('keeps a day of successful briefings at zero notifications for a new install', async () => {
    // S1/N1：完成类在新装默认订阅（全空）下被 suppressed，不落库、不投递。
    const { runtime, records } = createRuntime()
    const notified = await notifyDailyBriefing((request) => runtime.submit(request), { kind: 'ready', date: DATE, periodId: 'default' }, NOW)

    expect(notified).toMatchObject({ kind: 'suppressed', reason: 'not-subscribed' })
    expect(records()).toHaveLength(0)
  })

  it('submits the ready notice when the reader subscribed to records', async () => {
    const { runtime, records } = createRuntime({
      'market-intelligence.briefing.ready': { record: true }
    })
    const notified = await notifyDailyBriefing((request) => runtime.submit(request), { kind: 'ready', date: DATE, periodId: 'default' }, NOW)

    expect(notified).toMatchObject({ kind: 'accepted' })
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.ready',
      dedupeKey: 'market-intelligence|brief-done:2026-11-03:default',
      occurrenceCount: 1
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
      { kind: 'ready', date: DATE, periodId: 'default' }, NOW)

    expect(notified).toBeNull()
  })
})
