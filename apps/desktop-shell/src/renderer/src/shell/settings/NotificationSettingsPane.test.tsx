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
    // 通知中心常开、已从设置页移除：只剩三个投递开关。
    expect(switches).toHaveLength(3)
    // 三条可点，弹窗那条不可点（它没有落点）——见下一例的逐渠道断言。
    expect(switches.filter((control) => (control as HTMLButtonElement).disabled)).toHaveLength(1)
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

  it('没落点的那条渠道单独禁用，并说自己这一个原因', async () => {
    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const switches = [...container.querySelectorAll<HTMLButtonElement>('.notification-channel-switch')]

    // 弹窗还没有形态：它必须是禁用的，而且原因不能借用「系统没放行」。
    expect(switches[2]?.disabled).toBe(true)
    expect(container.textContent).toContain(labels.popupUnavailable)
    // 横幅已经有落点，所以它可点——这正是逐渠道判的意义。
    expect(switches[0]?.disabled).toBe(false)
  })

  it('does not stamp a generic "not enabled" badge on a channel that simply works', async () => {
    const container = await mount()
    const labels = platformText['zh-CN'].notifications

    // 通用那句「未启用」已经删掉：它会让「有落点但没授权」的桌面渠道和「本版本没有」的弹窗说同一句话。
    const tags = [...container.querySelectorAll('.ant-tag')].map((tag) => tag.textContent)
    expect(tags).toEqual([labels.popupUnavailable])
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

  it('已删掉的键不会悄悄回到设置页：判据放在行为上，不放在源码字符串上', async () => {
    // 「源码里不含某个字符串」在键被删之后恒真，它证明不了任何事；真正的判据是这一屏渲染出来的东西：
    // 每一条没有落点的渠道只说它自己的原因，没有任何「未启用」这类通用说法。
    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const tags = [...container.querySelectorAll('.ant-tag')].map((tag) => tag.textContent)

    expect(tags).toEqual([labels.popupUnavailable])
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
