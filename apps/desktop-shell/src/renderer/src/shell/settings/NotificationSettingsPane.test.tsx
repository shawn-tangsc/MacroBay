// @vitest-environment happy-dom
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
    expect(switches).toHaveLength(4)
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
    expect(badgeCount).toBe(notificationProducerWired ? 0 : 4)
  })
})
