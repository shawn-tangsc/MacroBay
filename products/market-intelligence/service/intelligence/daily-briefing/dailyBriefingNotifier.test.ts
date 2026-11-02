import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { buildBriefingNoticeRequest, createDailyBriefingNotifier } from './dailyBriefingNotifier'

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

  it('has exactly one notice, and it is about a problem rather than a success', () => {
    // §28：成功是常态，每天报一次会训练读者关通知；真出事那条也就看不见了。
    // 所以这里不是「暂时没实现」，而是「只有一个 kind」——想加回一条，先改产品口径。
    const request = buildBriefingNoticeRequest({ kind: 'timezone-invalid', date: DATE }, NOW)
    expect(request.eventTypeId).toBe('market-intelligence.timezone.invalid')
  })

  it('says nothing at all when a briefing is stored', async () => {
    const { runtime, records } = createRuntime({ 'market-intelligence.timezone.invalid': { record: true } })
    const notify = createDailyBriefingNotifier({ submit: (request) => runtime.submit(request), now: () => NOW })
    // 生成成功这条路径不调用通知：三个事件订阅全开也不该落一行。
    expect(records()).toHaveLength(0)
    expect(notify).toBeTypeOf('function')
  })

  it('records one timezone notice for repeated detections, and never a desktop popup', async () => {
    // N14：注入无效时区三次 → 中心一条、桌面 0；`occurrence` 下重复上报不新开行。
    const { runtime, records } = createRuntime()
    const notify = createDailyBriefingNotifier({ submit: (request) => runtime.submit(request), now: () => NOW })

    for (let index = 0; index < 3; index += 1) await notify({ kind: 'timezone-invalid', date: DATE })

    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({
      eventTypeId: 'market-intelligence.timezone.invalid',
      dedupeKey: `market-intelligence|timezone-invalid:${DATE}`,
      occurrenceCount: 1
    })
    expect(records()[0]?.delivery ?? {}).not.toHaveProperty('desktop')
  })

  it('does not fail generation when the notification port throws', async () => {
    const notify = createDailyBriefingNotifier({
      submit: async () => { throw new Error('notification store unavailable') },
      now: () => NOW
    })

    await expect(notify({ kind: 'ready', date: DATE, periodId: 'default' })).resolves.toBeNull()
  })
})
