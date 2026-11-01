import { describe, expect, it } from 'vitest'

import { fromWallClock, toWallClock, wallClockIsAmbiguous } from './economicCalendarModel'

describe('wall clock text in a zone and the instant it names', () => {
  it('formats an instant the way an input needs it, per zone', () => {
    // 12:30Z is 08:30 in New York during daylight saving and 20:30 in Beijing.
    expect(toWallClock('2026-10-14T12:30:00.000Z', 'America/New_York')).toBe('2026-10-14T08:30')
    expect(toWallClock('2026-10-14T12:30:00.000Z', 'Asia/Shanghai')).toBe('2026-10-14T20:30')
    // And an hour later in winter: the same zone, a different UTC hour for the same wall clock.
    expect(toWallClock('2026-12-10T13:30:00.000Z', 'America/New_York')).toBe('2026-12-10T08:30')
    expect(toWallClock('2026-12-10T13:30:00.000Z', 'UTC')).toBe('2026-12-10T13:30')
    expect(toWallClock('not-an-instant', 'UTC')).toBeUndefined()
  })

  it('turns wall clock text back into the instant, across both sides of a DST change', () => {
    // Summer: 08:30 New York is 12:30Z.
    expect(fromWallClock('2026-10-14T08:30', 'America/New_York')).toBe('2026-10-14T12:30:00.000Z')
    // Winter: the same wall clock is 13:30Z. A fixed offset would get one of these wrong.
    expect(fromWallClock('2026-12-10T08:30', 'America/New_York')).toBe('2026-12-10T13:30:00.000Z')
    expect(fromWallClock('2026-10-14T20:30', 'Asia/Shanghai')).toBe('2026-10-14T12:30:00.000Z')
    // UTC is treated as an ordinary zone, not as the absence of one.
    expect(fromWallClock('2026-10-14T13:30', 'UTC')).toBe('2026-10-14T13:30:00.000Z')
  })

  it('round-trips every instant it formats', () => {
    // 06:00Z is 01:00 in New York on the autumn change-over, a wall clock that happens twice; the
    // ambiguous case has its own test below rather than being smuggled through this one.
    for (const instant of ['2026-10-14T12:30:00.000Z', '2026-12-10T13:30:00.000Z', '2026-03-08T07:00:00.000Z', '2026-11-01T07:00:00.000Z']) {
      for (const zone of ['America/New_York', 'Asia/Shanghai', 'UTC', 'Europe/London']) {
        const text = toWallClock(instant, zone)
        expect(text, `${instant} in ${zone}`).toBeDefined()
        expect(fromWallClock(text as string, zone), `${text} in ${zone}`).toBe(instant)
        expect(wallClockIsAmbiguous(text as string, zone), `${text} in ${zone}`).toBe(false)
      }
    }
  })

  it('says so when a wall clock names two instants, instead of silently picking one', () => {
    // 01:00 on 2026-11-01 exists twice in New York: 05:00Z (EDT) and 06:00Z (EST).
    expect(wallClockIsAmbiguous('2026-11-01T01:00', 'America/New_York')).toBe(true)
    expect(fromWallClock('2026-11-01T01:00', 'America/New_York')).toBe('2026-11-01T05:00:00.000Z')
    // The same wall clock in UTC, where nothing is ambiguous, is answered plainly.
    expect(wallClockIsAmbiguous('2026-11-01T01:00', 'UTC')).toBe(false)
    expect(wallClockIsAmbiguous('2026-10-14T08:30', 'America/New_York')).toBe(false)
  })

  it('refuses text that names no moment instead of guessing one', () => {
    for (const bad of ['', '2026-10-14', '2026-10-14 08:30', '14/10/2026T08:30', '2026-13-01T08:30', '2026-10-14T25:00', 'nonsense']) {
      expect(fromWallClock(bad, 'America/New_York'), bad).toBeUndefined()
    }
    // An unknown zone is refused too: no guessing UTC, no guessing the machine.
    expect(fromWallClock('2026-10-14T08:30', 'Mars/Olympus_Mons')).toBeUndefined()
  })

  it('resolves a spring gap forward, and hands back the text that will be shown', () => {
    // 02:30 on the spring-forward day does not exist in New York. The platform conversion lands on
    // the first instant after the gap; the editor must then show 03:00 rather than the 02:30 the
    // reader typed, or the screen and the store disagree.
    expect(fromWallClock('2026-03-08T02:30', 'America/New_York')).toBe('2026-03-08T07:00:00.000Z')
    expect(toWallClock('2026-03-08T07:00:00.000Z', 'America/New_York')).toBe('2026-03-08T03:00')
  })

  it('reads a display-zone wall clock without consulting the machine zone', () => {
    // The old editor formatted the instant on the reader's machine. These are the exact pairs that
    // were off by the machine's offset: UTC display on a Shanghai machine, and the reverse.
    expect(toWallClock('2026-11-01T00:05:00.000Z', 'UTC')).toBe('2026-11-01T00:05')
    expect(fromWallClock('2026-11-01T00:05', 'UTC')).toBe('2026-11-01T00:05:00.000Z')
    expect(toWallClock('2026-11-01T00:05:00.000Z', 'Asia/Shanghai')).toBe('2026-11-01T08:05')
    expect(fromWallClock('2026-11-01T08:05', 'Asia/Shanghai')).toBe('2026-11-01T00:05:00.000Z')
  })
})
