import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { httpRequest } from '@platform/jobs'
import type { HttpClientResponse } from '@platform/jobs/transport/httpClient'

import { macroAdapterConfigForSource } from './macroSourceCatalogMetadata'
import { probeIntelligenceSourceConnection } from './intelligenceSourceConnectivity'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { createDefaultSourceProfile, resolveAndValidateRuntimeConfig } from './sourceRuntimeConfig'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import {
  createInMemoryIntelligenceCredentialStorage,
  createIntelligenceCredentialStore,
  defaultIntelligenceCredentialRef
} from '../store/intelligenceCredentialStore'
import type { IntelligenceSourceConfig } from '../schema/intelligenceSource'

// The application injects the platform's proxy-aware fetch at startup. Tests never reach the
// network, so a stub stands in for it — the point is that the module boundary stays real and no
// silent fallback to the global fetch can creep back in.
vi.mock('@platform/network/platformFetch', () => ({
  getPlatformFetch: () => (async () => new Response('', { status: 200 })) as unknown as typeof fetch
}))

vi.mock('@platform/jobs', async () => {
  const actual = await vi.importActual<typeof import('@platform/jobs')>('@platform/jobs')
  return {
    ...actual,
    httpRequest: vi.fn()
  }
})

const mockedHttpRequest = vi.mocked(httpRequest)

/** 平台 http 客户端回的是四个字段，缺一个就编译不过——测试照真实签名造。 */
function response(bodyText: string, status = 200): HttpClientResponse {
  return { bodyText, byteSize: Buffer.byteLength(bodyText, 'utf8'), headers: {}, status }
}

function macroConfig(sourceId: 'bls-economic-series' | 'fred-rates-liquidity' | 'treasury-fiscal-data'): IntelligenceSourceConfig {
  return {
    sourceId,
    sourceName: sourceId,
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    executionMode: 'polling',
    enabled: true,
    category: 'macro',
    trustLevel: 'high',
    language: 'en',
    collectionPreset: 'balanced',
    desiredRuntimeState: 'polling',
    parserStrategy: `${sourceId}-v1`,
    noisePolicy: 'balanced',
    includeInSentiment: true,
    scopePolicy: 'all',
    rawArchiveEnabled: true,
    retentionMode: 'balanced',
    autoReplayAfterParserUpgrade: true,
    sentimentEligible: true,
    adapterConfig: macroAdapterConfigForSource(sourceId)
  }
}

describe('probeIntelligenceSourceConnection', () => {
  it('probes macro sources using realistic request targets instead of bare endpoints', async () => {
    mockedHttpRequest.mockClear()
    mockedHttpRequest.mockResolvedValueOnce(response('{"data":[]}', 200))

    const result = await probeIntelligenceSourceConnection(macroConfig('treasury-fiscal-data'))

    expect(result.ok).toBe(true)
    const request = mockedHttpRequest.mock.calls[0]?.[0]
    expect(request?.url).toContain('operating_cash_balance')
    expect(request?.url).toContain('fields=record_date')
    expect(request?.url).not.toBe('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/')
  })

  it('uses BLS POST probe shape for bls-economic-series', async () => {
    mockedHttpRequest.mockClear()
    mockedHttpRequest.mockResolvedValueOnce(response('{"Results":{}}', 200))

    await probeIntelligenceSourceConnection(macroConfig('bls-economic-series'))

    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('CUSR0000SA0')
      }),
      expect.any(Object)
    )
  })

  it('rejects non-2xx macro probe responses without credential deps', async () => {
    mockedHttpRequest.mockClear()
    mockedHttpRequest.mockResolvedValueOnce(response('{"error":"forbidden"}', 403))

    const result = await probeIntelligenceSourceConnection(macroConfig('fred-rates-liquidity'))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('HTTP 403')
  })

  it('uses FRED series probe with series_id query params', async () => {
    mockedHttpRequest.mockClear()
    mockedHttpRequest.mockResolvedValueOnce(response('{"observations":[]}', 200))

    await probeIntelligenceSourceConnection(macroConfig('fred-rates-liquidity'))

    const request = mockedHttpRequest.mock.calls[0]?.[0]
    expect(request?.url).toContain('series_id=DGS2')
    expect(request?.url).toContain('file_type=json')
  })

  it('injects saved credentials when probing macro sources with credential deps', async () => {
    mockedHttpRequest.mockClear()
    mockedHttpRequest.mockResolvedValueOnce(response('{"observations":[]}', 200))

    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const credentialStore = createIntelligenceCredentialStore(createInMemoryIntelligenceCredentialStorage())
    const sourceId = 'fred-rates-liquidity'
    const credentialRef = defaultIntelligenceCredentialRef(sourceId)
    await credentialStore.save({ credentialRef, sourceId, apiKey: 'fred-test-key' })
    await profileStore.saveProfile({ sourceId, credentialRef })

    const result = await probeIntelligenceSourceConnection(macroConfig(sourceId), {
      profileStore,
      credentialStore
    })

    expect(result.ok).toBe(true)
    const request = mockedHttpRequest.mock.calls[0]?.[0]
    expect(request?.url).toContain('api_key=fred-test-key')
  })

  it('probes OKX against the announcements endpoint the collector reads, not the help-centre shell', async () => {
    mockedHttpRequest.mockClear()
    mockedHttpRequest.mockResolvedValueOnce(response(
      readFileSync(path.join(__dirname, '../adapters/fixtures/okx-announcements-api-sample.json'), 'utf8')
    ))

    const result = await probeIntelligenceSourceConnection(okxConfig('okx-api-announcements'))

    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/Connected\. Latest announcement:/)
    const request = mockedHttpRequest.mock.calls[0]?.[0]
    expect(request?.url).toBe('https://www.okx.com/api/v5/support/announcements?annType=announcements-api&page=1')
  })

  it('reports an OKX rejection instead of claiming the source is connected', async () => {
    mockedHttpRequest.mockClear()
    mockedHttpRequest.mockResolvedValueOnce(response('{"code":"51000","msg":"Parameter annType error","data":[]}', 200))

    const result = await probeIntelligenceSourceConnection(okxConfig('okx-api-announcements'))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('51000')
  })
})

function okxConfig(sourceId: 'okx-latest-announcements' | 'okx-api-announcements'): IntelligenceSourceConfig {
  const definition = getIntelligenceSourceDefinition(sourceId)!
  return resolveAndValidateRuntimeConfig({
    definition,
    profile: createDefaultSourceProfile(definition),
    hasCredential: false
  }).config
}

describe('Polymarket connectivity probe', () => {
  const config = (): IntelligenceSourceConfig => ({
    sourceId: 'policy-path-market',
    sourceName: 'FOMC decision market',
    sourceGroup: 'macro-regulation',
    adapterType: 'rest-api-poller',
    executionMode: 'polling',
    enabled: true,
    category: 'macro',
    trustLevel: 'high',
    language: 'en',
    endpointUrl: 'https://gamma-api.polymarket.com',
    parserStrategy: 'policy-path-market-v1',
    authMode: 'none',
    supportsRunNow: false,
    defaultScopePolicy: 'all',
    scopePolicy: 'all',
    defaultCollectionPreset: 'manual',
    collectionPreset: 'manual',
    adapterConfig: { endpointUrl: 'https://gamma-api.polymarket.com' },
    requestGovernance: undefined
  } as never)

  it('passes only when the search endpoint answers with Fed events', async () => {
    mockedHttpRequest.mockResolvedValueOnce({ status: 200, bodyText: JSON.stringify({ events: [{ slug: 'fed-decision-in-december' }] }) } as never)
    const ok = await probeIntelligenceSourceConnection(config())
    expect(ok.ok).toBe(true)
    expect(ok.message).toContain('1 Fed events')

    mockedHttpRequest.mockResolvedValueOnce({ status: 200, bodyText: JSON.stringify({ events: [] }) } as never)
    expect((await probeIntelligenceSourceConnection(config())).ok).toBe(false)

    mockedHttpRequest.mockResolvedValueOnce({ status: 403, bodyText: '' } as never)
    expect((await probeIntelligenceSourceConnection(config())).ok).toBe(false)
  })

  it('probes the search endpoint, not the API root', async () => {
    mockedHttpRequest.mockResolvedValueOnce({ status: 200, bodyText: JSON.stringify({ events: [{}] }) } as never)
    await probeIntelligenceSourceConnection(config())
    expect(mockedHttpRequest.mock.calls.at(-1)?.[0]).toMatchObject({
      url: expect.stringContaining('/public-search?q=fed%20decision')
    })
  })
})
