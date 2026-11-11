// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { clearAllWriteFailures } from './channelEventWriteFailures'
import { NotificationDrawerScreen } from './NotificationDrawerScreen'

/**
 * 用户 2026-11-11：「还没有任何投递记录」这一行删掉——它只陈述「什么都没有」，读者看了不知道该做什么。
 * 只报空、不给动作的信息一律不留；真送不到的故障由「通道未就绪」横幅 + 真动作承担，
 * 一次测试推送的成/败由「发送测试」按钮下面那行就地反馈承担。
 *
 * 这条用例是**删干净**的守卫：把那一行（或它那句文案）加回来，必须红。
 */
let root: Root | undefined

beforeEach(() => { clearAllWriteFailures() })
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  vi.restoreAllMocks()
})

function install(): void {
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
        lastDelivery: null
      })),
      getSurfaceSelection: vi.fn(async () => ({
        key: 'calendar-events',
        available: ['channel', 'toast'],
        selection: { channel: true },
        conflict: false
      })),
      setSurfaceSelection: vi.fn(async () => undefined)
    },
    products: {
      invoke: vi.fn(async (_productId: string, method: string) => {
        if (String(method).includes('getNewsPushThreshold')) return { pushThreshold: 'medium' }
        if (String(method).includes('getNewsPushOutletState')) return { enabled: true }
        if (String(method).includes('getCalendarReminderSettings')) {
          return { enabled: false, leadMinutes: 60, importance: ['high'], landedFilter: 'surprise-only' }
        }
        return { enabled: false }
      })
    }
  }
}

async function render(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<ShellLanguageProvider language="zh-CN"><NotificationDrawerScreen /></ShellLanguageProvider>)
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

describe('通知抽屉不再有「没有任何投递记录」这类空话', () => {
  it('renders no delivery line and none of its four sentences', async () => {
    install()
    const container = await render()
    expect(container.querySelector('.intelligence-notification-delivery-line')).toBeNull()
    expect(container.textContent).not.toContain('还没有任何投递记录')
    expect(container.textContent).not.toContain('最近一次投递')
  })
})
