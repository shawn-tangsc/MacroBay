import { afterEach, describe, expect, it, vi } from 'vitest'

import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { intelligenceOpenInterestClient } from './intelligenceOpenInterestClient'

const asOf = '2026-10-29T00:00:00.000Z'
const points = [
  { observedAt: '2026-10-28T23:00:00.000Z', notionalUsd: 8_900_000_000 },
  { observedAt: '2026-10-29T00:00:00.000Z', notionalUsd: 8_940_000_000 }
]
const available = {
  state: 'available', asOf, window: '7d', btc: points, eth: points,
  change: { btc: { h1Pct: -0.4, h24Pct: -2.1 }, eth: { h24Pct: 1.8 } },
  liquidationHintsState: 'available'
}

function invoke(value: unknown) {
  const products = { invoke: vi.fn(async () => value) }
  vi.stubGlobal('window', { platform: { products } })
  return products
}

afterEach(() => vi.unstubAllGlobals())

describe('open interest renderer client', () => {
  it('calls the one IPC method with the asked window and returns the answered DTO', async () => {
    const products = invoke(available)
    await expect(intelligenceOpenInterestClient.query({ asOf, window: '7d' })).resolves.toEqual(available)
    expect(products.invoke).toHaveBeenCalledWith('market-intelligence', INTELLIGENCE_PUBLIC_QUERY_METHODS.queryOpenInterestHistory, { asOf, window: '7d' })
  })

  it('refuses an instant or window that is not canonical before spending an IPC call', async () => {
    const products = invoke(available)
    await expect(intelligenceOpenInterestClient.query({ asOf: '2026-10-29 00:00', window: '7d' })).resolves.toEqual({
      state: 'unavailable', failureCode: 'open-interest-history-query-unavailable'
    })
    await expect(intelligenceOpenInterestClient.query({ asOf, window: '30d' as never })).resolves.toMatchObject({ state: 'unavailable' })
    expect(products.invoke).not.toHaveBeenCalled()
  })

  it.each([
    ['a different asOf', { ...available, asOf: '2026-10-29T00:01:00.000Z' }],
    ['a different window', { ...available, window: '24h' }],
    ['descending points', { ...available, btc: [...points].reverse() }],
    ['a future point', { ...available, btc: [{ observedAt: '2026-10-29T00:15:00.000Z', notionalUsd: 1 }] }],
    ['a negative notional', { ...available, btc: [{ observedAt: '2026-10-29T00:00:00.000Z', notionalUsd: -1 }] }],
    ['an unknown state', { state: 'weird' }],
    ['a missing hints state', { ...available, liquidationHintsState: undefined }],
    ['a positive drop', { ...available, liquidationHints: [{ observedAt: '2026-10-28T23:45:00.000Z', asset: 'btc', dropPct: 1, volumeMultiple: 2 }] }]
  ])('refuses %s', async (_name, value) => {
    invoke(value)
    await expect(intelligenceOpenInterestClient.query({ asOf, window: '7d' })).resolves.toEqual({
      state: 'unavailable', failureCode: 'open-interest-history-query-unavailable'
    })
  })

  it('passes an empty window through as empty', async () => {
    invoke({ state: 'empty', asOf, window: '24h' })
    await expect(intelligenceOpenInterestClient.query({ asOf, window: '24h' })).resolves.toEqual({ state: 'empty', asOf, window: '24h' })
  })

  it('fails closed when the bridge is missing or throws', async () => {
    vi.stubGlobal('window', {})
    await expect(intelligenceOpenInterestClient.query({ asOf, window: '7d' })).resolves.toMatchObject({ state: 'unavailable' })
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => { throw new Error('ipc down') }) } } })
    await expect(intelligenceOpenInterestClient.query({ asOf, window: '7d' })).resolves.toMatchObject({ state: 'unavailable' })
  })
})
