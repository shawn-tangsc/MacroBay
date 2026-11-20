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
  /**
   * 这个月到底读没读到。空 facts 有两种意思——这个事件没有事实，或这个月根本没读成；
   * 适配层据它决定要不要回一份「读不到」，而不是把空列表当成「没有」。
   */
  readState: (query: MacroCalendarEventContextQuery) => Promise<'available' | 'unavailable'>
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
  const [state, monthFacts, monthRefs] = await Promise.all([reads.readState(query), reads.readFacts(query), reads.readEvidenceRefs(query)])
  if (state === 'unavailable') {
    // 「读不到」不是「没有事实」：回一份带专用 caveat 的不可用结果，调用方据此说「日历读不到」。
    return assembleMacroCalendarEventContext({ facts: [], evidenceRefs: [], eventValuesPresent: false, unreadable: true })
  }
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
