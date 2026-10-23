import { describe, expect, it } from 'vitest'

import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultProviderState } from '@platform/ai/providers/providerStore'
import type { ModelDefaultsSettings } from '@platform/settings/schema/appSettings'

import { createMarketAnalysisSettingsService } from './marketAnalysisSettingsService'
import { createInMemoryMarketAnalysisSettingsStorage, createMarketAnalysisSettingsStore } from './marketAnalysisSettingsStore'

const NOW = '2026-10-22T15:00:00.000Z'

function readyProviderState(): { state: ProviderState; providerId: string; chatModelId: string; nonChatModelId: string } {
  const state = createDefaultProviderState()
  const provider = state.providers[0]
  if (!provider) throw new Error('missing preset provider')
  provider.enabled = true
  provider.apiKey = 'fixture-key'
  provider.baseUrl = 'https://example.com/v1'
  const chatModel = provider.models.find(model => model.capabilities.chat)
  if (!chatModel) throw new Error('missing chat model')
  provider.defaultChatModelId = chatModel.id
  const nonChatModel = provider.models.find(model => model.id !== chatModel.id)
  if (!nonChatModel) throw new Error('missing second model')
  nonChatModel.capabilities.chat = false
  return { state, providerId: provider.id, chatModelId: chatModel.id, nonChatModelId: nonChatModel.id }
}

function modelDefaults(assistantModelId: string): ModelDefaultsSettings {
  return { assistantModelId, agentModelId: '', fastModelId: '', translationModelId: '', imageModelId: '' }
}

function serviceFor(options: {
  state: ProviderState
  defaults: ModelDefaultsSettings
  initial?: Parameters<typeof createInMemoryMarketAnalysisSettingsStorage>[0]
}) {
  const storage = createInMemoryMarketAnalysisSettingsStorage(options.initial)
  const store = createMarketAnalysisSettingsStore(storage, () => NOW)
  return createMarketAnalysisSettingsService({
    store,
    now: () => NOW,
    getProviderState: async () => options.state,
    getModelDefaults: async () => options.defaults
  })
}

describe('marketAnalysisSettingsService', () => {
  it('enables on the platform default assistant model and stores that model as a snapshot', async () => {
    const { state, providerId, chatModelId } = readyProviderState()
    const service = serviceFor({ state, defaults: modelDefaults(`${providerId}:${chatModelId}`) })

    const saved = await service.updateSettings({ enabled: true })

    expect(saved).toMatchObject({ enabled: true, providerId, modelId: chatModelId, updatedAt: NOW })
    // The platform default moving afterwards must not move a background job onto another model.
    expect(await service.getSettings()).toMatchObject({ providerId, modelId: chatModelId })
  })

  it('refuses to enable when neither a model nor a usable platform default exists', async () => {
    const { state } = readyProviderState()
    const service = serviceFor({ state, defaults: modelDefaults('unconfigured:default-chat-model') })

    await expect(service.updateSettings({ enabled: true })).rejects.toThrow('analysis-model-unconfigured')
    expect(await service.getSettings()).toMatchObject({ enabled: false, providerId: '', modelId: '' })
  })

  it('refuses a model that cannot be called now instead of storing it', async () => {
    const { state, providerId, nonChatModelId } = readyProviderState()
    const service = serviceFor({ state, defaults: modelDefaults('') })

    await expect(service.updateSettings({ enabled: true, providerId, modelId: nonChatModelId }))
      .rejects.toThrow('analysis-model-unavailable')
  })

  it('keeps the stored model when the capability is turned off', async () => {
    const { state, providerId, chatModelId } = readyProviderState()
    const service = serviceFor({ state, defaults: modelDefaults(`${providerId}:${chatModelId}`) })
    await service.updateSettings({ enabled: true })

    const disabled = await service.updateSettings({ enabled: false })

    // Re-enabling must not need the platform default again: the choice was the reader's.
    expect(disabled).toMatchObject({ enabled: false, providerId, modelId: chatModelId })
    expect((await service.updateSettings({ enabled: true })).enabled).toBe(true)
  })

  it('falls back to the platform default again when the model is cleared while enabled', async () => {
    const { state, providerId, chatModelId } = readyProviderState()
    const service = serviceFor({ state, defaults: modelDefaults(`${providerId}:${chatModelId}`) })

    const cleared = await service.updateSettings({ enabled: true, providerId: '', modelId: '' })

    expect(cleared).toMatchObject({ providerId, modelId: chatModelId })
  })

  it('starts switched off when no settings file exists', async () => {
    const { state } = readyProviderState()
    const service = serviceFor({ state, defaults: modelDefaults('') })

    // A fresh install must not analyse anything, or call any model, before the reader enables it.
    expect(await service.getSettings()).toMatchObject({ enabled: false, providerId: '', modelId: '' })
  })
})
