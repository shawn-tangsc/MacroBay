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

function bridge(value: unknown) {
  const products = { invoke: vi.fn(async () => value) }
  vi.stubGlobal('window', { platform: { products } })
  return products
}

afterEach(() => vi.unstubAllGlobals())

describe('module signal renderer client', () => {
  it('reads the one IPC method and returns the signals it can trust', async () => {
    const products = bridge([signal])
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual([signal])
    expect(products.invoke).toHaveBeenCalledWith('market-intelligence', INTELLIGENCE_PUBLIC_QUERY_METHODS.queryModuleSignals, { asOf })
  })

  it('drops a signal it cannot render instead of drawing half of it', async () => {
    bridge([signal, { ...signal, severity: 'critical' }, { ...signal, asset: null }])
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual([signal])
  })

  it('answers nothing when the bridge is missing or refuses the call', async () => {
    vi.stubGlobal('window', { platform: undefined })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual([])
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => { throw new Error('ipc down') }) } } })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual([])
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => 'nonsense') } } })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual([])
  })

  it('does not spend a call on an instant it cannot name', async () => {
    const products = bridge([signal])
    await expect(moduleSignalClient.query({ asOf: '2026-10-31 14:45' })).resolves.toEqual([])
    expect(products.invoke).not.toHaveBeenCalled()
  })
})
