import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider } from './modelProviderTypes'
import { testModelProviderConnection } from './providerConnection'

/**
 * PLAT-75：巡检对 Gemini 必须走**原生**端点。
 * 若仍打 `/v1/chat/completions`，Google 会回 404，从而把"路径不存在"误判成"模型下线"。
 */
function geminiProvider(): ModelProvider {
  return {
    id: 'gemini',
    name: 'Gemini',
    endpoints: [
      { protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' }
    ],
    enabled: true,
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: 'fixture-gemini-key',
    models: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', capabilities: { chat: true } }],
    defaultChatModelId: 'gemini-2.5-flash'
  }
}

describe('PLAT-75 gemini connection probe', () => {
  it('probes the native generateContent endpoint with the google key header', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))

    const result = await testModelProviderConnection(geminiProvider(), {
      modelId: 'gemini-2.5-flash',
      fetch
    })

    expect(result).toMatchObject({ ok: true })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect(url).not.toContain('/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('fixture-gemini-key')
    expect(headers.authorization).toBeUndefined()
    expect(JSON.parse(String(init.body))).toMatchObject({ contents: [{ role: 'user' }] })
  })

  it('reports a retired gemini model as model_retired (not a generic 404)', async () => {
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'This model has been retired and is no longer available.' } }),
      { status: 404, headers: { 'content-type': 'application/json' } }
    ))

    const result = await testModelProviderConnection(geminiProvider(), { modelId: 'gemini-2.5-flash', fetch })

    expect(result).toMatchObject({ ok: false, failureCode: 'model_retired' })
  })
})
