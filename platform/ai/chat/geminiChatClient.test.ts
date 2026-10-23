import { describe, expect, it, vi } from 'vitest'

import { requestGeminiChatCompletion } from './geminiChatClient'

/**
 * T5：Gemini 原生（`:generateContent`）非流式适配器。
 * `contents/parts` + `systemInstruction`，鉴权用 `x-goog-api-key`（不是 Bearer），
 * 基址的 `/v1`·`/v1beta` 后缀与模型 id 的 `models/` 前缀都必须只出现一次。
 */
const apiKey = 'AIza-gemini-secret-1234567890'

type Call = { url: string; init: RequestInit }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function run(options: {
  response?: Response | Error
  baseUrl?: string
  modelId?: string
  onDelta?: (text: string) => void
} = {}): Promise<{ result: Awaited<ReturnType<typeof requestGeminiChatCompletion>>; calls: Call[] }> {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (options.response instanceof Error) throw options.response
    return (
      options.response ??
      jsonResponse(200, {
        candidates: [{ content: { role: 'model', parts: [{ text: 'Hello from gemini' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 5, totalTokenCount: 14 }
      })
    )
  })
  const result = await requestGeminiChatCompletion({
    baseUrl: options.baseUrl ?? 'https://generativelanguage.test',
    apiKey,
    providerId: 'google',
    modelId: options.modelId ?? 'gemini-2.0-flash',
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

describe('requestGeminiChatCompletion', () => {
  it('posts contents + systemInstruction to :generateContent with x-goog-api-key', async () => {
    const { result, calls } = await run()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.test/v1beta/models/gemini-2.0-flash:generateContent'
    )
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe(apiKey)
    expect(headers.authorization).toBeUndefined()

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'model', parts: [{ text: 'Hello' }] },
      { role: 'user', parts: [{ text: 'Again' }] }
    ])
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] })
    expect(body.generationConfig).toMatchObject({ temperature: 0.3 })
    expect(body.messages).toBeUndefined()
    expect(result.text).toBe('Hello from gemini')
    expect(result.stats).toMatchObject({ promptTokens: 9, completionTokens: 5, totalTokens: 14 })
  })

  it('strips a versioned base and a models/ prefix exactly once', async () => {
    const versioned = await run({ baseUrl: 'https://generativelanguage.test/v1beta/' })
    expect(versioned.calls[0]?.url).toBe(
      'https://generativelanguage.test/v1beta/models/gemini-2.0-flash:generateContent'
    )

    const prefixed = await run({ baseUrl: 'https://generativelanguage.test/v1', modelId: 'models/gemini-2.0-pro' })
    expect(prefixed.calls[0]?.url).toBe(
      'https://generativelanguage.test/v1beta/models/gemini-2.0-pro:generateContent'
    )
  })

  it('joins every text part of the first candidate', async () => {
    const { result } = await run({
      response: jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: 'Part one. ' }, { text: 'Part two.' }] } }]
      })
    })

    expect(result.text).toBe('Part one. Part two.')
  })

  it('emits the whole text once through onDelta', async () => {
    const onDelta = vi.fn()
    await run({ onDelta })

    expect(onDelta).toHaveBeenCalledTimes(1)
    expect(onDelta).toHaveBeenCalledWith('Hello from gemini')
  })

  it('reports a blocked prompt instead of persisting an empty message', async () => {
    await expect(
      run({ response: jsonResponse(200, { promptFeedback: { blockReason: 'SAFETY' } }) })
    ).rejects.toThrow('Model response was blocked: SAFETY')
  })

  it('surfaces non-2xx as provider-request-failed evidence', async () => {
    await expect(
      run({ response: jsonResponse(400, { error: { message: 'API key not valid.' } }) })
    ).rejects.toMatchObject({
      name: 'ChatProtocolFailureError',
      message: 'provider-request-failed',
      evidence: { phase: 'response', httpStatus: 400 }
    })
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
