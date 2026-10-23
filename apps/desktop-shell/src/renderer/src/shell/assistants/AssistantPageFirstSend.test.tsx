// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { AssistantTopicStreamSnapshot } from '@platform/ai/assistant-platform/schemas/streamSchemas'

import { AssistantPage } from './AssistantPage'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const assistant = {
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
  modelId: 'provider-1:model-1',
  modelName: null,
  mcpServerIds: [],
  contextSourceIds: [],
  tags: [],
  orderKey: 'assistant-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

const providers: SafeModelProvider[] = [{
  id: 'provider-1',
  name: 'Provider',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.example.test' }
  ],
  enabled: true,
  baseUrl: 'https://api.example.test',
  hasApiKey: true,
  apiKeyPreview: 'fixt...key',
  connectionStatus: 'ready',
  models: [{
    id: 'model-1',
    name: 'Model 1',
    capabilities: { chat: true, vision: false, embedding: false, tools: false }
  }]
}]

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

describe('AssistantPage first-send stream completion', () => {
  it('returns to Send after the first topic reports done before React rebinds stream listeners', async () => {
    const api = installAssistantApi({
      onStreamOpen: ({ topicId }) => {
        api.emitDoneBeforeTopicRebind({ topicId, executionId: 'first-execution', status: 'success', isTopicDone: true })
      }
    })
    const { container, root } = await renderPage()

    await enterDraft(container, 'first message')
    await clickButton(container, 'Send')

    await vi.waitFor(() => {
      expect(api.streamOpen).toHaveBeenCalledOnce()
      expect(buttonLabels(container)).toContain('Send')
      expect(container.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(false)
    })

    await enterDraft(container, 'second message')
    await clickButton(container, 'Send')
    expect(api.streamOpen).toHaveBeenCalledTimes(2)
    await act(async () => root.unmount())
  })

  it.each([
    {
      name: 'reports an error',
      emit: (api: AssistantApi, topicId: string) => api.emitErrorBeforeTopicRebind({
        topicId,
        executionId: 'first-execution',
        isTopicDone: true,
        error: { code: 'provider-request-failed', message: 'request failed' }
      })
    },
    {
      name: 'reports an aborted terminal snapshot',
      emit: (api: AssistantApi, topicId: string) => api.emitStatusBeforeTopicRebind(snapshot(topicId, 'aborted'))
    }
  ])('returns to Send when the first topic $name before React rebinds listeners', async ({ emit }) => {
    const api = installAssistantApi({
      onStreamOpen: ({ topicId }) => emit(api, topicId)
    })
    const { container, root } = await renderPage()

    await enterDraft(container, 'first message')
    await clickButton(container, 'Send')

    await vi.waitFor(() => {
      expect(api.streamOpen).toHaveBeenCalledOnce()
      expect(buttonLabels(container)).toContain('Send')
    })
    await act(async () => root.unmount())
  })

  it.each([
    {
      name: 'done',
      emit: (api: AssistantApi) => api.emitDone({
        topicId: 'first',
        executionId: 'first-execution',
        status: 'success',
        isTopicDone: true
      })
    },
    {
      name: 'error',
      emit: (api: AssistantApi) => api.emitError({
        topicId: 'first',
        executionId: 'first-execution',
        isTopicDone: true,
        error: { code: 'provider-request-failed' }
      })
    },
    {
      name: 'status',
      emit: (api: AssistantApi) => api.emitStatus(snapshot('first', 'aborted'))
    }
  ])('does not let a late $name terminal event for a previously selected topic unlock another topic', async ({ emit }) => {
    const api = installAssistantApi({ topics: [topic('first'), topic('other')] })
    const { container, root } = await renderPage()

    await vi.waitFor(() => expect(container.textContent).toContain('first'))
    await enterDraft(container, 'first message')
    await clickButton(container, 'Send')
    expect(buttonLabels(container)).toContain('Stop')

    await clickButton(container, 'Topics')
    await clickButton(container, 'other')
    await vi.waitFor(() => expect(container.querySelector('.assistant-chat-header-copy')?.textContent).toContain('other'))
    await act(async () => emit(api))

    expect(buttonLabels(container)).toContain('Stop')
    await act(async () => root.unmount())
  })

  it('waits for the current execution before unlocking an existing topic', async () => {
    const api = installAssistantApi({ topics: [topic('existing')] })
    const { container, root } = await renderPage()

    await vi.waitFor(() => expect(container.textContent).toContain('existing'))
    await enterDraft(container, 'message')
    await clickButton(container, 'Send')
    await vi.waitFor(() => expect(api.streamOpen).toHaveBeenCalledOnce())

    await act(async () => api.emitDone({
      topicId: 'existing',
      executionId: 'stale-execution',
      status: 'success',
      isTopicDone: true
    }))
    expect(buttonLabels(container)).toContain('Stop')

    await act(async () => api.emitDone({
      topicId: 'existing',
      executionId: 'first-execution',
      status: 'success',
      isTopicDone: true
    }))
    await vi.waitFor(() => expect(buttonLabels(container)).toContain('Send'))
    await act(async () => root.unmount())
  })

  it('does not let a prior execution terminal event unlock an existing topic before the next stream open returns', async () => {
    let openCount = 0
    let resolveSecondOpen: ((response: { mode: 'started'; executionIds: string[] }) => void) | undefined
    const secondOpen = new Promise<{ mode: 'started'; executionIds: string[] }>((resolve) => {
      resolveSecondOpen = resolve
    })
    const api = installAssistantApi({
      topics: [topic('existing')],
      onStreamOpen: ({ topicId }) => {
        openCount += 1
        if (openCount === 1) {
          api.emitDone({
            topicId,
            executionId: 'first-execution',
            status: 'success',
            isTopicDone: true
          })
          return
        }
        api.emitDone({
          topicId,
          executionId: 'first-execution',
          status: 'success',
          isTopicDone: true
        })
        api.emitError({
          topicId,
          executionId: 'first-execution',
          isTopicDone: true,
          error: { code: 'provider-request-failed' }
        })
        api.emitStatus(snapshot(topicId, 'done'))
      },
      streamOpenResultForOpen: (count) => count === 2
        ? secondOpen
        : { mode: 'started', executionIds: ['first-execution'] }
    })
    const { container, root } = await renderPage()

    await vi.waitFor(() => expect(container.textContent).toContain('existing'))
    await enterDraft(container, 'first message')
    await clickButton(container, 'Send')
    await vi.waitFor(() => expect(buttonLabels(container)).toContain('Send'))

    await enterDraft(container, 'second message')
    await clickButton(container, 'Send')
    expect(buttonLabels(container)).toContain('Stop')

    await act(async () => resolveSecondOpen?.({ mode: 'started', executionIds: ['second-execution'] }))
    expect(buttonLabels(container)).toContain('Stop')

    await act(async () => api.emitDone({
      topicId: 'existing',
      executionId: 'second-execution',
      status: 'success',
      isTopicDone: true
    }))
    await vi.waitFor(() => expect(buttonLabels(container)).toContain('Send'))
    await act(async () => root.unmount())
  })
})

async function renderPage(): Promise<{ container: HTMLDivElement; root: ReturnType<typeof createRoot> }> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(AssistantPage, {
      language: 'en-US',
      providers,
      chatSettings: createDefaultAppSettings().chat,
      pinnedModelIds: []
    }))
    await Promise.resolve()
  })
  return { container, root }
}

async function enterDraft(container: HTMLElement, value: string): Promise<void> {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea')
  if (!textarea) throw new Error('Expected Assistant composer textarea.')
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    descriptor?.set?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`Expected ${label} button.`)
  await act(async () => button.click())
}

function buttonLabels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '')
}

type AssistantApi = {
  streamOpen: ReturnType<typeof vi.fn>
  emitDone: (payload: unknown) => void
  emitDoneBeforeTopicRebind: (payload: unknown) => void
  emitError: (payload: unknown) => void
  emitErrorBeforeTopicRebind: (payload: unknown) => void
  emitStatus: (payload: unknown) => void
  emitStatusBeforeTopicRebind: (payload: unknown) => void
}

function installAssistantApi(input: {
  topics?: ReturnType<typeof topic>[]
  onStreamOpen?: (request: { topicId: string }) => void
  streamOpenResultForOpen?: (count: number) =>
    | { mode: 'started'; executionIds: string[] }
    | Promise<{ mode: 'started'; executionIds: string[] }>
} = {}): AssistantApi {
  const topics = input.topics ?? []
  const doneListeners: Array<(payload: unknown) => void> = []
  const errorListeners: Array<(payload: unknown) => void> = []
  const statusListeners: Array<(payload: unknown) => void> = []
  const detach = () => undefined
  let openCount = 0
  const api: AssistantApi = {
    streamOpen: vi.fn(async (request: { topicId: string }) => {
      openCount += 1
      input.onStreamOpen?.(request)
      return input.streamOpenResultForOpen?.(openCount) ?? { mode: 'started', executionIds: ['first-execution'] }
    }),
    emitDone: (payload) => doneListeners.at(-1)?.(payload),
    emitDoneBeforeTopicRebind: (payload) => doneListeners[0]?.(payload),
    emitError: (payload) => errorListeners.at(-1)?.(payload),
    emitErrorBeforeTopicRebind: (payload) => errorListeners[0]?.(payload),
    emitStatus: (payload) => statusListeners.at(-1)?.(payload),
    emitStatusBeforeTopicRebind: (payload) => statusListeners[0]?.(payload)
  }
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      assistants: {
        list: vi.fn(async () => [assistant]),
        listTopics: vi.fn(async () => ({ topics })),
        createTopic: vi.fn(async () => {
          const created = topic('created-topic')
          topics.push(created)
          return created
        }),
        listTopicMessages: vi.fn(async () => ({ messages: [] })),
        streamOpen: api.streamOpen,
        streamAttach: vi.fn(async (topicId: string) => ({ snapshot: snapshot(topicId, 'done') })),
        onStreamChunk: vi.fn(() => detach),
        onStreamDone: vi.fn((listener) => {
          doneListeners.push(listener)
          return detach
        }),
        onStreamError: vi.fn((listener) => {
          errorListeners.push(listener)
          return detach
        }),
        onStreamStatusChanged: vi.fn((listener) => {
          statusListeners.push(listener)
          return detach
        })
      }
    } as unknown as Window['platform']
  })
  return api
}

function topic(id: string) {
  return {
    id,
    assistantId: assistant.id,
    name: id,
    isNameManuallyEdited: false,
    orderKey: id,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  }
}

function snapshot(topicId: string, status: AssistantTopicStreamSnapshot['status']): AssistantTopicStreamSnapshot {
  return {
    topicId,
    status,
    activeExecutions: [],
    awaitingApprovalAnchors: [],
    updatedAt: '2026-08-01T00:00:00.000Z'
  }
}
