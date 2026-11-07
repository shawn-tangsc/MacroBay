// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'

import { NotificationSettingsScreen } from './NotificationSettingsScreen'
import { notificationSettingsText } from './notifications/notificationSettingsText'
import type { NotificationSettingsClient } from './notifications/useNotificationSettingsData'

let root: Root | undefined

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = undefined
  document.body.innerHTML = ''
})

const text = notificationSettingsText['zh-CN']

function client(overrides: Partial<NotificationSettingsClient> = {}): NotificationSettingsClient {
  return {
    getDeliverySettings: async () => ({ toastEnabled: false, desktopEnabled: false }),
    setToastEnabled: async () => ({}),
    setDesktopEnabled: async () => ({}),
    sendTest: async () => ({ state: 'sent' as const, channelId: 'slack', channelName: 'Slack' }),
    ...overrides
  }
}

async function mount(settings: NotificationSettingsClient): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      createElement(NotificationSettingsScreen, {
        title: '通知',
        language: 'zh-CN',
        client: settings
      })
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  return container
}

describe('notification settings is two switches, one test button and a footer', () => {
  it('renders only that: no event list, no channel control, no fixed-on label', async () => {
    const container = await mount(client())

    expect(container.querySelectorAll('button[role="switch"]')).toHaveLength(2)
    expect(container.querySelector('[data-send-test]')).not.toBeNull()
    expect(container.querySelector('.notification-footer')?.textContent).toContain(text.footerLine)

    // 订阅层 v2.20 撤销后，这些对象一个都不该留在屏上。
    expect(container.textContent).not.toContain('固定开启')
    expect(container.textContent).not.toContain('发送到频道')
    expect(container.textContent).not.toContain('订阅')
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('select')).toBeNull()
  })

  it('never prints counts on the page', async () => {
    const container = await mount(client())
    expect(container.textContent).not.toMatch(/\b(1[0-9])\s*(行|条|类)\b/)
  })

  it('keeps both switches off by default and reflects what the main process stored', async () => {
    const off = await mount(client())
    for (const element of off.querySelectorAll('button[role="switch"]')) {
      expect(element.getAttribute('aria-checked')).toBe('false')
    }

    const on = await mount(
      client({ getDeliverySettings: async () => ({ toastEnabled: true, desktopEnabled: true }) })
    )
    for (const element of on.querySelectorAll('button[role="switch"]')) {
      expect(element.getAttribute('aria-checked')).toBe('true')
    }
  })

  it('does not turn a switch on when the write failed, and says it was not saved', async () => {
    const container = await mount(
      client({ setToastEnabled: async () => Promise.reject(new Error('write-failed')) })
    )
    const toast = container.querySelectorAll('button[role="switch"]')[0]!

    await act(async () => {
      toast.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.querySelectorAll('button[role="switch"]')[0]!.getAttribute('aria-checked')).toBe('false')
    expect(container.querySelector('[data-notification-write-failed]')?.textContent).toContain(text.writeFailed)
    // 不给内部码，也不假装成功。
    expect(container.textContent).not.toContain('write-failed')
  })

  it('turns the switch on only after the main process accepted the write', async () => {
    const container = await mount(client())
    const toast = container.querySelectorAll('button[role="switch"]')[0]!

    await act(async () => {
      toast.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.querySelectorAll('button[role="switch"]')[0]!.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('[data-notification-write-failed]')).toBeNull()
  })

  it('shows the three hint triggers, and the desktop one explains what we cannot read', async () => {
    const container = await mount(client())
    const hints = container.querySelectorAll('button[aria-label]')
    const labels = [...hints].map((element) => element.getAttribute('aria-label'))
    expect(labels).toContain('应用内提示')
    expect(labels).toContain('桌面提醒')

    // 桌面说明必须说清：读不到系统开关、去哪儿开、怎么自验。
    const hint = text.desktopHint
    expect(hint).toContain('看不到')
    expect(hint).toContain('系统设置 › 通知 › MacroBay')
    expect(hint).toContain('发送测试通知')

    // 假状态一个都不许出现：Electron 读不到系统开关，画三档就是一句恒定的假结论。
    expect(container.textContent).not.toContain('系统已放行')
    expect(container.textContent).not.toContain('暂时无法确认')
  })

  it('names the channel on success and never promises the reader saw anything', async () => {
    const container = await mount(
      client({ sendTest: async () => ({ state: 'sent' as const, channelId: 'slack', channelName: 'Slack' }) })
    )
    const button = container.querySelector('[data-send-test]') as HTMLElement
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    const receipt = container.querySelector('[data-send-test-result]')
    // 成功必须点名通道：只写「已发送」等于没回答读者「发到哪」。
    expect(receipt?.textContent).toContain('已发到 Slack（测试）')
    expect(container.textContent).not.toContain('已送达')
    expect(container.textContent).not.toContain('已显示')
  })

  it('uses the platform state surfaces for loading and read failure', async () => {
    const loading = await mount({
      getDeliverySettings: () => new Promise(() => undefined)
    })
    // 平台唯一的加载件，不是自己写的转圈或裸「加载中」段落。
    expect(loading.querySelector('[data-loading-state]')).not.toBeNull()
    expect(LoadingState).toBeTypeOf('function')

    await act(async () => {
      root?.unmount()
    })
    root = undefined
    document.body.innerHTML = ''

    const failed = await mount(
      client({ getDeliverySettings: async () => Promise.reject(new Error('read-failed')) })
    )
    expect(failed.querySelector('[data-state="error"]')).not.toBeNull()
    expect(StateView).toBeTypeOf('function')
    expect(failed.textContent).not.toContain('read-failed')
    // 读不到 ≠ 两个都关着：失败时一个开关都不画。
    expect(failed.querySelectorAll('button[role="switch"]')).toHaveLength(0)
  })

  it('shows the write failure sentence once, even after two failed writes', async () => {
    const setToastEnabled = vi.fn(async () => Promise.reject(new Error('no')))
    const container = await mount(client({ setToastEnabled }))
    const toast = container.querySelectorAll('button[role="switch"]')[0]!

    for (let index = 0; index < 2; index += 1) {
      await act(async () => {
        toast.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(container.querySelectorAll('[data-notification-write-failed]')).toHaveLength(1)
  })

  it('says only 「没发出去」 in the sentence and puts the reason code in a collapsed area', async () => {
    const container = await mount(
      client({ sendTest: async () => ({ state: 'unavailable' as const, reasonCode: 'push-unavailable', enabledChannelCount: 0 }) })
    )
    const button = container.querySelector('[data-send-test]') as HTMLElement
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const sentence = container.querySelector('[data-send-test-result] p')?.textContent ?? ''
    expect(sentence).toContain(text.testUnavailable)
    // 码只在折叠区：主句里 0 次，展开后恰 1 处，而且是返回值里的原码。
    expect(sentence).not.toContain('push-unavailable')
    const details = container.querySelector('[data-send-test-result] details')
    expect(details?.hasAttribute('open')).toBe(false)
    expect(details?.textContent).toContain('push-unavailable')
  })
})
