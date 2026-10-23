import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { getIntelligenceSourceDefinition } from '../application/sourceCatalog'
import { createDefaultSourceProfile, resolveAndValidateRuntimeConfig } from '../application/sourceRuntimeConfig'
import { metricRestApiAdapter } from './metricRestApiAdapter'

const MACRO_SOURCE_IDS = [
  'bls-economic-series',
  'bea-economic-series',
  'fred-rates-liquidity',
  'treasury-fiscal-data'
] as const

describe('metricRestApiAdapter macro parsers', () => {
  for (const sourceId of MACRO_SOURCE_IDS) {
    it(`parses ${sourceId} fixture into metric events`, () => {
      const definition = getIntelligenceSourceDefinition(sourceId)!
      const { config } = resolveAndValidateRuntimeConfig({
        definition,
        profile: createDefaultSourceProfile(definition)
      })
      const fixtureName = macroFixtureForSource(sourceId)
      const rawRecord = {
        rawRecordId: `raw-${sourceId}`,
        sourceId,
        detectedAt: '2026-07-08T10:00:00.000Z',
        payloadBody: loadFixture(fixtureName),
        payloadMetaJson: macroPayloadMetaForSource(sourceId, fixtureName)
      }

      const parsed = metricRestApiAdapter.parseRawRecord({ config, rawRecord })
      expect(parsed.metricEvents?.length).toBeGreaterThan(0)
      expect(parsed.metricEvents?.[0]?.metricKey).toBeTruthy()
      expect(parsed.metricEvents?.[0]?.actual).toBeTypeOf('number')
    })
  }
})

describe('metricRestApiAdapter.collect', () => {
  it('does not retain DeFiLlama stablecoins as a generic raw-record source', () => {
    expect(metricRestApiAdapter.supportedSourceIds).not.toContain('defillama-stablecoins')
  })

  it('creates one raw record per symbol response', async () => {
    const fetchText = vi.fn(async (url: string) => {
      if (url.includes('ETHUSDT')) return loadFixture('binance-eth-ticker-sample.json')
      if (url.includes('BTCUSDT')) return loadFixture('binance-btc-ticker-negative.json')
      throw new Error(`unexpected url ${url}`)
    })

    const records = await metricRestApiAdapter.collect({
      config: {
        sourceId: 'binance-spot-market',
        sourceName: 'Binance Spot Market',
        sourceGroup: 'exchange-announcement',
        adapterType: 'rest-api-poller',
        executionMode: 'polling',
        enabled: true,
        category: 'exchange-announcement',
        trustLevel: 'high',
        language: 'en',
        collectionPreset: 'balanced',
        desiredRuntimeState: 'polling',
        parserStrategy: 'binance-spot-market-v1',
        noisePolicy: 'balanced',
        includeInSentiment: true,
        scopePolicy: 'watchlist-priority',
        rawArchiveEnabled: false,
        retentionMode: 'balanced',
        autoReplayAfterParserUpgrade: false,
        sentimentEligible: true,
        adapterConfig: {
          endpointUrl: 'https://api.binance.com/api/v3/ticker/24hr',
          symbolParam: 'symbol',
          symbols: ['ETHUSDT', 'BTCUSDT']
        }
      },
      runId: 'run-1',
      fetchText
    })

    expect(records).toHaveLength(2)
    expect(records[0]?.sourceDedupeKey).toContain('ETHUSDT')
    expect(records[1]?.sourceDedupeKey).toContain('BTCUSDT')
    expect(records[0]?.sourceDedupeKey).not.toEqual(records[1]?.sourceDedupeKey)
  })
})

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
}

function macroFixtureForSource(sourceId: (typeof MACRO_SOURCE_IDS)[number]): string {
  switch (sourceId) {
    case 'bls-economic-series':
      return 'bls-cpi-hot-sample.json'
    case 'bea-economic-series':
      return 'bea-pce-hot-sample.json'
    case 'fred-rates-liquidity':
      return 'fred-yields-rising-sample.json'
    case 'treasury-fiscal-data':
      return 'treasury-tga-rising-sample.json'
  }
}

function macroPayloadMetaForSource(sourceId: (typeof MACRO_SOURCE_IDS)[number], fixtureName: string): string | undefined {
  if (sourceId === 'fred-rates-liquidity') {
    return JSON.stringify({ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD' })
  }
  if (sourceId === 'treasury-fiscal-data') {
    return JSON.stringify({ metricKey: 'US_TGA_BALANCE' })
  }
  if (sourceId === 'bea-economic-series' && fixtureName.includes('gdp')) {
    return JSON.stringify({ metricKey: 'US_GDP_REAL_QOQ_ANNUALIZED' })
  }
  if (sourceId === 'bea-economic-series') {
    return JSON.stringify({ metricKey: 'US_PCE_HEADLINE_YOY' })
  }
  return undefined
}
