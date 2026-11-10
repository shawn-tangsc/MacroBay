// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellCompactInstant } from '@platform/ui/time/shellTimeFormat'

import { clearAllWriteFailures } from './channelEventWriteFailures'
import { NotificationDrawerScreen } from './NotificationDrawerScreen'
import { intelligenceNotificationText } from './text'

/**
 * 「最近一次投递」四种结局各说各的：`null` 是「一次都没投过」，与「通道未就绪」共用一句话会
 * 把两种事实混成一种。时间按读者时区走统一格式化。
 */
const text = intelligenceNotificationText['zh-CN']
const AT = '2026-11-10T04:30:00.000Z'
const TZ = 'Asia/Shanghai'
let root: Root | undefined

beforeEach(() => { clearAllWriteFailures() })
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  vi.restoreAllMocks()
})

type LastDelivery = { status: 'delivered' | 'failed' | 'unknown-after-send'; at: string; conversationLabel: string | null } | null

function install(lastDelivery: LastDelivery): void {
  ;(window as unknown as { platform: unknown }).platform = {
    notifications: {
      getChannelEvents: vi.fn(async () => ({})),
      setChannelEvent: vi.fn(async (eventId: string, enabled: boolean) => ({ eventId, enabled })),
      getDeliverySettings: vi.fn(async () => ({
        toastEnabled: true,
        desktopEnabled: false,
        pushWired: true,
        channels: [{ deliverable: true }],
        lastPushFailureAt: null,
        lastPushFailureReason: null,
        lastDelivery
      })),
      getSurfaceSelection: vi.fn(async () => ({ key: 'calendar-events', available: ['channel', 'toast'], selection: { channel: true }, conflict: false })),
      setSurfaceSelection: vi.fn(async () => undefined)
    },
    products: { invoke: vi.fn(async () => ({ enabled: false })) }
  }
}

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone={TZ}>
      <NotificationDrawerScreen />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

function lineOf(container: HTMLElement): string {
  return container.querySelector('.intelligence-notification-delivery-line')?.textContent ?? ''
}

describe('the last delivery line', () => {
  it('says there is no record yet when nothing was ever delivered', async () => {
    install(null)
    expect(lineOf(await render())).toBe(text['pages.intelligence.notification.delivery.none'])
  })

  it('names the conversation and the time for a delivered one', async () => {
    install({ status: 'delivered', at: AT, conversationLabel: '与运营的会话' })
    expect(lineOf(await render())).toBe(
      text['pages.intelligence.notification.delivery.delivered']
        .replace('{conversation}', '与运营的会话')
        .replace('{time}', formatShellCompactInstant(AT, { timeZone: TZ, locale: 'zh-CN' }))
    )
  })

  it('says it did not reach the channel for a failed one', async () => {
    install({ status: 'failed', at: AT, conversationLabel: '与运营的会话' })
    expect(lineOf(await render())).toBe(
      text['pages.intelligence.notification.delivery.failed']
        .replace('{time}', formatShellCompactInstant(AT, { timeZone: TZ, locale: 'zh-CN' }))
    )
  })

  it('says it was sent without a receipt for an unknown-after-send one', async () => {
    install({ status: 'unknown-after-send', at: AT, conversationLabel: '与运营的会话' })
    expect(lineOf(await render())).toBe(
      text['pages.intelligence.notification.delivery.unknown']
        .replace('{time}', formatShellCompactInstant(AT, { timeZone: TZ, locale: 'zh-CN' }))
    )
  })
})
