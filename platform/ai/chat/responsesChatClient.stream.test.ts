import { describe, expect, it, vi } from 'vitest'

import { requestResponsesChatCompletion } from './responsesChatClient'
import type { ChatProtocolTool, ChatProtocolToolCall, ChatProtocolToolResult } from './chatProtocolTypes'

/**
 * B 包：Responses 适配器的**流式**读取。
 *
 * 只认四个 SSE 事件：`response.output_text.delta`（累积回调）、`response.output_item.done`
 * （函数调用）、`response.completed`（usage）、`error` / `response.failed`（中性失败）。
 * 供应商回 `application/json` 时回退到 JSON 解析；abort 必须能打断读取循环。
 */
const apiKey = 'sk-responses-stream-secret-123456'

type Call = { url: string; init: RequestInit }

const webSearchTool: ChatProtocolTool = {
  name: 'web_search',
  description: 'Search the web',
  parameters: { type: 'object', properties: { query: { type: 'string' } } }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function sseResponse(events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  })
}

async function run(options: {
  responses: Array<() => Response>
  executeTool?: (call: ChatProtocolToolCall) => Promise<ChatProtocolToolResult>
  onDelta?: (text: string) => void
  signal?: AbortSignal
}): Promise<{ result: Awaited<ReturnType<typeof requestResponsesChatCompletion>>; calls: Call[] }> {
  const calls: Call[] = []
  let index = 0
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = options.responses[index]
    index += 1
    if (!next) throw new Error('unexpected extra provider request')
    return next()
  })
  const result = await requestResponsesChatCompletion({
    baseUrl: 'https://api.acme.test',
    apiKey,
    providerId: 'acme',
    modelId: 'doubao-seed-2-1-pro-260915',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.2,
    fetch: fetchMock as unknown as typeof fetch,
    tools: [webSearchTool],
    executeTool: options.executeTool ?? (async () => ({ ok: true, content: 'tool output' })),
    ...(options.onDelta ? { onDelta: options.onDelta } : {}),
    ...(options.signal ? { signal: options.signal } : {})
  })
  return { result, calls }
}

describe('requestResponsesChatCompletion streaming', () => {
  it('emits accumulated text for every output_text delta and reads usage from response.completed', async () => {
    const onDelta = vi.fn()
    const { result } = await run({
      responses: [
        () =>
          sseResponse([
            { type: 'response.created', response: { id: 'resp_1' } },
            { type: 'response.output_text.delta', delta: 'Hel' },
            { type: 'response.output_text.delta', delta: 'lo' },
            { type: 'response.output_text.delta', delta: ' there' },
            {
              type: 'response.completed',
              response: { usage: { input_tokens: 4, output_tokens: 6, total_tokens: 10 } }
            }
          ])
      ],
      onDelta
    })

    expect(onDelta.mock.calls.map(([text]) => text)).toEqual(['Hel', 'Hello', 'Hello there'])
    expect(result.text).toBe('Hello there')
    expect(result.stats).toMatchObject({ promptTokens: 4, completionTokens: 6, totalTokens: 10 })
  })

  it('falls back to JSON parsing when the provider answers with application/json', async () => {
    const onDelta = vi.fn()
    const { result } = await run({
      responses: [() => jsonResponse(200, { output_text: 'Whole JSON answer' })],
      onDelta
    })

    expect(result.text).toBe('Whole JSON answer')
    expect(onDelta.mock.calls.map(([text]) => text)).toEqual(['Whole JSON answer'])
  })

  it('runs the tool loop on a streamed first round and still streams the final answer', async () => {
    const executeTool = vi.fn(async () => ({ ok: true, content: 'search result' }))
    const onDelta = vi.fn()
    const { result, calls } = await run({
      responses: [
        () =>
          sseResponse([
            { type: 'response.output_text.delta', delta: 'Let me search.' },
            {
              type: 'response.output_item.done',
              item: { type: 'function_call', name: 'web_search', arguments: '{"query":"docs"}', call_id: 'call_1' }
            },
            { type: 'response.completed', response: { usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 } } }
          ]),
        () =>
          sseResponse([
            { type: 'response.output_text.delta', delta: 'Streamed ' },
            { type: 'response.output_text.delta', delta: 'answer.' },
            { type: 'response.completed', response: { usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } } }
          ])
      ],
      executeTool,
      onDelta
    })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
    const secondInput = JSON.parse(String(calls[1]?.init.body)).input as Array<Record<string, unknown>>
    expect(secondInput[secondInput.length - 1]).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: 'search result'
    })
    expect(result.text).toBe('Streamed answer.')
    expect(onDelta.mock.calls.map(([text]) => text)).toContain('Streamed answer.')
    expect(result.stats).toMatchObject({ totalTokens: 11 })
  })

  it('surfaces an SSE error event as neutral failure evidence without leaking the key', async () => {
    const error = await run({
      responses: [
        () =>
          sseResponse([
            { type: 'response.created', response: { id: 'resp_1' } },
            { type: 'error', error: { message: `bad key ${apiKey}`, code: 'invalid_api_key' } }
          ])
      ]
    }).catch((reason: unknown) => reason)

    expect(error).toMatchObject({
      name: 'ChatProtocolFailureError',
      message: 'provider-request-failed',
      evidence: { phase: 'response', summary: `bad key ${apiKey}` }
    })
    // 适配器自己不得把凭据写进证据（authorization 头永远不回声）
    expect(JSON.stringify((error as { evidence: unknown }).evidence)).not.toContain('Bearer ')
  })

  it('surfaces response.failed as neutral failure evidence', async () => {
    await expect(
      run({
        responses: [
          () => sseResponse([{ type: 'response.failed', response: { error: { message: 'server said no' } } }])
        ]
      })
    ).rejects.toMatchObject({
      name: 'ChatProtocolFailureError',
      evidence: { phase: 'response', summary: 'server said no' }
    })
  })

  it('surfaces a 500 JSON body as evidence with the http status', async () => {
    await expect(
      run({ responses: [() => jsonResponse(500, { error: { message: 'upstream exploded' } })] })
    ).rejects.toMatchObject({
      name: 'ChatProtocolFailureError',
      evidence: { phase: 'response', httpStatus: 500, summary: 'upstream exploded' }
    })
  })

  it('stops reading the stream when the caller aborts', async () => {
    const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      start(inner) {
        inner.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Hi"}\n\n'))
      }
    })

    await expect(
      run({
        responses: [() => new Response(body, { headers: { 'content-type': 'text/event-stream' } })],
        onDelta: () => controller.abort(),
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})
