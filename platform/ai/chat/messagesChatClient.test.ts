import { describe, expect, it, vi } from 'vitest'

import { ChatProtocolFailureError } from './chatProtocolFailure'
import {
  DEFAULT_MESSAGES_MAX_TOKENS,
  requestMessagesChatCompletion
} from './messagesChatClient'
import { buildMessagesUrl } from '../providers/providerEndpoints'

/**
 * PLAT-69：Anthropic Messages（`POST /v1/messages`）非流式适配器。
 * 鉴权用 `x-api-key` + `anthropic-version`（不是 Bearer）；system 走顶层 `system` 字段，
 * 响应 `content[]` 的 text 块归一成既有 chat 结果。
 */
const apiKey = 'sk-ant-secret-1234567890'

type Call = { url: string; init: RequestInit }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function run(options: {
  response?: Response | Error
  baseUrl?: string
  onDelta?: (text: string) => void
} = {}): Promise<{ result: Awaited<ReturnType<typeof requestMessagesChatCompletion>>; calls: Call[] }> {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (options.response instanceof Error) throw options.response
    return (
      options.response ??
      jsonResponse(200, {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello from ' },
          { type: 'thinking', thinking: 'ignore me' },
          { type: 'text', text: 'Anthropic' }
        ],
        usage: { input_tokens: 12, output_tokens: 4 }
      })
    )
  })
  const result = await requestMessagesChatCompletion({
    baseUrl: options.baseUrl ?? 'https://api.anthropic.com',
    apiKey,
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    messages: [
      { role: 'system', content: 'Be brief.' },
      { role: 'system', content: 'Answer in English.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Again' }
    ],
    temperature: 0.3,
    fetch: fetchMock as unknown as typeof fetch,
    onDelta: options.onDelta
  })
  return { result, calls }
}

describe('PLAT-69 Anthropic messages chat client', () => {
  it('posts to /v1/messages with x-api-key and anthropic-version', async () => {
    const { calls } = await run()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe(apiKey)
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['content-type']).toBe('application/json')
    // 绝不能把 Anthropic 的 Key 当 Bearer 发出去。
    expect(headers.authorization).toBeUndefined()
  })

  it('sends model / max_tokens / merged system / alternating messages', async () => {
    const { calls } = await run()
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>

    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.max_tokens).toBe(DEFAULT_MESSAGES_MAX_TOKENS)
    expect(body.system).toBe('Be brief.\n\nAnswer in English.')
    expect(body.messages).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Again' }
    ])
    expect(body.temperature).toBe(0.3)
  })

  it('never doubles the version segment for an already versioned base', async () => {
    const { calls } = await run({ baseUrl: 'https://api.anthropic.com/v1/' })

    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0]?.url).not.toContain('/v1/v1')
  })

  it('normalizes text blocks into the shared chat result and reports usage', async () => {
    const deltas: string[] = []
    const { result } = await run({ onDelta: (text) => { deltas.push(text) } })

    expect(result.text).toBe('Hello from Anthropic')
    expect(result.stats).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 })
    expect(deltas).toEqual(['Hello from Anthropic'])
  })

  it('omits an empty system field and drops tool messages', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(200, { content: [{ type: 'text', text: 'ok' }] })
    )
    await requestMessagesChatCompletion({
      baseUrl: 'https://api.anthropic.com',
      apiKey,
      modelId: 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: '   ' },
        { role: 'tool', content: 'tool output' },
        { role: 'user', content: 'Hi' }
      ],
      fetch: fetchMock as unknown as typeof fetch
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>
    expect(body.system).toBeUndefined()
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }])
  })

  it('throws the shared failure error on a non-2xx response', async () => {
    const create = () => jsonResponse(401, { error: { message: `invalid x-api-key ${apiKey}` } })

    await expect(run({ response: create() })).rejects.toMatchObject({
      name: 'ChatProtocolFailureError',
      evidence: { phase: 'response', httpStatus: 401, summary: expect.stringContaining('invalid x-api-key') }
    })
    await expect(run({ response: create() })).rejects.toBeInstanceOf(ChatProtocolFailureError)
  })

  it('builds the URL for host and versioned bases', () => {
    expect(buildMessagesUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1/messages')
    expect(buildMessagesUrl('https://api.anthropic.com/')).toBe('https://api.anthropic.com/v1/messages')
    expect(buildMessagesUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1/messages')
    expect(buildMessagesUrl('https://proxy.test/anthropic')).toBe('https://proxy.test/anthropic/v1/messages')
  })
})
