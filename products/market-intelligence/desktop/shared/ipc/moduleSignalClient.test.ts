import { afterEach, describe, expect, it, vi } from 'vitest'

import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { moduleSignalClient } from './moduleSignalClient'

const asOf = '2026-10-31T14:45:00.000Z'

const signal = {
  version: '1', moduleId: 'open-interest', ruleId: 'oi-liquidation-proxy', asset: 'btc',
  severity: 'high', observedAt: '2026-10-31T14:30:00.000Z',
  cadence: { kind: 'intraday', bucketMs: 15 * 60_000 },
  values: { dropPct: -2.6, volumeMultiple: 3.2, notionalUsd: 7.4e9 },
  dedupeKey: 'open-interest:oi-liquidation-proxy:btc:2026-10-31T14:30:00.000Z',
  readiness: 'available', triggerOwner: 'module-signal'
}

const window = { unit: 'buckets' as const, amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 }
const entry = { signal, window }

function bridge(value: unknown) {
  const products = { invoke: vi.fn(async () => value) }
  vi.stubGlobal('window', { platform: { products } })
  return products
}

afterEach(() => vi.unstubAllGlobals())

describe('module signal renderer client', () => {
  it('reads the one IPC method and returns the signals it can trust', async () => {
    const products = bridge([entry])
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual({ state: 'available', signals: [entry], droppedInvalid: 0 })
    expect(products.invoke).toHaveBeenCalledWith('market-intelligence', INTELLIGENCE_PUBLIC_QUERY_METHODS.queryModuleSignals, { asOf })
  })

  it('drops a signal it cannot render instead of drawing half of it', async () => {
    bridge([entry, { signal: { ...signal, severity: 'critical' }, window }, { signal: { ...signal, asset: null }, window }, { signal, window: { unit: 'buckets' } }])
    // The good entry is readable and the three bad ones are counted: dropping them silently is how
    // a producer/contract disagreement hides behind a chip that simply never appeared.
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual({ state: 'available', signals: [entry], droppedInvalid: 3 })
  })

  it('reports an unreadable answer as one, instead of an empty market', async () => {
    const failed = { state: 'unavailable', failureCode: 'query-failed' }
    vi.stubGlobal('window', { platform: undefined })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual(failed)
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => { throw new Error('ipc down') }) } } })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual(failed)
    // An answer that is not a list at all is a contract defect, not a quiet market.
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => 'nonsense') } } })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual({ state: 'unavailable', failureCode: 'contract-invalid' })
  })

  it('does not spend a call on an instant it cannot name', async () => {
    const products = bridge([signal])
    await expect(moduleSignalClient.query({ asOf: '2026-10-31 14:45' })).resolves.toEqual({ state: 'unavailable', failureCode: 'invalid-as-of' })
    expect(products.invoke).not.toHaveBeenCalled()
  })
})
