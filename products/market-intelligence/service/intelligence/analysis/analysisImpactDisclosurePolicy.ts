import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { eventKeyOfEvidenceRef } from './macroEvidenceRef'

/**
 * Keeps the facts that explain a triggered change inside the context budget.
 *
 * The gate can approve a run for a change whose supporting facts are then truncated away by
 * the 160-fact cap (macro facts come first, but a busy month still fills it), which would ask
 * the model to "interpret the change in detail" while handing it nothing to interpret.
 *
 * This reserves a slice of the budget for the facts belonging to the triggering events and
 * fills the remainder in the existing order, so the reserve can only reorder *within* the
 * budget — it never grows the context, and with no triggers the order and the result are
 * exactly what they were before.
 */

export const analysisImpactDisclosurePolicy = Object.freeze({
  version: 'marketAnalysisImpactDisclosurePolicy.v1',
  /** Facts about the triggering events that survive truncation, budget permitting. */
  reservedFactsForTriggeredEvents: 24,
  includeConsensusMetric: true
})

/** A fact belongs to a triggering event when its evidence reference names that event. */
export function isFactForTriggeredEvent(fact: AgentFact, triggeredEventKeys: ReadonlySet<string>): boolean {
  if (triggeredEventKeys.size === 0) return false
  const eventKey = eventKeyOfEvidenceRef(fact.evidenceRefId)
  return eventKey !== null && triggeredEventKeys.has(eventKey)
}

export function applyReservedFacts(sorted: readonly AgentFact[], triggeredEventKeys: ReadonlySet<string>, maximum: number,
  reserved = analysisImpactDisclosurePolicy.reservedFactsForTriggeredEvents,
  /**
   * Minimum facts every domain keeps. A global budget alone loses whole domains: adding one domain
   * pushed funding and sentiment out of the context entirely, and a conclusion cannot explain a move
   * without the leverage and sentiment evidence it was told to consider.
   */
  domainFloor = 0): readonly AgentFact[] {
  if (maximum <= 0) return []
  if (sorted.length <= maximum) return sorted.slice(0, maximum)
  const kept: AgentFact[] = []
  const seen = new Set<AgentFact>()
  const take = (fact: AgentFact): void => {
    if (kept.length >= maximum || seen.has(fact)) return
    kept.push(fact)
    seen.add(fact)
  }
  // What explains a triggered change keeps its place at the front, as it always has — and only up
  // to the reserve: the rest of the budget belongs to the other domains, so a triggering event
  // cannot fill the context with its own rows.
  let triggeredKept = 0
  const deferred = new Set<AgentFact>()
  for (const fact of sorted) {
    if (!isFactForTriggeredEvent(fact, triggeredEventKeys)) continue
    if (triggeredKept >= reserved) {
      deferred.add(fact)
      continue
    }
    const before = kept.length
    take(fact)
    if (kept.length > before) triggeredKept += 1
  }
  if (domainFloor > 0) {
    const perDomain = new Map<string, number>()
    for (const fact of sorted) {
      const used = perDomain.get(fact.domain) ?? 0
      if (used >= domainFloor) continue
      if (seen.has(fact)) continue
      take(fact)
      perDomain.set(fact.domain, used + 1)
    }
  }
  for (const fact of sorted) if (!deferred.has(fact)) take(fact)
  return kept
}
