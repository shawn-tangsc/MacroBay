// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  GeneratedProductMenuEntry,
  GeneratedProductSettingsDrawerEntry
} from '@platform/product-registry/types'
import { APP_NAVIGATE_EVENT } from '@platform/workspace/navigation/navigationRequest'

import { platformText } from '../../i18n/platformText'

import { NotificationCenterDrawer } from './NotificationCenterDrawer'
import {
  openNotificationCenterSettings,
  resolveNotificationCenterSettingsEntry
} from './notificationCenterSettingsEntry'

/**
 * 通知中心那颗「去设置」的判据：**按产品注册的数据渲染**。
 *
 * - 产品还没声明抽屉（今天就是）→ 0 个按钮、0 次 dispatch；
 * - 声明了 `notifications` 一屏、且有唯一产品页可落 → 恰好 1 个按钮，点击 dispatch 带
 *   `{ productId, menuId }`，走既有 `app-shell:navigate`（不新增事件名）。
 */
const labels = platformText['zh-CN'].notifications

const forgedDrawer: GeneratedProductSettingsDrawerEntry = {
  productId: 'sample-product',
  productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
  menus: ['notifications', 'sources']
}

const forgedMenu: GeneratedProductMenuEntry = {
  id: 'sample-product.home',
  productId: 'sample-product',
  productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
  title: { 'zh-CN': '示例', 'en-US': 'Sample' },
  icon: 'radar',
  order: 10,
  routePath: '/sample-product/home',
  load: async () => ({})
} as unknown as GeneratedProductMenuEntry

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mountDrawer(detail: Parameters<typeof NotificationCenterDrawer>[0]): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(NotificationCenterDrawer, detail))
  })
  return container
}

const source = {
  list: async () => ({ items: [] }),
  unread: async () => ({ unread: 0, version: 1 }),
  markAllRead: async () => ({ unread: 0, version: 1 }),
  deleteRead: async () => ({ deleted: 0 }),
  markRead: async (id: string) => ({ id }),
  onChanged: () => () => undefined
} as unknown as Parameters<typeof NotificationCenterDrawer>[0]['source']

describe('the notification centre settings entry follows the registry', () => {
  it('renders nothing and dispatches nothing when no product declares a settings drawer', async () => {
    const entry = resolveNotificationCenterSettingsEntry([], [])
    expect(entry).toBeNull()

    const container = await mountDrawer({
      open: true,
      onClose: () => undefined,
      labels,
      onOpenDeeplink: () => undefined,
      source,
      settingsEntry: entry
    })

    const dispatch = vi.fn()
    window.addEventListener(APP_NAVIGATE_EVENT, dispatch)

    expect(document.querySelectorAll('[data-notification-open-settings]')).toHaveLength(0)
    expect(dispatch).toHaveBeenCalledTimes(0)
    window.removeEventListener(APP_NAVIGATE_EVENT, dispatch)
  })

  it('renders exactly one entry from a declared drawer and dispatches the drawer request', async () => {
    const entry = resolveNotificationCenterSettingsEntry([forgedDrawer], [forgedMenu])
    expect(entry).toEqual({ productId: 'sample-product', menuId: 'notifications', routePath: '/sample-product/home' })

    const onOpenSettings = vi.fn()
    const container = await mountDrawer({
      open: true,
      onClose: () => undefined,
      labels,
      onOpenDeeplink: () => undefined,
      source,
      settingsEntry: entry,
      onOpenSettings
    })

    const button = document.querySelector<HTMLButtonElement>('[data-notification-open-settings]')
    expect(document.querySelectorAll('[data-notification-open-settings]')).toHaveLength(1)
    expect(button?.textContent).toBe(labels.centerOpenSettings)

    await act(async () => { button?.click() })
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(onOpenSettings).toHaveBeenCalledWith(entry)

    // 动作本身：一次导航，detail 里带抽屉请求；外壳打开产品页后由产品页消费。
    const details: Array<Record<string, unknown>> = []
    const listener = ((event: CustomEvent) => { details.push(event.detail as Record<string, unknown>) }) as EventListener
    window.addEventListener(APP_NAVIGATE_EVENT, listener)
    openNotificationCenterSettings(entry!)
    window.removeEventListener(APP_NAVIGATE_EVENT, listener)

    expect(details).toEqual([
      { navKey: '/sample-product/home', settingsDrawer: { productId: 'sample-product', menuId: 'notifications' } }
    ])
  })

  it('stays out of the way when two products declare the same menu', () => {
    const second = { ...forgedDrawer, productId: 'other-product' }
    expect(resolveNotificationCenterSettingsEntry([forgedDrawer, second], [forgedMenu])).toBeNull()
  })
})
