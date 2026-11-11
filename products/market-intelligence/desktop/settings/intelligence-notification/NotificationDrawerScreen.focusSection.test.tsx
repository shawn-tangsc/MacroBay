// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { clearAllWriteFailures } from './channelEventWriteFailures'
import { NotificationDrawerScreen } from './NotificationDrawerScreen'

/**
 * `focus.notifications.section` 的判据：入口说了这一屏的哪一块，挂载时就把那一块带进视野一次。
 *
 * 三块的名字与 DOM 上的 `data-notification-section` 是同一套（推送提醒 / 舆情条件 / 日历提醒）——
 * 契约原先写的 `events` / `channels` / `quietHours` 在界面上根本不存在，加一层映射只会多一套词。
 */
let root: Root | undefined
let scrolled: HTMLElement[] = []
let scrollSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  clearAllWriteFailures()
  scrolled = []
  scrollSpy = vi.fn(function (this: HTMLElement) { scrolled.push(this) })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollSpy })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  document.head.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  vi.restoreAllMocks()
})

function install(): void {
  ;(window as unknown as { platform: unknown }).platform = {
    notifications: {
      getChannelEvents: vi.fn(async () => ({})),
      setChannelEvent: vi.fn(async (eventId: string, enabled: boolean) => ({ eventId, enabled })),
      getDeliverySettings: vi.fn(async () => ({
        toastEnabled: true,
        desktopEnabled: false,
        pushWired: true,
        channels: [{ deliverable: true }],
        lastPushFailureAt: null,
        lastPushFailureReason: null
      })),
      getSurfaceSelection: vi.fn(async () => ({
        key: 'calendar-events',
        available: ['channel', 'toast'],
        selection: { channel: true },
        conflict: false
      })),
      setSurfaceSelection: vi.fn(async () => undefined)
    },
    products: {
      invoke: vi.fn(async (_productId: string, method: string) => {
        if (String(method).includes('getNewsPushThreshold')) return { pushThreshold: 'medium' }
        if (String(method).includes('getNewsPushOutletState')) return { enabled: true }
        if (String(method).includes('getCalendarReminderSettings')) {
          return { enabled: true, leadMinutes: 60, importance: ['high'], landedFilter: 'surprise-only' }
        }
        return { enabled: false }
      })
    }
  }
}

async function render(initialSection?: 'push' | 'sentiment' | 'calendar'): Promise<HTMLElement> {
  install()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<ShellLanguageProvider language="zh-CN"><NotificationDrawerScreen {...(initialSection === undefined ? {} : { initialSection })} /></ShellLanguageProvider>)
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

describe('focus.notifications.section 落到那一块', () => {
  it('brings the named block into view once and marks it', async () => {
    const container = await render('calendar')
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    const marked = [...container.querySelectorAll<HTMLElement>('[data-focused="true"]')]
    expect(marked).toHaveLength(1)
    expect(marked[0]?.getAttribute('data-notification-section')).toBe('calendar')
  })

  it('leaves the reader alone when no section was asked for', async () => {
    const container = await render()
    expect(scrollSpy).not.toHaveBeenCalled()
    expect(container.querySelector('[data-focused]')).toBeNull()
  })
})
