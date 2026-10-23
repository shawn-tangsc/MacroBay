import { describe, expect, it } from 'vitest'

import { createSystemProviderPresets } from '../../ai/providers/providerPresets'

import { resolveModelVisual, resolveProviderVisual } from './modelProviderVisuals'

describe('model and provider visual identities', () => {
  it('resolves known providers by id and aliases', () => {
    expect(resolveProviderVisual('openai', 'OpenAI')).toMatchObject({ key: 'openai', iconSet: 'provider', iconKey: 'openai' })
    expect(resolveProviderVisual('gemini', 'Gemini')).toMatchObject({ key: 'google', iconSet: 'provider', iconKey: 'google' })
    expect(resolveProviderVisual('aionly', 'AiOnly')).toMatchObject({ key: 'ai-only', iconSet: 'provider', iconKey: 'ai-only' })
  })

  it('creates a stable fallback from unknown provider names', () => {
    expect(resolveProviderVisual('custom-local', 'Local Router')).toMatchObject({
      key: 'custom-local',
      shortLabel: 'LR',
      isFallback: true
    })
  })

  it('resolves every preset system provider to a concrete provider icon key', () => {
    const providers = createSystemProviderPresets()

    const missingProviders = providers
      .map((provider) => resolveProviderVisual(provider.id, provider.name))
      .filter((visual) => visual.iconSet !== 'provider' || !visual.iconKey || visual.isFallback)
      .map((visual) => visual.key)

    expect(missingProviders).toEqual([])
  })

  it('resolves model visuals from model ids before falling back to provider visuals', () => {
    expect(resolveModelVisual('deepseek-ai/DeepSeek-R1', 'DeepSeek R1', 'silicon')).toMatchObject({ key: 'deepseek', iconSet: 'provider' })
    expect(resolveModelVisual('Qwen/Qwen3-235B-A22B', 'Qwen3', 'silicon')).toMatchObject({ key: 'qwen', iconSet: 'model' })
    expect(resolveModelVisual('claude-3-5-sonnet-20241022', 'Claude Sonnet', 'anthropic')).toMatchObject({
      key: 'claude',
      iconSet: 'model'
    })
    expect(resolveModelVisual('gpt-5.2-pro', 'GPT 5.2 Pro', 'openai')).toMatchObject({ key: 'gpt-5-2-pro', iconSet: 'model' })
    expect(resolveModelVisual('gpt-4o', 'GPT-4o', 'openai')).toMatchObject({ key: 'openai', iconSet: 'provider' })
  })

  it('falls back to the provider visual when a custom model does not match known model families', () => {
    expect(resolveModelVisual('my-trading-reviewer', 'Trading Reviewer', 'deepseek')).toMatchObject({
      key: 'deepseek'
    })
  })
})
