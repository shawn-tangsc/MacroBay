import { afterEach, describe, expect, it, vi } from 'vitest'

const platformFetch = vi.hoisted(() => vi.fn())
vi.mock('@platform/network/platformFetch', () => ({ getPlatformFetch: () => platformFetch }))

import { createSourceRequestGovernanceQueue } from '../application/sourceRequestGovernance'
import { createZeroXRouterEtfFlowHistoryClient } from '../application/zeroXRouterEtfFlowHistoryClient'
import { zeroXRouterSourcePolicy } from '../application/zeroXRouterSourcePolicy'
import { createEtfHistoryAsOf, etfHistoryAsOfPolicy, type EtfHistoryApiWindow } from './etfHistoryAsOf'

const cutoff = '2026-10-30T00:00:00.000Z'
const later = '2026-10-30T04:48:00.000Z'

function midnight(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`)
}

function envelope(rows: readonly { tradingDate: string; changeUsd: number }[]): Response {
  return new Response(JSON.stringify({
    code: 200,
    msg: 'ok',
    data: rows.map((row) => ({ date: midnight(row.tradingDate), changeUsd: row.changeUsd }))
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function windowWith(fetchResponses: readonly [Response, Response]) {
  platformFetch.mockResolvedValueOnce(fetchResponses[0]).mockResolvedValueOnce(fetchResponses[1])
  const client = createZeroXRouterEtfFlowHistoryClient({
    requestGovernanceQueue: createSourceRequestGovernanceQueue({ now: () => Date.now() })
  })
  return {
    client,
    reader: createEtfHistoryAsOf({
      requestWindow: () => client.requestWindow('router-key'),
      now: () => Date.parse(later)
    })
  }
}

afterEach(() => platformFetch.mockReset())

describe('ETF flow history as of an instant', () => {
  it('takes the newest trading day that had ended, through the provider client and the platform fetch', async () => {
    const { reader } = windowWith([
      envelope([
        { tradingDate: '2026-10-28', changeUsd: -10 },
        { tradingDate: '2026-10-29', changeUsd: 250_000_000 },
        { tradingDate: '2026-10-30', changeUsd: 999 }
      ]),
      envelope([
        { tradingDate: '2026-10-28', changeUsd: 5 },
        { tradingDate: '2026-10-29', changeUsd: -30_000_000 },
        { tradingDate: '2026-10-30', changeUsd: 777 }
      ])
    ])

    await expect(reader.read({ asset: 'btc', asOf: cutoff })).resolves.toEqual({
      state: 'available',
      asset: 'btc',
      asOf: cutoff,
      value: 250_000_000,
      tradingDate: '2026-10-29',
      observedAt: '2026-10-29T00:00:00.000Z',
      sourceUrl: 'https://0xrouter.app/cexdata/etf/bitcoin/flow-history',
      method: 'historical-api'
    })
    await expect(reader.read({ asset: 'eth', asOf: cutoff })).resolves.toMatchObject({
      state: 'available', asset: 'eth', value: -30_000_000,
      sourceUrl: 'https://0xrouter.app/cexdata/etf/ethereum/flow-history'
    })

    // Both requests go through the existing client: the platform fetch, never a bare fetch, and the
    // provider's own key header.
    expect(platformFetch).toHaveBeenCalledWith(
      zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.urls.bitcoin,
      expect.objectContaining({ method: 'GET', headers: { 'X-My-Token': 'router-key' }, redirect: 'error' })
    )
    // One edition asks at most twice and shares the window between the two metrics.
    expect(platformFetch).toHaveBeenCalledTimes(2)
  })

  it('does not touch the network for a future instant', async () => {
    const { reader } = windowWith([envelope([]), envelope([])])
    await expect(reader.read({ asset: 'btc', asOf: '2026-10-30T04:48:00.001Z' }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'future-as-of' })
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('never reports a trading day that had not ended by the instant', async () => {
    const { reader } = windowWith([
      envelope([{ tradingDate: '2026-10-30', changeUsd: 999 }]),
      envelope([{ tradingDate: '2026-10-30', changeUsd: 999 }])
    ])
    const result = await reader.read({ asset: 'btc', asOf: cutoff })
    expect(result).toMatchObject({ state: 'unavailable', gapCode: 'historical-as-of-unavailable' })
    expect('value' in result).toBe(false)
  })

  it('skips a trading day the provider contradicts itself about', async () => {
    const { reader } = windowWith([
      envelope([
        { tradingDate: '2026-10-28', changeUsd: -10 },
        { tradingDate: '2026-10-29', changeUsd: 250_000_000 },
        { tradingDate: '2026-10-29', changeUsd: -250_000_000 }
      ]),
      envelope([{ tradingDate: '2026-10-28', changeUsd: 5 }])
    ])
    await expect(reader.read({ asset: 'btc', asOf: cutoff })).resolves.toMatchObject({
      state: 'available', value: -10, tradingDate: '2026-10-28'
    })
  })

  it('answers historical-api-unavailable when no provider client is configured', async () => {
    const unwired = createEtfHistoryAsOf({ now: () => Date.parse(later) })
    const unwiredResult = await unwired.read({ asset: 'btc', asOf: cutoff })
    expect(unwiredResult).toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect('value' in unwiredResult).toBe(false)

    const uncredentialed = createEtfHistoryAsOf({
      requestWindow: async () => Object.freeze({ state: 'not-configured' as const }),
      now: () => Date.parse(later)
    })
    await expect(uncredentialed.read({ asset: 'eth', asOf: cutoff }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'historical-api-unavailable' })
    expect(platformFetch).not.toHaveBeenCalled()
  })

  it('keeps the gap when the provider request is refused or fails', async () => {
    const { reader } = windowWith([
      new Response('', { status: 503, headers: { 'content-type': 'application/json' } }),
      new Response('', { status: 503, headers: { 'content-type': 'application/json' } })
    ])
    const refused = await reader.read({ asset: 'btc', asOf: cutoff })
    expect(refused).toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
    expect('value' in refused).toBe(false)

    const throwing = createEtfHistoryAsOf({
      requestWindow: async () => { throw new Error('socket closed') },
      now: () => Date.parse(later)
    })
    await expect(throwing.read({ asset: 'btc', asOf: cutoff }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })

    // A failed window is not cached as an answer; a later read asks again.
    const retried = vi.fn<() => Promise<EtfHistoryApiWindow>>()
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce(Object.freeze({ state: 'unavailable' as const }))
    const retrying = createEtfHistoryAsOf({ requestWindow: retried, now: () => Date.parse(later) })
    await expect(retrying.read({ asset: 'btc', asOf: cutoff })).resolves.toMatchObject({ gapCode: 'query-unavailable' })
    await expect(retrying.read({ asset: 'btc', asOf: cutoff })).resolves.toMatchObject({ gapCode: 'query-unavailable' })
    expect(retried).toHaveBeenCalledTimes(2)

    // A partial window answers the asset that responded and reports the other as a failed request.
    const partial = createEtfHistoryAsOf({
      requestWindow: async () => Object.freeze({
        state: 'partial' as const,
        btc: [Object.freeze({ date: midnight('2026-10-29'), changeUsd: 1 })]
      }),
      now: () => Date.parse(later)
    })
    await expect(partial.read({ asset: 'eth', asOf: cutoff }))
      .resolves.toMatchObject({ state: 'unavailable', gapCode: 'query-unavailable' })
    await expect(partial.read({ asset: 'btc', asOf: cutoff }))
      .resolves.toMatchObject({ state: 'available', value: 1, tradingDate: '2026-10-29' })
  })

  it('keeps the provider urls and the read path named in one place', () => {
    expect(etfHistoryAsOfPolicy.sourceUrl.btc).toBe('https://0xrouter.app/cexdata/etf/bitcoin/flow-history')
    expect(etfHistoryAsOfPolicy.sourceUrl.eth).toBe('https://0xrouter.app/cexdata/etf/ethereum/flow-history')
    expect(etfHistoryAsOfPolicy.method).toBe('historical-api')
  })
})
