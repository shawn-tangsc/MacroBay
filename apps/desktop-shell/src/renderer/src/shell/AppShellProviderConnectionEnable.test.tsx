// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProviderRuntimeCheckReport } from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type { ModelProviderInput, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { AppShell } from './AppShell'
import { platformText } from '../i18n/platformText'

/**
 * PLAT-61 诊断可用性：抽屉顶部「启用」必须复用既有 `setEnabled` 保存路径，并**自动重跑一次**检查。
 * 真实 AppShell + 真实抽屉；只 mock 边界 IPC。
 */
const labels = platformText['en-US'].models

const baseProvider: SafeModelProvider = {
  id: 'silicon',
  name: 'Silicon',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
    { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
  ],
  enabled: false,
  baseUrl: 'https://api.siliconflow.cn',

  hasApiKey: true,
  apiKeyPreview: 'sk-s**********7890',
  connectionStatus: 'unverified',
  models: [
    {
      id: 'deepseek-ai/DeepSeek-V3.2',
      name: 'DeepSeek V3.2',
      capabilities: { chat: true, vision: false, embedding: false, tools: true }
    }
  ],
  defaultChatModelId: 'deepseek-ai/DeepSeek-V3.2'
}

function createReport(providerEnabled: boolean): ProviderRuntimeCheckReport {
  return {
    providerId: 'silicon',
    modelId: 'deepseek-ai/DeepSeek-V3.2',
    runtimeId: 'claude-code',
    ordinaryChat: { lane: 'ordinary-chat', status: 'unknown', summary: 'Connection failed.' },
    direct: { lane: 'claude-code-direct', status: 'auth-failed', summary: 'Direct failed.', route: 'direct' },
    gateway: { lane: 'claude-code-gateway', status: 'gateway-required', summary: 'Gateway disabled.', route: 'gateway' },
    finalCompatibility: {
      providerId: 'silicon',
      modelId: 'deepseek-ai/DeepSeek-V3.2',
      runtimeId: 'claude-code',
      selectable: false,
      route: 'none',
      status: providerEnabled ? 'auth-failed' : 'provider-disabled',
      summary: providerEnabled ? 'Authentication failed.' : 'Provider is disabled.'
    },
    updatedAt: '2026-10-18T00:00:00.000Z',
    signature: 'sig'
  }
}

let root: Root | undefined
let provider: SafeModelProvider
let api: {
  setEnabled: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  runRuntimeChecks: ReturnType<typeof vi.fn>
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

function installPlatform(): void {
  provider = { ...baseProvider }
  const list = vi.fn(async () => [provider])
  const upsert = vi.fn(async (input: ModelProviderInput) => {
    provider = { ...provider, ...input, enabled: input.enabled ?? provider.enabled } as SafeModelProvider
    return provider
  })
  const setEnabled = vi.fn(async (_providerId: string, enabled: boolean) => {
    provider = { ...provider, enabled }
  })
  const runRuntimeChecks = vi.fn(async () => createReport(provider.enabled))
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      app: {
        getInfo: vi.fn(async () => null),
        getProductSummaries: vi.fn(async () => []),
        openExternal: vi.fn(async () => undefined)
      },
      settings: { get: vi.fn(async () => ({ ...createDefaultAppSettings(), language: 'en-US', themeMode: 'dark' })) },
      modelProviders: {
        list,
        upsert,
        setEnabled,
        remove: vi.fn(async () => undefined),
        addOrUpdateModel: vi.fn(async () => undefined),
        removeModel: vi.fn(async () => undefined),
        setDefaultChatModel: vi.fn(async () => undefined),
        previewModelSync: vi.fn(async () => ({ added: [], missing: [], remoteIds: [] })),
        applyModelSync: vi.fn(async () => undefined),
        runRuntimeChecks,
        revealApiKey: vi.fn(async () => ({ apiKey: 'sk-live' }))
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
  api = { setEnabled, upsert, runRuntimeChecks }
}

async function clickButtonByText(container: ParentNode, text: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === text
  )
  if (!button) throw new Error(`Expected ${text} button.`)
  await act(async () => button.click())
}

async function renderAndOpenDrawer(): Promise<HTMLDivElement> {
  installPlatform()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(AppShell))
    await Promise.resolve()
  })
  await clickButtonByText(container, 'Settings')
  await clickButtonByText(container, 'Model Service')
  await vi.waitFor(() => expect(container.querySelector('[data-provider-connection-check]')).not.toBeNull())

  // 停用状态下入口仍可用（连接检查的既有语义：可探测未启用的草稿）。
  const entry = container.querySelector<HTMLButtonElement>('[data-provider-connection-check]')
  expect(entry?.disabled).toBe(false)
  await act(async () => entry?.click())
  await vi.waitFor(() => expect(document.querySelector('[data-connection-check-enable]')).not.toBeNull())
  return container
}

describe('PLAT-61 连接检查抽屉：就地启用并自动重跑', () => {
  it('enables the provider through setEnabled and re-runs the check exactly once', async () => {
    await renderAndOpenDrawer()

    await clickButtonByText(document, labels.connectionCheckStart)
    await vi.waitFor(() => expect(api.runRuntimeChecks).toHaveBeenCalledTimes(1))

    const statusBefore = document.querySelector('[data-connection-check-provider-status]')
    expect(statusBefore?.textContent).toContain(labels.connectionCheckStatusDisabled)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-connection-check-enable]')?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith('silicon', true))
    // 重跑一次检查（不含首次），并且启用后的落盘带着 enabled: true（不被旧闭包写回 false）。
    await vi.waitFor(() => expect(api.runRuntimeChecks).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-connection-check-provider-status]')?.textContent)
        .toContain(labels.connectionCheckStatusEnabled)
    })
    expect(document.querySelector('[data-connection-check-enable]')).toBeNull()
    expect(api.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'silicon', enabled: true }))

    // 稳定后不再继续重跑（恰好一次）。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(api.runRuntimeChecks).toHaveBeenCalledTimes(2)
  })
})
