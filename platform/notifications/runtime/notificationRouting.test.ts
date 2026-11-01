import { describe, expect, it } from 'vitest'

import type { NotificationRequest } from '../contracts/notificationContracts'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import { normalizeRequestedChannels, routeTransientDelivery } from './notificationRouting'
import { createNotificationFromRequest } from '../store/notificationStore'

describe('notification routing settings boundary', () => {
  it('applies product permissions and quiet hours to disruptive channels', () => {
    const request: NotificationRequest = {
      owner: 'product',
      productId: 'sample-product',
      sourceId: 'alert-engine',
      title: 'Position risk',
      severity: 'warning',
      priority: 'normal',
      requestedChannels: ['center', 'toast', 'desktop']
    }

    const settings = {
      ...createDefaultNotificationRuntimeSettings(),
      quietHours: { enabled: true, startLocalTime: '00:00', endLocalTime: '23:59' },
      productPermissions: {
        'sample-product': {
          enabled: true,
          allowDesktop: false,
          allowToast: true,
          allowPopup: false
        }
      }
    }

    expect(normalizeRequestedChannels(request, settings)).toEqual(['center'])
  })

  it('allows urgent notifications during quiet hours', () => {
    const request: NotificationRequest = {
      owner: 'product',
      productId: 'sample-product',
      sourceId: 'alert-engine',
      title: 'Liquidation risk',
      severity: 'critical',
      priority: 'urgent',
      requestedChannels: ['center', 'popup']
    }

    const settings = {
      ...createDefaultNotificationRuntimeSettings(),
      quietHours: { enabled: true, startLocalTime: '00:00', endLocalTime: '23:59' }
    }

    expect(normalizeRequestedChannels(request, settings)).toEqual(['center', 'popup'])
  })
})

describe('notification quiet hours follow the reader time zone', () => {
  const settings = {
    ...createDefaultNotificationRuntimeSettings(),
    quietHours: { enabled: true, startLocalTime: '22:00', endLocalTime: '08:00' }
  }
  const request: NotificationRequest = {
    owner: 'platform',
    sourceId: 'job-runtime',
    title: 'Scheduled run',
    severity: 'info',
    priority: 'normal',
    requestedChannels: ['center', 'toast']
  }

  it('suppresses toast inside the window of the zone the clock reports', () => {
    const clock = { now: () => new Date('2026-11-01T23:30:00.000Z'), timeZone: () => 'UTC' }

    expect(normalizeRequestedChannels(request, settings, clock)).toEqual(['center'])
  })

  it('lets the same instant through when the reader zone is outside its window', () => {
    // 同一瞬间，东京是 08:30，已经出了 22:00–08:00 的窗口；机器本地时间不参与判断。
    const clock = { now: () => new Date('2026-11-01T23:30:00.000Z'), timeZone: () => 'Asia/Tokyo' }

    expect(normalizeRequestedChannels(request, settings, clock)).toEqual(['center', 'toast'])
  })
})

describe('notification transient delivery wiring', () => {
  const settings = createDefaultNotificationRuntimeSettings()
  const record = createNotificationFromRequest({
    owner: 'platform',
    sourceId: 'job-runtime',
    title: 'Resource job failed',
    severity: 'warning',
    priority: 'high',
    requestedChannels: ['center', 'toast', 'popup', 'desktop']
  })

  it('records an unwired channel as skipped instead of a false success', async () => {
    const attempts = await routeTransientDelivery(record, settings, {})

    expect(attempts).toEqual([
      { channel: 'toast', attemptedAt: expect.any(String), result: 'skipped', reason: 'toast-unavailable' },
      { channel: 'popup', attemptedAt: expect.any(String), result: 'skipped', reason: 'popup-unavailable' },
      { channel: 'desktop', attemptedAt: expect.any(String), result: 'skipped', reason: 'desktop-unavailable' }
    ])
    expect(attempts.some((attempt) => attempt.result === 'sent')).toBe(false)
  })

  it('reports sent only after the wired hook actually ran', async () => {
    const shown: string[] = []
    const attempts = await routeTransientDelivery(record, settings, {
      toast: (item) => shown.push(`toast:${item.title}`),
      popup: (item) => shown.push(`popup:${item.title}`),
      desktop: async () => ({ ok: true })
    })

    expect(shown).toEqual(['toast:Resource job failed', 'popup:Resource job failed'])
    expect(attempts.map((attempt) => [attempt.channel, attempt.result])).toEqual([
      ['toast', 'sent'],
      ['popup', 'sent'],
      ['desktop', 'sent']
    ])
  })

  it('keeps the disabled reason distinct from an unwired channel', async () => {
    const attempts = await routeTransientDelivery(
      record,
      { ...settings, desktopEnabled: false, toastEnabled: false },
      { popup: () => undefined }
    )

    expect(attempts).toEqual([
      { channel: 'toast', attemptedAt: expect.any(String), result: 'skipped', reason: 'toast-disabled' },
      { channel: 'popup', attemptedAt: expect.any(String), result: 'sent' },
      { channel: 'desktop', attemptedAt: expect.any(String), result: 'skipped', reason: 'desktop-disabled' }
    ])
  })
})
