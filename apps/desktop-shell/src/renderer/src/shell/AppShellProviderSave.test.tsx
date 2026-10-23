// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelProviderInput, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { AppShell } from './AppShell'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const apiKeyFixture = 'fixture-provider-key-1234567890'

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

describe('AppShell provider save (PLAT-61: 改动即存 / 失焦保存)', () => {
  it('saves the entered key on blur with the selected provider and refreshes after saving', async () => {
    const api = installPlatformApi()
    const page = await renderAppShell()

    await enterApiKey(page.container, apiKeyFixture)
    await blurApiKey(page.container)

    await vi.waitFor(() => {
      expect(api.upsert).toHaveBeenCalledTimes(1)
      expect(api.list).toHaveBeenCalledTimes(2)
      expect(page.container.textContent).toContain('Saved')
    })
    expect(api.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'provider-local',
      enabled: true,
      // 端点清单随保存一起写（主地址由它派生，不再是独立入参）。
      endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.example.test/v1' }],
      models: providerFixture.models,
      apiKey: apiKeyFixture
    }))

    await act(async () => page.root.unmount())
  })

  it('rolls the key draft back and shows an inline error without refreshing when saving rejects', async () => {
    const api = installPlatformApi({ upsertError: new Error('provider-secret-vault-write-failed') })
    const page = await renderAppShell()

    await enterApiKey(page.container, apiKeyFixture)
    await blurApiKey(page.container)

    await vi.waitFor(() => {
      expect(api.upsert).toHaveBeenCalledTimes(1)
      expect(page.container.querySelector('[data-model-service-key-error]')?.textContent).toContain('Save failed')
    })
    expect(api.list).toHaveBeenCalledTimes(1)
    // 失败回滚到原值（原本没有草稿 ⇒ 回到空输入 + 「必填」占位），整页不回退。
    expect(apiKeyInput(page.container).value).toBe('')
    expect(page.container.querySelector('[data-model-service-page]')).not.toBeNull()
    expect(page.container.textContent).not.toContain('Saved')

    await act(async () => page.root.unmount())
  })

  it('shows the saved mask until the eye reveals the key through exactly one reveal IPC call', async () => {
    const api = installPlatformApi({ provider: savedProviderFixture })
    const page = await renderAppShell()

    expect(apiKeyInput(page.container).value).toBe(savedProviderFixture.apiKeyPreview)
    expect(page.container.innerHTML).not.toContain(apiKeyFixture)
    expect(api.reveal).not.toHaveBeenCalled()

    const eye = page.container.querySelector<HTMLButtonElement>('.provider-api-key-eye')
    if (!eye) throw new Error('Expected API Key eye button.')
    await act(async () => {
      eye.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(apiKeyInput(page.container).value).toBe(apiKeyFixture))
    expect(api.reveal).toHaveBeenCalledTimes(1)
    expect(api.reveal).toHaveBeenCalledWith(savedProviderFixture.id)

    await act(async () => page.root.unmount())
  })
})

const providerFixture: SafeModelProvider = {
  id: 'provider-local',
  name: 'Local Provider',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.example.test/v1' }
  ],
  enabled: true,
  baseUrl: 'https://api.example.test/v1',
  hasApiKey: false,
  apiKeyPreview: '',
  connectionStatus: 'unavailable',
  models: [{
    id: 'chat-model',
    name: 'Chat Model',
    capabilities: { chat: true, vision: false, embedding: false, tools: true }
  }],
  defaultChatModelId: 'chat-model'
}

const savedProviderFixture: SafeModelProvider = {
  ...providerFixture,
  hasApiKey: true,
  apiKeyPreview: 'fixt...7890',
  connectionStatus: 'ready'
}

function installPlatformApi(input: { upsertError?: Error; provider?: SafeModelProvider } = {}): {
  list: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  reveal: ReturnType<typeof vi.fn>
} {
  const provider = input.provider ?? providerFixture
  const list = vi.fn(async () => [provider])
  const upsert = vi.fn(async (_provider: ModelProviderInput) => {
    if (input.upsertError) throw input.upsertError
    return provider
  })
  const reveal = vi.fn(async (_providerId: string) => ({ apiKey: apiKeyFixture }))
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      app: {
        getInfo: vi.fn(async () => null),
        getProductSummaries: vi.fn(async () => []),
        openExternal: vi.fn(async () => undefined)
      },
      settings: { get: vi.fn(async () => ({ ...createDefaultAppSettings(), language: 'en-US' })) },
      modelProviders: { list, upsert, revealApiKey: reveal },
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
  return { list, upsert, reveal }
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
  await clickButton(container, 'Model Service')
  await vi.waitFor(() => expect(apiKeyInput(container)).toBeTruthy())
  return { container, root }
}

async function enterApiKey(container: HTMLElement, value: string): Promise<void> {
  const input = apiKeyInput(container)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/**
 * PLAT-61：保存边界从「表单提交」改成「密钥输入框失焦」。
 * React 的 onBlur 走 focusout（冒泡），所以这里派发 focusout 模拟真实的焦点移出。
 */
async function blurApiKey(container: HTMLElement): Promise<void> {
  const input = apiKeyInput(container)
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await Promise.resolve()
  })
}

function apiKeyInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.provider-api-key-input input')
  if (!input) throw new Error('Expected API Key input.')
  return input
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`Expected ${label} button.`)
  await act(async () => button.click())
}
