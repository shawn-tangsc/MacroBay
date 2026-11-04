// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { intelligenceNotificationText } from './text'
import IntelligenceNotificationSettingsSection from './index'

/**
 * 这一屏的判据都来自界面规范 §9d：三条默认全开、只管手机、频道没就绪不禁用但要说清、
 * 保存失败回滚并就地提示、读失败给「再试一次」而不是空清单。
 */

const IDS = {
  signal: 'market-intelligence.signal.triggered',
  macro: 'market-intelligence.macro.event-landed',
  briefing: 'market-intelligence.briefing.ready'
} as const

const text = intelligenceNotificationText['zh-CN']

type NotificationStubs = {
  getChannelEvents: ReturnType<typeof vi.fn>
  setChannelEvent: ReturnType<typeof vi.fn>
  getDeliverySettings: ReturnType<typeof vi.fn>
}

function installApi(overrides: Partial<NotificationStubs> = {}): NotificationStubs {
  const stubs: NotificationStubs = {
    getChannelEvents: vi.fn(async () => ({})),
    setChannelEvent: vi.fn(async (eventId: string, enabled: boolean) => ({ eventId, enabled })),
    getDeliverySettings: vi.fn(async () => ({
      toastEnabled: false,
      desktopEnabled: false,
      pushWired: true,
      channels: [{ id: 'c1', deliverable: true }],
      lastPushFailureAt: null,
      lastPushFailureReason: null
    })),
    ...overrides
  }
  ;(window as unknown as { platform: unknown }).platform = { notifications: stubs }
  return stubs
}

let root: Root | undefined
let container: HTMLDivElement | undefined

async function renderPage(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <ShellLanguageProvider language="zh-CN">
        <IntelligenceNotificationSettingsSection />
      </ShellLanguageProvider>
    )
  })
  return container
}

function switches(): HTMLButtonElement[] {
  return [...(container?.querySelectorAll<HTMLButtonElement>('button[role="switch"]') ?? [])]
}

function rowTitles(): string[] {
  return [...(container?.querySelectorAll<HTMLElement>('.intelligence-notification-row-title') ?? [])].map(
    (node) => node.textContent ?? ''
  )
}

beforeEach(() => {
  installApi()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
  delete (window as unknown as { platform?: unknown }).platform
})

describe('intelligence notification settings', () => {
  it('shows exactly the three events, all on by default', async () => {
    await renderPage()
    expect(rowTitles()).toEqual([
      text['pages.intelligence.notification.rows.signalTriggered.title'],
      text['pages.intelligence.notification.rows.macroEventLanded.title'],
      text['pages.intelligence.notification.rows.briefingReady.title']
    ])
    const all = switches()
    expect(all).toHaveLength(3)
    for (const toggle of all) expect(toggle.getAttribute('aria-checked')).toBe('true')
    // 页面上不写死条数、不出现「固定开启」。
    expect(container?.textContent ?? '').not.toContain('固定开启')
  })

  it('keeps a stored off value and writes the reader’s change through setChannelEvent', async () => {
    const stubs = installApi({ getChannelEvents: vi.fn(async () => ({ [IDS.macro]: false })) })
    await renderPage()
    expect(switches()[1].getAttribute('aria-checked')).toBe('false')

    await act(async () => switches()[0].click())
    expect(stubs.setChannelEvent).toHaveBeenCalledWith(IDS.signal, false)
    expect(switches()[0].getAttribute('aria-checked')).toBe('false')
  })

  it('rolls the switch back and says so when the save fails', async () => {
    installApi({ setChannelEvent: vi.fn(async () => Promise.reject(new Error('rejected'))) })
    await renderPage()

    await act(async () => switches()[2].click())
    expect(switches()[2].getAttribute('aria-checked')).toBe('true')
    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.saveFailed'])
  })

  it('keeps the switches usable and explains itself when no channel is ready', async () => {
    installApi({
      getDeliverySettings: vi.fn(async () => ({
        toastEnabled: false,
        desktopEnabled: false,
        pushWired: true,
        channels: [{ id: 'c1', deliverable: false, reason: 'no-enabled-target' }],
        lastPushFailureAt: null,
        lastPushFailureReason: null
      }))
    })
    await renderPage()

    expect(container?.textContent ?? '').toContain(text['pages.intelligence.notification.channelNotReady'])
    for (const toggle of switches()) expect(toggle.hasAttribute('disabled')).toBe(false)
  })

  it('reports an unreadable page instead of drawing three blank rows, and can retry', async () => {
    const getChannelEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({})
    installApi({ getChannelEvents })
    await renderPage()

    expect(switches()).toHaveLength(0)
    const retry = container?.querySelector<HTMLButtonElement>('.ui-state__action, [data-state-action]')
    expect(container?.textContent ?? '').not.toContain(text['pages.intelligence.notification.footer'])

    // 重试是同一个读入口：成功后三条才出现。
    const action = container?.querySelector<HTMLElement>('button')
    expect(retry ?? action).toBeTruthy()
    await act(async () => (retry ?? action)?.click())
    expect(getChannelEvents).toHaveBeenCalledTimes(2)
    expect(switches()).toHaveLength(3)
  })
})
