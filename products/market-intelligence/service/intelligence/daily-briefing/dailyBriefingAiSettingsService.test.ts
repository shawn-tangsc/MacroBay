import { describe, expect, it } from 'vitest'

import { createDailyBriefingAiSettingsService } from './dailyBriefingAiSettingsService'
import { createDailyBriefingAiSettingsStore, createInMemoryDailyBriefingAiSettingsStorage } from './dailyBriefingAiSettingsStore'

const providers = [
  { id: 'p', enabled: true, baseUrl: 'https://p', apiKey: 'k', models: [{ id: 'm', capabilities: { chat: true } }] },
  { id: 'p2', enabled: true, baseUrl: 'https://p2', apiKey: 'k', models: [{ id: 'm2', capabilities: { chat: true } }] }
]
const deps = {
  getModelDefaults: async () => ({ assistantModelId: 'p:m' }) as never,
  getProviderState: async () => ({ providers }) as never
}

function service() {
  return createDailyBriefingAiSettingsService({
    store: createDailyBriefingAiSettingsStore(createInMemoryDailyBriefingAiSettingsStorage(), () => '2026-10-30T01:00:00.000Z'),
    ...deps
  })
}

describe('daily briefing AI settings service', () => {
  it('shows the default model and saves a custom one', async () => {
    const api = service()
    expect(await api.getView()).toEqual({
      settings: { editorialEnabled: true, providerId: '', modelId: '' },
      resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' }
    })
    expect(await api.save({ providerId: 'p2', modelId: 'm2' })).toMatchObject({
      settings: { editorialEnabled: true, providerId: 'p2', modelId: 'm2' },
      resolved: { state: 'agent', providerId: 'p2', modelId: 'm2', source: 'custom' }
    })
  })

  it('turns off into the fact layer and refuses a half-bound model', async () => {
    const api = service()
    expect((await api.save({ editorialEnabled: false })).resolved).toEqual({ state: 'disabled' })
    await expect(api.save({ providerId: 'p' })).rejects.toThrow('daily-briefing-model-half-bound')
  })
})
