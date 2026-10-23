import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { eventKeyOfEvidenceRef } from './macroEvidenceRef'
import { semanticKeyOf, type PreviousFactKey } from './significanceChangeMatcher'

/**
 * Rebuilds "what the model saw last time" from the previous snapshot's facts.
 *
 * The macro calendar replaces rows in place (delete then insert) and its as-of reads filter by
 * collection time, so querying an older instant cannot recover a previous value — the previous
 * snapshot is the only place it survives. This is also the honest baseline for the product
 * question: the gate should fire when something moved since the last conclusion, which is
 * exactly this comparison.
 *
 * Facts are keyed by the raw event key taken from their evidence reference, never by parsing
 * `factId`, whose sanitising turns the dots in official keys into dashes.
 */

export type PreviousSignificanceBaseline = Readonly<{
  values: ReadonlyMap<PreviousFactKey, string | null>
  asOf: string
}>

export function projectPreviousBaseline(snapshot: Readonly<{ facts: readonly AgentFact[]; asOf: string }> | undefined | null): PreviousSignificanceBaseline | null {
  if (!snapshot) return null
  const values = new Map<PreviousFactKey, string | null>()
  for (const fact of snapshot.facts) {
    if (fact.domain !== 'macro') continue
    const eventKey = eventKeyOfEvidenceRef(fact.evidenceRefId)
    // No evidence reference means no provable event identity: skip rather than guess one.
    if (eventKey === null) continue
    values.set(semanticKeyOf(fact.domain, fact.subject, fact.metric, eventKey), fact.value === null || fact.value === undefined ? null : String(fact.value))
  }
  return { values, asOf: snapshot.asOf }
}
