import { describe, expect, it } from 'vitest'

import type { NotificationRequest } from '../contracts/notificationContracts'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import { normalizeRequestedChannels, routeTransientDelivery } from './notificationRouting'
import { createNotificationFromRequest } from '../store/notificationStore'

/**
 * 用例显式声明「读者在 UTC」；不再有「没传就按 UTC」的缺省（MI-11-R68）。
 * **与本批同笔**：运行时改成只读注入时钟后，这条测试若不跟着传时钟，就会按真实时间跑并在
 * 跨零点自己变红——所以它不是顺手改的测试，是这次修复的一半。
 */
const utcClock = { now: () => new Date('2026-11-01T23:30:00.000Z'), timeZone: () => 'UTC' }

describe('notification routing settings boundary', () => {
  it('applies product permissions and quiet hours to disruptive channels', () => {
    const request: NotificationRequest = {
      owner: 'product',
      productId: 'sample-product',
      sourceId: 'alert-engine',
      titleKey: 'notification.taskFailed.title',
      titleParams: { taskName: 'Position risk' },
      severity: 'warning',
      priority: 'normal',
      requestedChannels: ['center', 'toast', 'desktop']
    }

    const settings = {
      ...createDefaultNotificationRuntimeSettings(),
      // 契约 §5.1：提示是全站开关、新装默认关；这些用例测的是「开关打开时」的路由。
      toastEnabled: true,
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

    expect(normalizeRequestedChannels(request, settings, utcClock)).toEqual(['center'])
  })

  it('does not let urgent pierce quiet hours: a silent window is silent for every local surface', () => {
    const request: NotificationRequest = {
      owner: 'product',
      productId: 'sample-product',
      sourceId: 'alert-engine',
      titleKey: 'notification.taskFailed.title',
      titleParams: { taskName: 'Liquidation risk' },
      severity: 'critical',
      priority: 'urgent',
      requestedChannels: ['center', 'popup']
    }

    const settings = {
      ...createDefaultNotificationRuntimeSettings(),
      popupEnabled: true,
      quietHours: { enabled: true, startLocalTime: '00:00', endLocalTime: '23:59' }
    }

    // Chief 2026-11-07 定：窗口内不留穿透。今天没有任何生产者发 `urgent`，所以这条改的是规则、
    // 不是今天的观感——但留下例外，将来就有人靠「悄悄标个 urgent」绕开读者的免打扰。
    expect(normalizeRequestedChannels(request, settings, utcClock)).toEqual(['center'])
  })
})

describe('notification quiet hours follow the reader time zone', () => {
  const settings = {
    ...createDefaultNotificationRuntimeSettings(),
    toastEnabled: true,
    quietHours: { enabled: true, startLocalTime: '22:00', endLocalTime: '08:00' }
  }
  const request: NotificationRequest = {
    owner: 'platform',
    sourceId: 'job-runtime',
    titleKey: 'notification.taskFailed.title',
    titleParams: { taskName: 'Scheduled run' },
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

  it('does not treat an unusable zone as UTC when deciding quiet hours', () => {
    // 窗口设成 UTC 下必然命中（00:00–23:59）：只要还拿 UTC 兜底，这条就会被静音。
    // 修好后「现在几点」算不出来 ⇒ 判定为未知 ⇒ 不做静音，而不是当成某个具体时刻。
    const allDayWindow = {
      ...createDefaultNotificationRuntimeSettings(),
      toastEnabled: true,
      quietHours: { enabled: true, startLocalTime: '00:00', endLocalTime: '23:59' }
    }
    const clock = { now: () => new Date('2026-11-01T23:30:00.000Z'), timeZone: () => 'Mars/Olympus_Mons' }

    expect(normalizeRequestedChannels(request, allDayWindow, clock)).toEqual(['center', 'toast'])
  })
})

describe('notification transient delivery wiring', () => {
  // 桌面开关新装默认关（契约 §4.2）；这一组测的是「开关打开时」的接线，所以显式打开。
  const settings = { ...createDefaultNotificationRuntimeSettings(), toastEnabled: true, desktopEnabled: true }
  const record = createNotificationFromRequest({
    owner: 'platform',
    sourceId: 'job-runtime',
    titleKey: 'notification.taskFailed.title',
    titleParams: { taskName: 'Resource job failed' },
    severity: 'warning',
    priority: 'high',
    requestedChannels: ['center', 'toast', 'popup', 'desktop']
  })

  it('records an unwired channel as skipped instead of a false success', async () => {
    const attempts = await routeTransientDelivery(record, settings, {}, utcClock)

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
      toast: (item) => shown.push(`toast:${item.titleKey}`),
      popup: (item) => shown.push(`popup:${item.titleKey}`),
      desktop: async () => ({ ok: true })
    }, utcClock)

    expect(shown).toEqual(['toast:notification.taskFailed.title', 'popup:notification.taskFailed.title'])
    expect(attempts.map((attempt) => [attempt.channel, attempt.result])).toEqual([
      ['toast', 'sent'],
      ['popup', 'sent'],
      ['desktop', 'handed-to-system']
    ])
  })

  it('records a successful desktop handoff as handed-to-system, never as sent', async () => {
    // `show()` 返回 ok 只说明交给了系统，证明不了用户看到了：静音、勿扰、系统关闭都会吞掉它。
    const attempts = await routeTransientDelivery(record, settings, {
      desktop: async () => ({ ok: true })
    }, utcClock)

    expect(attempts).toEqual([
      { channel: 'toast', attemptedAt: expect.any(String), result: 'skipped', reason: 'toast-unavailable' },
      { channel: 'popup', attemptedAt: expect.any(String), result: 'skipped', reason: 'popup-unavailable' },
      { channel: 'desktop', attemptedAt: expect.any(String), result: 'handed-to-system' }
    ])
    expect(attempts.some((attempt) => attempt.result === 'sent')).toBe(false)
  })

  it('keeps the disabled reason distinct from an unwired channel', async () => {
    const attempts = await routeTransientDelivery(
      record,
      { ...settings, desktopEnabled: false, toastEnabled: false },
      { popup: () => undefined },
      utcClock
    )

    expect(attempts).toEqual([
      { channel: 'toast', attemptedAt: expect.any(String), result: 'skipped', reason: 'toast-disabled' },
      { channel: 'popup', attemptedAt: expect.any(String), result: 'sent' },
      { channel: 'desktop', attemptedAt: expect.any(String), result: 'skipped', reason: 'desktop-disabled' }
    ])
  })
})

describe('the reader clock has no UTC default', () => {
  it('both entry points stop compiling when the clock is omitted, and refuse to run without one', () => {
    const request: NotificationRequest = {
      owner: 'platform',
      sourceId: 'job-runtime',
      titleKey: 'notification.taskFailed.title',
      titleParams: { taskName: 'Scheduled run' },
      severity: 'info',
      priority: 'normal',
      requestedChannels: ['center', 'toast']
    }
    const settings = createDefaultNotificationRuntimeSettings()
    const record = createNotificationFromRequest(request)

    // @ts-expect-error 时钟必传。若有人重新加回「缺省 UTC」，这两条会变成「未使用的 @ts-expect-error」
    // 并让 typecheck 变红——缺省值不能靠人盯着文档来守，得靠编译期。
    void normalizeRequestedChannels(request, settings)
    // @ts-expect-error 同上：删掉时钟参数就编译不过，而不是悄悄按格林尼治算。
    const withoutClock = (): unknown => routeTransientDelivery(record, settings, {})
    // 编译期之外再挡一次：绕过类型传空值时明确失败，而不是退回某个默认时区。
    expect(withoutClock).toThrow('notification-clock-required')
  })
})
