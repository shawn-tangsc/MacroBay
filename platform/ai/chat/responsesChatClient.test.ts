import { describe, expect, it, vi } from 'vitest'

import { requestResponsesChatCompletion } from './responsesChatClient'

/**
 * T4：OpenAI Responses（`POST /v1/responses`）非流式适配器。
 * 请求 `{model, input}`（input 是消息项数组，不是 chat 的 `messages`），
 * 响应 `output[]` / `output_text` 归一成文本 + token 统计；失败抛中性 `ChatProtocolFailureError`（不含 Key）。
 */
const apiKey = 'sk-responses-secret-1234567890'

type Call = { url: string; init: RequestInit }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function run(options: {
  response?: Response | Error
  baseUrl?: string
  onDelta?: (text: string) => void
} = {}): Promise<{ result: Awaited<ReturnType<typeof requestResponsesChatCompletion>>; calls: Call[] }> {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (options.response instanceof Error) throw options.response
    return (
      options.response ??
      jsonResponse(200, {
        id: 'resp_1',
        output_text: 'Hello from responses',
        output: [],
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 }
      })
    )
  })
  const result = await requestResponsesChatCompletion({
    baseUrl: options.baseUrl ?? 'https://api.acme.test',
    apiKey,
    providerId: 'acme',
    modelId: 'gpt-5',
    messages: [
      { role: 'system', content: 'Be brief.' },
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

describe('requestResponsesChatCompletion', () => {
  it('posts model + input items to /v1/responses without chat-style messages', async () => {
    const { result, calls } = await run()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.acme.test/v1/responses')
    expect(calls[0]?.init.method).toBe('POST')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${apiKey}`)
    expect(headers['content-type']).toBe('application/json')

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body.model).toBe('gpt-5')
    expect(body.messages).toBeUndefined()
    // 没传 tools 时请求体形状必须逐字不变（B 包新增的 tools/tool_choice/stream 都不得出现）
    expect(Object.keys(body).sort()).toEqual(['input', 'model', 'temperature'])
    expect(body.input).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Again' }
    ])
    expect(result.text).toBe('Hello from responses')
    expect(result.stats).toMatchObject({ promptTokens: 11, completionTokens: 7, totalTokens: 18 })
  })

  it('does not duplicate the version when the base url already has one', async () => {
    const { calls } = await run({ baseUrl: 'https://api.acme.test/v1/' })

    expect(calls[0]?.url).toBe('https://api.acme.test/v1/responses')
  })

  it('flattens output[] message content when output_text is missing', async () => {
    const { result } = await run({
      response: jsonResponse(200, {
        output: [
          { type: 'reasoning', summary: [] },
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'Part one. ' },
              { type: 'output_text', text: 'Part two.' }
            ]
          }
        ],
        usage: { input_tokens: 3, output_tokens: 4 }
      })
    })

    expect(result.text).toBe('Part one. Part two.')
    expect(result.stats).toMatchObject({ promptTokens: 3, completionTokens: 4 })
  })

  it('emits the whole text once through onDelta (streaming is deferred)', async () => {
    const onDelta = vi.fn()
    await run({ onDelta })

    expect(onDelta).toHaveBeenCalledTimes(1)
    expect(onDelta).toHaveBeenCalledWith('Hello from responses')
  })

  it('surfaces non-2xx as provider-request-failed evidence without leaking the key', async () => {
    await expect(
      run({ response: jsonResponse(401, { error: { message: `Incorrect API key: ${apiKey}` } }) })
    ).rejects.toMatchObject({
      name: 'ChatProtocolFailureError',
      message: 'provider-request-failed',
      evidence: { phase: 'response', httpStatus: 401 }
    })
  })

  it('refuses an empty response instead of persisting a blank assistant message', async () => {
    await expect(run({ response: jsonResponse(200, { output: [] }) })).rejects.toThrow(
      'Model response did not include assistant text.'
    )
  })

  it('never logs anything', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ]
    try {
      await run()
      await expect(run({ response: jsonResponse(500, { error: { message: 'boom' } }) })).rejects.toBeTruthy()
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
