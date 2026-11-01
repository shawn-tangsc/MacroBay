import { describe, expect, it, vi } from 'vitest'

import type { CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import { createPriceLegReader, priceLegStepBackMs } from './priceLegReading'

const asOf = '2026-10-30T12:00:00.000Z'
const closeAt = (minutesAgo: number) => new Date(Date.parse(asOf) - minutesAgo * 60_000).toISOString()

/** The shape the leg reads: only `btc['24h']` and `analysisEnd` matter to it. */
function snapshot(analysisEnd: string, metric: { state: 'available'; value: number } | { state: 'unavailable'; reason: 'missing' }): CrossAssetSnapshot {
  return { analysisEnd, closedReturns: { btc: { '24h': metric } } } as unknown as CrossAssetSnapshot
}

describe('price leg reading', () => {
  it('answers from the current close when the store already has it', async () => {
    const read = vi.fn(async () => snapshot(closeAt(0), { state: 'available', value: -1.25 }))
    const leg = await createPriceLegReader(read)(asOf)
    expect(leg).toEqual({ return24hPercent: -1.25, observedAt: closeAt(0) })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('steps back to the newest close the store can answer instead of reporting no price', async () => {
    // The bar closing at the analysis instant is written a moment after it closes: the first read
    // finds nothing, the next one finds the previous five-minute close.
    const read = vi.fn(async (input: { asOf: string }) => input.asOf === asOf
      ? snapshot(closeAt(0), { state: 'unavailable', reason: 'missing' })
      : snapshot(closeAt(5), { state: 'available', value: 0.42 }))
    const leg = await createPriceLegReader(read)(asOf)
    expect(leg).toEqual({ return24hPercent: 0.42, observedAt: closeAt(5) })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reports the close it used, so the card can say how old it is', async () => {
    const read = vi.fn(async (input: { asOf: string }) => input.asOf === asOf
      ? snapshot(closeAt(0), { state: 'unavailable', reason: 'missing' })
      : snapshot(closeAt(10), { state: 'available', value: 1.1 }))
    const leg = await createPriceLegReader(read)(asOf)
    expect(leg?.observedAt).toBe(closeAt(10))
  })

  it('stops stepping back once the window is older than half an hour', async () => {
    const read = vi.fn(async () => snapshot(closeAt(0), { state: 'unavailable', reason: 'missing' }))
    expect(await createPriceLegReader(read)(asOf)).toBeUndefined()
    expect(read).toHaveBeenCalledTimes(priceLegStepBackMs.length)
  })

  it('throws when no snapshot came back, so the card says the read failed rather than "no data"', async () => {
    const read = vi.fn(async () => undefined)
    await expect(createPriceLegReader(read)(asOf)).rejects.toThrow('cross-asset snapshot unavailable')
  })

  it('surfaces a throwing reader instead of swallowing it', async () => {
    const read = vi.fn(async () => { throw new Error('store-unavailable') })
    await expect(createPriceLegReader(read)(asOf)).rejects.toThrow('store-unavailable')
  })

  it('keeps the steps five minutes apart and inside half an hour', () => {
    expect([...priceLegStepBackMs].every(step => step % (5 * 60_000) === 0)).toBe(true)
    expect(Math.max(...priceLegStepBackMs)).toBeLessThanOrEqual(30 * 60_000)
  })
})
