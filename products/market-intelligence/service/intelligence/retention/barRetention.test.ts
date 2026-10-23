import { describe, expect, it } from 'vitest'

import { barRetentionCutoffs, barRetentionKeeps, barRetentionPolicy } from './barRetention'

const hour = 3_600_000
const day = 24 * hour
const nowMs = Date.UTC(2026, 9, 15, 12, 0, 0)

describe('the bar retention policy', () => {
  it('never thins or deletes the newest eight days, and caps everything at thirty', () => {
    const { thinBeforeMs, deleteBeforeMs } = barRetentionCutoffs(nowMs)

    // The floor is the analytic need: the seven-day return divides against the bar at exactly the same
    // instant a week earlier, read by identity — so the hot window has to reach further than a week.
    expect(nowMs - thinBeforeMs).toBe(8 * day)
    expect(nowMs - thinBeforeMs).toBeGreaterThan(7 * day)
    // The cap is a cap: newer than the hot edge, and the cold tier is what lies between them.
    expect(nowMs - deleteBeforeMs).toBe(30 * day)
    expect(deleteBeforeMs).toBeLessThan(thinBeforeMs)
    // A five-minute bar inside the hot window is never a candidate for either pass.
    expect(nowMs - 5 * 60_000).toBeGreaterThan(thinBeforeMs)
  })

  it('keeps the bar that ends on the hour, and only that one', () => {
    expect(barRetentionKeeps(Date.UTC(2026, 9, 15, 12, 0, 0))).toBe(true)
    expect(barRetentionKeeps(Date.UTC(2026, 9, 15, 12, 0, 0) + 5 * 60_000)).toBe(false)
    expect(barRetentionKeeps(Date.UTC(2026, 9, 15, 12, 0, 0) + 55 * 60_000)).toBe(false)
    // A stamp that is not a time at all is not a bar to keep: the store's own validity rule, repeated
    // here so a malformed row cannot become the surviving hour.
    expect(barRetentionKeeps(-1)).toBe(false)
    expect(barRetentionKeeps(Number.NaN)).toBe(false)
    expect(barRetentionPolicy.hourMs).toBe(hour)
  })
})
