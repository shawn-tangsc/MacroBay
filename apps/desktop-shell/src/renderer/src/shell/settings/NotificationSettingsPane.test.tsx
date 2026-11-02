// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { notificationDeliveryWired } from '@platform/notifications/contracts/notificationContracts'
import { createDefaultNotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'

import { platformText } from '../../i18n/platformText'
import { NotificationSettingsPane } from './NotificationSettingsPane'

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
})

async function mount(
  onChange = vi.fn(),
  settings = createDefaultNotificationRuntimeSettings()
): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      createElement(NotificationSettingsPane, {
        title: platformText['zh-CN'].settings.notifications,
        notice: null,
        settings,
        labels: platformText['zh-CN'].notifications,
        onChange
      })
    )
  )
  return container
}

describe('notification settings availability', () => {
  it('presents working switches and no explanation once the first producer is wired', async () => {
    // 逐个渠道钉住：可点状态等于「这条渠道有没有用户看得见的落点」，不是一个布尔量。
    expect(notificationDeliveryWired).toEqual({ center: true, desktop: true, toast: true, popup: false })

    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const switches = [...container.querySelectorAll('.notification-channel-switch')]

    // 那句「平台还没有产生通知的来源」已经不在任何状态里成立，键和分支都已删除。
    expect(container.textContent).not.toContain('平台目前还没有产生通知的来源')
    // 通知中心常开、已从设置页移除；弹窗能力还没做，整行不渲染：只剩两条投递开关。
    expect(switches).toHaveLength(2)
    expect(switches.every((control) => !(control as HTMLButtonElement).disabled)).toBe(true)
    expect(container.textContent).toContain(labels.scopeNote)
  })

  it('tells the reader what to do, instead of drawing a permission state we cannot read', async () => {
    const readDesktopPermission = vi.fn(async () => 'unknown')
    Object.assign(globalThis, { platform: { notifications: { readDesktopPermission } } })

    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const hint = container.querySelector('[data-desktop-gate-hint]')

    // 静态说明替代状态行：适配器恒返回 unknown，每次打开都写同一句等于没有信息量。
    expect(hint?.textContent).toBe(labels.desktopSystemGateHint)
    expect(hint?.textContent).toContain('系统设置')
    // 也不再读授权：读不到的状态画成三种颜色，用户会当成事实。
    expect(readDesktopPermission).not.toHaveBeenCalled()
    expect(container.querySelector('[data-desktop-permission]')).toBeNull()
  })

  it('没有落点的渠道整行不渲染：禁用一个不存在的能力等于说这里本来有', async () => {
    const container = await mount()
    const labels = platformText['zh-CN'].notifications

    // 弹窗属于「能力没有」这一档：不渲染，也就没有「为什么不能用」要解释。
    // 按结构断言，不按整屏文字：建议行里仍提到「高优先级弹窗」（那句文案待营销改），
    // 用文字断言会把文案问题当成渲染问题。
    const rows = [...container.querySelectorAll('.notification-channel-row')]
    const titles = rows.map((row) => row.querySelector('.notification-channel-title')?.textContent)
    expect(titles).toEqual([labels.toastEnabled, labels.desktopEnabled])
    // 这条屏上没有任何一个「未启用」式的通用徽标。
    expect([...container.querySelectorAll('.ant-tag')]).toHaveLength(0)
  })
})

describe('notification settings styles', () => {
  const styles = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
  const paneSource = readFileSync(resolve(__dirname, './NotificationSettingsPane.tsx'), 'utf8')

  it('defines every class the pane renders', () => {
    // A class name with no rule is invisible in review and silently drops the layout it was added
    // for: the delivery switches lost their right alignment exactly this way.
    const used = [...paneSource.matchAll(/className="([a-z0-9 -]+)"/g)]
      .flatMap((match) => match[1].split(' '))
      .filter((name) => name.startsWith('notification-'))

    expect(used.length).toBeGreaterThan(0)
    // Match a whole class selector, not a prefix: `.notification-channel-controls-extra` must not
    // satisfy `.notification-channel-controls`.
    expect(used.filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(styles))).toEqual([])
  })
})

describe('同一屏不许有两种说法', () => {
  it('测试提示不下结论，把「去系统设置放行」指向上面那句说明', async () => {
    const labels = platformText['zh-CN'].notifications
    const english = platformText['en-US'].notifications

    // 不再引用任何「权限状态」：那行状态已经删掉，提示必须自己给出下一步。
    expect(labels.sendTestHint).not.toMatch(/多半是系统/)
    expect(english.sendTestHint).not.toMatch(/probably blocked/)
    expect(labels.sendTestHint).toContain('系统设置')
    expect(english.sendTestHint).toContain('System Settings')
    // 与上面那条门禁说明指向同一处，不留第二套说法。
    expect(labels.desktopSystemGateHint).toContain('系统设置 › 通知')
  })
})

describe('发送测试通知的反馈', () => {
  it('点完当场给出结果，不是点了没反应', async () => {
    const sendTest = vi.fn(async () => ({
      record: { id: 'test-1' },
      delivery: [
        { channel: 'toast', result: 'sent' },
        { channel: 'desktop', result: 'handed-to-system' }
      ]
    }))
    Object.assign(globalThis, { platform: { notifications: { sendTest } } })

    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === labels.sendTest)
    expect(button).toBeDefined()

    await act(async () => {
      button!.click()
      await Promise.resolve()
    })

    expect(sendTest).toHaveBeenCalledTimes(1)
    // 横幅真的出了才说「已出现」，桌面那条只说「交给系统了」——交给系统不等于用户看到。
    const result = container.querySelector('[data-send-test-result]')?.textContent ?? ''
    expect(result).toContain(labels.sendTestSent)
    expect(result).toContain(labels.sendTestDesktopQueued)
  })

  it('横幅关着就如实说它不会出现，并指向铃铛', async () => {
    Object.assign(globalThis, {
      platform: {
        notifications: {
          sendTest: vi.fn(async () => ({
            record: { id: 'test-2' },
            delivery: [{ channel: 'toast', result: 'skipped', reason: 'toast-disabled' }]
          }))
        }
      }
    })

    const container = await mount(vi.fn(), { ...createDefaultNotificationRuntimeSettings(), toastEnabled: false })
    const labels = platformText['zh-CN'].notifications
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === labels.sendTest)

    await act(async () => {
      button!.click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-send-test-result]')?.textContent).toBe(labels.sendTestToastOff)
  })

  it('发不出去时说的是「没发出去」，不是「已发送」', async () => {
    Object.assign(globalThis, {
      platform: { notifications: { sendTest: vi.fn(async () => Promise.reject(new Error('ipc down'))) } }
    })

    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === labels.sendTest)

    await act(async () => {
      button!.click()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-send-test-result]')?.textContent).toBe(labels.sendTestFailed)
  })

  it('桌面那条失败时把原因说出来，而不是只说「已发送」', async () => {
    Object.assign(globalThis, {
      platform: {
        notifications: {
          sendTest: vi.fn(async () => ({
            record: { id: 'test-3' },
            delivery: [
              { channel: 'toast', result: 'sent' },
              { channel: 'desktop', result: 'failed', reason: 'notifications-disabled' }
            ]
          }))
        }
      }
    })

    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent === labels.sendTest)

    await act(async () => {
      button!.click()
      await Promise.resolve()
    })

    // 用户点这个按钮就是为了判断「系统放没放行」，原因被吞掉等于没测。
    expect(container.querySelector('[data-send-test-result]')?.textContent).toContain(
      labels.sendTestDesktopFailed('notifications-disabled')
    )
  })
})
