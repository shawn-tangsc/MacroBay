import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentSessionEntity } from '../schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { createAgentStoreState } from '../store/agentStore'
import type { ModelProvider } from '../../providers/modelProviderTypes'
import { createAgentChatRuntime } from './agentChatRuntime'

/**
 * T4/T5：**智能体**运行时同样按模型协议派发。
 * - 默认 ⇒ chat/completions（既有 SSE 链路，含 runtimeResumeToken）；
 * - responses / gemini ⇒ 共用适配器（非流式），消息落盘成功；
 * - 选了协议但端点没配 ⇒ provider-configuration-required，零请求。
 */
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
  instructions: 'Answer briefly.',
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

function provider(
  overrides: Partial<ModelProvider> = {},
  chatProtocol?: 'responses' | 'gemini' | 'messages'
): ModelProvider {
  return {
    id: 'provider-1',
    name: 'Provider',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://example.test' } as const
    ],
    // T4/T5：模型没声明协议时跟随供应商默认端点；这里显式声明 chat-completions。

    enabled: true,
    baseUrl: 'https://example.test',
    apiKey: 'sk-test',
    models: [
      {
        id: 'chat-model',
        name: 'Chat Model',
        capabilities: { chat: true, vision: false, embedding: false, tools: true },
        // T4/T5：协议写在模型上（默认 chat-completions），运行时不再跟随供应商默认。
        chatProtocol: chatProtocol ?? 'chat-completions'
      }
    ],
    defaultChatModelId: 'chat-model',
    ...overrides
  }
}

function createRuntime(options: {
  provider: ModelProvider
  fetch: ReturnType<typeof vi.fn>
}) {
  let state = createAgentStoreState({
    agents: [agent],
    sessions: [session],
    workspaces: [workspace],
    messagesBySessionId: { 'session-1': [] },
    activeAgentId: 'agent-1',
    activeSessionId: 'session-1'
  })
  return createAgentChatRuntime({
    getAgentState: async () => state,
    saveAgentState: async (next) => {
      state = next
    },
    getProviderState: async () => ({ providers: [options.provider] }),
    fetch: options.fetch as unknown as typeof fetch
  })
}

describe('agent chat protocol routing', () => {
  it('keeps the streaming chat/completions path for models without an explicit protocol', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(
        'data: {"choices":[{"delta":{"content":"streamed"}}]}\n\ndata: {"usage":{"total_tokens":5},"id":"resume-1"}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    )
    const runtime = createRuntime({ provider: provider(), fetch: fetchMock })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Hi' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.test/v1/chat/completions')
    expect(result.assistantMessage.searchableText).toBe('streamed')
    expect(result.assistantMessage.runtimeResumeToken).toBe('resume-1')
  })

  it('uses the Responses adapter when the model selected it and the endpoint is configured', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ output_text: 'responses answer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    const runtime = createRuntime({
      provider: provider({ endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://api.example.test' },
        { protocol: 'responses', baseUrl: 'https://responses.example.test' }
      ] }, 'responses'),
      fetch: fetchMock
    })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Hi' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://responses.example.test/v1/responses')
    expect(result.assistantMessage.status).toBe('success')
    expect(result.assistantMessage.searchableText).toBe('responses answer')
    expect(result.assistantMessage.runtimeResumeToken).toBeNull()
  })

  it('uses the Gemini adapter when the model selected it and the endpoint is configured', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini answer' }] } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    const runtime = createRuntime({
      provider: provider({ endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://api.example.test' },
        { protocol: 'gemini', baseUrl: 'https://gemini.example.test' }
      ] }, 'gemini'),
      fetch: fetchMock
    })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Hi' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://gemini.example.test/v1beta/models/chat-model:generateContent'
    )
    expect(result.assistantMessage.searchableText).toBe('gemini answer')
  })

  /**
   * PLAT-69：`messages` 复用 Anthropic 端点 —— 官方预设只写 `anthropicBaseUrl`，
   * 运行时必须把它当成已配置端点（否则每次聊天都会被判成 configuration-required）。
   */
  it('uses the Anthropic messages adapter via anthropicBaseUrl', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'messages answer' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    const runtime = createRuntime({
      provider: provider({ endpoints: [{ protocol: 'messages', baseUrl: 'https://anthropic.example.test' } as const], }, 'messages'),
      fetch: fetchMock
    })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Hi' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://anthropic.example.test/v1/messages')
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(result.assistantMessage.searchableText).toBe('messages answer')
  })

  it('fails closed without sending anything when the selected endpoint is missing', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    const runtime = createRuntime({ provider: provider({}, 'responses'), fetch: fetchMock })

    const result = await runtime.sendMessage({ agentId: 'agent-1', sessionId: 'session-1', text: 'Hi' })

    expect(fetchMock).not.toHaveBeenCalled()
    // 智能体把失败写成一条 error 消息（runtime 文案按 code 生成）
    expect(result.assistantMessage.status).toBe('error')
  })
})
