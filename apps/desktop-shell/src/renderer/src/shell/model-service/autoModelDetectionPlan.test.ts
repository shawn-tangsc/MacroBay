import { describe, expect, it } from 'vitest'

import type { ModelAvailability, ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { modelAvailabilityFingerprint } from '@platform/ai/providers/modelAvailability'

import {
  AUTO_MODEL_DETECTION_LIMIT,
  autoModelDetectionSignature,
  planAutoModelDetection,
  resolveModelAvailabilityView
} from './autoModelDetectionPlan'

const CHECKED_AT = '2026-10-25T05:00:00.000Z'

function providerFixture(overrides: Partial<SafeModelProvider> = {}): SafeModelProvider {
  return {
    id: 'tokenrhythm',
    name: 'TokenRhythm',
    enabled: true,
    baseUrl: 'https://tokenrhythm.studio',
    endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://tokenrhythm.studio' }],
    hasApiKey: true,
    apiKeyPreview: 'sk-a**********wxyz',
    models: [],
    ...overrides
  }
}

function model(id: string, overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return { id, name: id, capabilities: { chat: true }, ...overrides }
}

function availabilityFor(provider: SafeModelProvider, entry: ModelDefinition): ModelAvailability {
  return {
    status: 'ok',
    checkedAt: CHECKED_AT,
    fingerprint: modelAvailabilityFingerprint(
      { endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview },
      entry
    )
  }
}

describe('planAutoModelDetection', () => {
  it('selects only chat text models without a fresh verdict, in priority order', () => {
    const provider = providerFixture({
      defaultChatModelId: 'default-chat',
      models: [
        model('checked'),
        model('embedding', { capabilities: { chat: false, embedding: true } }),
        model('image', { capabilities: { chat: false, imageGeneration: true } }),
        model('free-chat', { priceTag: 'free' }),
        model('default-chat'),
        model('stale-chat')
      ]
    })
    // 给 checked / stale 各一份结论：一个新鲜、一个指针过期。
    const models = provider.models.map((entry) => {
      if (entry.id === 'checked') return { ...entry, availability: availabilityFor(provider, entry) }
      if (entry.id === 'stale-chat') {
        return {
          ...entry,
          availability: { ...availabilityFor(provider, entry), fingerprint: 'av1-stale' }
        }
      }
      return entry
    })
    const value = { ...provider, models }

    expect(planAutoModelDetection(value)).toEqual({
      // 默认聊天模型 → 免费 → 结论过期；embedding / image / 已测过的新鲜结论都不进候选。
      modelIds: ['default-chat', 'free-chat', 'stale-chat'],
      skipped: 0
    })
  })

  it('caps a batch and reports how many candidates were left out', () => {
    const models = Array.from({ length: AUTO_MODEL_DETECTION_LIMIT + 5 }, (_, index) => model(`m-${index}`))
    const plan = planAutoModelDetection(providerFixture({ models }), { limit: 3 })
    expect(plan?.modelIds).toEqual(['m-0', 'm-1', 'm-2'])
    expect(plan?.skipped).toBe(AUTO_MODEL_DETECTION_LIMIT + 5 - 3)
  })

  it('re-tests a model whose verdict predates a key or endpoint change', () => {
    const before = providerFixture({ models: [model('chat')] })
    const tested = { ...before, models: [{ ...before.models[0], availability: availabilityFor(before, before.models[0]) }] }
    expect(planAutoModelDetection(tested)).toBeNull()

    const rotatedKey = { ...tested, apiKeyPreview: 'sk-b**********wxyz' }
    expect(planAutoModelDetection(rotatedKey)?.modelIds).toEqual(['chat'])

    const movedEndpoint = { ...tested, endpoints: [{ protocol: 'chat-completions' as const, baseUrl: 'https://moved.test' }] }
    expect(planAutoModelDetection(movedEndpoint)?.modelIds).toEqual(['chat'])
  })

  it('never fires for a disabled provider, a missing key, or a missing endpoint', () => {
    const models = [model('chat')]
    expect(planAutoModelDetection(providerFixture({ models, enabled: false }))).toBeNull()
    expect(planAutoModelDetection(providerFixture({ models, hasApiKey: false }))).toBeNull()
    expect(planAutoModelDetection(providerFixture({ models, baseUrl: '' }))).toBeNull()
    expect(planAutoModelDetection(providerFixture({ models: [] }))).toBeNull()
  })

  it('ignores archived preset models', () => {
    const provider = providerFixture({ models: [model('archived', { presetStale: true })] })
    expect(planAutoModelDetection(provider)).toBeNull()
  })
})

describe('autoModelDetectionSignature', () => {
  it('ignores verdicts (so writing results cannot re-trigger a run) but tracks config changes', () => {
    const provider = providerFixture({ models: [model('chat')] })
    const signature = autoModelDetectionSignature(provider)
    const withVerdict = {
      ...provider,
      models: [{ ...provider.models[0], availability: availabilityFor(provider, provider.models[0]) }]
    }
    expect(autoModelDetectionSignature(withVerdict)).toBe(signature)
    expect(autoModelDetectionSignature({ ...provider, apiKeyPreview: 'sk-new**********wxyz' })).not.toBe(signature)
    expect(autoModelDetectionSignature({ ...provider, models: [model('chat'), model('chat-2')] })).not.toBe(signature)
    expect(autoModelDetectionSignature({ ...provider, enabled: false })).not.toBe(signature)
  })
})

describe('resolveModelAvailabilityView', () => {
  it('marks a verdict stale in the renderer without asking the main process', () => {
    const provider = providerFixture({ models: [model('chat')] })
    const availability = availabilityFor(provider, provider.models[0])
    expect(resolveModelAvailabilityView(provider, { ...provider.models[0], availability })?.stale).toBe(false)
    expect(
      resolveModelAvailabilityView({ ...provider, apiKeyPreview: 'sk-new**********wxyz' }, {
        ...provider.models[0],
        availability
      })?.stale
    ).toBe(true)
    expect(resolveModelAvailabilityView(provider, provider.models[0])).toBeUndefined()
  })
})
