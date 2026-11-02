// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { notificationProducerWired } from '@platform/notifications/contracts/notificationContracts'
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
    // Pinned on purpose: the first producer is wired (task failure), so the pane must present
    // working switches instead of the "nothing produces notifications" notice.
    expect(notificationProducerWired).toBe(true)

    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const switches = [...container.querySelectorAll('.notification-channel-switch')]

    // 接通后：不再出现「为什么不能用」的解释（包括反过来的「现在可以了」），开关可用，建议行回来。
    expect(container.textContent).not.toContain(labels.unavailableNotice)
    // 通知中心常开、已从设置页移除：只剩三个投递开关。
    expect(switches).toHaveLength(3)
    expect(switches.every((control) => (control as HTMLButtonElement).disabled)).toBe(false)
    expect(container.textContent).toContain(labels.scopeNote)
  })

  it('keeps the delivery switches enabled once a producer is wired', async () => {
    const container = await mount()
    const labels = platformText['zh-CN'].notifications

    // The component reads the constant, so this asserts the wiring shape rather than the value:
    // an enabled switch must carry no unavailable badge next to it.
    const badgeCount = [...container.querySelectorAll('.ant-tag')].filter(
      (tag) => tag.textContent === labels.unavailableBadge
    ).length
    expect(badgeCount).toBe(0)
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
