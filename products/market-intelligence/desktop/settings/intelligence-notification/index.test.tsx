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
  // 第四条走产品 IPC（出口开关），另外三条走通用通知 IPC；两套都要备好。
  ;(window as unknown as { platform: unknown }).platform = {
    notifications: stubs,
    products: {
      invoke: vi.fn(async (_productId: string, method: string) =>
        method.endsWith('getNewsPushOutletState') ? { enabled: false } : { enabled: false })
    }
  }
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
  it('reads the outlet switch from the service and follows it back when the service refused', async () => {
    // 服务「拒了」时页面必须回到服务说的值：本地先翻转再回滚，会给读者看一个不存在的状态。
    const state = vi.fn(async () => ({ enabled: true }))
    const setEnabled = vi.fn(async () => ({ enabled: true }))
    ;(window as unknown as { platform: unknown }).platform = {
      ...(window as unknown as { platform: { notifications: unknown } }).platform,
      products: {
        invoke: vi.fn(async (_productId: string, method: string) => (method.endsWith('getNewsPushOutletState') ? state() : setEnabled()))
      }
    }
    await renderPage()
    expect(switches()[3]?.getAttribute('aria-checked')).toBe('true')

    // 点一下：写请求里**不许带 `at`**（页面没有第二个时钟）。
    await act(async () => { switches()[3]?.click(); await Promise.resolve(); await Promise.resolve() })
    expect(setEnabled).toHaveBeenCalledTimes(1)
    const invoke = (window as unknown as { platform: { products: { invoke: ReturnType<typeof vi.fn> } } }).platform.products.invoke
    const writeCall = invoke.mock.calls.find((call) => String(call[1]).endsWith('setNewsPushOutletEnabled'))
    expect(writeCall?.[2]).toEqual({ enabled: false })

    // 写完之后重新读：服务仍说开着 → 界面必须仍是开（这就是「不本地缓存真值」）。
    expect(state.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(switches()[3]?.getAttribute('aria-checked')).toBe('true')
  })

  it('names the fourth row like the others: what triggered it, not the feature name', async () => {
    await renderPage()
    const title = text['pages.intelligence.notification.rows.sentimentAlert.title']
    expect(title).toBe('舆情提醒')
    expect(rowTitles()).toContain(title)
    expect(container?.textContent ?? '').not.toContain('舆情推送')
  })


  it('shows exactly the four rows: three on by default and the outlet off', async () => {
    await renderPage()
    expect(rowTitles()).toEqual([
      text['pages.intelligence.notification.rows.signalTriggered.title'],
      text['pages.intelligence.notification.rows.macroEventLanded.title'],
      text['pages.intelligence.notification.rows.briefingReady.title'],
      text['pages.intelligence.notification.rows.sentimentAlert.title']
    ])
    const all = switches()
    expect(all).toHaveLength(4)
    for (const toggle of all.slice(0, 3)) expect(toggle.getAttribute('aria-checked')).toBe('true')
    // **第四條默认关**：水位与基线只有读者按下那一刻才成立，不许因为别的三条开着就默认打开。
    expect(all[3]?.getAttribute('aria-checked')).toBe('false')
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

    // 重试是同一个读入口：成功后四条才出现（第四条是出口开关，来源不同但同一屏）。
    const action = container?.querySelector<HTMLElement>('button')
    expect(retry ?? action).toBeTruthy()
    await act(async () => (retry ?? action)?.click())
    expect(getChannelEvents).toHaveBeenCalledTimes(2)
    expect(switches()).toHaveLength(4)
  })
})
