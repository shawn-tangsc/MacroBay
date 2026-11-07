/**
 * Which consensus a calendar event's surprise is judged against, and — when there is none — **why**
 * there is none.
 *
 * The official three (Fed / BEA / BLS) publish no consensus, so an official event's only possible
 * expectation is the market observation linked to it. That leaves three different situations that
 * used to collapse into one sentence, and the collapse is the bug:
 *
 * - `undefined` — there is **no observation** to read. Nobody has looked.
 * - `null` — an observation exists but its consensus field is **unreadable**. We looked and could
 *   not read it.
 * - `{ displayValue }` — a value.
 *
 * "We have no expectation" and "we could not read the expectation" are different states for the
 * reader, and they must stay different here, before any sentence is written: a resolver that merges
 * them makes the copy lie in a way no test can see.
 *
 * The value and its source are returned together on purpose: showing one side's number under the
 * other side's label is the failure this shape exists to prevent.
 */
export type CalendarConsensusValue = Readonly<{ displayValue: string }>

/**
 * `undefined` = no observation. `null` = an observation whose value we cannot read.
 */
export type CalendarConsensusInput = CalendarConsensusValue | null | undefined

export type CalendarConsensusResolution =
  | Readonly<{ state: 'value'; value: string; source: 'official' | 'market' }>
  /** No observation on either side: nobody has looked. */
  | Readonly<{ state: 'missing' }>
  /** An observation exists but its value is unreadable: we looked and could not read it. */
  | Readonly<{ state: 'unreadable'; source: 'official' | 'market' }>

export function resolveCalendarConsensus(
  official: CalendarConsensusInput,
  market: CalendarConsensusInput
): CalendarConsensusResolution {
  const officialValue = readDisplayValue(official)
  if (officialValue !== undefined) return Object.freeze({ state: 'value' as const, value: officialValue, source: 'official' as const })
  const marketValue = readDisplayValue(market)
  if (marketValue !== undefined) return Object.freeze({ state: 'value' as const, value: marketValue, source: 'market' as const })
  // A value on either side wins above; from here on nothing was readable. Any input that is not
  // `undefined` **is** an observation — `null` with no value, or an object whose value is blank —
  // so it makes the answer "unreadable". Only two `undefined` inputs mean "nothing to read".
  if (official !== undefined) return Object.freeze({ state: 'unreadable' as const, source: 'official' as const })
  if (market !== undefined) return Object.freeze({ state: 'unreadable' as const, source: 'market' as const })
  return Object.freeze({ state: 'missing' as const })
}

/** A blank display value is absence, not a number that happens to be empty. */
function readDisplayValue(value: CalendarConsensusInput): string | undefined {
  const text = value?.displayValue.trim()
  return text === undefined || text === '' ? undefined : text
}
