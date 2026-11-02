// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { platformText } from '../i18n/platformText'
import { AppShell } from './AppShell'

/**
 * 模型服务的启动读数（台账 §25 / `MI-11-R161`）：供应商列表、模型与端点一次读回。
 *
 * 判据是**状态顺序**，不是「看一眼没闪」：
 *  ① 慢返回：读还没 settle 时屏幕上只有加载态，没有错误、也没有「没有供应商」的空栏；
 *  ② 真失败：settle 为失败后才出错误 + 重试，点了重试真的再读一次；
 *  ③ 有旧数据的刷新失败：上一次的列表仍在，并标明这是上一次的读数。
 */
const providerFixture: SafeModelProvider = {
  id: 'provider-local',
  name: 'Local Provider',
  enabled: true,
  baseUrl: 'https://api.example.test/v1',
  endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.example.test/v1' }],
  hasApiKey: true,
  apiKeyPreview: 'fixt...7890',
  connectionStatus: 'ready',
  models: [{
    id: 'chat-model',
    name: 'Chat Model',
    capabilities: { chat: true, vision: false, embedding: false, tools: true }
  }],
  defaultChatModelId: 'chat-model'
} as SafeModelProvider


afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

type Api = {
  list: ReturnType<typeof vi.fn>
  fireDone: () => void
}

function installPlatformApi(list: ReturnType<typeof vi.fn>): Api {
  const doneListeners = new Set<() => void>()
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      app: {
        getInfo: vi.fn(async () => null),
        getProductSummaries: vi.fn(async () => []),
        openExternal: vi.fn(async () => undefined)
      },
      settings: { get: vi.fn(async () => ({ ...createDefaultAppSettings(), language: 'en-US' })) },
      modelProviders: {
        list,
        onModelDetectionProgress: vi.fn(() => () => undefined),
        onModelDetectionDone: vi.fn((listener: () => void) => {
          doneListeners.add(listener)
          return () => doneListeners.delete(listener)
        })
      },
      assistants: {
        list: vi.fn(async () => []),
        listTopics: vi.fn(async () => ({ topics: [] })),
        listTopicMessages: vi.fn(async () => ({ messages: [] })),
        streamAttach: vi.fn(async () => ({ snapshot: { topicId: '', status: 'idle', executions: [] } })),
        onStreamChunk: vi.fn(() => () => undefined),
        onStreamDone: vi.fn(() => () => undefined),
        onStreamError: vi.fn(() => () => undefined),
        onStreamStatusChanged: vi.fn(() => () => undefined)
      }
    } as unknown as Window['platform']
  })
  return {
    list,
    fireDone: () => {
      for (const listener of doneListeners) listener()
    }
  }
}

async function renderAppShell(): Promise<{ container: HTMLDivElement; root: ReturnType<typeof createRoot> }> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(AppShell))
    await Promise.resolve()
  })
  await clickButton(container, 'Settings')
  return { container, root }
}

function settingsPane(container: HTMLElement): HTMLElement {
  const pane = container.querySelector<HTMLElement>('.settings-layout')
  if (!pane) throw new Error('Expected the settings workspace.')
  return pane
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  await vi.waitFor(() => {
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.trim() === label)
    if (!button) throw new Error(`Expected ${label} button.`)
    button.click()
  })
  await act(async () => { await Promise.resolve() })
}

describe('model service boot read', () => {
  it('draws only the loading state before the first read settles', async () => {
    let settleRead: (value: SafeModelProvider[]) => void = () => undefined
    const pending = new Promise<SafeModelProvider[]>((resolve) => {
      settleRead = resolve
    })
    const api = installPlatformApi(vi.fn(() => pending))
    const { container, root } = await renderAppShell()

    const pane = settingsPane(container)
    // 首帧：加载态在，终态一个都没有——「还没读到」既不是「没有」也不是「失败」。
    expect(pane.querySelector('[data-loading-state]')).not.toBeNull()
    expect(pane.querySelector('[data-state="error"]')).toBeNull()
    expect(pane.querySelector('[data-state="empty"]')).toBeNull()
    // 也不能先把「没有供应商」的左栏画出来。
    expect(pane.querySelector('[data-model-service-page]')).toBeNull()

    // 读回来之后同一棵树要能翻成页面——「首帧是加载态」不等于「永远停在加载态」。
    await act(async () => {
      settleRead([providerFixture])
      await pending
    })
    await vi.waitFor(() => expect(container.querySelector('[data-model-service-page]')).not.toBeNull())
    expect(settingsPane(container).querySelector('[data-loading-state]')).toBeNull()
    expect(api.list).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
  })

  it('turns a failed first read into an error with a retry that reads again', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('provider-store-unreadable'))
      .mockResolvedValue([providerFixture])
    installPlatformApi(list)
    const { container, root } = await renderAppShell()

    await vi.waitFor(() => {
      expect(settingsPane(container).querySelector('[data-state="error"]')).not.toBeNull()
    })
    // 读不到不是「没有供应商」：这时不许出现左栏的空态。
    expect(settingsPane(container).querySelector('[data-state="empty"]')).toBeNull()

    await clickButton(settingsPane(container), 'Retry')
    await vi.waitFor(() => expect(container.querySelector('[data-model-service-page]')).not.toBeNull())
    expect(list).toHaveBeenCalledTimes(2)
    expect(settingsPane(container).querySelector('[data-state="error"]')).toBeNull()

    await act(async () => root.unmount())
  })

  it('keeps the last list and marks it stale when a refresh fails', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce([providerFixture])
      .mockRejectedValue(new Error('provider-store-unreadable'))
    const api = installPlatformApi(list)
    const { container, root } = await renderAppShell()

    await vi.waitFor(() => expect(container.querySelector('[data-model-service-page]')).not.toBeNull())
    expect(container.textContent).toContain(providerFixture.name)

    // 检测结束触发的重读失败：不把已经看到的列表删掉，只说明这是上一次的读数。
    await act(async () => {
      api.fireDone()
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(settingsPane(container).textContent).toContain(platformText['en-US'].models.providersStaleNotice)
    })
    expect(container.querySelector('[data-model-service-page]')).not.toBeNull()
    expect(container.textContent).toContain(providerFixture.name)
    expect(settingsPane(container).querySelector('[data-state="error"]')).toBeNull()
    expect(list).toHaveBeenCalledTimes(2)

    await act(async () => root.unmount())
  })
})
