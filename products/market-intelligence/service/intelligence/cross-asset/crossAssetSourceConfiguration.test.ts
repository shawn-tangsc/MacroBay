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
    // 默认开不是这条用例的主张，是用户 2026-11-11 的默认启用规则带来的事实：这条源免钥匙、live，
    // 且被看板的持仓 / 资金费率 / 纳指格用到，所以没有 profile 行时默认启用。这条用例保的是
    // 「复用同一个源身份、不改资金费率默认与预设」，因此下面仍按原样验预设。
    expect(profile.enabled).toBe(true)
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
