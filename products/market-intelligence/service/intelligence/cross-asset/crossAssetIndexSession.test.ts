import { describe, expect, it } from 'vitest'

import { crossAssetRowMarketState, usCashSessionState } from './crossAssetIndexSession'

/** Wall clock in New York, rendered by the same timezone database the session policy reads. */
const at = (iso: string) => Date.parse(iso)

describe('cross-asset US cash session clock', () => {
  it('opens at 09:30 and closes at 16:00 New York in summer time', () => {
    // July: New York is UTC−4, so the session is 13:30–20:00 UTC.
    expect(usCashSessionState(at('2026-07-15T13:29:59.000Z'))).toBe('closed')
    expect(usCashSessionState(at('2026-07-15T13:30:00.000Z'))).toBe('open')
    expect(usCashSessionState(at('2026-07-15T19:59:59.000Z'))).toBe('open')
    expect(usCashSessionState(at('2026-07-15T20:00:00.000Z'))).toBe('closed')
  })

  it('moves with daylight saving instead of a fixed Beijing window', () => {
    // January: New York is UTC−5, so the same session is 14:30–21:00 UTC. A hard-coded 21:30–04:00
    // Beijing window would call 14:00 UTC open in January and be wrong by an hour all winter.
    expect(usCashSessionState(at('2026-01-15T14:29:59.000Z'))).toBe('closed')
    expect(usCashSessionState(at('2026-01-15T14:30:00.000Z'))).toBe('open')
    expect(usCashSessionState(at('2026-01-15T20:59:59.000Z'))).toBe('open')
    expect(usCashSessionState(at('2026-01-15T21:00:00.000Z'))).toBe('closed')
  })

  it('reads the Beijing evening and early morning the way the reader experiences them', () => {
    // 2026-07-15 21:30 Beijing (summer) is the opening bell; 04:00 Beijing is the close.
    expect(usCashSessionState(at('2026-07-15T21:30:00+08:00'))).toBe('open')
    expect(usCashSessionState(at('2026-07-15T23:59:00+08:00'))).toBe('open')
    expect(usCashSessionState(at('2026-07-16T04:00:00+08:00'))).toBe('closed')
    expect(usCashSessionState(at('2026-07-16T09:00:00+08:00'))).toBe('closed')
  })

  it('closes for the weekend and refuses to answer for an unreadable instant', () => {
    expect(usCashSessionState(at('2026-07-18T15:00:00.000Z'))).toBe('closed') // Saturday
    expect(usCashSessionState(at('2026-07-19T15:00:00.000Z'))).toBe('closed') // Sunday
    expect(usCashSessionState(at('2026-07-20T13:30:00.000Z'))).toBe('open') // Monday
    expect(usCashSessionState(Number.NaN)).toBe('unavailable')
    expect(usCashSessionState(-1)).toBe('unavailable')
  })

  it('describes the instrument that is answering the row, not the clock alone', () => {
    const closedSession = at('2026-07-16T02:00:00.000Z') // 22:00 New York, market shut
    // The real index row: shut, with the last closed bar still on screen.
    expect(crossAssetRowMarketState('index', 'real', closedSession, true)).toBe('closed')
    // The tokenised proxy trades around the clock, so while it answers the row there is no closure to
    // report — the row's own label is what distinguishes it from the index.
    expect(crossAssetRowMarketState('index', 'proxy', closedSession, true)).toBe('open')
    // The crypto contracts never report a session at all.
    expect(crossAssetRowMarketState('btc', 'real', closedSession, true)).toBe('open')
    // No reading: there is no session to describe, which is what the panel prints 未接入 for.
    expect(crossAssetRowMarketState('index', 'unavailable', closedSession, false)).toBe('unavailable')
  })
})
