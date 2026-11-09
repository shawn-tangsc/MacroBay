import { describe, expect, it, vi } from 'vitest'

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings } from '../contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

/**
 * 设置页那四条「推不推手机」最终落在 `settings.channelEvents[eventId]`。
 *
 * 这张表曾经一版又一版被丢、也曾经没有任何读者（读者写的开关不生效）；现在投递链读它，
 * 这条用例就是**读取方真的生效**的判据：显式 `false` 不许发手机，缺省（没写过）照常发。
 * 没有它，删掉投递链那一行也能全绿——那就是「死表」复发。
 */
const eventId = 'platform.channel-veto.probe'

const baseSettings: NotificationRuntimeSettings = {
  desktopEnabled: false,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}

function catalog() {
  return createNotificationEventCatalog({
    sources: [{
      productId: 'platform',
      events: [{
        id: eventId,
        titleKey: 'notification.test.title',
        bodyKey: 'notification.test.body',
        reasonKey: 'notification.test.body',
        requiresUserAction: false,
        category: 'reminder',
        requestedDisruptionLevels: ['channel'],
        dedupeKeyTemplate: 'veto:{date}',
        dedupeUnit: 'occurrence'
      }],
      approval: {
        [eventId]: { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false }
      }
    }]
  })
}

function harness(channelEvents: Readonly<Record<string, boolean>> | undefined) {
  let state: any = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) }
  }
  const push = vi.fn(async () => ({ ok: true as const, messageId: 'm-1' }))
  const runtime = createNotificationRuntime({
    storage,
    catalog: catalog(),
    diagnostics: () => undefined,
    resolvePushChannel: async () => ({ ok: true, channelId: 'telegram', channelName: 'Telegram · test' }),
    getSettings: async () => ({ ...baseSettings, ...(channelEvents === undefined ? {} : { channelEvents }) }),
    clock: { now: () => new Date('2026-11-08T00:00:00.000Z'), timeZone: () => 'UTC' },
    deliveryHooks: { push }
  })
  return { runtime, push, state: () => state }
}

function submit(runtime: ReturnType<typeof harness>['runtime']) {
  return runtime.submit({
    eventTypeId: eventId,
    dedupeVars: { builder: 'template', vars: { date: '2026-11-08' } },
    actions: [],
    occurredAt: '2026-11-08T00:00:00.000Z'
  })
}

describe('the per-event channel switch is read by delivery', () => {
  it('sends nothing to the channel when the reader explicitly turned that event off', async () => {
    const { runtime, push } = harness({ [eventId]: false })
    await submit(runtime)

    expect(push).not.toHaveBeenCalled()
  })

  it('still sends when the event was never touched, because absent means on', async () => {
    const { runtime, push } = harness(undefined)
    await submit(runtime)

    expect(push).toHaveBeenCalledOnce()
  })
})
