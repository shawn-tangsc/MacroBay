import { describe, expect, it } from 'vitest'

import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultProviderState } from '@platform/ai/providers/providerStore'

import { resolveTranslationModel } from './intelligenceTranslationModel'

function createReadyProviderState(): { state: ProviderState; providerId: string; modelId: string } {
  const state = createDefaultProviderState()
  const provider = state.providers[0]
  if (!provider) throw new Error('Missing default provider')
  const model = provider.models.find((entry) => entry.capabilities.chat)
  if (!model) throw new Error('Missing chat model')
  provider.enabled = true
  provider.apiKey = 'test-key'
  provider.baseUrl = 'https://example.com/v1'
  provider.defaultChatModelId = model.id
  return { state, providerId: provider.id, modelId: model.id }
}

describe('resolveTranslationModel', () => {
  it('follows the configured default translation model when no explicit model is bound', () => {
    const { state, providerId, modelId } = createReadyProviderState()
    const resolved = resolveTranslationModel({
      settings: {},
      modelDefaults: { translationModelId: `${providerId}:${modelId}` },
      providers: state.providers
    })

    expect(resolved).toEqual({
      source: 'platform-default',
      defaultModelState: 'ready',
      providerId,
      modelId
    })
  })

  it('keeps an explicit binding even when the model-service default points elsewhere', () => {
    const { state, providerId, modelId } = createReadyProviderState()
    const resolved = resolveTranslationModel({
      settings: { providerId, modelId: 'explicit-model' },
      modelDefaults: { translationModelId: `${providerId}:${modelId}` },
      providers: state.providers
    })

    expect(resolved.source).toBe('explicit')
    expect(resolved.providerId).toBe(providerId)
    expect(resolved.modelId).toBe('explicit-model')
    expect(resolved.defaultModelState).toBe('ready')
  })

  it('falls back to the existing provider default when the model-service default is unset', () => {
    const { state } = createReadyProviderState()
    const resolved = resolveTranslationModel({
      settings: {},
      modelDefaults: { translationModelId: '' },
      providers: state.providers
    })

    expect(resolved).toEqual({ source: 'fallback', defaultModelState: 'unset' })
  })

  it('falls back when the configured default model no longer resolves', () => {
    const { state } = createReadyProviderState()
    const resolved = resolveTranslationModel({
      settings: {},
      modelDefaults: { translationModelId: 'missing-provider:missing-model' },
      providers: state.providers
    })

    expect(resolved).toEqual({ source: 'fallback', defaultModelState: 'unavailable' })
  })

  it('does not require model-service defaults to resolve an explicit binding', () => {
    const { state, providerId } = createReadyProviderState()
    const resolved = resolveTranslationModel({
      settings: { providerId, modelId: 'explicit-model' },
      providers: state.providers
    })

    expect(resolved.source).toBe('explicit')
    expect(resolved.defaultModelState).toBe('unset')
  })
})
