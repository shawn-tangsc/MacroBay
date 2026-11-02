import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { buildCalibrationResultRequest, notifyCalibrationResult } from './calibrationResultNotifier'

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

function createRuntime(subscriptions: Record<string, unknown> = {}) {
  let state: { records: Array<Record<string, unknown>>; dailyCounters: Record<string, unknown>; subscriptions: Record<string, unknown>; pushBackoff: Record<string, unknown> } =
    { records: [], dailyCounters: {}, subscriptions, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) as typeof state }
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

describe('calibration result notifier', () => {
  it('submits parameters only, keyed by the settlement day', () => {
    const request = buildCalibrationResultRequest(DATE, NOW)

    expect(request).toMatchObject({
      eventTypeId: 'market-intelligence.calibration.result',
      // 判定账本由这个 job 结算；producerId 用 handler id（契约 §14.1）。
      producerId: 'market-intelligence.verifyMarketAnalysisPredictions',
      dedupeVars: { builder: 'template', vars: { date: DATE } },
      actions: [],
      occurredAt: NOW
    })
    expect(request).not.toHaveProperty('dedupeKey')
  })

  it('stays silent for a new install and records once when the reader subscribed', async () => {
    const empty = createRuntime()
    await notifyCalibrationResult((request) => empty.runtime.submit(request), DATE, NOW)
    expect(empty.records()).toHaveLength(0)

    const subscribed = createRuntime({ 'market-intelligence.calibration.result': { record: true } })
    await notifyCalibrationResult((request) => subscribed.runtime.submit(request), DATE, NOW)
    expect(subscribed.records()).toHaveLength(1)
    expect(subscribed.records()[0]).toMatchObject({
      eventTypeId: 'market-intelligence.calibration.result',
      dedupeKey: `market-intelligence|calibration:${DATE}`
    })
  })

  it('does nothing without a notification port', async () => {
    await expect(notifyCalibrationResult(undefined, DATE, NOW)).resolves.toBeUndefined()
  })
})
