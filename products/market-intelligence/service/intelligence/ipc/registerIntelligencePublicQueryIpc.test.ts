import { describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { MARKET_INTELLIGENCE_QUERY_TYPES } from '../../../contracts/intelligenceQueryContracts'
import { registerIntelligencePublicQueryIpc } from './registerIntelligencePublicQueryIpc'

const mockPublicQueryService = {
  querySentimentSnapshot: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sentimentSnapshot })),
  querySentimentSeries: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sentimentSeries })),
  queryRelatedEvents: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.relatedEvents })),
  queryImpactTimeline: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.impactTimeline })),
  getSourceHealth: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sourceHealth })),
  getEvidenceExcerpt: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.evidenceExcerpt })),
  queryFearGreedSnapshot: vi.fn(async () => ({
    state: 'available', asOf: '2026-08-06T12:00:00.000Z', score: 22, bucket: 'extreme-fear', observedAt: '2026-08-06T10:00:00.000Z'
  })),
  queryFundingRateHistory: vi.fn(async () => ({
    state: 'available', asOf: '2026-08-06T12:00:00.000Z',
    btc: [{ observedAt: '2026-08-05T00:00:00.000Z', ratePercent: 0.01 }],
    eth: [{ observedAt: '2026-08-05T00:00:00.000Z', ratePercent: -0.02 }]
  })),
  queryCapitalConditionsSnapshot: vi.fn(async () => ({
    state: 'available', asOf: '2026-08-06T12:00:00.000Z', etf: { state: 'unavailable' },
    coreStablecoins: { observedAt: '2026-08-06T10:00:00.000Z', verifiedAt: '2026-08-06T10:00:00.000Z', currentUsd: 310, change1dUsd: 10, change1dPercent: 3, change7dUsd: 10, change7dPercent: 3, change30dUsd: 30, change30dPercent: 10 }, conclusion: 'partial'
  }))
}

vi.mock('../intelligenceModule', () => ({
  getIntelligenceModule: () => ({
    publicQueryService: mockPublicQueryService
  })
}))

describe('registerIntelligencePublicQueryIpc', () => {
  it('registers public query IPC methods that delegate to publicQueryService', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    const register = (_productId: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }

    registerIntelligencePublicQueryIpc(register, {} as JobRuntime)

    await handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.querySentimentSnapshot)?.({
      asOf: '2026-07-08T10:00:00.000Z',
      scope: { symbol: 'BTCUSDT' }
    })
    await handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.getSourceHealth)?.({
      asOf: '2026-07-08T10:00:00.000Z'
    })
    await handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.getEvidenceExcerpt)?.({
      asOf: '2026-07-08T10:00:00.000Z',
      itemId: 'item-1'
    })

    expect(mockPublicQueryService.querySentimentSnapshot).toHaveBeenCalledWith({
      asOf: '2026-07-08T10:00:00.000Z',
      scope: { symbol: 'BTCUSDT' }
    })
    expect(mockPublicQueryService.getSourceHealth).toHaveBeenCalledWith({
      asOf: '2026-07-08T10:00:00.000Z'
    })
    expect(mockPublicQueryService.getEvidenceExcerpt).toHaveBeenCalledWith({
      asOf: '2026-07-08T10:00:00.000Z',
      itemId: 'item-1'
    })
  })

  it('rejects time-bound queries without asOf', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    const register = (_productId: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }

    registerIntelligencePublicQueryIpc(register, {} as JobRuntime)

    await expect(
      handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryRelatedEvents)?.({ scope: { symbol: 'BTCUSDT' } })
    ).rejects.toThrow('asOf is required.')
  })

  it('rejects evidence excerpt queries without evidence identity', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    const register = (_productId: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }

    registerIntelligencePublicQueryIpc(register, {} as JobRuntime)

    await expect(
      handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.getEvidenceExcerpt)?.({
        asOf: '2026-07-08T10:00:00.000Z'
      })
    ).rejects.toThrow('evidenceRefId, itemId, impactId, or clusterId is required.')
  })

  it('reconstructs only a valid fixed Fear & Greed snapshot result', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerIntelligencePublicQueryIpc((_productId, method, handler) => handlers.set(method, handler), {} as JobRuntime)

    await expect(handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFearGreedSnapshot)?.({
      asOf: '2026-08-06T12:00:00.000Z'
    })).resolves.toEqual({
      state: 'available', asOf: '2026-08-06T12:00:00.000Z', score: 22, bucket: 'extreme-fear', observedAt: '2026-08-06T10:00:00.000Z'
    })
    expect(mockPublicQueryService.queryFearGreedSnapshot).toHaveBeenCalledWith({ asOf: '2026-08-06T12:00:00.000Z' })
  })

  it.each([
    [{}, 'invalid input'],
    [{ asOf: '2026-08-06T12:00:00.000Z', sourceUrl: 'https://secret.example.test' }, 'input extension'],
    [{ asOf: '2026-08-06T12:00:00.000Z' }, 'invalid service result']
  ])('returns exact redacted unavailable for %s', async (payload, _name) => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerIntelligencePublicQueryIpc((_productId, method, handler) => handlers.set(method, handler), {} as JobRuntime)
    mockPublicQueryService.queryFearGreedSnapshot.mockResolvedValueOnce({ state: 'available', asOf: '2026-08-06T12:00:00.000Z', score: 22, bucket: 'fear', observedAt: '2026-08-06T10:00:00.000Z', sourceUrl: 'https://secret.example.test' })

    await expect(handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFearGreedSnapshot)?.(payload)).resolves.toEqual({
      state: 'unavailable', failureCode: 'fear-greed-query-unavailable'
    })
  })

  it.each([
    ['a getPrototypeOf trap', new Proxy({}, { getPrototypeOf: () => { throw new Error('secret') } })],
    ['an ownKeys trap', new Proxy({}, { ownKeys: () => { throw new Error('secret') } })],
    ['a descriptor trap', new Proxy({ asOf: '2026-08-06T12:00:00.000Z' }, { getOwnPropertyDescriptor: () => { throw new Error('secret') } })],
    ['a getter trap', new Proxy({ asOf: '2026-08-06T12:00:00.000Z' }, { get: () => { throw new Error('secret') } })],
    ['an accessor payload', Object.defineProperty({}, 'asOf', { enumerable: true, get: () => '2026-08-06T12:00:00.000Z' })],
    ['a symbol-bearing payload', { asOf: '2026-08-06T12:00:00.000Z', [Symbol('secret')]: true }]
  ])('fails closed for %s without calling the service', async (_name, payload) => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerIntelligencePublicQueryIpc((_productId, method, handler) => handlers.set(method, handler), {} as JobRuntime)
    mockPublicQueryService.queryFearGreedSnapshot.mockClear()

    await expect(handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFearGreedSnapshot)?.(payload)).resolves.toEqual({
      state: 'unavailable', failureCode: 'fear-greed-query-unavailable'
    })
    expect(mockPublicQueryService.queryFearGreedSnapshot).not.toHaveBeenCalled()
  })

  it.each([
    ['an accessor result', Object.defineProperty({}, 'state', { enumerable: true, get: () => { throw new Error('secret') } })],
    ['a symbol-bearing result', { state: 'unavailable', failureCode: 'fear-greed-query-unavailable', [Symbol('secret')]: true }],
    ['an ownKeys-trapping result', new Proxy({}, { ownKeys: () => { throw new Error('secret') } })],
    ['a descriptor-trapping result', new Proxy({ state: 'unavailable' }, { getOwnPropertyDescriptor: () => { throw new Error('secret') } })],
    ['a getter-trapping result', new Proxy({ state: 'unavailable', failureCode: 'fear-greed-query-unavailable' }, { get: () => { throw new Error('secret') } })]
  ])('fails closed for %s without exposing a reflection failure', async (_name, result) => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerIntelligencePublicQueryIpc((_productId, method, handler) => handlers.set(method, handler), {} as JobRuntime)
    mockPublicQueryService.queryFearGreedSnapshot.mockResolvedValueOnce(result)

    await expect(handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFearGreedSnapshot)?.({ asOf: '2026-08-06T12:00:00.000Z' })).resolves.toEqual({
      state: 'unavailable', failureCode: 'fear-greed-query-unavailable'
    })
  })
  it('passes only the safe funding-rate history DTO through IPC', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerIntelligencePublicQueryIpc((_productId, method, handler) => handlers.set(method, handler), {} as JobRuntime)

    await expect(handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFundingRateHistory)?.({
      asOf: '2026-08-06T12:00:00.000Z'
    })).resolves.toEqual({
      state: 'available',
      asOf: '2026-08-06T12:00:00.000Z',
      btc: [{ observedAt: '2026-08-05T00:00:00.000Z', ratePercent: 0.01 }],
      eth: [{ observedAt: '2026-08-05T00:00:00.000Z', ratePercent: -0.02 }]
    })
    expect(mockPublicQueryService.queryFundingRateHistory).toHaveBeenCalledWith({ asOf: '2026-08-06T12:00:00.000Z' })
  })

  it('reconstructs a capital snapshot and rejects an extended input before service invocation', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerIntelligencePublicQueryIpc((_productId, method, handler) => handlers.set(method, handler), {} as JobRuntime)
    const expected = {
      state: 'available', asOf: '2026-08-06T12:00:00.000Z', etf: { state: 'unavailable' },
      coreStablecoins: { observedAt: '2026-08-06T10:00:00.000Z', verifiedAt: '2026-08-06T10:00:00.000Z', currentUsd: 310, change1dUsd: 10, change1dPercent: 3, change7dUsd: 10, change7dPercent: 3, change30dUsd: 30, change30dPercent: 10 }, conclusion: 'partial'
    }
    mockPublicQueryService.queryCapitalConditionsSnapshot.mockResolvedValueOnce(expected)

    await expect(handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot)?.({ asOf: expected.asOf })).resolves.toEqual(expected)
    mockPublicQueryService.queryCapitalConditionsSnapshot.mockClear()
    await expect(handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot)?.({ asOf: expected.asOf, sourceUrl: 'https://secret.example.test' })).resolves.toEqual({
      state: 'unavailable', failureCode: 'capital-conditions-query-unavailable'
    })
    expect(mockPublicQueryService.queryCapitalConditionsSnapshot).not.toHaveBeenCalled()
  })

  it('reconstructs the optional finite stablecoin background only', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerIntelligencePublicQueryIpc((_productId, method, handler) => handlers.set(method, handler), {} as JobRuntime)
    mockPublicQueryService.queryCapitalConditionsSnapshot.mockResolvedValueOnce({
      state: 'available', asOf: '2026-08-06T12:00:00.000Z', etf: { state: 'unavailable' },
      coreStablecoins: { observedAt: '2026-08-06T10:00:00.000Z', verifiedAt: '2026-08-06T10:00:00.000Z', currentUsd: 310, change1dUsd: 10, change1dPercent: 3, change7dUsd: 10, change7dPercent: 3, change30dUsd: 30, change30dPercent: 10 },
      usdStablecoinSupplyUsd: 315, conclusion: 'partial'
    })

    await expect(handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot)?.({ asOf: '2026-08-06T12:00:00.000Z' })).resolves.toMatchObject({
      state: 'available', usdStablecoinSupplyUsd: 315
    })
  })

  it('passes only the compact stablecoin history rows through IPC', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerIntelligencePublicQueryIpc((_productId, method, handler) => handlers.set(method, handler), {} as JobRuntime)
    const expected = {
      state: 'available', asOf: '2026-08-06T12:00:00.000Z', etf: { state: 'unavailable' },
      coreStablecoins: { observedAt: '2026-08-06T10:00:00.000Z', verifiedAt: '2026-08-06T10:00:00.000Z', currentUsd: 310, change1dUsd: 10, change1dPercent: 3, change7dUsd: 10, change7dPercent: 3, change30dUsd: 30, change30dPercent: 10, dailyFlows: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1 })) }, conclusion: 'partial'
    }
    mockPublicQueryService.queryCapitalConditionsSnapshot.mockResolvedValueOnce(expected)
    await expect(handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot)?.({ asOf: expected.asOf })).resolves.toEqual(expected)
  })

  it.each([
    ['a safe versioned ETF result', safeEtfResult()],
    ['an ETF result with an extra provider field', { ...safeEtfResult(), providerPayload: 'secret' }],
    ['an ETF result with the wrong BTC asset', { ...safeEtfResult(), btc: { ...safeEtfResult().btc, asset: 'ETH' } }],
    ['an ETF result with a non-finite flow', { ...safeEtfResult(), btc: { ...safeEtfResult().btc, rows: [{ ...safeEtfResult().btc.rows[0], netFlowUsd: Number.NaN }] } }],
    ['an ETF result older than the named 48-hour policy', { ...safeEtfResult(), verifiedAt: '2026-08-04T11:59:59.999Z' }]
  ])('only passes the exact safe %s through IPC', async (_name, etf) => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerIntelligencePublicQueryIpc((_productId, method, handler) => handlers.set(method, handler), {} as JobRuntime)
    mockPublicQueryService.queryCapitalConditionsSnapshot.mockResolvedValueOnce({
      state: 'available', asOf: '2026-08-06T12:00:00.000Z', etf,
      coreStablecoins: { observedAt: '2026-08-06T10:00:00.000Z', verifiedAt: '2026-08-06T10:00:00.000Z', currentUsd: 310, change1dUsd: 10, change1dPercent: 3, change7dUsd: 10, change7dPercent: 3, change30dUsd: 30, change30dPercent: 10 }, conclusion: 'partial'
    })

    const result = await handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot)?.({ asOf: '2026-08-06T12:00:00.000Z' })
    if (_name === 'a safe versioned ETF result') {
      expect(result).toMatchObject({ state: 'available', etf: safeEtfResult() })
    } else {
      expect(result).toEqual({ state: 'unavailable', failureCode: 'capital-conditions-query-unavailable' })
    }
  })

  it('passes a complete legal 30-row BTC/ETH ETF DTO through IPC within the named response budget', async () => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerIntelligencePublicQueryIpc((_productId, method, handler) => handlers.set(method, handler), {} as JobRuntime)
    mockPublicQueryService.queryCapitalConditionsSnapshot.mockResolvedValueOnce(capitalResultWithFullEtf())

    await expect(handlers.get(INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot)?.({ asOf: '2026-08-06T12:00:00.000Z' })).resolves.toMatchObject({ state: 'available', etf: { state: 'available' } })
  })
})

function safeEtfResult() {
  return {
    state: 'available' as const, schemaVersion: 1, sourceId: '0xrouter', windowEnd: '2026-08-05', verifiedAt: '2026-08-06T10:00:00.000Z',
    btc: { asset: 'BTC' as const, rows: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1, observedAt: '2026-08-06T10:00:00.000Z' })) },
    eth: { asset: 'ETH' as const, rows: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].map((tradingDate, index) => ({ tradingDate, netFlowUsd: -(index + 1), observedAt: '2026-08-06T10:00:00.000Z' })) }
  }
}

function capitalResultWithFullEtf() {
  const dates = Array.from({ length: 30 }, (_, index) => new Date(Date.parse('2026-07-07T00:00:00.000Z') + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10))
  const etf = {
    state: 'available' as const, schemaVersion: 1, sourceId: '0xrouter', windowEnd: dates.at(-1)!, verifiedAt: '2026-08-06T10:00:00.000Z',
    btc: { asset: 'BTC' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1, observedAt: '2026-08-06T10:00:00.000Z' })) },
    eth: { asset: 'ETH' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: -(index + 1), observedAt: '2026-08-06T10:00:00.000Z' })) }
  }
  return {
    state: 'available' as const, asOf: '2026-08-06T12:00:00.000Z', etf,
    coreStablecoins: { observedAt: '2026-08-06T10:00:00.000Z', verifiedAt: '2026-08-06T10:00:00.000Z', currentUsd: 310, change1dUsd: 10, change1dPercent: 3, change7dUsd: 10, change7dPercent: 3, change30dUsd: 30, change30dPercent: 10 }, conclusion: 'partial' as const
  }
}
