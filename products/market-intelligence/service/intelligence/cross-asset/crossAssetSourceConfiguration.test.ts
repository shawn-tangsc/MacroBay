import { describe, expect, it, vi } from 'vitest'
import { createCrossAssetSourceConfiguration } from './crossAssetSourceConfiguration'
import { crossAssetPolicy } from './crossAssetPolicy'
import { getIntelligenceSourceDefinition, listIntelligenceSourceDefinitions } from '../application/sourceCatalog'
import { createDefaultSourceProfile, resolveRuntimeConfig } from '../application/sourceRuntimeConfig'

describe('cross-asset existing Binance source configuration', () => {
  it('uses the single existing source identity without changing funding defaults or presets', () => {
    expect(crossAssetPolicy.sourceId).toBe('binance-futures-positioning')
    expect(crossAssetPolicy.capabilityId).toBe('cross-asset-market')
    const definition = getIntelligenceSourceDefinition(crossAssetPolicy.sourceId)!
    const profile = createDefaultSourceProfile(definition)
    expect(profile.enabled).toBe(false)
    expect(resolveRuntimeConfig({ definition, profile: { ...profile, enabled: true, collectionPreset: 'frequent' } }).collectionPreset).toBe('frequent')
    expect(listIntelligenceSourceDefinitions().filter(source => source.sourceId === 'binance-cross-asset-market')).toEqual([])
  })

  it('projects an existing disabled profile without credentials, account IPC, writes or default resolution', async () => {
    const profile = { sourceId: 'binance-futures-positioning', enabled: false, monitoredSymbols: ['BTCUSDT'], credentialRef: 'private' }
    const getProfile = vi.fn(async () => profile)
    const resolveProfile = vi.fn()
    const configuration = createCrossAssetSourceConfiguration({ profileStore: { getProfile, resolveProfile } })
    expect(await configuration.read()).toEqual({ state: 'configured', enabled: false })
    expect(getProfile).toHaveBeenCalledWith('binance-futures-positioning')
    expect(resolveProfile).not.toHaveBeenCalled()
    expect(profile).toEqual({ sourceId: 'binance-futures-positioning', enabled: false, monitoredSymbols: ['BTCUSDT'], credentialRef: 'private' })
  })

  it('reports unsaved default configuration separately and reads the latest enabled value each time', async () => {
    const getProfile = vi.fn(async () => undefined)
    const resolveProfile = vi.fn(async () => ({ sourceId: 'binance-futures-positioning', enabled: false }))
    const configuration = createCrossAssetSourceConfiguration({ profileStore: { getProfile, resolveProfile } })
    expect(await configuration.read()).toEqual({ state: 'default', enabled: false })
    resolveProfile.mockResolvedValue({ sourceId: 'binance-futures-positioning', enabled: true })
    expect(await configuration.read()).toEqual({ state: 'default', enabled: true })
  })

  it('fails closed for unavailable or mismatched profiles without returning internal exceptions', async () => {
    for (const value of [{ sourceId: 'other', enabled: true }, { sourceId: 'binance-futures-positioning', enabled: 'true' }]) {
      expect(await createCrossAssetSourceConfiguration({ profileStore: { getProfile: async () => value, resolveProfile: vi.fn() } }).read()).toEqual({ state: 'unknown' })
    }
    expect(await createCrossAssetSourceConfiguration({ profileStore: { getProfile: async () => { throw new Error('private') }, resolveProfile: vi.fn() } }).read()).toEqual({ state: 'unknown' })
  })
})
