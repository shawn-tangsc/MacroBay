import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { getIntelligenceSourceDefinition } from '../../application/sourceCatalog'
import { createDefaultSourceProfile, resolveAndValidateRuntimeConfig } from '../../application/sourceRuntimeConfig'
import { metricRestApiAdapter } from '../metricRestApiAdapter'
import { normalizeCoingeckoUpdatedAt, parseCoingeckoGlobalPayload } from './coingeckoMarketParser'
import type { IntelligenceSourceConfig } from '../../schema/intelligenceSource'

describe('parseCoingeckoGlobalPayload', () => {
  it('maps the sample global snapshot into level metrics', () => {
    const drafts = parseCoingeckoGlobalPayload(JSON.parse(loadFixture('coingecko-global-sample.json')), config())
    expect(drafts.map((draft) => draft.metricKey)).toEqual([
      'CRYPTO_TOTAL_MARKET_CAP',
      'CRYPTO_MARKET_CAP_CHANGE_24H',
      'CRYPTO_BTC_DOMINANCE'
    ])
    const [cap, change, dominance] = drafts
    expect(cap?.actual).toBe(1000000000)
    expect(cap?.unit).toBe('usd')
    expect(cap?.comparisonBasis).toBe('level')
    expect(change?.surpriseDirection).toBe('down')
    expect(change?.unit).toBe('percent')
    expect(dominance?.metricKind).toBe('market-cap')
    expect(drafts.every((draft) => draft.releaseTime === '2026-10-14T13:16:59.000Z')).toBe(true)
    expect(drafts.every((draft) => draft.rawValueJson?.includes('"aggregator":true'))).toBe(true)
  })

  it('drops only the metric whose own field is missing', () => {
    const drafts = parseCoingeckoGlobalPayload(
      {
        data: {
          updated_at: 1791983819,
          total_market_cap: { usd: 1000 },
          market_cap_change_percentage_24h_usd: null,
          market_cap_percentage: { btc: '52.25' }
        }
      },
      config()
    )
    expect(drafts.map((draft) => draft.metricKey)).toEqual(['CRYPTO_TOTAL_MARKET_CAP', 'CRYPTO_BTC_DOMINANCE'])
    expect(drafts[1]?.actual).toBe(52.25)
  })

  it('refuses a payload it cannot date, and one with no usable metric at all', () => {
    expect(() => parseCoingeckoGlobalPayload({ data: { total_market_cap: { usd: 1 } } }, config())).toThrow(
      /missing or invalid updated_at/
    )
    expect(() =>
      parseCoingeckoGlobalPayload({ data: { updated_at: 1791983819, total_market_cap: {} } }, config())
    ).toThrow(/no usable metric fields/)
    expect(() => parseCoingeckoGlobalPayload({ status: { error_code: 429 } }, config())).toThrow(/no data object/)
    expect(() => parseCoingeckoGlobalPayload({ data: { updated_at: 'not-a-time' } }, config())).toThrow(
      /missing or invalid updated_at/
    )
  })
})

describe('normalizeCoingeckoUpdatedAt', () => {
  it('reads epoch seconds and rejects unusable values', () => {
    expect(normalizeCoingeckoUpdatedAt(1791983819)).toBe('2026-10-14T13:16:59.000Z')
    for (const value of [undefined, null, '', 'abc', 0, -5, 1]) {
      expect(normalizeCoingeckoUpdatedAt(value)).toBeUndefined()
    }
  })
})

describe('metricRestApiAdapter coingecko collection', () => {
  it('collects and parses the snapshot, and enables without any credential', async () => {
    const definition = getIntelligenceSourceDefinition('coingecko-market')!
    const { config: runtimeConfig, issues } = resolveAndValidateRuntimeConfig({
      definition,
      profile: { ...createDefaultSourceProfile(definition), enabled: true },
      hasCredential: false
    })
    expect(definition.authMode).toBe('none')
    expect(issues).toEqual([])
    expect(runtimeConfig.enabled).toBe(true)
    // The declared preset is what arms the cadence: a 10-minute metric poll, not a new schedule.
    expect(runtimeConfig.pollingIntervalSec).toBe(10 * 60)

    const fetchText = vi.fn(async () => loadFixture('coingecko-global-sample.json'))
    const records = await metricRestApiAdapter.collect({ config: runtimeConfig, runId: 'run-cg', fetchText })
    expect(fetchText.mock.calls[0]?.[0]).toBe('https://api.coingecko.com/api/v3/global')
    expect(records.length).toBe(1)

    const parsed = metricRestApiAdapter.parseRawRecord({ config: runtimeConfig, rawRecord: records[0]! })
    expect(parsed.metricEvents?.map((event) => event.metricKey)).toContain('CRYPTO_TOTAL_MARKET_CAP')
    const normalized = metricRestApiAdapter.normalizeParsedItems?.({
      config: runtimeConfig,
      parsed,
      rawRecordId: 'raw-1',
      detectedAt: '2026-10-14T10:00:00.000Z'
    })
    expect(normalized?.length).toBe(3)
    expect(normalized?.[0]?.eventSubtype).toBe('market-cap')
  })
})

function config(): IntelligenceSourceConfig {
  const definition = getIntelligenceSourceDefinition('coingecko-market')!
  return resolveAndValidateRuntimeConfig({
    definition,
    profile: { ...createDefaultSourceProfile(definition), enabled: true }
  }).config
}

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, '../fixtures', name), 'utf8')
}
