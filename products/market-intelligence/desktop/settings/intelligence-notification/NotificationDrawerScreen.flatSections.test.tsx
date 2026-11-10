// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { clearAllWriteFailures } from './channelEventWriteFailures'
import { NotificationDrawerScreen } from './NotificationDrawerScreen'
import { intelligenceNotificationText } from './text'

/**
 * 抽屉内容本来就在一张卡里：区块必须用 `variant="flat"`（用户 2026-11-11，`6887263` 加的那一档）。
 * 以前靠 `configDrawer.css` 的三条作用域覆盖临时压平，那是过渡；调用点传了 flat 之后，
 * 前端组件才能删那三条覆盖。
 *
 * 判据是**计算值**：注入区块自己的样式表，量第一个区块与它的卡头——
 * 边框 0、底色透明、内距 0、卡头无底线。少任一复位就会红。
 */
const text = intelligenceNotificationText['zh-CN']
let root: Root | undefined

beforeEach(() => { clearAllWriteFailures() })
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  document.head.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
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

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<ShellLanguageProvider language="zh-CN"><NotificationDrawerScreen /></ShellLanguageProvider>)
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

describe('抽屉里的区块是 flat 档', () => {
  it('renders every block flat: no border, no background, no padding, no header rule', async () => {
    const css = readFileSync('platform/ui/components/settings-section/styles.css', 'utf8')
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)

    install()
    const container = await render()
    const blocks = [...container.querySelectorAll<HTMLElement>('.intelligence-notification-drawer .settings-section')]
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block.getAttribute('data-variant')).toBe('flat')
      const computed = getComputedStyle(block)
      expect(computed.borderTopWidth).toBe('0px')
      expect(computed.paddingTop).toBe('0px')
      // `background: none` 在 happy-dom 里读成 `none`，浏览器里是透明；两种都算「没底色」。
      expect(['transparent', 'rgba(0, 0, 0, 0)', 'none']).toContain(computed.backgroundColor)
      const header = block.querySelector<HTMLElement>('.settings-section__header')
      expect(header).not.toBeNull()
      expect(getComputedStyle(header!).borderBottomWidth).toBe('0px')
    }
    // 区块里的内容还在（不是把整块画没了）。
    expect(container.textContent).toContain(text['pages.intelligence.notification.calendarSection'])
  })
})
