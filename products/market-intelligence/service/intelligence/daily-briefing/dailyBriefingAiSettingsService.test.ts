import { describe, expect, it, vi } from 'vitest'

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

/** A provider the agent runtime can call: enabled, keyed, Messages endpoint and capability flag. */
function agentProvider(id: string, modelId: string, enabled = true) {
  return {
    id,
    enabled,
    baseUrl: `https://${id}`,
    apiKey: 'k',
    endpoints: [{ id: 'messages', protocol: 'messages', baseUrl: `https://${id}` }],
    models: [{ id: modelId, capabilities: { chat: true, agentRuntimes: { claudeCode: true } } }]
  }
}

const editorSettings = (providerId: string, modelId: string, editorialEnabled = true) => ({
  editorialEnabled, providerId, modelId, webSearchEnabled: false, updatedAt: '2026-10-30T00:00:00.000Z'
})

function seededStore() {
  return createDailyBriefingAiSettingsStore(createInMemoryDailyBriefingAiSettingsStorage(), () => '2026-10-30T01:00:00.000Z')
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
      settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
      resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' },
      webSearchSupported: false
    })
    expect(await api.save({ providerId: 'p2', modelId: 'm2' })).toMatchObject({
      settings: { editorialEnabled: true, providerId: 'p2', modelId: 'm2', webSearchEnabled: false },
      resolved: { state: 'agent', providerId: 'p2', modelId: 'm2', source: 'custom' }
    })
  })

  it('reports server-side web search support for the agent model, not the editorial default', async () => {
    const official = {
      id: 'anthropic',
      enabled: true,
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'k',
      endpoints: [{ protocol: 'messages', baseUrl: 'https://api.anthropic.com' }],
      models: [{ id: 'claude-sonnet-4-5', capabilities: { chat: true, agentRuntimes: { claudeCode: true } } }]
    }
    const api = createDailyBriefingAiSettingsService({
      store: createDailyBriefingAiSettingsStore(createInMemoryDailyBriefingAiSettingsStorage(), () => '2026-10-30T01:00:00.000Z'),
      getModelDefaults: async () => ({ assistantModelId: 'p:m', agentModelId: 'anthropic:claude-sonnet-4-5' }) as never,
      getProviderState: async () => ({ providers: [...providers, official] }) as never
    })

    expect((await api.getView()).webSearchSupported).toBe(true)

    const thirdParty = createDailyBriefingAiSettingsService({
      store: createDailyBriefingAiSettingsStore(createInMemoryDailyBriefingAiSettingsStorage(), () => '2026-10-30T01:00:00.000Z'),
      getModelDefaults: async () => ({ assistantModelId: 'p:m', agentModelId: 'tokenrhythm:model' }) as never,
      getProviderState: async () => ({ providers: [
        { id: 'tokenrhythm', enabled: true, baseUrl: 'https://tokenrhythm.studio', apiKey: 'k', endpoints: [{ protocol: 'messages', baseUrl: 'https://tokenrhythm.studio' }], models: [{ id: 'model', capabilities: { chat: true, agentRuntimes: { claudeCode: true } } }] }
      ] }) as never
    })
    expect((await thirdParty.getView()).webSearchSupported).toBe(false)
  })

  it('synchronizes the saved model to the editor agent', async () => {
    const onModelSaved = vi.fn()
    const api = createDailyBriefingAiSettingsService({
      store: createDailyBriefingAiSettingsStore(createInMemoryDailyBriefingAiSettingsStorage(), () => '2026-10-30T01:00:00.000Z'),
      onModelSaved,
      ...deps
    })
    await api.save({ providerId: 'p2', modelId: 'm2' })
    expect(onModelSaved).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'p2', modelId: 'm2' }))
  })

  it('turns off into the fact layer and refuses a half-bound model', async () => {
    const api = service()
    expect((await api.save({ editorialEnabled: false })).resolved).toEqual({ state: 'disabled' })
    await expect(api.save({ providerId: 'p' })).rejects.toThrow('daily-briefing-model-half-bound')
  })

  it('moves the agent to the platform default agent model when the custom model is unavailable', async () => {
    const store = seededStore()
    await store.save(editorSettings('p2', 'm2'))
    const applyAgentModel = vi.fn()
    const api = createDailyBriefingAiSettingsService({
      store,
      applyAgentModel,
      getModelDefaults: async () => ({ assistantModelId: 'p2:m2', agentModelId: 'p:m' }) as never,
      getProviderState: async () => ({ providers: [agentProvider('p', 'm'), agentProvider('p2', 'm2', false)] }) as never
    })

    expect(await api.ensureAgentModel()).toEqual({
      state: 'agent', providerId: 'p', modelId: 'm', source: 'default', fallback: 'custom-unavailable'
    })
    expect(applyAgentModel).toHaveBeenCalledWith('p:m')
  })

  it('reports unavailable instead of calling anything when neither model can be called', async () => {
    const store = seededStore()
    await store.save(editorSettings('p2', 'm2'))
    const applyAgentModel = vi.fn()
    const api = createDailyBriefingAiSettingsService({
      store,
      applyAgentModel,
      getModelDefaults: async () => ({ assistantModelId: 'p2:m2', agentModelId: 'p:retired' }) as never,
      getProviderState: async () => ({ providers: [agentProvider('p', 'm'), agentProvider('p2', 'm2', false)] }) as never
    })

    expect(await api.ensureAgentModel()).toEqual({ state: 'unavailable', reason: 'default-unavailable' })
    expect(applyAgentModel).not.toHaveBeenCalled()
  })

  it('keeps a callable custom model and writes exactly that model to the agent', async () => {
    const store = seededStore()
    await store.save(editorSettings('p2', 'm2'))
    const applyAgentModel = vi.fn()
    const api = createDailyBriefingAiSettingsService({
      store,
      applyAgentModel,
      getModelDefaults: async () => ({ assistantModelId: 'p:m', agentModelId: 'p:m' }) as never,
      getProviderState: async () => ({ providers: [agentProvider('p', 'm'), agentProvider('p2', 'm2')] }) as never
    })

    expect(await api.ensureAgentModel()).toEqual({ state: 'agent', providerId: 'p2', modelId: 'm2', source: 'custom' })
    expect(applyAgentModel).toHaveBeenCalledWith('p2:m2')
  })

  it('follows the platform default agent model when no custom model is set', async () => {
    const store = seededStore()
    const applyAgentModel = vi.fn()
    const api = createDailyBriefingAiSettingsService({
      store,
      applyAgentModel,
      getModelDefaults: async () => ({ assistantModelId: '', agentModelId: 'p:m' }) as never,
      getProviderState: async () => ({ providers: [agentProvider('p', 'm')] }) as never
    })

    expect(await api.ensureAgentModel()).toEqual({ state: 'agent', providerId: 'p', modelId: 'm', source: 'default' })
    expect(applyAgentModel).toHaveBeenCalledWith('p:m')
  })

  it('fails closed when the resolved model cannot be written to the agent', async () => {
    const store = seededStore()
    const api = createDailyBriefingAiSettingsService({
      store,
      applyAgentModel: () => { throw new Error('agent store unavailable') },
      getModelDefaults: async () => ({ assistantModelId: 'p:m', agentModelId: 'p:m' }) as never,
      getProviderState: async () => ({ providers: [agentProvider('p', 'm')] }) as never
    })

    expect(await api.ensureAgentModel()).toEqual({ state: 'unavailable', reason: 'default-unavailable' })
  })

  it('does not touch the agent when AI editing is off', async () => {
    const store = seededStore()
    await store.save(editorSettings('p2', 'm2', false))
    const applyAgentModel = vi.fn()
    const api = createDailyBriefingAiSettingsService({
      store,
      applyAgentModel,
      getModelDefaults: async () => ({ assistantModelId: 'p:m', agentModelId: 'p:m' }) as never,
      getProviderState: async () => ({ providers: [agentProvider('p', 'm'), agentProvider('p2', 'm2')] }) as never
    })

    expect(await api.ensureAgentModel()).toEqual({ state: 'disabled' })
    expect(applyAgentModel).not.toHaveBeenCalled()
  })
})
