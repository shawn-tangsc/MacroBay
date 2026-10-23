import { describe, expect, it, vi } from 'vitest'

import { requestResponsesChatCompletion } from './responsesChatClient'
import type { ChatProtocolTool, ChatProtocolToolCall, ChatProtocolToolResult } from './chatProtocolTypes'

/**
 * B 包：Responses 适配器的**工具循环**（轮次均为 JSON 响应，流式用例在
 * `responsesChatClient.stream.test.ts`）。
 *
 * 线上事实（方舟 `/api/v3/responses` 实测）：工具声明是**扁平** `{type:'function', name, ...}`，
 * 调用出现在 `output[]` 的 `{type:'function_call', name, arguments, call_id}`，
 * 回传时 input 需要同时带上该 `function_call` item 和 `{type:'function_call_output', call_id, output}`。
 */
const apiKey = 'sk-responses-tools-secret-123456'

type Call = { url: string; init: RequestInit }

const webSearchTool: ChatProtocolTool = {
  name: 'web_search',
  description: 'Search the web',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function functionCallTurn(callId: string, name: string, args: string, usage?: unknown): Response {
  return jsonResponse(200, {
    output: [{ type: 'function_call', name, arguments: args, call_id: callId }],
    ...(usage ? { usage } : {})
  })
}

function readBody(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init.body)) as Record<string, unknown>
}

async function run(options: {
  responses: Array<() => Response>
  tools?: ChatProtocolTool[]
  executeTool?: (call: ChatProtocolToolCall) => Promise<ChatProtocolToolResult>
  maxToolCalls?: number
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
  const tools = options.tools ?? [webSearchTool]
  const result = await requestResponsesChatCompletion({
    baseUrl: 'https://api.acme.test',
    apiKey,
    providerId: 'acme',
    modelId: 'doubao-seed-2-1-pro-260915',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.2,
    fetch: fetchMock as unknown as typeof fetch,
    tools,
    executeTool: options.executeTool ?? (async () => ({ ok: true, content: 'tool output' })),
    ...(options.maxToolCalls === undefined ? {} : { maxToolCalls: options.maxToolCalls })
  })
  return { result, calls }
}

describe('requestResponsesChatCompletion tools', () => {
  it('translates chat-shaped tools into flat Responses function tools and streams the request', async () => {
    const { calls } = await run({
      responses: [() => jsonResponse(200, { output_text: 'ok', output: [] })]
    })

    const body = readBody(calls[0])
    expect(body.tools).toEqual([
      {
        type: 'function',
        name: 'web_search',
        description: 'Search the web',
        parameters: webSearchTool.parameters
      }
    ])
    expect(body.tool_choice).toBe('auto')
    expect(body.stream).toBe(true)
    // chat 的嵌套 function 形状不得出现在 Responses 请求里
    expect(JSON.stringify(body.tools)).not.toContain('"function":{')
  })

  it('runs one tool round and returns the function_call_output in the second request input', async () => {
    const executeTool = vi.fn(async (call: ChatProtocolToolCall) => ({
      ok: true,
      content: JSON.stringify({ results: [call.name] })
    }))
    const { result, calls } = await run({
      responses: [
        () => functionCallTurn('call_1', 'web_search', '{"query":"docs"}', {
          input_tokens: 5,
          output_tokens: 2,
          total_tokens: 7
        }),
        () => jsonResponse(200, { output_text: 'Final answer.', usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 } })
      ],
      executeTool
    })

    expect(calls).toHaveLength(2)
    expect(executeTool).toHaveBeenCalledWith({
      id: 'call_1',
      name: 'web_search',
      argumentsJson: '{"query":"docs"}'
    })

    const secondInput = readBody(calls[1]).input as Array<Record<string, unknown>>
    expect(secondInput[0]).toEqual({ role: 'user', content: 'hi' })
    // assistant 的 function_call item 必须回传，随后才是它的 output
    expect(secondInput[secondInput.length - 2]).toEqual({
      type: 'function_call',
      call_id: 'call_1',
      name: 'web_search',
      arguments: '{"query":"docs"}'
    })
    expect(secondInput[secondInput.length - 1]).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: JSON.stringify({ results: ['web_search'] })
    })

    expect(result.text).toBe('Final answer.')
    // stats 取自最后一轮
    expect(result.stats).toMatchObject({ promptTokens: 9, completionTokens: 4, totalTokens: 13 })
  })

  it('keeps looping across rounds and reports every executed call', async () => {
    const executeTool = vi.fn(async (call: ChatProtocolToolCall) => ({
      ok: true,
      content: `output-of-${call.id}`
    }))
    const { result, calls } = await run({
      responses: [
        () => functionCallTurn('call_1', 'web_search', '{"query":"one"}'),
        () => functionCallTurn('call_2', 'web_search', '{"query":"two"}'),
        () => jsonResponse(200, { output_text: 'Done after two tools.', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } })
      ],
      executeTool
    })

    expect(calls).toHaveLength(3)
    expect(executeTool).toHaveBeenCalledTimes(2)
    const thirdInput = readBody(calls[2]).input as Array<Record<string, unknown>>
    expect(thirdInput.filter((item) => item.type === 'function_call_output').map((item) => item.call_id)).toEqual([
      'call_1',
      'call_2'
    ])
    expect(result.text).toBe('Done after two tools.')
  })

  it('fails when the model asks for more tool calls than maxToolCalls allows', async () => {
    const executeTool = vi.fn(async () => ({ ok: true, content: 'x' }))
    const responses = [
      () =>
        jsonResponse(200, {
          output: [
            { type: 'function_call', name: 'web_search', arguments: '{}', call_id: 'call_1' },
            { type: 'function_call', name: 'web_search', arguments: '{}', call_id: 'call_2' }
          ]
        })
    ]

    await expect(run({ responses, executeTool, maxToolCalls: 1 })).rejects.toThrow(
      'Model tool call limit exceeded.'
    )
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('uses six tool calls as the default limit', async () => {
    const calls = Array.from({ length: 7 }, (_, index) => ({
      type: 'function_call',
      name: 'web_search',
      arguments: '{}',
      call_id: `call_${index}`
    }))

    await expect(run({ responses: [() => jsonResponse(200, { output: calls })] })).rejects.toThrow(
      'Model tool call limit exceeded.'
    )
  })

  it('feeds tool failures back to the model instead of throwing at the caller', async () => {
    const executeTool = vi.fn(async () => ({
      ok: false,
      content: JSON.stringify({ error: 'Web Search failed.' })
    }))
    const { result, calls } = await run({
      responses: [
        () => functionCallTurn('call_1', 'web_search', '{"query":"docs"}'),
        () => jsonResponse(200, { output_text: 'Recovered.', usage: { total_tokens: 3 } })
      ],
      executeTool
    })

    const secondInput = readBody(calls[1]).input as Array<Record<string, unknown>>
    expect(secondInput[secondInput.length - 1]).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: JSON.stringify({ error: 'Web Search failed.' })
    })
    expect(result.text).toBe('Recovered.')
  })

  it('returns successful tool message parts for the assistant citation card', async () => {
    const executeTool = vi.fn(async (call: ChatProtocolToolCall) => ({
      ok: true,
      content: 'sources',
      messagePart: { type: 'web-search', toolName: call.name, status: 'success', query: 'docs' }
    }))
    const { result } = await run({
      responses: [
        () => functionCallTurn('call_1', 'web_search', '{"query":"docs"}'),
        () => jsonResponse(200, { output_text: 'Cited.', output: [] })
      ],
      executeTool
    })

    expect(result.messageParts).toEqual([
      { type: 'web-search', toolName: 'web_search', status: 'success', query: 'docs' }
    ])
  })
})
