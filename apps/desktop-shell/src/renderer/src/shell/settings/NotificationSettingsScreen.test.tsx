// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { NotificationEventCatalogEntry } from '@platform/notifications/contracts/notificationEventCatalog'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { NotificationSettingsScreen } from './NotificationSettingsScreen'
import type { NotificationSettingsClient } from './notifications/useNotificationSettingsData'

let root: Root | undefined

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = undefined
  document.body.innerHTML = ''
})

function entry(overrides: Partial<NotificationEventCatalogEntry> = {}): NotificationEventCatalogEntry {
  return {
    id: 'platform.job.failed-terminal',
    titleKey: 'notification.job.failed',
    reasonKey: 'notification.reason.failed',
    requiresUserAction: true,
    requestedDisruptionLevels: ['desktop'],
    dedupeUnit: 'occurrence',
    notifyOnlyIfSubscribed: false,
    productId: 'platform',
    approvedDisruptionLevels: ['center', 'desktop'],
    approvedBypassQuietHours: false,
    ...overrides
  }
}

async function mount(client: NotificationSettingsClient): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      createElement(ShellTimeZoneProvider, {
        timeZone: 'Asia/Shanghai',
        children: createElement(NotificationSettingsScreen, {
          title: '通知',
          language: 'zh-CN',
          client
        })
      })
    )
  })
  return container
}

describe('desktop notification permission is not a fake state', () => {
  it('says what we cannot read, where to turn it on, and how to check it ourselves', async () => {
    const container = await mount({
      listEventCatalog: async () => [],
      getSubscriptions: async () => ({}),
      getDeliverySettings: async () => ({ toastEnabled: false })
    })
    await act(async () => {
      await Promise.resolve()
    })

    const hint = container.querySelector('[data-desktop-cannot-read]')
    expect(hint?.textContent).toContain('读不到')
    expect(hint?.textContent).toContain('系统设置 › 通知 › MacroBay')
    expect(hint?.textContent).toContain('发送测试通知')

    // 三档状态词一个都不许出现：Electron 读不到系统开关，画出来就是一句恒定的假结论。
    expect(container.textContent).not.toContain('系统已放行')
    expect(container.textContent).not.toContain('暂时无法确认')
    // 「去系统设置」那条链已删（`openExternal` 只放行 http(s)，点了会抛错）。
    expect(container.textContent).not.toContain('去系统设置')
    expect(container.querySelector('[data-row="desktop"] .status-pill')).toBeNull()
  })
})

describe('the event name column never shows an internal key', () => {
  it('names the rows the reader subscribed to, in both products and the platform', async () => {
    const container = await mount({
      listEventCatalog: () =>
        Promise.resolve([
          entry(),
          entry({ id: 'market-intelligence.briefing.failed', titleKey: 'notification.event.market-intelligence.briefing.failed.title', productId: 'market-intelligence' })
        ]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false })
    })

    const names = [...container.querySelectorAll('.notification-subs-name')].map((node) => node.textContent)
    expect(names).toContain('任务跑到终态仍失败')
    // 产品事件名同样读得出来：这一行以前会直接印出 `notification.event.market-intelligence.…`。
    expect(names).toContain('日报没生成出来')
  })

  it('says the name cannot be read instead of printing the key when there is no name for it', async () => {
    const container = await mount({
      listEventCatalog: () =>
        Promise.resolve([
          entry({ id: 'platform.something.new', titleKey: 'notification.something.new.title', productId: 'platform' })
        ]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false })
    })

    const name = container.querySelector('.notification-subs-name')?.textContent ?? ''
    expect(name).toBe('这一条的名称暂时读不出来')
    // 兜底不许回显键名，也不许把事件 id 当文字。
    expect(name).not.toContain('notification.')
    expect(name).not.toContain('platform.something.new')
  })
})

describe('notification settings screen', () => {
  it('waits with the platform loading surface instead of drawing an empty form', async () => {
    const container = await mount({
      listEventCatalog: () => new Promise(() => undefined),
      getSubscriptions: () => new Promise(() => undefined),
      getDeliverySettings: () => new Promise(() => undefined),
    })

    expect(container.querySelector('[data-loading-state], .loading-state')).not.toBeNull()
  })

  it('says the read failed instead of saying there is nothing to subscribe to', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.reject(new Error('boom')),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({}),
    })

    // 「读不到」与「没有」是两件事：这里绝不能说清单为空。
    expect(container.textContent).not.toContain('现在还没有可以订阅的事件')
    expect(container.querySelector('[data-state="error"]')).not.toBeNull()
  })

  it('draws the three cell forms: fixed label, unapproved dash, and a real checkbox', async () => {
    const container = await mount({
      listEventCatalog: () =>
        Promise.resolve([
          entry(),
          entry({
            id: 'market-intelligence.briefing.analyzed',
            titleKey: 'notification.briefing.analyzed',
            productId: 'market-intelligence',
            notifyOnlyIfSubscribed: true,
            // 只批了中心：桌面列是未批准 —— 这一格必须是灰色「—」，不是禁用的勾。
            approvedDisruptionLevels: ['center']
          })
        ]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false }),
    })

    // 无条件记录的事件：标签，不是控件。
    expect(container.querySelectorAll('.notification-subs-fixed').length).toBeGreaterThan(1)
    // 未批准的格子只出现「—」：它是文字，不是任何形态的控件。
    expect(container.querySelectorAll('.notification-subs-dash').length).toBeGreaterThan(0)
    // 结果类事件的记录格是可勾的。
    const recordBoxes = container.querySelectorAll('input[type="checkbox"][aria-label*="记录"]')
    expect(recordBoxes.length).toBe(1)
  })

  it('keeps four delivery rows and shows nothing about phones or channels', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false }),
    })

    expect(container.querySelector('[data-row="center"]')).not.toBeNull()
    expect(container.querySelector('[data-row="toast"]')).not.toBeNull()
    expect(container.querySelector('[data-row="desktop"]')).not.toBeNull()
    expect(container.querySelector('[data-row="popup"]')).not.toBeNull()
    // 没有任何「发到手机 / 通道绑定」的东西：这个能力还不存在，画出来就是一句现在为假的话。
    expect(container.querySelector('[data-row="channel"]')).toBeNull()
    expect(container.querySelector('select')).toBeNull()
    expect(container.textContent).not.toContain('通道')
  })

  it('tells an empty catalog apart from a failed read', async () => {
    const container = await mount({
      listEventCatalog: () => Promise.resolve([]),
      getSubscriptions: () => Promise.resolve({}),
      getDeliverySettings: () => Promise.resolve({ channels: [], toastEnabled: false }),
    })

    expect(container.querySelector('[data-subs-empty]')).not.toBeNull()
    // 空不等于错：这里不该出现错误视图。
    expect(container.querySelector('[data-state="error"]')).toBeNull()
  })
})
