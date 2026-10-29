import { describe, expect, it } from 'vitest'

import {
  applyDailyBriefingAiSettingsPatch,
  createDefaultDailyBriefingAiSettings,
  type DailyBriefingAiSettings
} from '../schema/dailyBriefingAiSettings'
import { resolveDailyBriefingEditorialModel } from './dailyBriefingAiSettings'
import { createDailyBriefingAiSettingsStore, createInMemoryDailyBriefingAiSettingsStorage } from './dailyBriefingAiSettingsStore'

const providers = [
  { id: 'p', enabled: true, baseUrl: 'https://p', apiKey: 'k', models: [{ id: 'm', capabilities: { chat: true } }] },
  { id: 'p2', enabled: true, baseUrl: 'https://p2', apiKey: 'k', models: [{ id: 'm2', capabilities: { chat: true } }] }
]

const settings = (overrides: Partial<DailyBriefingAiSettings> = {}): DailyBriefingAiSettings => ({
  editorialEnabled: true, providerId: '', modelId: '', updatedAt: '2026-10-30T00:00:00.000Z', ...overrides
})

const deps = {
  getModelDefaults: async () => ({ assistantModelId: 'p:m' }) as never,
  getProviderState: async () => ({ providers }) as never
}

describe('daily briefing AI settings', () => {
  it('follows the platform default when no custom model is set', async () => {
    expect(await resolveDailyBriefingEditorialModel(settings(), deps)).toEqual({
      state: 'agent', providerId: 'p', modelId: 'm', source: 'default'
    })
  })

  it('uses a custom model, and falls back to the default when it cannot be called', async () => {
    expect(await resolveDailyBriefingEditorialModel(settings({ providerId: 'p2', modelId: 'm2' }), deps)).toEqual({
      state: 'agent', providerId: 'p2', modelId: 'm2', source: 'custom'
    })
    const disabledProviders = providers.map((provider) => provider.id === 'p2' ? { ...provider, enabled: false } : provider)
    expect(await resolveDailyBriefingEditorialModel(settings({ providerId: 'p2', modelId: 'm2' }), {
      getModelDefaults: deps.getModelDefaults,
      getProviderState: async () => ({ providers: disabledProviders }) as never
    })).toEqual({
      state: 'agent', providerId: 'p', modelId: 'm', source: 'default', fallback: 'custom-unavailable'
    })
  })

  it('falls back to the fact layer when the switch is off or no default exists', async () => {
    expect(await resolveDailyBriefingEditorialModel(settings({ editorialEnabled: false }), deps)).toEqual({ state: 'disabled' })
    expect(await resolveDailyBriefingEditorialModel(settings(), {
      getModelDefaults: async () => ({ assistantModelId: '' }) as never,
      getProviderState: deps.getProviderState
    })).toEqual({ state: 'unavailable', reason: 'default-unavailable' })
    expect(await resolveDailyBriefingEditorialModel(settings(), {})).toEqual({ state: 'unavailable', reason: 'default-unavailable' })
  })

  it('rejects a half-bound model and persists a valid one', async () => {
    expect(() => applyDailyBriefingAiSettingsPatch(settings(), { providerId: 'p' }, '2026-10-30T01:00:00.000Z'))
      .toThrow('daily-briefing-model-half-bound')
    expect(createDefaultDailyBriefingAiSettings('2026-10-30T00:00:00.000Z')).toMatchObject({
      editorialEnabled: true, providerId: '', modelId: ''
    })

    const store = createDailyBriefingAiSettingsStore(createInMemoryDailyBriefingAiSettingsStorage(), () => '2026-10-30T01:00:00.000Z')
    const saved = await store.save(settings({ providerId: 'p2', modelId: 'm2' }))
    expect(saved.providerId).toBe('p2')
    expect(await store.getSettings()).toMatchObject({ providerId: 'p2', modelId: 'm2' })
    await expect(store.save(settings({ providerId: 'p' }))).rejects.toThrow('daily-briefing-model-half-bound')
  })
})
