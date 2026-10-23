import { describe, expect, it, vi } from 'vitest'

import { requestMarketAnalysisForCalendarUpdate } from './marketAnalysisCalendarUpdateTrigger'

const batch = (results: readonly { storedRows?: number; state?: string }[]) => results

describe('calendar update to analysis trigger', () => {
  it('requests one analysis when the calendar stored new observations', async () => {
    const requestRefresh = vi.fn(async () => ({ itemId: 'item-1', queued: true as const }))
    const result = await requestMarketAnalysisForCalendarUpdate(
      batch([{ state: 'succeeded', storedRows: 386 }]),
      { requestRefresh }
    )

    expect(requestRefresh).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ decision: 'requested', storedRows: 386 })
  })

  it('asks for an evaluation even when the refresh stored nothing, and lets the gate decide', async () => {
    const requestRefresh = vi.fn(async () => ({ itemId: 'item-1', queued: true as const }))
    const result = await requestMarketAnalysisForCalendarUpdate(
      batch([{ state: 'succeeded', storedRows: 0 }, { state: 'succeeded', storedRows: 0 }]),
      { requestRefresh }
    )

    // Stored rows are no longer the trigger condition: a re-collection stores rows too, which
    // is why the old rule spent a model call every thirty minutes. The gate owns significance.
    expect(requestRefresh).toHaveBeenCalledTimes(1)
    // Zero stored rows is not a decision any more: the gate decides significance.
    expect(result).toEqual({ decision: 'requested', storedRows: 0 })
  })

  it('does nothing when no refresh was attempted at all', async () => {
    const requestRefresh = vi.fn(async () => ({ itemId: 'item-1', queued: true as const }))
    expect(await requestMarketAnalysisForCalendarUpdate(batch([]), { requestRefresh }))
      .toEqual({ decision: 'skipped', reasonCode: 'no-refresh-attempted' })
    expect(requestRefresh).not.toHaveBeenCalled()
  })

  it('adds up rows across locales and descriptors', async () => {
    const requestRefresh = vi.fn(async () => ({ itemId: 'item-1', queued: true as const }))
    const result = await requestMarketAnalysisForCalendarUpdate(
      batch([{ state: 'succeeded', storedRows: 386 }, { state: 'succeeded', storedRows: 52 }, { state: 'unavailable' }]),
      { requestRefresh }
    )

    expect(result).toEqual({ decision: 'requested', storedRows: 438 })
  })

  it('reports a declined request as skipped instead of throwing', async () => {
    const requestRefresh = vi.fn(async () => { throw new Error('analysis-already-available') })
    const result = await requestMarketAnalysisForCalendarUpdate(
      batch([{ state: 'succeeded', storedRows: 12 }]),
      { requestRefresh }
    )

    expect(result).toEqual({ decision: 'skipped', reasonCode: 'producer-declined' })
  })
})
