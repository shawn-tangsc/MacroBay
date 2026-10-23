import { describe, expect, it, vi } from 'vitest'

import type { ModelProvider } from './modelProviderTypes'
import { MAX_IMAGE_BYTES } from './providerImageGeneration'
import {
  editProviderImages,
  MAX_SOURCE_IMAGE_BYTES,
  validateImageEditInput,
  type ImageEditSourceMime
} from './providerImageEdit'

/**
 * T3：图像编辑主进程契约（`/v1/images/edits`，multipart）。
 * 校验：prompt ≤2000、源图 ≤4MB 且 mime 白名单、结果 ≤2MB；失败复用既有分类码与脱敏；
 * 不写日志、不回显 Key/自定义头值/原始 JSON。
 */
const apiKey = 'sk-edit-secret-1234567890'
const headerValue = 'edit-team-secret'
const onePixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

const provider: ModelProvider = {
  id: 'acme',
  name: 'Acme',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.acme.test' }
  ],
  imageEndpoints: { generation: 'https://api.acme.test/images-base', edit: 'https://api.acme.test/images-base' },
  enabled: true,
  baseUrl: 'https://api.acme.test',
  apiKey,
  customHeaders: [{ name: 'x-team', value: headerValue }],

  models: [
    { id: 'acme-image', name: 'Acme Image', capabilities: { chat: false, imageGeneration: true } }
  ]
}

const sourceBytes = new Uint8Array(Buffer.from(onePixelPng, 'base64'))

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type Call = { url: string; init: RequestInit }

async function run(options: {
  response?: Response | Error
  provider?: ModelProvider
  source?: { mime: ImageEditSourceMime; bytes: Uint8Array }
  prompt?: string
  modelId?: string
} = {}): Promise<{ outcome: Awaited<ReturnType<typeof editProviderImages>>; calls: Call[] }> {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (options.response instanceof Error) throw options.response
    return options.response ?? jsonResponse(200, { data: [{ b64_json: onePixelPng, mime_type: 'image/png' }] })
  })
  const outcome = await editProviderImages(options.provider ?? provider, {
    fetch: fetchMock as unknown as typeof fetch,
    modelId: options.modelId ?? 'acme-image',
    prompt: options.prompt ?? 'make it blue',
    size: '512x512',
    count: 1,
    source: options.source ?? { mime: 'image/png', bytes: sourceBytes }
  })
  return { outcome, calls }
}

describe('validateImageEditInput', () => {
  it('normalizes a stored-file source and an inline source', () => {
    expect(
      validateImageEditInput({
        modelId: 'acme-image',
        prompt: 'make it blue',
        sourceImage: { fileName: '0123456789abcdef.png' }
      })
    ).toEqual({
      ok: true,
      value: {
        modelId: 'acme-image',
        prompt: 'make it blue',
        size: '1024x1024',
        count: 1,
        sourceImage: { kind: 'file', fileName: '0123456789abcdef.png' }
      }
    })

    const inline = validateImageEditInput({
      modelId: 'acme-image',
      prompt: 'make it blue',
      sourceImage: { mime: 'image/webp', bytes: sourceBytes }
    })
    expect(inline.ok).toBe(true)
    if (!inline.ok) return
    expect(inline.value.sourceImage).toMatchObject({ kind: 'inline', mime: 'image/webp' })
  })

  it('rejects a missing source, a missing prompt and an over-long prompt', () => {
    expect(validateImageEditInput({ modelId: 'acme-image', prompt: 'x' })).toMatchObject({
      ok: false,
      reasonCode: 'invalid_request'
    })
    expect(
      validateImageEditInput({ modelId: 'acme-image', prompt: '   ', sourceImage: { fileName: '0123456789abcdef.png' } })
    ).toMatchObject({ ok: false, reasonCode: 'invalid_request' })
    expect(
      validateImageEditInput({
        modelId: 'acme-image',
        prompt: 'x'.repeat(2001),
        sourceImage: { fileName: '0123456789abcdef.png' }
      })
    ).toMatchObject({ ok: false, reasonCode: 'invalid_request' })
  })

  it('rejects an oversized or unsupported inline source before any request', () => {
    expect(
      validateImageEditInput({
        modelId: 'acme-image',
        prompt: 'make it blue',
        sourceImage: { mime: 'image/png', bytes: new Uint8Array(MAX_SOURCE_IMAGE_BYTES + 1) }
      })
    ).toMatchObject({ ok: false, reasonCode: 'source_image_too_large' })

    expect(
      validateImageEditInput({
        modelId: 'acme-image',
        prompt: 'make it blue',
        sourceImage: { mime: 'image/gif', bytes: sourceBytes }
      })
    ).toMatchObject({ ok: false, reasonCode: 'source_image_type_unsupported' })
  })

  it('rejects unsafe stored file names', () => {
    expect(
      validateImageEditInput({
        modelId: 'acme-image',
        prompt: 'make it blue',
        sourceImage: { fileName: '../../etc/passwd.png' }
      })
    ).toMatchObject({ ok: false, reasonCode: 'invalid_request' })
  })
})

describe('editProviderImages', () => {
  it('posts multipart form data with the image, prompt, model, count and size', async () => {
    const { outcome, calls } = await run()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.acme.test/images-base/v1/images/edits')
    expect(calls[0]?.init.method).toBe('POST')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.authorization).toBe(`Bearer ${apiKey}`)
    expect(headers['x-team']).toBe(headerValue)
    // 不手写 content-type：multipart boundary 交给 fetch
    expect(headers['content-type']).toBeUndefined()

    const form = calls[0]?.init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('prompt')).toBe('make it blue')
    expect(form.get('model')).toBe('acme-image')
    expect(form.get('n')).toBe('1')
    expect(form.get('size')).toBe('512x512')
    const image = form.get('image')
    expect(image).toBeInstanceOf(Blob)
    expect((image as Blob).type).toBe('image/png')
    expect((image as Blob).size).toBe(sourceBytes.byteLength)
    expect(outcome).toEqual({ ok: true, images: [{ mime: 'image/png', base64: onePixelPng }] })
  })

  it('refuses to call when the provider has no image edit endpoint', async () => {
    const { outcome, calls } = await run({
      provider: { ...provider, imageEndpoints: { generation: 'https://api.acme.test/images-base' } }
    })

    expect(calls).toHaveLength(0)
    expect(outcome).toMatchObject({ ok: false, reasonCode: 'missing_endpoint' })
  })

  it('refuses an unknown model without sending a request', async () => {
    const { outcome, calls } = await run({ modelId: 'ghost-image' })

    expect(calls).toHaveLength(0)
    expect(outcome).toMatchObject({ ok: false, reasonCode: 'model_not_found' })
  })

  it('refuses an oversized or unsupported source image without sending a request', async () => {
    const tooLarge = await run({ source: { mime: 'image/png', bytes: new Uint8Array(MAX_SOURCE_IMAGE_BYTES + 1) } })
    const wrongType = await run({ source: { mime: 'image/gif' as ImageEditSourceMime, bytes: sourceBytes } })

    expect(tooLarge.calls).toHaveLength(0)
    expect(tooLarge.outcome).toMatchObject({ ok: false, reasonCode: 'source_image_too_large' })
    expect(wrongType.calls).toHaveLength(0)
    expect(wrongType.outcome).toMatchObject({ ok: false, reasonCode: 'source_image_type_unsupported' })
  })

  it('keeps the 2MB limit on the edited result and classifies failures without leaking secrets', async () => {
    const huge = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16)
    const tooLarge = await run({ response: jsonResponse(200, { data: [{ b64_json: huge }] }) })
    expect(tooLarge.outcome).toMatchObject({ ok: false, reasonCode: 'image_too_large' })

    const unauthorized = await run({
      response: jsonResponse(401, { error: { message: `Incorrect API key: ${apiKey}` } })
    })
    expect(unauthorized.outcome).toMatchObject({ ok: false, reasonCode: 'http_401' })
    if (unauthorized.outcome.ok) throw new Error('expected failure')
    expect(unauthorized.outcome.message).not.toContain(apiKey)
    expect(unauthorized.outcome.message).not.toContain(headerValue)
    expect(unauthorized.outcome.message).not.toContain('{"error"')
    expect(unauthorized.outcome.message.length).toBeLessThanOrEqual(220)
  })

  it('never logs anything', async () => {
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
