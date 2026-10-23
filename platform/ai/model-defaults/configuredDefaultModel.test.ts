import { describe, expect, it } from 'vitest'

import type { ModelDefinition, ModelProvider } from '../providers/modelProviderTypes'
import {
  isConfiguredModelProviderReady,
  parseConfiguredModelRef,
  resolveConfiguredModel,
  resolveConfiguredModelId
} from './configuredDefaultModel'

function model(id: string, chat = true): ModelDefinition {
  return { id, name: `Model ${id}`, capabilities: { chat } }
}

function provider(overrides: Partial<ModelProvider> & { id: string }): ModelProvider {
  return {
    name: overrides.id,
    enabled: true,
    baseUrl: 'https://api.test/v1',
    apiKey: 'sk-test',
    endpoints: [],
    models: [model('chat-a'), model('chat-b')],
    ...overrides
  } as ModelProvider
}

const chatAcceptable = (provider: ModelProvider, entry: ModelDefinition) =>
  provider.models.includes(entry) && entry.capabilities.chat === true

describe('parseConfiguredModelRef', () => {
  it('parses providerId:modelId and keeps colons inside the model id', () => {
    expect(parseConfiguredModelRef('openai:gpt-4o')).toEqual({ providerId: 'openai', modelId: 'gpt-4o' })
    expect(parseConfiguredModelRef('openai:gpt:4o')).toEqual({ providerId: 'openai', modelId: 'gpt:4o' })
  })

  it('rejects empty, missing separator, and missing halves', () => {
    expect(parseConfiguredModelRef('')).toBeNull()
    expect(parseConfiguredModelRef('  ')).toBeNull()
    expect(parseConfiguredModelRef(null)).toBeNull()
    expect(parseConfiguredModelRef('openai')).toBeNull()
    expect(parseConfiguredModelRef(':gpt-4o')).toBeNull()
    expect(parseConfiguredModelRef('openai:')).toBeNull()
  })
})

describe('isConfiguredModelProviderReady', () => {
  it('accepts a vault-backed main-process provider without a plaintext key', () => {
    expect(
      isConfiguredModelProviderReady(
        provider({ id: 'openai', apiKey: undefined, apiKeyRef: 'provider:6f70656e6169' })
      )
    ).toBe(true)
  })

  it('accepts a renderer-safe provider that still has a credential', () => {
    expect(
      isConfiguredModelProviderReady({
        ...provider({ id: 'openai' }),
        apiKey: undefined,
        hasApiKey: true,
        apiKeyPreview: 'sk-**********test',
        connectionStatus: 'unverified'
      } as never)
    ).toBe(true)
  })

  it('rejects providers without a credential, disabled providers, and empty base URLs', () => {
    expect(isConfiguredModelProviderReady(provider({ id: 'openai', apiKey: '' }))).toBe(false)
    expect(isConfiguredModelProviderReady(provider({ id: 'openai', enabled: false }))).toBe(false)
    expect(isConfiguredModelProviderReady(provider({ id: 'openai', baseUrl: '  ' }))).toBe(false)
  })
})

describe('resolveConfiguredModel', () => {
  it('reports unset for an empty value', () => {
    expect(resolveConfiguredModel({ value: '', providers: [provider({ id: 'openai' })] })).toEqual({
      ok: false,
      reason: 'unset'
    })
  })

  it('reports unparsable for a value without a provider prefix', () => {
    expect(resolveConfiguredModel({ value: 'gpt-4o', providers: [] })).toEqual({
      ok: false,
      reason: 'unparsable'
    })
  })

  it('tracks provider and model availability', () => {
    const providers = [provider({ id: 'openai' })]
    expect(resolveConfiguredModel({ value: 'missing:chat-a', providers })).toEqual({
      ok: false,
      reason: 'provider-missing'
    })
    expect(
      resolveConfiguredModel({ value: 'openai:chat-a', providers: [provider({ id: 'openai', enabled: false })] })
    ).toEqual({ ok: false, reason: 'provider-disabled' })
    expect(
      resolveConfiguredModel({ value: 'openai:chat-a', providers: [provider({ id: 'openai', apiKey: '' })] })
    ).toEqual({ ok: false, reason: 'provider-not-ready' })
    expect(resolveConfiguredModel({ value: 'openai:ghost', providers })).toEqual({
      ok: false,
      reason: 'model-missing'
    })
  })

  it('resolves a default on a vault-backed provider (no plaintext key in state)', () => {
    const providers = [provider({ id: 'openai', apiKey: undefined, apiKeyRef: 'provider:6f70656e6169' })]

    expect(resolveConfiguredModel({ value: 'openai:chat-a', providers })).toMatchObject({
      ok: true,
      ref: { providerId: 'openai', modelId: 'chat-a' }
    })
  })

  it('applies the caller-provided acceptance rule', () => {
    const providers = [provider({ id: 'openai' })]
    expect(
      resolveConfiguredModel({
        value: 'openai:chat-a',
        providers,
        isModelAcceptable: (_provider, entry) => entry.capabilities.chat === false
      })
    ).toEqual({ ok: false, reason: 'model-incompatible' })
  })

  it('returns the resolved labels for a usable value', () => {
    const providers = [provider({ id: 'openai' })]
    expect(resolveConfiguredModel({ value: 'openai:chat-b', providers, isModelAcceptable: chatAcceptable })).toEqual({
      ok: true,
      ref: { providerId: 'openai', modelId: 'chat-b' },
      providerName: 'openai',
      modelName: 'Model chat-b'
    })
  })
})

describe('resolveConfiguredModelId', () => {
  it('returns the unique id only when the value is usable', () => {
    const providers = [provider({ id: 'openai' })]
    expect(resolveConfiguredModelId({ value: 'openai:chat-a', providers })).toBe('openai:chat-a')
    expect(resolveConfiguredModelId({ value: '', providers })).toBeNull()
    expect(resolveConfiguredModelId({ value: 'openai:ghost', providers })).toBeNull()
  })
})
