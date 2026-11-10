// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { clearAllWriteFailures } from './channelEventWriteFailures'
import { NotificationSettingsPanel } from './NotificationSettingsPanel'
import { intelligenceNotificationText } from './text'

/**
 * 读不到 ≠ 关：日历那一段读失败时，列表里那一行必须是「读不到」（muted），详情给错误态与真重试；
 * 不许画成「关着」，也不许留白。
 */
const text = intelligenceNotificationText['zh-CN']
const CALENDAR_EVENT_ID = 'market-intelligence.calendar.event-upcoming'

let root: Root | undefined

beforeEach(() => {
  clearAllWriteFailures()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  vi.restoreAllMocks()
})

function install(calendarFails: boolean): void {
  const productsInvoke = vi.fn(async (_productId: string, method: string) => {
    if (String(method).includes('getNewsPushThreshold')) return { pushThreshold: 'medium' }
    if (String(method).includes('getNewsPushOutletState')) return { enabled: true }
    if (String(method).includes('getCalendarReminderSettings')) {
      if (calendarFails) throw new Error('read failed')
      return { enabled: true, leadMinutes: 60, importance: ['high'], landedFilter: 'also-matched' }
    }
    return { enabled: false }
  })
  ;(window as unknown as { platform: unknown }).platform = {
    notifications: {
      getChannelEvents: vi.fn(async () => ({})),
      setChannelEvent: vi.fn(async (eventId: string, enabled: boolean) => ({ eventId, enabled })),
      getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, desktopEnabled: false, pushWired: true, channels: [{ deliverable: true }], lastPushFailureAt: null, lastPushFailureReason: null })),
      getSurfaceSelection: vi.fn(async () => ({ key: 'calendar-events', available: ['channel', 'toast'], selection: { channel: true, toast: true }, conflict: false })),
      setSurfaceSelection: vi.fn(async () => undefined)
    },
    products: { invoke: productsInvoke }
  }
}

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<ShellLanguageProvider language="zh-CN"><NotificationSettingsPanel variant="drawer" /></ShellLanguageProvider>)
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

async function selectCalendar(container: HTMLElement): Promise<void> {
  const row = [...container.querySelectorAll<HTMLButtonElement>('.intelligence-provider-row')]
    .find((button) => button.textContent?.includes(text['pages.intelligence.notification.rows.calendar.title']))
  await act(async () => { row?.click(); await Promise.resolve() })
}

describe('an unreadable calendar settings block is never drawn as off', () => {
  it('says unreadable on its own row and offers a real retry, not an off switch', async () => {
    install(true)
    const container = await render()

    const row = container.querySelector('[data-setting-key="setting:notifications.calendar.enabled"]')
    expect(row?.textContent).toContain(text['pages.intelligence.notification.status.unreadable'])
    expect(row?.textContent).not.toContain(text['pages.intelligence.notification.status.off'])
    // 读不到时**不画开关**：一颗灰开关会被读成「关着」。
    expect(row?.querySelector('button[role="switch"]')).toBeNull()
    // 真重试：可点的按钮，不是一句话。
    expect([...(row?.querySelectorAll('button') ?? [])].length).toBeGreaterThan(0)

    // 条件区块跟着消失（条件属于那一刻读到的值，读不到就不画）。
    expect(container.querySelector('.intelligence-notification-drawer')?.textContent)
      .not.toContain(text['pages.intelligence.notification.calendarSection'])
  })

  it('keeps the row explanation in the ⓘ, not in the row body', async () => {
    install(false)
    const container = await render()
    const row = container.querySelector('.intelligence-notification-form-row')
    const info = text['pages.intelligence.notification.rows.signalTriggered.info'] ?? ''
    expect(row?.textContent ?? '').not.toContain(info)
    const trigger = [...(row?.querySelectorAll('button') ?? [])]
      .find((button) => button.getAttribute('aria-label') === info)
    expect(trigger).toBeDefined()
  })
})
