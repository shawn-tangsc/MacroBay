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
  it('splits the drawer into the catalog and the detail pane at any container width', async () => {
    // 分栏屏吃满宽度、任何窗口宽度都不切下拉（860 只属设置页）。左列表是目录行，不是下拉。
    const previous = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    try {
      const container = await renderPanel('drawer')
      const split = container.querySelector('.config-drawer__split.intelligence-notification-split')
      expect(split).not.toBeNull()
      expect([...(split?.children ?? [])]).toHaveLength(2)
      expect(split?.children[0]?.className).toContain('intelligence-catalog-pane')
      expect(split?.children[1]?.className).toContain('settings-detail-pane')
      expect(container.querySelectorAll('.intelligence-catalog-pane .intelligence-provider-row')).toHaveLength(4)
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
    // 抽屉自己有这一屏的页名；再画一遍面板标题就不是同一套语言了。**不渲染**，不是 CSS 藏。
    const drawer = await renderPanel('drawer')
    expect(drawer.querySelector('.intelligence-notification-title')).toBeNull()
    expect(drawer.textContent).not.toContain(groupTitle)

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    const page = await renderPanel('page')
    expect(page.querySelector('.intelligence-notification-title')?.textContent).toBe(groupTitle)
  })

  it('keeps the explanation attached to the notice it explains, above the two columns', async () => {
    // 「为什么勾了还不响」不许单独悬空：抽屉里它挂在通道提示这一条上，提示在两栏上方；
    // 行自己的说明由该行声明里的 helpKey 给（`showHelp`），不在组件里另写句子。
    const infoAria = text['pages.intelligence.notification.infoAria']
    const drawer = await renderPanel('drawer')
    const notice = drawer.querySelector('.intelligence-notification-panel__notice')
    expect(notice).not.toBeNull()
    // 提示在上、两栏在下：读者先知道不通，再看内容。
    expect(notice?.nextElementSibling?.className).toContain('intelligence-notification-split')
    const trigger = [...(notice?.querySelectorAll('button') ?? [])]
      .find((button) => button.getAttribute('aria-label') === infoAria)
    expect(trigger, '提示旁必须有那颗 ⓘ').toBeDefined()

    await act(async () => {
      trigger?.focus()
      trigger?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      await Promise.resolve()
    })
    expect(document.querySelector('[data-popover-line="0"]')?.textContent).toBe(
      text['pages.intelligence.notification.channelNotReady']
    )

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    // 设置页那一面形状不变：标题与整组 ⓘ 仍在同一个 head 里。
    const page = await renderPanel('page')
    expect(page.querySelector('.intelligence-notification-head .intelligence-notification-title')).not.toBeNull()
    expect([...page.querySelectorAll('.intelligence-notification-head button')]
      .some((button) => button.getAttribute('aria-label') === infoAria)).toBe(true)
  })
})
