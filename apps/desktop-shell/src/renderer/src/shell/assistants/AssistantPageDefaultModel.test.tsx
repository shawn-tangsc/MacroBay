// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { AssistantPage } from './AssistantPage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const providers: SafeModelProvider[] = [
  {
    id: 'provider-1',
    name: 'Provider',
    endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.example.test' }],
    enabled: true,
    baseUrl: 'https://api.example.test',
    hasApiKey: true,
    apiKeyPreview: 'fixt...key',
    connectionStatus: 'ready',
    models: [
      {
        id: 'model-1',
        name: 'Model 1',
        capabilities: { chat: true, vision: false, embedding: false, tools: false }
      }
    ]
  }
]

function assistant(modelId: string | null) {
  return {
    id: 'assistant-1',
    name: 'Assistant',
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
    modelId,
    modelName: null,
    mcpServerIds: [],
    contextSourceIds: [],
    tags: [],
    orderKey: 'assistant-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  }
}

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

function installAssistantApi(modelId: string | null): void {
  const detach = () => undefined
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      assistants: {
        list: vi.fn(async () => [assistant(modelId)]),
        listTopics: vi.fn(async () => ({ topics: [] })),
        listTopicMessages: vi.fn(async () => ({ messages: [] })),
        streamAttach: vi.fn(async () => ({ snapshot: { status: 'done' } })),
        onStreamChunk: vi.fn(() => detach),
        onStreamDone: vi.fn(() => detach),
        onStreamError: vi.fn(() => detach),
        onStreamStatusChanged: vi.fn(() => detach)
      }
    } as unknown as Window['platform']
  })
}

async function renderPage(defaultAssistantModelId?: string): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      createElement(AssistantPage, {
        language: 'en-US',
        providers,
        chatSettings: createDefaultAppSettings().chat,
        pinnedModelIds: [],
        defaultAssistantModelId
      })
    )
    await Promise.resolve()
  })
  return container
}

function pickerName(container: HTMLElement): string | null {
  return container.querySelector('[data-model-picker="assistant-header"] [data-model-picker-name]')?.textContent ?? null
}

describe('AssistantPage default model label', () => {
  it('shows the configured default when the assistant has no model', async () => {
    installAssistantApi(null)
    const container = await renderPage('provider-1:model-1')

    expect(pickerName(container)).toBe('Following default: Provider / Model 1')
  })

  it('shows the generic label when the assistant has no model and no default is configured', async () => {
    installAssistantApi(null)
    const container = await renderPage()

    expect(pickerName(container)).toBe('Select a model')
  })

  it('keeps an explicitly bound assistant model visible instead of the default', async () => {
    installAssistantApi('provider-1:model-1')
    const container = await renderPage('')

    expect(pickerName(container)).toBe('Model 1')
  })

  it('ignores a default that is no longer usable', async () => {
    installAssistantApi(null)
    const container = await renderPage('provider-1:retired-model')

    expect(pickerName(container)).toBe('Select a model')
  })
})
