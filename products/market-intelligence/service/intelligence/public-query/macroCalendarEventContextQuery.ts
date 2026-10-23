/**
 * The fact context for one calendar event the reader selected in the panel.
 *
 * Reading only: it answers "what does the system hold about this event as of this instant", so the
 * agent can quote numbers instead of searching its memory. Coverage is decided here, before any
 * query is written, because the failure that matters is reporting sparse facts as a full context —
 * the agent would then read a gap as evidence.
 */

export const macroCalendarEventContextPolicy = Object.freeze({
  version: 'marketIntelligenceMacroCalendarEventContext.v1',
  /**
   * Below this many facts there is no context to reason from: the block would be one number and a
   * lot of silence, which reads as "nothing happened" rather than "we could not read it".
   */
  minimumFacts: 3
})

/** `month` is required: a 0xRouter event key (`market-observation-<hex>`) carries no month, so the
 *  read cannot be scoped without it. The card knows it (it groups rows by month) and passes it. */
export type MacroCalendarEventContextQuery = Readonly<{ eventKey: string; month: string; asOf: string }>

export type MacroCalendarEventContextCoverage = 'available' | 'partial' | 'unavailable'

/** Exact keys, non-empty strings, ISO instants: the same shape the other public queries accept. */
export function isMacroCalendarEventContextQuery(value: unknown): value is MacroCalendarEventContextQuery {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).sort().join(',') !== 'asOf,eventKey,month') return false
  return typeof candidate.eventKey === 'string' && candidate.eventKey.length > 0
    && typeof candidate.month === 'string' && /^\d{4}-\d{2}$/.test(candidate.month)
    && typeof candidate.asOf === 'string' && Number.isFinite(Date.parse(candidate.asOf))
}

/**
 * What the reader (and the agent) is told about how complete this context is.
 *
 * `unavailable` means we hold nothing for the event; `partial` means we hold something but not
 * enough to reason from — either too few facts, or the event's own published values are missing,
 * which is exactly the case where a model tends to fill the gap with the expectation.
 */
export function coverageOf(input: Readonly<{ factCount: number; eventValuesPresent: boolean }>, policy = macroCalendarEventContextPolicy): MacroCalendarEventContextCoverage {
  if (input.factCount <= 0) return 'unavailable'
  if (input.factCount < policy.minimumFacts) return 'partial'
  return input.eventValuesPresent ? 'available' : 'partial'
}

/** One fact about the selected event, as the agent will read it. */
export type MacroCalendarEventContextFact = Readonly<{ factId: string; metric: string; value: string }>

/** Everything the agent is told about why this context is or is not complete. */
export type MacroCalendarEventContextCaveat = 'no-facts-held' | 'insufficient-facts' | 'event-values-missing'

export type MacroCalendarEventContextResult = Readonly<{
  facts: readonly MacroCalendarEventContextFact[]
  evidenceRefs: readonly string[]
  coverage: MacroCalendarEventContextCoverage
  caveats: readonly MacroCalendarEventContextCaveat[]
}>

/**
 * Assembles the answer from facts already read, so the rule and the wording are testable without a
 * database. The adapter that reads them — as-of visibility, the evidence snapshot builder, fact
 * identity — is wired separately and must pass `eventValuesPresent` honestly: it is the one input
 * the coverage rule cannot verify by itself.
 */
export function assembleMacroCalendarEventContext(input: Readonly<{
  facts: readonly MacroCalendarEventContextFact[]
  evidenceRefs: readonly string[]
  eventValuesPresent: boolean
}>, policy = macroCalendarEventContextPolicy): MacroCalendarEventContextResult {
  const coverage = coverageOf({ factCount: input.facts.length, eventValuesPresent: input.eventValuesPresent }, policy)
  const caveats: MacroCalendarEventContextCaveat[] = []
  if (coverage === 'unavailable') caveats.push('no-facts-held')
  else if (input.facts.length < policy.minimumFacts) caveats.push('insufficient-facts')
  if (coverage !== 'unavailable' && !input.eventValuesPresent) caveats.push('event-values-missing')
  return { facts: input.facts, evidenceRefs: input.evidenceRefs, coverage, caveats }
}
