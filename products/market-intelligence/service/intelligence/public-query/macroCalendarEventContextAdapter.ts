import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { eventKeyOfEvidenceRef } from '../analysis/macroEvidenceRef'
import { assembleMacroCalendarEventContext, type MacroCalendarEventContextFact, type MacroCalendarEventContextQuery, type MacroCalendarEventContextResult } from './macroCalendarEventContextQuery'

/**
 * Reads the facts for one selected calendar event.
 *
 * The readers are injected rather than imported so the filtering and honesty rules are testable
 * without a database, and so the wiring step is only about choosing the readers. Two of them are
 * the product's existing rules, deliberately not reimplemented here: `isVisibleAsOf` decides what
 * the system held at that instant, and facts keep the identity the analysis projection gives them.
 */

export type MacroCalendarEventContextReads = Readonly<{
  /** Facts for the event's month, as the analysis projection builds them (identities included). */
  readFacts: (query: MacroCalendarEventContextQuery) => Promise<readonly AgentFact[]>
  /** Evidence refs for the month; filtered here to the selected event. */
  readEvidenceRefs: (query: MacroCalendarEventContextQuery) => Promise<readonly string[]>
  /** The instant the system was asked about, for the as-of visibility rule. */
  isVisible: (visibleAt: string | undefined, asOf: string) => boolean
}>

function isThisEvent(fact: AgentFact, eventKey: string): boolean {
  return fact.subject === eventKey || fact.factId.includes(eventKey) || fact.sourceId === eventKey
}

/** The event's own published value, which is the one thing coverage cannot verify for itself. */
function eventValuesPresent(facts: readonly AgentFact[], eventKey: string): boolean {
  return facts.some(fact => isThisEvent(fact, eventKey) && fact.metric === 'actual' && String(fact.value ?? '').trim() !== '')
}

export async function macroCalendarEventContextFromReads(
  reads: MacroCalendarEventContextReads,
  query: MacroCalendarEventContextQuery
): Promise<MacroCalendarEventContextResult> {
  const [monthFacts, monthRefs] = await Promise.all([reads.readFacts(query), reads.readEvidenceRefs(query)])
  const visible = monthFacts.filter(fact => reads.isVisible(fact.observedAt ?? undefined, query.asOf))
  const mine = visible.filter(fact => isThisEvent(fact, query.eventKey))
  const facts: MacroCalendarEventContextFact[] = mine.map(fact => ({
    factId: fact.factId, metric: fact.metric, value: String(fact.value ?? '')
  }))
  return assembleMacroCalendarEventContext({
    facts,
    evidenceRefs: monthRefs.filter(ref => eventKeyOfEvidenceRef(ref) === query.eventKey),
    eventValuesPresent: eventValuesPresent(mine, query.eventKey)
  })
}
