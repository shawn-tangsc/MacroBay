import { describe, expect, it } from 'vitest'

import { analysisSchedulePolicy, isScheduledSlotTriggerKey, slotForTriggerKey, triggerKeyForSlot } from './analysisSchedulePolicy'
import { dueSessionSlots, slotInstantsWithin, type SessionSlotInstant } from './analysisSlotCoverage'

/** A local wall-clock instant, so the assertions hold in whatever timezone the suite runs in. */
const local = (year: number, month: number, day: number, hour: number, minute = 0) => new Date(year, month - 1, day, hour, minute)

const at = (instant: SessionSlotInstant) => new Date(instant.at)
const label = (instant: SessionSlotInstant) => `${instant.slot}@${new Date(instant.atMs).toISOString()}`

describe('session slot instants', () => {
  it('places every slot at its own local wall-clock hour', () => {
    const instants = slotInstantsWithin(local(2026, 10, 14, 9))
    expect(instants.length).toBeGreaterThan(0)
    for (const instant of instants) {
      const expected = analysisSchedulePolicy.slots.find(slot => slot.slot === instant.slot)!.hour
      // Local hour, not UTC: the whole point of the schedule is the reader's clock. DST shifts in
      // every real zone happen in the small hours, so 0/8/16 stay on their hour.
      expect(at(instant).getHours(), label(instant)).toBe(expected)
      expect(at(instant).getMinutes()).toBe(0)
    }
  })

  it('returns the window oldest first and never a slot in the future', () => {
    const now = local(2026, 10, 14, 9)
    const instants = slotInstantsWithin(now)
    expect(instants.map(instant => instant.atMs)).toEqual([...instants.map(instant => instant.atMs)].sort((a, b) => a - b))
    expect(instants.every(instant => instant.atMs <= now.getTime())).toBe(true)
    // 09:00 local: today's 08:00 has passed, today's 16:00 has not.
    expect(instants.filter(instant => instant.atMs === local(2026, 10, 14, 8).getTime())).toHaveLength(1)
    expect(instants.some(instant => instant.atMs === local(2026, 10, 14, 16).getTime())).toBe(false)
  })

  it('drops slots older than the catch-up window and keeps the ones inside it', () => {
    // 09:00: 08:00 today is 1h old, 00:00 today 9h, 16:00 yesterday 17h, 08:00 yesterday 25h.
    const instants = slotInstantsWithin(local(2026, 10, 14, 9))
    const times = instants.map(instant => instant.atMs)
    expect(times).toContain(local(2026, 10, 14, 8).getTime())
    expect(times).toContain(local(2026, 10, 14, 0).getTime())
    expect(times).toContain(local(2026, 10, 13, 16).getTime())
    expect(times).not.toContain(local(2026, 10, 13, 8).getTime())
  })
})

describe('due session slots', () => {
  it('asks for the newest unserved open only, never a backlog of older ones', () => {
    const due = dueSessionSlots({ now: local(2026, 10, 14, 9).toISOString(), isDelivered: () => false })
    // Three opens are inside the window (16:00 yesterday, 00:00 and 08:00 today); the reader's rule
    // is to analyse the newest session, not to replay the ones whose data has been superseded.
    expect(due).toHaveLength(1)
    expect(due.map(instant => instant.atMs)).toEqual([local(2026, 10, 14, 8).getTime()])
    // Just past the US open with everything unserved: the US open is the one that runs.
    const us = dueSessionSlots({ now: local(2026, 10, 14, 1).toISOString(), isDelivered: () => false })
    expect(us.map(instant => instant.slot)).toEqual(['us'])
  })

  it('stays quiet once the newest open is served, and never reaches back to an older one', () => {
    // The reader's rule again: a served 08:00 means this tick has nothing to do, even though 00:00
    // was never analysed. Catching that up would describe a session that is long over.
    const served = new Set([local(2026, 10, 14, 8).getTime()])
    expect(dueSessionSlots({
      now: local(2026, 10, 14, 9).toISOString(),
      isDelivered: instant => served.has(instant.atMs)
    })).toEqual([])
    // And once it is served there is nothing to do at all — this is what makes the tick idempotent.
    expect(dueSessionSlots({ now: local(2026, 10, 14, 9).toISOString(), isDelivered: () => true })).toEqual([])
  })

  it('gives up on the newest open when it was attempted and missed, rather than replaying it or falling back', () => {
    // Attempted at 08:00 and never succeeded: the window has closed, so the tick does nothing until
    // the next open instead of asking every fifteen minutes — and it does not fall back to 00:00.
    const due = dueSessionSlots({
      now: local(2026, 10, 14, 11).toISOString(),
      isDelivered: () => false,
      isAbandoned: instant => instant.atMs === local(2026, 10, 14, 8).getTime()
    })
    expect(due).toEqual([])
  })

  it('returns nothing for an unreadable clock instead of guessing', () => {
    expect(dueSessionSlots({ now: 'not-a-time', isDelivered: () => false })).toEqual([])
    expect(slotInstantsWithin(new Date('not-a-time'))).toEqual([])
  })
})

describe('slot trigger keys', () => {
  it('round-trips every slot and rejects anything else', () => {
    for (const slot of analysisSchedulePolicy.slots) {
      const key = triggerKeyForSlot(slot.slot)
      expect(key).toBe(`schedule.${slot.slot}.open`)
      expect(slotForTriggerKey(key)).toBe(slot.slot)
      expect(isScheduledSlotTriggerKey(key)).toBe(true)
    }
    for (const other of ['staleness.floor', 'manual.refresh', 'schedule.mars.open', 'schedule.asia', 'schedule..open']) {
      expect(slotForTriggerKey(other), other).toBeNull()
      expect(isScheduledSlotTriggerKey(other), other).toBe(false)
    }
  })
})
