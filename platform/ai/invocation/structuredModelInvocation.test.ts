import { describe, expect, it, vi } from 'vitest'

import type { ProviderState } from '../providers/modelProviderTypes'
import { createDefaultProviderState } from '../providers/providerStore'

import { resolveChatModel, resolveSafeModelLabelsFromState } from './resolveChatModel'
import { createStructuredModelInvocationService } from './structuredModelInvocation'

function createReadyProviderState(): ProviderState {
  const state = createDefaultProviderState()
  const provider = state.providers[0]
  if (!provider) throw new Error('Missing default provider')
  provider.enabled = true
  provider.apiKey = 'test-key'
  provider.baseUrl = 'https://example.com/v1'
  provider.defaultChatModelId = provider.models.find((model) => model.capabilities.chat)?.id
  return state
}

describe('resolveChatModel', () => {
  it('returns missing-api-key when provider is enabled without a key', () => {
    const state = createReadyProviderState()
    state.providers[0]!.enabled = true
    state.providers[0]!.apiKey = ''

    expect(resolveChatModel(state)).toEqual({ ok: false, errorCode: 'missing-api-key' })
  })

  it('returns provider-disabled when the selected provider is disabled', () => {
    const state = createReadyProviderState()
    const provider = state.providers[0]!
    provider.enabled = false

    expect(resolveChatModel(state, provider.id)).toEqual({ ok: false, errorCode: 'provider-disabled' })
  })

  it('resolves the default chat model for a ready provider', () => {
    const state = createReadyProviderState()
    const provider = state.providers[0]!
    const modelId = provider.defaultChatModelId

    expect(resolveChatModel(state, provider.id, modelId)).toMatchObject({
      ok: true,
      model: {
        providerId: provider.id,
        modelId,
        apiKey: 'test-key'
      }
    })
  })

  it('does not replace an explicit unavailable model with the provider default', () => {
    const state = createReadyProviderState()
    const provider = state.providers[0]!

    expect(resolveChatModel(state, provider.id, 'missing-model')).toEqual({
      ok: false,
      errorCode: 'model-not-ready'
    })
  })

  it('returns safe labels without exposing secrets', () => {
    const state = createReadyProviderState()
    const labels = resolveSafeModelLabelsFromState(state)
    expect(labels.providerLabel).toBeTruthy()
    expect(labels.modelLabel).toBeTruthy()
    expect(JSON.stringify(labels)).not.toMatch(/test-key|apiKey/i)
  })
})

describe('createStructuredModelInvocationService', () => {
  it('returns model-not-ready when no provider is configured', async () => {
    const service = createStructuredModelInvocationService({
      getProviderState: async () => createDefaultProviderState()
    })

    const result = await service.invoke({
      taskId: 'task-1',
      messages: [{ role: 'user', content: 'hello' }],
      parse: (value) => value
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('model-not-ready')
      expect(result.trace.taskId).toBe('task-1')
      expect(result.trace.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('parses structured JSON output through the caller parser', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ title: '译文标题' }) } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    const service = createStructuredModelInvocationService({
      getProviderState: async () => createReadyProviderState(),
      fetch
    })

    const result = await service.invoke({
      taskId: 'task-2',
      messages: [{ role: 'user', content: 'translate' }],
      parse: (value) => {
        const record = value as { title?: string }
        if (!record.title) throw new Error('missing title')
        return record.title
      }
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.output).toBe('译文标题')
      expect(result.providerId).toBeTruthy()
      expect(result.modelId).toBeTruthy()
    }

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: expect.stringMatching(/^Bearer /)
        })
      })
    )
    expect(JSON.stringify(result)).not.toMatch(/test-key/)
    if (result.ok) {
      expect(JSON.stringify(result.trace)).not.toMatch(/test-key/)
    }
  })

  it('resolves the requested provider key only through the main-process runtime resolver', async () => {
    const runtimeKeyFixture = 'fixture-runtime-key-1234567890'
    const metadataState = createReadyProviderState()
    metadataState.providers[0]!.apiKey = undefined
    metadataState.providers[0]!.apiKeyRef = 'provider:73747275637475726564'
    const getProviderState = Object.assign(async () => metadataState, {
      resolveRuntimeProvider: vi.fn(async () => ({ ...createReadyProviderState().providers[0]!, apiKey: runtimeKeyFixture }))
    })
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }),
      { status: 200 }
    ))
    const service = createStructuredModelInvocationService({ getProviderState, fetch })

    await expect(service.invoke({
      taskId: 'runtime-resolver-task',
      providerId: metadataState.providers[0]!.id,
      messages: [{ role: 'user', content: 'fixture prompt' }],
      parse: (value) => value
    })).resolves.toMatchObject({ ok: true })

    expect(getProviderState.resolveRuntimeProvider).toHaveBeenCalledWith(metadataState.providers[0]!.id)
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ authorization: `Bearer ${runtimeKeyFixture}` })
    }))
  })

  it('returns invalid-json when provider content is not JSON', async () => {
    const service = createStructuredModelInvocationService({
      getProviderState: async () => createReadyProviderState(),
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    })

    const result = await service.invoke({
      taskId: 'task-3',
      messages: [{ role: 'user', content: 'translate' }],
      parse: (value) => value
    })

    expect(result).toMatchObject({ ok: false, errorCode: 'invalid-json' })
  })

  it('returns schema-validation-failed when parser rejects output', async () => {
    const service = createStructuredModelInvocationService({
      getProviderState: async () => createReadyProviderState(),
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({}) } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    })

    const result = await service.invoke({
      taskId: 'task-4',
      messages: [{ role: 'user', content: 'translate' }],
      parse: () => {
        throw new Error('invalid shape')
      }
    })

    expect(result).toMatchObject({ ok: false, errorCode: 'schema-validation-failed' })
  })

  it('maps provider HTTP failures to provider-error', async () => {
    const service = createStructuredModelInvocationService({
      getProviderState: async () => createReadyProviderState(),
      fetch: vi.fn(async () => new Response('{}', { status: 503 }))
    })

    const result = await service.invoke({
      taskId: 'task-5',
      messages: [{ role: 'user', content: 'translate' }],
      parse: (value) => value
    })

    expect(result).toMatchObject({ ok: false, errorCode: 'provider-error' })
  })

  it('maps HTTP 429 to rate-limited', async () => {
    const service = createStructuredModelInvocationService({
      getProviderState: async () => createReadyProviderState(),
      fetch: vi.fn(async () => new Response('{}', { status: 429 }))
    })

    const result = await service.invoke({
      taskId: 'task-6',
      messages: [{ role: 'user', content: 'translate' }],
      parse: (value) => value
    })

    expect(result).toMatchObject({ ok: false, errorCode: 'rate-limited' })
  })

  it('does not include raw prompt or provider response in trace metadata', async () => {
    const service = createStructuredModelInvocationService({
      getProviderState: async () => createReadyProviderState(),
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ secret: 'raw-provider-response' }) } }]
          }),
          { status: 200 }
        )
      )
    })

    const result = await service.invoke({
      taskId: 'task-7',
      messages: [{ role: 'user', content: 'raw-prompt-body' }],
      parse: (value) => value
    })

    expect(JSON.stringify(result.trace)).not.toMatch(/raw-prompt-body|raw-provider-response|test-key/i)
  })

  it('reports its own budget expiring as a timeout', async () => {
    // A request that only ever ends because it was aborted: exactly what a slow provider looks like.
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const service = createStructuredModelInvocationService({ getProviderState: async () => createReadyProviderState(), fetch: fetch as unknown as typeof globalThis.fetch })

    const result = await service.invoke({
      taskId: 'task-timeout',
      messages: [{ role: 'user', content: 'slow' }],
      timeoutMs: 5,
      parse: (value) => value
    })

    expect(result).toMatchObject({ ok: false, errorCode: 'timeout' })
  })

  it('reports a caller abort as cancelled instead of a timeout', async () => {
    const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const service = createStructuredModelInvocationService({ getProviderState: async () => createReadyProviderState(), fetch: fetch as unknown as typeof globalThis.fetch })
    const controller = new AbortController()

    const pending = service.invoke({
      taskId: 'task-cancelled',
      messages: [{ role: 'user', content: 'stop me' }],
      timeoutMs: 60_000,
      abortSignal: controller.signal,
      parse: (value) => value
    })
    controller.abort()

    // The budget never expired: the caller ended the call (window closed, job cancelled, shutdown).
    expect(await pending).toMatchObject({ ok: false, errorCode: 'cancelled' })
  })

  it('spends no request when the caller is already aborted', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    const service = createStructuredModelInvocationService({ getProviderState: async () => createReadyProviderState(), fetch })
    const controller = new AbortController()
    controller.abort()

    const result = await service.invoke({
      taskId: 'task-aborted',
      messages: [{ role: 'user', content: 'never sent' }],
      abortSignal: controller.signal,
      parse: (value) => value
    })

    expect(result).toMatchObject({ ok: false, errorCode: 'cancelled' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
