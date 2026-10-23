// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProviderRuntimeCheckReport } from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type { ModelProviderInput, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { platformText } from '../../i18n/platformText'
import { AppShell } from '../AppShell'

/**
 * PLAT-62：模型列表不再展示「该模型未启用运行时」噪音（99 个模型语义错位）。
 * 该信息只保留在连接检查抽屉里。
 */
const models = platformText['en-US'].models

const provider: SafeModelProvider = {
  id: 'silicon',
  name: 'Silicon',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
    { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
  ],
  enabled: true,
  baseUrl: 'https://api.siliconflow.cn',

  hasApiKey: true,
  apiKeyPreview: 'sk-s**********7890',
  connectionStatus: 'unverified',
  models: [
    { id: 'deepseek-ai/DeepSeek-V3.2', name: 'DeepSeek V3.2', capabilities: { chat: true, vision: false, embedding: false, tools: true } }
  ],
  defaultChatModelId: 'deepseek-ai/DeepSeek-V3.2'
}

const advisoryReport: ProviderRuntimeCheckReport = {
  providerId: 'silicon',
  modelId: 'deepseek-ai/DeepSeek-V3.2',
  runtimeId: 'claude-code',
  ordinaryChat: { lane: 'ordinary-chat', status: 'ready', summary: 'Connection succeeded.' },
  direct: { lane: 'claude-code-direct', status: 'unknown', summary: 'Model is not enabled for Claude Code agent runtime.', route: 'direct' },
  gateway: { lane: 'claude-code-gateway', status: 'ready', summary: 'Gateway runtime ready.', route: 'gateway' },
  finalCompatibility: {
    providerId: 'silicon',
    modelId: 'deepseek-ai/DeepSeek-V3.2',
    runtimeId: 'claude-code',
    selectable: false,
    route: 'none',
    status: 'model-not-enabled',
    summary: 'Model is not enabled for Claude Code agent runtime.'
  },
  updatedAt: '2026-10-18T00:00:00.000Z',
  signature: 'sig'
}

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

function installPlatform(): ReturnType<typeof vi.fn> {
  const runRuntimeChecks = vi.fn(async () => advisoryReport)
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
        list: vi.fn(async () => [provider]),
        upsert: vi.fn(async (input: ModelProviderInput) => ({ ...provider, ...input })),
        setEnabled: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        addOrUpdateModel: vi.fn(async () => undefined),
        removeModel: vi.fn(async () => undefined),
        setDefaultChatModel: vi.fn(async () => undefined),
        previewModelSync: vi.fn(async () => ({ ok: true, added: [], missing: [] })),
        applyModelSync: vi.fn(async () => ({ ok: true, provider })),
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
  return runRuntimeChecks
}

async function clickButton(container: ParentNode, text: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === text
  )
  if (!button) throw new Error(`Expected ${text} button.`)
  await act(async () => button.click())
}

describe('PLAT-61 运行时未启用的措辞与位置', () => {
  it('removes the advisory from the models area and keeps it in the connection drawer', async () => {
    const runRuntimeChecks = installPlatform()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(AppShell))
      await Promise.resolve()
    })
    await clickButton(container, 'Settings')
    await clickButton(container, 'Model Service')
    await vi.waitFor(() => expect(container.querySelector('[data-provider-connection-check]')).not.toBeNull())

    await act(async () => container.querySelector<HTMLButtonElement>('[data-provider-connection-check]')?.click())
    // 供应商已启用 ⇒ 顶部只有「已启用」状态，没有启用按钮；等抽屉本体即可。
    await vi.waitFor(() => expect(document.querySelector('[data-connection-check-provider-status]')).not.toBeNull())
    await clickButton(document, models.connectionCheckStart)
    await vi.waitFor(() => expect(runRuntimeChecks).toHaveBeenCalledTimes(1))

    // 模型区：没有 advisory 节点，也不含运行时文案。
    await vi.waitFor(() => expect(container.querySelector('[data-models-count]')).not.toBeNull())
    expect(container.querySelector('[data-models-runtime-advisory]')).toBeNull()
    expect(container.querySelector('[data-model-service-models]')?.textContent ?? '')
      .not.toContain('Claude Code runtime')

    // 连接检查抽屉：仍保留「可选，不影响智能体对话」的说明。
    await vi.waitFor(() => expect(document.querySelector('[data-runtime-lane="direct"]')).not.toBeNull())
    const directLane = document.querySelector<HTMLElement>('[data-runtime-lane="direct"]')
    expect(directLane?.querySelector('[data-lane-reason]')?.textContent)
      .toBe(models.connectionCheckOptionalRuntimeDisabled)
  })
})
