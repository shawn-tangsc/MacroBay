import { crossAssetPolicy } from './crossAssetPolicy'

/**
 * The session clock of the instrument behind a row.
 *
 * Only the Nasdaq 100 has one. It is read in New York local time, where the cash session is
 * 09:30–16:00 Monday to Friday: a fixed Beijing window would be wrong half the year, because New
 * York keeps daylight saving and Beijing does not — 21:30–04:00 Beijing is the *summer* reading of
 * the same session. The timezone database answers this, not an offset we would have to maintain.
 *
 * Two honest limits, both stated rather than papered over:
 *
 * 1. Exchange holidays are not modelled. On a holiday the clock reads `open` while no new bar can
 *    arrive, so the row shows the last closed bar and its windows stay `—`. The numbers never claim
 *    a bar that does not exist.
 * 2. The state describes the *market*, never the feed. A closed session with a healthy feed is
 *    `closed`; a healthy feed during a session is `open`. It is never used to decide which source
 *    answers the row — that is `selectCrossAssetIndexSource`, and it deliberately ignores the clock.
 */
export const crossAssetSessionPolicy = Object.freeze({
  timeZone: 'America/New_York',
  openMinuteOfDay: 9 * 60 + 30, closeMinuteOfDay: 16 * 60,
  tradingWeekdays: Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']),
  /** Which rows are session-limited. A crypto contract trades every day of the week. */
  sessionRows: Object.freeze({ [crossAssetPolicy.index.row]: 'us-cash-session' } as const)
})

export type CrossAssetMarketState = 'open' | 'closed' | 'unavailable'

function clockOf(atMs: number): { weekday: string; minuteOfDay: number } | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: crossAssetSessionPolicy.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(atMs))
    const value = (type: string) => parts.find(part => part.type === type)?.value
    const weekday = value('weekday')
    const hour = Number(value('hour'))
    const minute = Number(value('minute'))
    if (typeof weekday !== 'string' || !Number.isInteger(hour) || !Number.isInteger(minute)) return undefined
    return { weekday, minuteOfDay: hour * 60 + minute }
  } catch {
    // An environment without the timezone database cannot answer this. `closed` is the safe reading:
    // it shows the last closed bar and never implies a bar is coming.
    return undefined
  }
}

/** `open` inside the cash session, `closed` outside it, and `unavailable` for an unreadable clock. */
export function usCashSessionState(atMs: number): CrossAssetMarketState {
  if (!Number.isSafeInteger(atMs) || atMs < 0) return 'unavailable'
  const clock = clockOf(atMs)
  if (!clock) return 'unavailable'
  if (!(crossAssetSessionPolicy.tradingWeekdays as readonly string[]).includes(clock.weekday)) return 'closed'
  return clock.minuteOfDay >= crossAssetSessionPolicy.openMinuteOfDay && clock.minuteOfDay < crossAssetSessionPolicy.closeMinuteOfDay
    ? 'open' : 'closed'
}

/**
 * The state of one row, read from the instrument that is actually answering it.
 *
 * A session-limited row shows the cash session only while the real index answers it; while the
 * tokenised proxy does, the row describes a contract that trades continuously and must not claim the
 * Nasdaq 100 is shut. A row with no reading has no session to describe at all.
 */
export function crossAssetRowMarketState(
  row: string,
  source: 'real' | 'proxy' | 'unavailable',
  atMs: number,
  hasReading: boolean
): CrossAssetMarketState {
  if (!hasReading || !Object.hasOwn(crossAssetPolicy.assets, row)) return 'unavailable'
  if (row !== crossAssetPolicy.index.row || source === 'proxy') return 'open'
  return usCashSessionState(atMs)
}
