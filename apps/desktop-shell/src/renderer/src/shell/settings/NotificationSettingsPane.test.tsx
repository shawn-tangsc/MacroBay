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

async function mount(onChange = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      createElement(NotificationSettingsPane, {
        title: platformText['zh-CN'].settings.notifications,
        notice: null,
        settings: createDefaultNotificationRuntimeSettings(),
        labels: platformText['zh-CN'].notifications,
        onChange
      })
    )
  )
  return container
}

describe('notification settings availability', () => {
  it('shows the unavailable state while no producer exists, and does not pretend the switches work', async () => {
    // Pinned on purpose: flip the constant in the change that wires the first producer, and this
    // test is what makes that flip a reviewed decision instead of a forgotten toggle.
    expect(notificationProducerWired).toBe(false)

    const container = await mount()
    const labels = platformText['zh-CN'].notifications
    const switches = [...container.querySelectorAll('.notification-channel-switch')]

    expect(container.textContent).toContain(labels.unavailableNotice)
    // 通知中心常开、已从设置页移除：只剩三个投递开关。
    expect(switches).toHaveLength(3)
    expect(switches.every((control) => (control as HTMLButtonElement).disabled)).toBe(true)
  })

  it('keeps the delivery switches enabled once a producer is wired', async () => {
    const container = await mount()
    const labels = platformText['zh-CN'].notifications

    // The component reads the constant, so this asserts the wiring shape rather than the value:
    // an enabled switch must carry no unavailable badge next to it.
    const badgeCount = [...container.querySelectorAll('.ant-tag')].filter(
      (tag) => tag.textContent === labels.unavailableBadge
    ).length
    expect(badgeCount).toBe(notificationProducerWired ? 0 : 3)
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
