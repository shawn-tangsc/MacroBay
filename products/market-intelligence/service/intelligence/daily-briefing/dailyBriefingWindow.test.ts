import { describe, expect, it } from 'vitest'

import { briefingWindow } from './dailyBriefingWindow'

/**
 * The window's zone, when the reader's setting is unusable.
 *
 * The old code read an empty or broken zone as UTC: a reader in Beijing then got a window eight hours
 * off their day, with no error, no log and nothing on screen to say so. The window now falls back to
 * the machine's zone and reports where it came from, so the page can say what happened.
 */
describe('briefing window zone source', () => {
  const AS_OF = '2026-10-30T10:00:00.000Z'
  const SHANGHAI = 'Asia/Shanghai'

  it('uses the settings zone when it is valid, and says so', () => {
    const window = briefingWindow(AS_OF, SHANGHAI, { generationTime: '07:00', windowHours: 24 })

    expect(window?.zoneSource).toBe('settings')
    // 07:00 in Asia/Shanghai is the previous day 23:00Z.
    expect(window?.date).toBe('2026-10-30')
    expect(window?.windowEnd).toBe('2026-10-29T23:00:00.000Z')
    expect(window?.windowStart).toBe('2026-10-28T23:00:00.000Z')
  })

  it('keeps the current issue on the previous day before the generation hour', () => {
    // 03:21 local on 11-04, cutoff 07:00: the reader is still inside the 11-03 issue — the one the
    // list shows first and the one a generate lands on. Both paths read this function, so the two
    // dates cannot diverge.
    const window = briefingWindow('2026-11-03T19:21:25.083Z', SHANGHAI, { generationTime: '07:00', windowHours: 24 })

    expect(window?.date).toBe('2026-11-03')
    expect(window?.windowEnd).toBe('2026-11-02T23:00:00.000Z')
  })

  it('falls back to the machine zone, not UTC, when the setting is empty', () => {
    const window = briefingWindow(AS_OF, '', { generationTime: '07:00', windowHours: 24 }, SHANGHAI)
    const utc = briefingWindow(AS_OF, 'UTC', { generationTime: '07:00', windowHours: 24 })

    expect(window?.zoneSource).toBe('system')
    expect(window?.windowEnd).toBe('2026-10-29T23:00:00.000Z')
    // The whole point: the fallback must not be the UTC answer wearing a different label.
    expect(window?.windowEnd).not.toBe(utc?.windowEnd)
    expect(utc?.windowEnd).toBe('2026-10-30T07:00:00.000Z')
  })

  it('treats a broken zone name the same way as an empty one', () => {
    const window = briefingWindow(AS_OF, 'Mars/Olympus', { generationTime: '07:00', windowHours: 24 }, SHANGHAI)

    expect(window?.zoneSource).toBe('system')
    expect(window?.windowEnd).toBe('2026-10-29T23:00:00.000Z')
  })

  it('keeps the source out of the stored window arithmetic', () => {
    const settings = briefingWindow(AS_OF, SHANGHAI, { generationTime: '07:00', windowHours: 24 })
    const fallback = briefingWindow(AS_OF, '', { generationTime: '07:00', windowHours: 24 }, SHANGHAI)

    // Same instant, different reason: only the source differs.
    expect(fallback?.windowStart).toBe(settings?.windowStart)
    expect(fallback?.windowEnd).toBe(settings?.windowEnd)
    expect(fallback?.windowHours).toBe(settings?.windowHours)
  })
})
