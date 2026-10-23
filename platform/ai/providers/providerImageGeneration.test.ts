import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider } from './modelProviderTypes'
import {
  generateProviderImages,
  MAX_IMAGE_BYTES,
  validateImageGenerationInput
} from './providerImageGeneration'

/**
 * PLAT-63 第二阶段 B：图像生成主进程契约。
 * 只认已配置的 `imageEndpoints.generation`；返回 base64（≤2MB/张），
 * 失败复用既有分类码与脱敏规则（≤200、无原始 JSON、Key/自定义头值不回显、不写日志）。
 */
const apiKey = 'sk-image-secret-1234567890'
const headerValue = 'image-team-secret'

const provider: ModelProvider = {
  id: 'acme',
  name: 'Acme',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' }
  ],
  imageEndpoints: { generation: 'https://api.acme.test/images-base' },
  enabled: true,
  baseUrl: 'https://api.acme.test',
  apiKey,
  customHeaders: [{ name: 'x-team', value: headerValue }],

  models: [
    { id: 'acme-chat', name: 'Acme Chat', capabilities: { chat: true } },
    { id: 'acme-image', name: 'Acme Image', capabilities: { chat: false, imageGeneration: true } }
  ]
}

const onePixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Call = { url: string; init: RequestInit }

async function run(options: {
  response?: Response | Error
  request?: Partial<{ modelId: string; prompt: string; size: string; count: number }>
  provider?: ModelProvider
} = {}): Promise<{ outcome: Awaited<ReturnType<typeof generateProviderImages>>; calls: Call[] }> {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (options.response instanceof Error) throw options.response
    return options.response ?? jsonResponse(200, { data: [{ b64_json: onePixelPng, mime_type: 'image/png' }] })
  })
  const outcome = await generateProviderImages(options.provider ?? provider, {
    fetch: fetchMock as unknown as typeof fetch,
    modelId: options.request?.modelId ?? 'acme-image',
    prompt: options.request?.prompt ?? 'a red fox',
    size: (options.request?.size ?? '512x512') as never,
    count: options.request?.count ?? 1
  })
  return { outcome, calls }
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>
}

describe('validateImageGenerationInput', () => {
  it('accepts a normal request with defaults', () => {
    expect(validateImageGenerationInput({ modelId: 'acme-image', prompt: 'a red fox' })).toEqual({
      ok: true,
      value: { modelId: 'acme-image', prompt: 'a red fox', size: '1024x1024', count: 1 }
    })
  })

  it('rejects an empty prompt', () => {
    expect(validateImageGenerationInput({ modelId: 'acme-image', prompt: '   ' })).toMatchObject({
      ok: false,
      reasonCode: 'invalid_request'
    })
  })

  it('rejects a prompt over 2000 characters', () => {
    expect(
      validateImageGenerationInput({ modelId: 'acme-image', prompt: 'x'.repeat(2001) })
    ).toMatchObject({ ok: false, reasonCode: 'invalid_request' })
  })

  it('rejects an out-of-range count and a size outside the whitelist', () => {
    expect(validateImageGenerationInput({ modelId: 'acme-image', prompt: 'fox', count: 99 })).toMatchObject({
      ok: false,
      reasonCode: 'invalid_request'
    })
    expect(
      validateImageGenerationInput({ modelId: 'acme-image', prompt: 'fox', size: '4096x4096' })
    ).toMatchObject({ ok: false, reasonCode: 'invalid_request' })
  })

  it('rejects a missing model id', () => {
    expect(validateImageGenerationInput({ prompt: 'fox' })).toMatchObject({
      ok: false,
      reasonCode: 'invalid_request'
    })
  })
})

describe('generateProviderImages', () => {
  it('posts b64_json to the configured image endpoint with the model, size and count', async () => {
    const { outcome, calls } = await run({ request: { size: '256x256', count: 2 } })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.acme.test/images-base/v1/images/generations')
    expect(calls[0]?.init.method).toBe('POST')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${apiKey}`)
    expect(headers['x-team']).toBe(headerValue)
    expect(bodyOf(calls[0] as Call)).toEqual({
      model: 'acme-image',
      prompt: 'a red fox',
      n: 2,
      size: '256x256',
      response_format: 'b64_json'
    })
    expect(outcome).toEqual({ ok: true, images: [{ mime: 'image/png', base64: onePixelPng }] })
  })

  it('refuses to call when the provider has no image generation endpoint', async () => {
    const { outcome, calls } = await run({ provider: { ...provider, imageEndpoints: {} } })

    expect(calls).toHaveLength(0)
    expect(outcome).toMatchObject({ ok: false, reasonCode: 'missing_endpoint' })
  })

  it('refuses an unknown model without sending a request', async () => {
    const { outcome, calls } = await run({ request: { modelId: 'ghost-image' } })

    expect(calls).toHaveLength(0)
    expect(outcome).toMatchObject({ ok: false, reasonCode: 'model_not_found' })
  })

  it('classifies HTTP failures with the shared mapping and never echoes the key or raw JSON', async () => {
    const { outcome } = await run({
      response: jsonResponse(401, { error: { message: `Incorrect API key: ${apiKey}` } })
    })

    expect(outcome.ok).toBe(false)
    expect(outcome).toMatchObject({ reasonCode: 'http_401' })
    if (outcome.ok) throw new Error('expected failure')
    expect(outcome.message).toContain('HTTP 401')
    expect(outcome.message).not.toContain(apiKey)
    expect(outcome.message).not.toContain(headerValue)
    expect(outcome.message).not.toContain('{"error"')
    expect(outcome.message.length).toBeLessThanOrEqual(220)
  })

  it('reports insufficient balance as its own reason code', async () => {
    const { outcome } = await run({
      response: jsonResponse(402, { error: { message: 'Insufficient balance, please recharge.' } })
    })

    expect(outcome).toMatchObject({ ok: false, reasonCode: 'account_balance_insufficient' })
  })

  it('maps transport failures to a network reason code', async () => {
    const { outcome } = await run({
      response: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    })

    expect(outcome).toMatchObject({ ok: false, reasonCode: 'network_dns' })
  })

  it('refuses images larger than 2MB and returns no image at all', async () => {
    // base64 长度超过 2MB 的解码体积（约 4/3 膨胀），不实际分配大图。
    const huge = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16)
    const { outcome } = await run({
      response: jsonResponse(200, { data: [{ b64_json: huge }] })
    })

    expect(outcome).toMatchObject({ ok: false, reasonCode: 'image_too_large' })
    expect('images' in outcome).toBe(false)
  })

  it('treats a response without b64_json as an invalid response', async () => {
    const { outcome } = await run({ response: jsonResponse(200, { data: [{ url: 'https://x.test/a.png' }] }) })

    expect(outcome).toMatchObject({ ok: false, reasonCode: 'invalid_response' })
  })

  it('never logs anything (no key, no base64)', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
    ]
    try {
      await run()
      await run({ response: jsonResponse(500, { error: { message: 'boom' } }) })
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
