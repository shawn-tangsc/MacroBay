// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { NotificationSettingsPanel } from './NotificationSettingsPanel'
import { intelligenceNotificationText } from './text'

/**
 * 宽窄两种形态**只属于设置页**。
 *
 * 设置页挂在外壳三列里，窗口 1280 时它可能只剩 600，所以要量它自己的宽度：**849 换下拉、860 双栏**。
 *
 * 配置抽屉**固定宽版**：抽屉恒 `full`(1040)，扣掉菜单 208 与内边距 32 只剩约 800——在那里量宽
 * 只会「永远 < 860、永远只有下拉」，读者再也看不到列表。所以 `variant='drawer'` 不量、不切。
 */
const text = intelligenceNotificationText['zh-CN']
const groupTitle = text['pages.intelligence.notification.groupTitle']

const EVENT_IDS = {
  signal: 'notifications.channel-event.signal-triggered',
  briefing: 'notifications.channel-event.briefing-ready'
}

function installPlatform(): void {
  const productsInvoke = vi.fn(async (_productId: string, method: string) => {
    if (method.includes('getNewsPushThreshold') || method.includes('saveNewsPushThreshold')) return { pushThreshold: 'medium' }
    if (method.includes('getNewsPushOutletState') || method.includes('setNewsPushOutletEnabled')) return { enabled: true }
    if (method.includes('getCalendarReminderSettings')) return { enabled: false, leadMinutes: 60, importance: ['high'], landedFilter: 'surprise-only' }
    if (method.includes('setCalendarReminderSettings')) return { enabled: false, leadMinutes: 60, importance: ['high'], landedFilter: 'surprise-only' }
    return { enabled: false }
  })
  ;(window as unknown as { platform: unknown }).platform = {
    notifications: {
      getChannelEvents: vi.fn(async () => ({ [EVENT_IDS.signal]: true, [EVENT_IDS.briefing]: true })),
      setChannelEvent: vi.fn(async (eventId: string, enabled: boolean) => ({ eventId, enabled })),
      getDeliverySettings: vi.fn(async () => ({ toastEnabled: true, desktopEnabled: false, pushWired: true, channels: [], lastPushFailureAt: null, lastPushFailureReason: null })),
      getSurfaceSelection: vi.fn(async () => ({ key: 'calendar-events', available: ['channel', 'toast'], selection: { channel: true, toast: true }, conflict: false })),
      setSurfaceSelection: vi.fn(async () => ({ key: 'calendar-events', available: ['channel', 'toast'], selection: { channel: true, toast: true }, conflict: false }))
    },
    products: { invoke: productsInvoke }
  }
}

let root: Root | undefined
let sectionWidth = 1280

beforeEach(() => {
  sectionWidth = 1280
  installPlatform()
  // 量的是**设置页那一块的宽度**：happy-dom 的 `clientWidth` 恒为 0，不 stub 就永远走窗口兜底。
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('intelligence-notification-workspace') ? sectionWidth : 0
    }
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  vi.restoreAllMocks()
})

async function renderPanel(variant: 'page' | 'drawer', width?: number): Promise<HTMLElement> {
  if (width !== undefined) sectionWidth = width
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(NotificationSettingsPanel, { variant })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

describe('the notification settings panel layout', () => {
  it('keeps list + detail in the drawer at any container width', async () => {
    // 抽屉里可用宽度约 800（< 860）。这里连窗口宽度也压到 400，证明它**不看**任何宽度。
    const previous = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    try {
      const container = await renderPanel('drawer')
      const panes = container.querySelector('.intelligence-notification-panes')
      expect(panes).not.toBeNull()
      expect([...(panes?.children ?? [])]).toHaveLength(2)
      expect(container.querySelector('.intelligence-notification-list')).not.toBeNull()
      expect(container.querySelector('select')).toBeNull()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previous })
    }
  })

  it('still switches the settings page to the dropdown one pixel below 860', async () => {
    const container = await renderPanel('page', 849)
    expect(container.querySelector('select')).not.toBeNull()
    expect(container.querySelector('.intelligence-notification-list')).toBeNull()
  })

  it('keeps the settings page in two columns exactly at 860', async () => {
    const container = await renderPanel('page', 860)
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('.intelligence-notification-list')).not.toBeNull()
  })

  it('leaves the page-level heading to the drawer own title, and keeps it on the page', async () => {
    // 抽屉自己有这一屏的页名（16），再画一遍这颗 13.5 的标题，读者会读成两个层级。
    // **不渲染**，不是用 CSS 藏起来——藏起来它还在 DOM 里，读屏仍会念到。
    const drawer = await renderPanel('drawer')
    expect(drawer.querySelector('.intelligence-notification-title')).toBeNull()
    expect(drawer.textContent).not.toContain(groupTitle)

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    const page = await renderPanel('page')
    expect(page.querySelector('.intelligence-notification-title')).not.toBeNull()
    expect(page.querySelector('.intelligence-notification-title')?.textContent).toBe(groupTitle)
  })
})
