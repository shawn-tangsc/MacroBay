import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentSessionEntity } from '../schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { createAgentStoreState, type AgentStoreState } from '../store/agentStore'
import type { ModelProvider, ProviderState } from '../../providers/modelProviderTypes'
import { createAgentChatRuntime } from './agentChatRuntime'

const createdAt = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: '0001',
  createdAt,
  updatedAt: createdAt
}

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Code Assistant',
  instructions: 'Answer as a concise code assistant.',
  model: 'provider-1:chat-model',
  modelName: 'Chat Model',
  configuration: { permission_mode: 'default' },
  createdAt,
  updatedAt: createdAt,
  orderKey: '0001'
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: 'agent-1',
  name: 'Session',
  workspaceId: workspace.id,
  workspace,
  orderKey: '0001',
  createdAt,
  updatedAt: createdAt
}

const provider: ModelProvider = {
  id: 'provider-1',
  name: 'Provider',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://example.test' }
  ],
  enabled: true,
  baseUrl: 'https://example.test',
  apiKey: 'sk-test',
  models: [
    {
      id: 'chat-model',
      name: 'Chat Model',
      chatProtocol: 'chat-completions' as const,
      capabilities: { chat: true, vision: false, embedding: false, tools: true }
    }
  ],
  defaultChatModelId: 'chat-model'
}

function createState(overrides: Partial<AgentStoreState> = {}): AgentStoreState {
  return createAgentStoreState({
    agents: [agent],
    sessions: [session],
    workspaces: [workspace],
    messagesBySessionId: {
      'session-1': [
        {
          id: 'message-history',
          sessionId: 'session-1',
          role: 'assistant',
          data: { parts: [{ type: 'text', text: 'Previous answer' }] },
          searchableText: 'Previous answer',
          status: 'success',
          modelId: 'provider-1:chat-model',
          modelSnapshot: { id: 'chat-model', name: 'Chat Model', provider: 'provider-1' },
          stats: null,
          runtimeResumeToken: null,
          createdAt,
          updatedAt: createdAt
        }
      ]
    },
    activeAgentId: 'agent-1',
    activeSessionId: 'session-1',
    ...overrides
  })
}

describe('agent chat runtime', () => {
  it('persists a user turn and streams the assistant message from an OpenAI-compatible provider', async () => {
    let state = createState()
    const writes: AgentStoreState[] = []
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          createSseStream([
            { choices: [{ delta: { content: 'Use the entry trigger' } }] },
            { choices: [{ delta: { content: ' and invalidation level.' } }] },
            { usage: { total_tokens: 21, prompt_tokens: 12, completion_tokens: 9 }, id: 'runtime-resume-token' }
          ]),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
      )
    )
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
        writes.push(next)
      },
      getProviderState: async (): Promise<ProviderState> => ({ providers: [provider] }),
      fetch: fetchMock as unknown as typeof fetch
    })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Review my pull request.' })

    expect(result.state.messagesBySessionId['session-1'].map((message) => message.role)).toEqual([
      'assistant',
      'user',
      'assistant'
    ])
    const assistantMessage = result.assistantMessage
    expect(assistantMessage.status).toBe('success')
    expect(assistantMessage.searchableText).toBe('Use the entry trigger and invalidation level.')
    expect(assistantMessage.stats).toMatchObject({ totalTokens: 21, promptTokens: 12, completionTokens: 9 })
    expect(assistantMessage.runtimeResumeToken).toBe('runtime-resume-token')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer sk-test' }),
        body: expect.stringContaining('"Review my pull request."')
      })
    )
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('Answer as a concise code assistant.')
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('"stream":true')
    expect(writes.map((write) => write.messagesBySessionId['session-1'].at(-1)?.searchableText)).toEqual(
      expect.arrayContaining([
        '正在连接模型服务...',
        'Use the entry trigger',
        'Use the entry trigger and invalidation level.'
      ])
    )
    expect(writes.length).toBeGreaterThanOrEqual(2)
  })

  it('persists mentioned models on the user turn and forwards them into the provider prompt', async () => {
    let state = createState()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(createSseStream([{ choices: [{ delta: { content: 'Done.' } }] }]), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        })
      )
    )
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      getProviderState: async (): Promise<ProviderState> => ({ providers: [provider] }),
      fetch: fetchMock as unknown as typeof fetch
    })

    const result = await runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Use a second opinion.',
      mentionedModels: ['anthropic:claude-sonnet-4', 'openai:gpt-5']
    })

    expect(result.userMessage.data.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'agent-mentioned-models',
          modelIds: ['anthropic:claude-sonnet-4', 'openai:gpt-5']
        })
      ])
    )
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('Mentioned models:')
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('anthropic:claude-sonnet-4')
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('openai:gpt-5')
  })

  it('auto-renames default sessions after the first successful assistant turn', async () => {
    let state = createState({
      sessions: [{ ...session, name: 'New agent session' }]
    })
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      getProviderState: async (): Promise<ProviderState> => ({ providers: [provider] }),
      fetch: vi.fn(async () =>
        Promise.resolve(
          new Response(createSseStream([{ choices: [{ delta: { content: 'Looks good.' } }] }]), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          })
        )
      ) as unknown as typeof fetch
    })

    const result = await runtime.sendMessage({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Please review this pull request and identify risky areas.'
    })

    expect(result.state.sessions.find((item) => item.id === 'session-1')?.name).toBe(
      'Please review this pull request and identify'
    )
  })

  it('keeps manually named sessions during auto-rename checks', async () => {
    let state = createState({
      sessions: [{ ...session, name: 'Release planning' }]
    })
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      getProviderState: async (): Promise<ProviderState> => ({ providers: [provider] }),
      fetch: vi.fn(async () =>
        Promise.resolve(
          new Response(createSseStream([{ choices: [{ delta: { content: 'Done.' } }] }]), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          })
        )
      ) as unknown as typeof fetch
    })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Rename me from text.' })

    expect(result.state.sessions.find((item) => item.id === 'session-1')?.name).toBe('Release planning')
  })

  it('marks the assistant turn as error when the provider is not ready', async () => {
    let state = createState()
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      getProviderState: async (): Promise<ProviderState> => ({ providers: [{ ...provider, apiKey: '' }] }),
      fetch: vi.fn()
    })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Review this.' })

    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.data.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'runtime-text', key: 'agent.runtime.provider-configuration-required' })
    ]))
    expect(result.assistantMessage.searchableText).toBe('agent.runtime.provider-configuration-required')
    expect(state.messagesBySessionId['session-1']).toHaveLength(3)
  })

  it('fails closed before fetching when a vaulted provider cannot resolve a runtime key', async () => {
    let state = createState()
    const metadataProvider = {
      ...provider,
      apiKey: undefined,
      apiKeyRef: 'provider:666978747572652d6167656e74'
    }
    const getProviderState = Object.assign(async (): Promise<ProviderState> => ({ providers: [metadataProvider] }), {
      resolveRuntimeProvider: vi.fn(async () => metadataProvider)
    })
    const fetch = vi.fn()
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      getProviderState,
      fetch: fetch as unknown as typeof globalThis.fetch
    })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Do not send an empty key.' })

    expect(getProviderState.resolveRuntimeProvider).toHaveBeenCalledWith('provider-1')
    expect(fetch).not.toHaveBeenCalled()
    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.data.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'runtime-text', key: 'agent.runtime.provider-configuration-required' })
    ]))
    expect(result.assistantMessage.searchableText).toBe('agent.runtime.provider-configuration-required')
  })

  it('does not persist a provider error that echoes the runtime key', async () => {
    let state = createState()
    const runtimeKeyFixture = 'fixture-agent-runtime-key-1234567890'
    const runtimeProvider = { ...provider, apiKey: runtimeKeyFixture }
    const getProviderState = Object.assign(async (): Promise<ProviderState> => ({
      providers: [{ ...runtimeProvider, apiKey: undefined, apiKeyRef: 'provider:666978747572652d6167656e74' }]
    }), {
      resolveRuntimeProvider: vi.fn(async () => runtimeProvider)
    })
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      getProviderState,
      fetch: vi.fn(async () => new Response(
        JSON.stringify({ error: { message: `upstream echoed ${runtimeKeyFixture}` } }),
        { status: 401 }
      )) as unknown as typeof globalThis.fetch
    })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Keep provider errors safe.' })

    expect(result.assistantMessage.status).toBe('error')
    expect(JSON.stringify(result)).not.toContain(runtimeKeyFixture)
    expect(result.assistantMessage.searchableText).toBe('agent.runtime.provider-request-failed')
  })

  it('surfaces a retired model instead of the generic retry text', async () => {
    let state = createState()
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      getProviderState: Object.assign(async (): Promise<ProviderState> => ({
        providers: [{ ...provider, apiKey: undefined, apiKeyRef: 'provider:666978747572652d6167656e74' }]
      }), { resolveRuntimeProvider: vi.fn(async () => ({ ...provider, apiKey: 'fixture-agent-key' })) }),
      fetch: vi.fn(async () => new Response(
        JSON.stringify({ error: { message: 'This model has been retired and is no longer available.' } }),
        { status: 404 }
      )) as unknown as typeof globalThis.fetch
    })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Retired model.' })

    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.searchableText).toBe('agent.runtime.provider-model-retired')
  })

  it('can cancel an in-flight provider request and persist the assistant turn as paused', async () => {
    let state = createState()
    let capturedSignal: AbortSignal | undefined
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      getProviderState: async (): Promise<ProviderState> => ({ providers: [provider] }),
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      }) as unknown as typeof fetch
    })

    const pending = runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Keep working.', runId: 'run-1' })
    await vi.waitFor(() => expect(capturedSignal).toBeDefined())

    const cancelled = runtime.cancelMessage('run-1')
    const result = await pending

    expect(cancelled).toBe(true)
    expect(capturedSignal?.aborted).toBe(true)
    expect(result.assistantMessage.status).toBe('paused')
    expect(result.assistantMessage.searchableText).toContain('已停止')
    expect(runtime.cancelMessage('run-1')).toBe(false)
  })

  it('can cancel the active run by session id and persist the assistant turn as paused', async () => {
    let state = createState()
    let capturedSignal: AbortSignal | undefined
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      getProviderState: async (): Promise<ProviderState> => ({ providers: [provider] }),
      fetch: vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      }) as unknown as typeof fetch
    })

    const pending = runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Stop by session.', runId: 'run-2' })
    await vi.waitFor(() => expect(capturedSignal).toBeDefined())

    const cancelled = runtime.cancelSession('session-1')
    const result = await pending

    expect(cancelled).toBe(true)
    expect(capturedSignal?.aborted).toBe(true)
    expect(result.assistantMessage.status).toBe('paused')
    expect(result.assistantMessage.searchableText).toContain('已停止')
    expect(runtime.cancelSession('session-1')).toBe(false)
  })

  it('queues follow-up messages for a busy session without creating duplicate pending assistants', async () => {
    let state = createState()
    let firstStream: { enqueue: (chunk: Uint8Array) => void; close: () => void } | null = null
    const encoder = new TextEncoder()
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              firstStream = controller
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'First answer' } }] })}\n\n`))
            }
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
      }

      return new Response(
        createSseStream([{ choices: [{ delta: { content: 'Second answer' } }] }]),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    })
    const runtime = createAgentChatRuntime({
      getAgentState: async () => state,
      saveAgentState: async (next) => {
        state = next
      },
      getProviderState: async (): Promise<ProviderState> => ({ providers: [provider] }),
      fetch: fetchMock as unknown as typeof fetch
    })

    const first = runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'First turn', runId: 'run-1' })
    await vi.waitFor(() => expect(firstStream).not.toBeNull())

    const second = runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Second turn', runId: 'run-2' })
    await vi.waitFor(() => expect(state.messagesBySessionId['session-1'].filter((message) => message.role === 'user')).toHaveLength(2))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.messagesBySessionId['session-1'].filter((message) => message.role === 'assistant' && message.status === 'pending')).toHaveLength(1)
    expect(state.messagesBySessionId['session-1'].map((message) => message.searchableText)).toEqual([
      'Previous answer',
      'First turn',
      'First answer',
      'Second turn'
    ])

    const controller = requireStreamController(firstStream)
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()
    const firstResult = await first
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const secondResult = await second

    expect(firstResult.assistantMessage.searchableText).toBe('First answer')
    expect(secondResult.assistantMessage.searchableText).toBe('Second answer')
    expect(state.messagesBySessionId['session-1'].map((message) => `${message.role}:${message.searchableText}`)).toEqual([
      'assistant:Previous answer',
      'user:First turn',
      'assistant:First answer',
      'user:Second turn',
      'assistant:Second answer'
    ])
  })
})

function createSseStream(items: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const item of items) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    }
  })
}

function requireStreamController(controller: { enqueue: (chunk: Uint8Array) => void; close: () => void } | null): {
  enqueue: (chunk: Uint8Array) => void
  close: () => void
} {
  if (!controller) throw new Error('Expected stream controller to be captured.')
  return controller
}
