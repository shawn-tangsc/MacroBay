// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { clearAllWriteFailures } from './channelEventWriteFailures'
import { NotificationDrawerScreen } from './NotificationDrawerScreen'
import { NotificationPageScreen } from './NotificationPageScreen'
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
    // 两份样式一起注入：组件那份给 flat 的复位，**本屏那份也可能偷偷写第二份压平规则**——
    // 只注入组件那份，屏里再写一份 border 也量不出来（那就是假绿）。
    for (const file of [
      'platform/ui/components/settings-section/styles.css',
      'products/market-intelligence/desktop/settings/intelligence-notification/intelligence-notification.css'
    ]) {
      const style = document.createElement('style')
      style.textContent = readFileSync(file, 'utf8')
      document.head.append(style)
    }

    install()
    const container = await render()
    const blocks = [...container.querySelectorAll<HTMLElement>('.intelligence-notification-drawer .settings-section')]
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block.getAttribute('data-variant')).toBe('flat')
      const computed = getComputedStyle(block)
      // 卡内区块：**边框 0、底色透明、内距 0**（左右也 0——旧的压平覆盖是横向内距）。
      expect([computed.borderTopWidth, computed.borderRightWidth, computed.borderBottomWidth, computed.borderLeftWidth])
        .toEqual(['0px', '0px', '0px', '0px'])
      expect([computed.paddingTop, computed.paddingRight, computed.paddingBottom, computed.paddingLeft])
        .toEqual(['0px', '0px', '0px', '0px'])
      // `background: none` 在 happy-dom 里读成 `none`，浏览器里是透明；两种都算「没底色」。
      expect(['transparent', 'rgba(0, 0, 0, 0)', 'none']).toContain(computed.backgroundColor)
      const header = block.querySelector<HTMLElement>('.settings-section__header')
      expect(header).not.toBeNull()
      const headerStyle = getComputedStyle(header!)
      expect(headerStyle.borderBottomWidth).toBe('0px')
      // 卡头复位成 `0 0 8px`；左右那 12 是**对齐覆盖**（标题左缘 == 行标签左缘），不是压平。
      expect([headerStyle.paddingTop, headerStyle.paddingBottom]).toEqual(['0px', '8px'])
      expect([headerStyle.paddingLeft, headerStyle.paddingRight]).toEqual(['12px', '12px'])
    }
    // 区块里的内容还在（不是把整块画没了）。
    expect(container.textContent).toContain(text['pages.intelligence.notification.calendarSection'])
  })

  it('leaves the settings page on the card variant: only the drawer is flat', async () => {
    for (const file of [
      'platform/ui/components/settings-section/styles.css',
      'products/market-intelligence/desktop/settings/intelligence-notification/intelligence-notification.css'
    ]) {
      const style = document.createElement('style')
      style.textContent = readFileSync(file, 'utf8')
      document.head.append(style)
    }
    install()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<ShellLanguageProvider language="zh-CN"><NotificationPageScreen /></ShellLanguageProvider>)
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const block = container.querySelector<HTMLElement>('.settings-section')
    expect(block).not.toBeNull()
    // 设置页那边区块自己就是容器：不传 variant，保持卡片档。
    // 只断 `data-variant`：`border: 1px solid var(--border)` 在 happy-dom 里 var() 解不出来，
    // 量 `borderTopWidth` 会得到空串（那是量具的限制，不是「框没了」）。
    expect(block!.getAttribute('data-variant')).toBe('card')
  })
})
