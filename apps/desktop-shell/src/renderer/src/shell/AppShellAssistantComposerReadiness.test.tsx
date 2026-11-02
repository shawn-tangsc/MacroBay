// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createProviderStore } from '@platform/ai/providers/providerStore'
import type { SecretVault } from '@platform/secrets/secretVaultTypes'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { AppShell } from './AppShell'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const deepSeekProviderSecretRef = 'provider:646565707365656b'

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

describe('AppShell assistant composer readiness', () => {
  it('passes a vault-backed exact DeepSeek provider from the model-provider list into an editable composer', async () => {
    const providerStore = createProviderStore({
      read: async () => ({
        providers: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            protocol: 'openai',
            enabled: true,
            baseUrl: 'https://api.deepseek.test',
            apiKeyRef: deepSeekProviderSecretRef,
            apiKeyPreview: 'fixt...key',
            apiKeyMigrationState: 'vault-backed',
            apiKeyStorageVersion: 1,
            models: [
              {
                id: 'deepseek-v4-pro',
                name: 'DeepSeek V4 Pro',
                capabilities: { chat: true, vision: false, embedding: false, tools: true }
              }
            ]
          }
        ]
      }),
      write: async () => undefined
    }, createExistingSecretVault(deepSeekProviderSecretRef))
    const safeProviders = await providerStore.list()
    expect(safeProviders.find((provider) => provider.id === 'deepseek')).toMatchObject({ hasApiKey: true })
    const modelProviderList = vi.fn(async () => safeProviders)
    installPlatformApi(modelProviderList)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(AppShell))
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(modelProviderList).toHaveBeenCalledOnce()
      expect(container.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(false)
    })
    await act(async () => root.unmount())
  })

  /**
   * PLAT-64：这条用例的旧断言（"slot 密文还在 ⇒ 输入框可用"）**已过期**，不是 AppShell 回归。
   *
   * provider store 在 8a986b55 之后把 `historicalReadSlots` 彻底退役：`normalizeProvider` 只接受
   * `provider:<hex>` 与 `provider:<hex>:generation-N`，`providerStore.test.ts` 也明确断言
   * `:slot-a`/`:slot-b` 属 obsolete slot，在访问 vault 前就被拒（existsCount === 0、apiKeyRef 被丢弃）。
   * 因此"slot 密文存在即视为已配置"的前提和当前平台契约冲突，两条用例此前一直红（HEAD 既存红）。
   * 这里改为守护**当前真实行为**：已退役的 slot ref 不会被当成可用凭据，输入框保持锁定，直到用户重新保存 Key。
   */
  it.each(['slot-a', 'slot-b'] as const)('keeps the composer locked for a retired historical %s ref until a key is saved', async (slot) => {
    const priorRotationRef = `${deepSeekProviderSecretRef}:${slot}`
    const providerStore = createProviderStore({
      read: async () => ({
        providers: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            protocol: 'openai',
            enabled: true,
            baseUrl: 'https://api.deepseek.test',
            apiKeyRef: priorRotationRef,
            apiKeyPreview: 'fixt...key',
            apiKeyMigrationState: 'vault-backed',
            apiKeyStorageVersion: 1,
            models: [
              {
                id: 'deepseek-v4-pro',
                name: 'DeepSeek V4 Pro',
                capabilities: { chat: true, vision: false, embedding: false, tools: true }
              }
            ]
          }
        ]
      }),
      write: async () => undefined
    }, createExistingSecretVault(priorRotationRef))
    // 退役结论先落在 provider store 上：即使 vault 里仍有该 slot 的密文，也不再投影成可用凭据。
    const safeProviders = await providerStore.list()
    expect(safeProviders.find((provider) => provider.id === 'deepseek')).toMatchObject({
      hasApiKey: false,
      connectionStatus: 'unavailable'
    })
    const modelProviderList = vi.fn(async () => safeProviders)
    installPlatformApi(modelProviderList)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(AppShell))
      await Promise.resolve()
    })

    await vi.waitFor(() => {
      expect(modelProviderList).toHaveBeenCalledOnce()
      expect(container.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true)
    })
    await act(async () => root.unmount())
  })
})

function createExistingSecretVault(ref: string): SecretVault {
  return {
    put: async () => {
      throw new Error('This fixture only models an existing ciphertext.')
    },
    get: async () => null,
    rotate: async () => {
      throw new Error('This fixture only models an existing ciphertext.')
    },
    delete: async () => undefined,
    exists: async (candidate) => candidate === ref,
    has: async (candidate) => candidate === ref,
    inspect: async () => null
  }
}

function installPlatformApi(modelProviderList: () => Promise<unknown>): void {
  const assistant = {
    id: 'assistant-deepseek',
    name: 'DeepSeek Assistant',
    prompt: 'Help.',
    icon: 'AI',
    description: '',
    settings: {
      temperature: 0.7,
      enableTemperature: false,
      topP: 1,
      enableTopP: false,
      maxTokens: 4096,
      enableMaxTokens: false,
      streamOutput: true,
      reasoningEffort: '',
      mcpMode: 'disabled',
      maxToolCalls: 20,
      enableMaxToolCalls: false,
      enableWebSearch: false,
      customParameters: []
    },
    modelId: 'deepseek:deepseek-v4-pro',
    modelName: null,
    mcpServerIds: [],
    contextSourceIds: [],
    tags: [],
    orderKey: 'assistant-deepseek',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  }
  const detach = () => undefined
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      app: {
        getInfo: vi.fn(async () => null),
        getProductSummaries: vi.fn(async () => [])
      },
      settings: {
        get: vi.fn(async () => createDefaultAppSettings())
      },
      modelProviders: {
        list: modelProviderList
      },
      assistants: {
        list: vi.fn(async () => [assistant]),
        listTopics: vi.fn(async () => ({ topics: [] })),
        listTopicMessages: vi.fn(async () => ({ messages: [] })),
        streamAttach: vi.fn(async () => ({ snapshot: { topicId: '', status: 'idle', executions: [] } })),
        onStreamChunk: vi.fn(() => detach),
        onStreamDone: vi.fn(() => detach),
        onStreamError: vi.fn(() => detach),
        onStreamStatusChanged: vi.fn(() => detach)
      }
    } as unknown as Window['platform']
  })
}
