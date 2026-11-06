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
const analysisState = { analysisOffByReader: false, analysisState: 'not-triggered' as const }
const available = { state: 'available' as const, signals: [entry], droppedInvalid: 0, analysis: { [signal.dedupeKey]: analysisState } }

function bridge(value: unknown) {
  const products = { invoke: vi.fn(async () => value) }
  vi.stubGlobal('window', { platform: { products } })
  return products
}

afterEach(() => vi.unstubAllGlobals())

describe('module signal renderer client', () => {
  it('reads the new IPC method and returns the signals with their states', async () => {
    const products = bridge(available)
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual({
      state: 'available',
      signals: [entry],
      droppedInvalid: 0,
      analysis: { [signal.dedupeKey]: analysisState }
    })
    expect(products.invoke).toHaveBeenCalledWith('market-intelligence', INTELLIGENCE_PUBLIC_QUERY_METHODS.queryModuleSignalRead, { asOf })
  })

  it('keeps the handler&apos;s dropped count instead of recounting entries on this side', async () => {
    // The handler already filtered the four entries with `toModuleSignalRead`; what reaches the
    // renderer is one readable entry and `droppedInvalid: 3`. Recounting here would be a second
    // implementation of the same rule — and a producer/contract disagreement would hide behind it.
    bridge({
      state: 'available',
      signals: [entry],
      droppedInvalid: 3,
      analysis: { [signal.dedupeKey]: analysisState }
    })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual({
      state: 'available',
      signals: [entry],
      droppedInvalid: 3,
      analysis: { [signal.dedupeKey]: analysisState }
    })
  })

  it('passes a failure code from the handler through unchanged', async () => {
    const failedRead = { state: 'unavailable' as const, failureCode: 'invalid-as-of' as const }
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => failedRead) } } })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual(failedRead)
  })

  // 回归：状态整块缺席（老主进程 / 读口没挂）时，整读不可用；**不许**当成每条都「还没轮到」。
  it('treats a missing state block as an unreadable record, not as "not triggered yet"', async () => {
    bridge({ state: 'available', signals: [entry], droppedInvalid: 0 })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual({ state: 'unavailable', failureCode: 'query-failed' })
  })

  it('treats a malformed state entry as a contract defect', async () => {
    bridge({ state: 'available', signals: [entry], droppedInvalid: 0, analysis: { [signal.dedupeKey]: { analysisState: 'sideways' } } })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual({ state: 'unavailable', failureCode: 'contract-invalid' })
  })

  // 「某条没账本行」是一条**明确的** `not-triggered`，只有那条受影响，整批照常可用；
  // 一条状态直接缺席才是读不到整块。
  it('keeps the batch when one signal is explicitly not triggered, but fails when its entry is absent', async () => {
    bridge(available)
    await expect(moduleSignalClient.query({ asOf })).resolves.toMatchObject({ state: 'available' })

    const unstated = { ...signal, dedupeKey: 'open-interest:oi-liquidation-proxy:eth:2026-10-31T14:30:00.000Z' }
    bridge({
      state: 'available',
      signals: [entry, { signal: unstated, window }],
      droppedInvalid: 0,
      analysis: { [signal.dedupeKey]: analysisState }
    })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual({ state: 'unavailable', failureCode: 'query-failed' })
  })

  it('reports an unreadable answer as one, instead of an empty market', async () => {
    const failed = { state: 'unavailable', failureCode: 'query-failed' }
    vi.stubGlobal('window', { platform: undefined })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual(failed)
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => { throw new Error('ipc down') }) } } })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual(failed)
    // An answer that is not a read at all is a contract defect, not a quiet market.
    vi.stubGlobal('window', { platform: { products: { invoke: vi.fn(async () => 'nonsense') } } })
    await expect(moduleSignalClient.query({ asOf })).resolves.toEqual({ state: 'unavailable', failureCode: 'contract-invalid' })
  })

  it('does not spend a call on an instant it cannot name', async () => {
    const products = bridge(available)
    await expect(moduleSignalClient.query({ asOf: '2026-10-31 14:45' })).resolves.toEqual({ state: 'unavailable', failureCode: 'invalid-as-of' })
    expect(products.invoke).not.toHaveBeenCalled()
  })
})
