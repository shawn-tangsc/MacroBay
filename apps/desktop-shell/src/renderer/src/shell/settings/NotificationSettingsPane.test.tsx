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

  it('桌面渠道如实报授权状态：读不到就说读不到，不替系统背锅', async () => {
    Object.assign(globalThis, {
      platform: { notifications: { readDesktopPermission: vi.fn(async () => 'unknown') } }
    })

    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const state = container.querySelector('[data-desktop-permission]')

    // 「读不到」和「系统没放行」对用户是两件事：混用会把人送进系统设置白找一圈。
    expect(state?.getAttribute('data-desktop-permission')).toBe('unknown')
    expect(state?.textContent).toBe(labels.desktopPermissionUnknown)
    expect(container.textContent).not.toContain(labels.desktopPermissionDenied)
  })

  it('系统明确拒绝时说要自己去开', async () => {
    Object.assign(globalThis, {
      platform: { notifications: { readDesktopPermission: vi.fn(async () => 'denied') } }
    })

    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    expect(container.querySelector('[data-desktop-permission="denied"]')?.textContent).toBe(
      labels.desktopPermissionDenied
    )
  })

  it('「能力有但被挡住」的那条：渲染 + 禁用 + 原因与控件关联', async () => {
    Object.assign(globalThis, {
      platform: { notifications: { readDesktopPermission: vi.fn(async () => 'denied') } }
    })

    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const reason = container.querySelector('[data-desktop-permission="denied"]')
    const desktopSwitch = [...container.querySelectorAll<HTMLButtonElement>('.notification-channel-switch')].at(-1)

    expect(reason?.textContent).toBe(labels.desktopPermissionDenied)
    // 只挂 role="note" 不关联控件，读屏走到开关时听不到原因。
    expect(desktopSwitch?.getAttribute('aria-describedby')).toBe(reason?.getAttribute('id'))
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
  it('测试提示不下结论，把判断交给上面那条权限状态', async () => {
    const labels = platformText['zh-CN'].notifications
    const english = platformText['en-US'].notifications

    // 上面一行写着「暂时无法确认」时，下面一行说「多半是系统拦的」，用户会以为结论是确定的。
    expect(labels.sendTestHint).not.toMatch(/多半是系统/)
    expect(english.sendTestHint).not.toMatch(/probably blocked/)
    expect(labels.sendTestHint).toContain('权限状态')
    expect(english.sendTestHint).toContain('permission status')
  })

  it('原因说的是「现在是否成立」：窗口重新获得焦点会重读一次', async () => {
    let state: 'granted' | 'denied' | 'unknown' = 'denied'
    const readDesktopPermission = vi.fn(async () => state)
    Object.assign(globalThis, { platform: { notifications: { readDesktopPermission } } })

    const container = await mount()
    expect(container.querySelector('[data-desktop-permission="denied"]')).not.toBeNull()

    // 用户去系统设置放行后切回来：不重读的话，这行还写着「没放行」，他会再改一遍。
    state = 'granted'
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    expect(readDesktopPermission.mock.calls.length).toBeGreaterThan(1)
    expect(container.querySelector('[data-desktop-permission="denied"]')).toBeNull()
    expect(container.querySelector('[data-desktop-permission="granted"]')).not.toBeNull()
  })
})

describe('发送测试通知的反馈', () => {
  it('点完当场给出结果，不是点了没反应', async () => {
    const sendTest = vi.fn(async () => ({ id: 'test-1' }))
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
    // 横幅开着：告诉他去哪看，而不是只回一句「已发送」。
    expect(container.querySelector('[data-send-test-result]')?.textContent).toBe(labels.sendTestSent)
  })

  it('横幅关着就如实说它不会出现，并指向铃铛', async () => {
    Object.assign(globalThis, { platform: { notifications: { sendTest: vi.fn(async () => ({ id: 'test-2' })) } } })

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
})
