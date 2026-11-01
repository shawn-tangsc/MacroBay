import { describe, expect, it } from 'vitest'

import { axisTicks } from './positioningAxisTicks'

const hour = 3_600_000
const start = Date.parse('2026-10-28T23:00:00.000Z')

describe('positioning time axis', () => {
  it('labels five instants across a week', () => {
    const ticks = axisTicks(start, 7 * 24 * hour, 2)
    expect(ticks).toHaveLength(5)
    expect(ticks[0]!.at).toBe(start)
    expect(ticks.at(-1)!.at).toBe(start + 7 * 24 * hour)
    expect(ticks[0]!.first && ticks.at(-1)!.last).toBe(true)
  })

  it('gives every label its own instant, so the axis never draws the same time twice', () => {
    // The case that drew three identical labels: the data spans a couple of buckets, and a fixed
    // one-hour snap rounded all three interior marks onto the same hour.
    const ticks = axisTicks(start, 2 * hour, 3)
    const instants = ticks.map(tick => tick.at)
    expect(new Set(instants).size).toBe(instants.length)
  })

  it('keeps whole hours apart when the window is wide enough to snap', () => {
    const ticks = axisTicks(start, 24 * hour, 2)
    for (const tick of ticks.slice(1, -1)) expect(tick.at % hour).toBe(0)
  })

  it('has nothing to draw without a span', () => {
    expect(axisTicks(start, 0, 2)).toEqual([])
    expect(axisTicks(start, 24 * hour, 1)).toEqual([])
  })
})
