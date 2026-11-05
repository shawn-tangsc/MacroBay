import { describe, expect, it } from 'vitest'

import { briefingWindow, briefingWindowAtCutoff } from './dailyBriefingWindow'

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

  it('keeps the date on the reader’s calendar day, before the generation hour too', () => {
    // 03:21 本地 11-04、截止 07:00：日期就是 **11-04**（用户 2026-11-06 拍板：没有"当前期"这回事，
    // 没过点就是"今天还没有"）。窗口右端截到"现在"，不覆盖还没到的那一段。
    const window = briefingWindow('2026-11-03T19:21:25.083Z', SHANGHAI, { generationTime: '07:00', windowHours: 24 })

    expect(window?.date).toBe('2026-11-04')
    expect(window?.windowEnd).toBe('2026-11-03T19:21:25.083Z')
    expect(window?.windowStart).toBe('2026-11-02T19:21:25.083Z')
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

/**
 * A cutoff the reader picked is the cutoff — not "which scheduled edition it belongs to".
 *
 * The reported defect: choosing 08:00 in the manual dialog published the 07:00 edition, because the
 * schedule's own generation time was used as the window end and the chosen instant was ignored.
 */
describe('a chosen cutoff is the cutoff', () => {
  const CHOSEN = '2026-11-05T00:00:00.000Z' // 08:00 Asia/Shanghai on the 5th
  const SHANGHAI = 'Asia/Shanghai'

  it('uses the chosen instant as the window end, not the schedule time', () => {
    const scheduled = briefingWindow(CHOSEN, SHANGHAI, { generationTime: '07:00', windowHours: 24 })
    const chosen = briefingWindowAtCutoff(CHOSEN, SHANGHAI, { generationTime: '07:00', windowHours: 24 })

    // 这就是那个 bug 的形状：同一个瞬间走排期口径，窗口落在了 07:00。
    expect(scheduled?.windowEnd).toBe('2026-11-04T23:00:00.000Z')
    expect(chosen?.windowEnd).toBe('2026-11-05T00:00:00.000Z')
    expect(chosen?.date).toBe('2026-11-05')
    expect(chosen?.windowStart).toBe('2026-11-04T00:00:00.000Z')
    expect(chosen?.windowHours).toBe(24)
  })

  it('keeps the window length the dialog chose, and files the edition under the chosen local day', () => {
    const window = briefingWindowAtCutoff(CHOSEN, SHANGHAI, { generationTime: '07:00', windowHours: 12 })

    expect(window?.windowHours).toBe(12)
    expect(window?.windowStart).toBe('2026-11-04T12:00:00.000Z')
    expect(window?.date).toBe('2026-11-05')
  })

  it('refuses an unreadable cutoff instead of inventing one', () => {
    expect(briefingWindowAtCutoff('not-a-time', SHANGHAI)).toBeUndefined()
  })
})
