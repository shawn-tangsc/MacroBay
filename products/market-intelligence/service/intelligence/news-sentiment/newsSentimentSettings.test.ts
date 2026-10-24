import { describe, expect, it } from 'vitest'

import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultProviderState } from '@platform/ai/providers/providerStore'

import {
  applyNewsSentimentSettingsPatch,
  createDefaultNewsSentimentSettings,
  resolveNewsSentimentModel
} from './newsSentimentSettings'

function readyProviders(): { state: ProviderState; providerId: string; modelId: string } {
  const state = createDefaultProviderState()
  const provider = state.providers[0]
  if (!provider) throw new Error('Missing default provider')
  const model = provider.models.find((entry) => entry.capabilities.chat)
  if (!model) throw new Error('Missing chat model')
  provider.enabled = true
  provider.apiKey = 'test-key'
  provider.baseUrl = 'https://example.com/v1'
  return { state, providerId: provider.id, modelId: model.id }
}

describe('newsSentimentSettings', () => {
  it('defaults to model scoring enabled and no explicit binding', () => {
    const settings = createDefaultNewsSentimentSettings('2026-10-24T00:00:00.000Z')
    expect(settings).toEqual({
      modelScoringEnabled: true,
      providerId: '',
      modelId: '',
      updatedAt: '2026-10-24T00:00:00.000Z'
    })
  })

  it('follows the platform fast model when nothing is bound', () => {
    const { state, providerId, modelId } = readyProviders()
    const resolved = resolveNewsSentimentModel({
      settings: createDefaultNewsSentimentSettings('2026-10-24T00:00:00.000Z'),
      modelDefaults: { fastModelId: `${providerId}:${modelId}` },
      providers: state.providers
    })

    expect(resolved).toEqual({
      source: 'platform-fast',
      defaultModelState: 'ready',
      providerId,
      modelId
    })
  })

  it('keeps an explicit binding even when the fast model points elsewhere', () => {
    const { state, providerId, modelId } = readyProviders()
    const resolved = resolveNewsSentimentModel({
      settings: {
        modelScoringEnabled: true,
        providerId,
        modelId: 'explicit-model',
        updatedAt: '2026-10-24T00:00:00.000Z'
      },
      modelDefaults: { fastModelId: `${providerId}:${modelId}` },
      providers: state.providers
    })

    expect(resolved.source).toBe('explicit')
    expect(resolved.modelId).toBe('explicit-model')
  })

  it('reports unavailable when the fast model is unset', () => {
    const { state } = readyProviders()
    const resolved = resolveNewsSentimentModel({
      settings: createDefaultNewsSentimentSettings('2026-10-24T00:00:00.000Z'),
      modelDefaults: { fastModelId: '' },
      providers: state.providers
    })

    expect(resolved).toEqual({ source: 'unavailable', defaultModelState: 'unset' })
  })

  it('reports unavailable when the fast model no longer resolves', () => {
    const { state } = readyProviders()
    const resolved = resolveNewsSentimentModel({
      settings: createDefaultNewsSentimentSettings('2026-10-24T00:00:00.000Z'),
      modelDefaults: { fastModelId: 'missing:missing' },
      providers: state.providers
    })

    expect(resolved).toEqual({ source: 'unavailable', defaultModelState: 'unavailable' })
  })

  it('applies a paired patch and keeps updatedAt fresh', () => {
    const current = createDefaultNewsSentimentSettings('2026-10-24T00:00:00.000Z')
    const next = applyNewsSentimentSettingsPatch(
      current,
      { providerId: 'p', modelId: 'm', modelScoringEnabled: false },
      '2026-10-24T01:00:00.000Z'
    )
    expect(next).toEqual({
      modelScoringEnabled: false,
      providerId: 'p',
      modelId: 'm',
      updatedAt: '2026-10-24T01:00:00.000Z'
    })
  })

  it('refuses a half-bound model and allows clearing both halves', () => {
    const current = createDefaultNewsSentimentSettings('2026-10-24T00:00:00.000Z')
    expect(() => applyNewsSentimentSettingsPatch(current, { providerId: 'p2' }, '2026-10-24T01:00:00.000Z')).toThrow()
    const bound = applyNewsSentimentSettingsPatch(
      current,
      { providerId: 'p', modelId: 'm' },
      '2026-10-24T00:30:00.000Z'
    )
    const cleared = applyNewsSentimentSettingsPatch(
      bound,
      { providerId: '', modelId: '' },
      '2026-10-24T01:00:00.000Z'
    )
    expect(cleared.providerId).toBe('')
    expect(cleared.modelId).toBe('')
  })
})
