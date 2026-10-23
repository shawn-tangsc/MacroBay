import { describe, expect, it } from 'vitest'

import { getIntelligenceSourceDefinition } from './sourceCatalog'
import {
  createDefaultSourceProfile,
  resolveAndValidateRuntimeConfig,
  resolveMonitoredSymbols,
  resolveRuntimeConfig,
  resolveSafeDashboardSourceScheduleRule
} from './sourceRuntimeConfig'
import type { IntelligenceSourceDefinition } from '../schema/intelligenceSource'

describe('sourceRuntimeConfig', () => {
  it('resolves defaults when profile is missing', () => {
    const definition = requireDefinition('coindesk-rss')
    const config = resolveRuntimeConfig({ definition })

    expect(config.enabled).toBe(false)
    expect(config.collectionPreset).toBe('balanced')
    expect(config.scopePolicy).toBe('watchlist-priority')
    expect(config.retentionMode).toBe('balanced')
    expect(config.rawArchiveEnabled).toBe(true)
    expect(config.includeInSentiment).toBe(true)
    expect(config.pollingIntervalSec).toBe(15 * 60)
  })

  it('applies profile overrides for enabled, preset, sentiment, scope, and retention', () => {
    const definition = requireDefinition('sec-rss')
    const profile = {
      ...createDefaultSourceProfile(definition),
      enabled: true,
      collectionPreset: 'frequent' as const,
      includeInSentiment: false,
      scopePolicy: 'watchlist-priority' as const,
      retentionMode: 'extended' as const,
      rawArchiveEnabled: false
    }

    const config = resolveRuntimeConfig({ definition, profile })

    expect(config.enabled).toBe(true)
    expect(config.collectionPreset).toBe('frequent')
    expect(config.includeInSentiment).toBe(false)
    expect(config.scopePolicy).toBe('watchlist-priority')
    expect(config.retentionMode).toBe('extended')
    expect(config.rawArchiveEnabled).toBe(false)
    expect(config.pollingIntervalSec).toBe(5 * 60)
  })

  it('uses the product ETF refresh cadence when a legacy profile still says manual', () => {
    const definition = requireDefinition('0xrouter-aggregate-provider')
    const config = resolveRuntimeConfig({
      definition,
      profile: {
        ...createDefaultSourceProfile(definition),
        enabled: true,
        collectionPreset: 'manual',
        credentialRef: '0xrouter-credentials'
      },
      hasCredential: true
    })

    expect(config.collectionPreset).toBe('balanced')
    expect(config.pollingIntervalSec).toBe(10 * 60)
  })

  it('keeps the ETF source unscheduled when disabled or credential-incomplete', () => {
    const definition = requireDefinition('0xrouter-aggregate-provider')

    const disabled = resolveRuntimeConfig({
      definition,
      profile: { ...createDefaultSourceProfile(definition), collectionPreset: 'manual' }
    })
    const credentialIncomplete = resolveRuntimeConfig({
      definition,
      profile: { ...createDefaultSourceProfile(definition), enabled: true, collectionPreset: 'manual' },
      hasCredential: false
    })

    expect(disabled.collectionPreset).toBe('manual')
    expect(disabled.pollingIntervalSec).toBeUndefined()
    expect(credentialIncomplete.collectionPreset).toBe('manual')
    expect(credentialIncomplete.pollingIntervalSec).toBeUndefined()
  })

  it('forces includeInSentiment false when definition does not support sentiment', () => {
    const definition = requireDefinition('github-releases')
    const config = resolveRuntimeConfig({
      definition,
      profile: {
        ...createDefaultSourceProfile(definition),
        includeInSentiment: true
      }
    })

    expect(config.includeInSentiment).toBe(false)
    expect(config.sentimentEligible).toBe(false)
  })

  it('does not interpret generic raw archive, retention, or replay profile values for the special stablecoin collector', () => {
    const definition = requireDefinition('defillama-stablecoins')
    const config = resolveRuntimeConfig({
      definition,
      profile: {
        ...createDefaultSourceProfile(definition), enabled: true, rawArchiveEnabled: true,
        retentionMode: 'extended', autoReplayAfterParserUpgrade: true, includeInSentiment: true
      }
    })

    expect(config.includeInSentiment).toBe(false)
    expect(config.rawArchiveEnabled).toBe(false)
    expect(config.autoReplayAfterParserUpgrade).toBe(false)
  })

  it('returns a safe validation error when api-key source is enabled without credential', () => {
    const definition: IntelligenceSourceDefinition = {
      ...requireDefinition('coindesk-rss'),
      authMode: 'api-key',
      supportsCredentialTest: true,
      readiness: 'live'
    }
    const { issues } = resolveAndValidateRuntimeConfig({
      definition,
      profile: {
        ...createDefaultSourceProfile(definition),
        enabled: true
      },
      hasCredential: false
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe('missing-credential')
  })

  it('resolves stream sources to live desired state without polling interval', () => {
    const definition: IntelligenceSourceDefinition = {
      ...requireDefinition('coindesk-rss'),
      executionMode: 'websocket',
      adapterType: 'websocket-stream-consumer'
    }

    const config = resolveRuntimeConfig({
      definition,
      profile: {
        ...createDefaultSourceProfile(definition),
        enabled: true,
        collectionPreset: 'balanced'
      }
    })

    expect(config.desiredRuntimeState).toBe('live')
    expect(config.pollingIntervalSec).toBeUndefined()
  })

  it('blocks enabling planned sources at validation time', () => {
    const definition = requireDefinition('bea-economic-series')
    const { config, issues } = resolveAndValidateRuntimeConfig({
      definition,
      profile: {
        ...createDefaultSourceProfile(definition),
        enabled: true
      }
    })

    expect(config.enabled).toBe(false)
    expect(issues.some((issue) => issue.code === 'source-not-ready')).toBe(true)
  })

  it('blocks enabling fixture-ready sources at validation time', () => {
    const definition = requireDefinition('bls-economic-series')
    const { config, issues } = resolveAndValidateRuntimeConfig({
      definition,
      profile: {
        ...createDefaultSourceProfile(definition),
        enabled: true
      }
    })

    expect(config.enabled).toBe(false)
    expect(issues.some((issue) => issue.code === 'source-not-ready')).toBe(true)
    expect(issues.some((issue) => issue.code === 'missing-credential')).toBe(false)
    expect(definition.readiness).toBe('fixture-ready')
  })

  it('expands monitored symbols into binance runtime adapter config', () => {
    const definition = requireDefinition('binance-spot-market')
    const config = resolveRuntimeConfig({
      definition,
      profile: {
        ...createDefaultSourceProfile(definition),
        monitoredSymbols: ['SOLUSDT']
      }
    })

    expect(config.adapterConfig.symbols).toEqual(expect.arrayContaining(['ETHUSDT', 'BTCUSDT', 'SOLUSDT']))
  })

  it('uses cadence-aware polling intervals for macro sources', () => {
    const definition = requireDefinition('fred-rates-liquidity')
    const config = resolveRuntimeConfig({
      definition,
      profile: {
        ...createDefaultSourceProfile(definition),
        enabled: true,
        collectionPreset: 'balanced'
      }
    })

    expect(config.pollingIntervalSec).toBe(6 * 60 * 60)
    expect(config.adapterConfig.requestMode).toBe('fred-series')
  })

  it('derives immutable Dashboard REST schedule DTOs from the named profile preset policy', () => {
    expect(resolveSafeDashboardSourceScheduleRule({ sourceId: 'alternative-fear-greed', collectionPreset: 'manual' })).toEqual({ mode: 'manual' })
    expect(resolveSafeDashboardSourceScheduleRule({ sourceId: 'binance-futures-positioning', collectionPreset: 'balanced' })).toEqual({
      mode: 'interval', intervalSeconds: 600, anchor: 'last-complete', initialRunOnEnable: true
    })
    expect(resolveSafeDashboardSourceScheduleRule({ sourceId: 'binance-futures-positioning', collectionPreset: 'frequent' })).toEqual({
      mode: 'interval', intervalSeconds: 180, anchor: 'last-complete', initialRunOnEnable: true
    })
    expect(resolveSafeDashboardSourceScheduleRule({ sourceId: 'defillama-stablecoins', collectionPreset: 'balanced' })).toEqual({
      mode: 'interval', intervalSeconds: 600, anchor: 'last-complete', initialRunOnEnable: true
    })
    expect(resolveSafeDashboardSourceScheduleRule({ sourceId: 'defillama-stablecoins', collectionPreset: 'frequent' })).toEqual({
      mode: 'interval', intervalSeconds: 180, anchor: 'last-complete', initialRunOnEnable: true
    })
    expect(Object.isFrozen(resolveSafeDashboardSourceScheduleRule({ sourceId: 'binance-futures-positioning', collectionPreset: 'balanced' }))).toBe(true)
  })

  it('fails closed instead of deriving a Dashboard schedule from hostile profile input', () => {
    const accessor = { sourceId: 'alternative-fear-greed' }
    Object.defineProperty(accessor, 'collectionPreset', { enumerable: true, get: () => { throw new Error('getter must not run') } })
    const symbolBearing = { sourceId: 'alternative-fear-greed', collectionPreset: 'balanced', [Symbol('extension')]: true }
    const cyclic: Record<string, unknown> = { sourceId: 'alternative-fear-greed', collectionPreset: 'balanced' }
    cyclic.self = cyclic
    const throwingProxy = new Proxy({}, { getPrototypeOf: () => { throw new Error('reflection must not run') } })
    const throwingGetProxy = new Proxy({ sourceId: 'alternative-fear-greed', collectionPreset: 'balanced' }, { get: () => { throw new Error('property access must not run') } })

    expect(resolveSafeDashboardSourceScheduleRule({ sourceId: 'foreign-source', collectionPreset: 'balanced' })).toBeUndefined()
    expect(resolveSafeDashboardSourceScheduleRule({ sourceId: 'alternative-fear-greed', collectionPreset: 'balanced', extension: true })).toBeUndefined()
    expect(resolveSafeDashboardSourceScheduleRule(accessor)).toBeUndefined()
    expect(resolveSafeDashboardSourceScheduleRule(symbolBearing)).toBeUndefined()
    expect(resolveSafeDashboardSourceScheduleRule(cyclic)).toBeUndefined()
    expect(resolveSafeDashboardSourceScheduleRule(throwingProxy)).toBeUndefined()
    expect(resolveSafeDashboardSourceScheduleRule(throwingGetProxy)).toBeUndefined()
  })
})

function requireDefinition(sourceId: string) {
  const definition = getIntelligenceSourceDefinition(sourceId)
  if (!definition) throw new Error(`Missing definition for ${sourceId}`)
  return definition
}
