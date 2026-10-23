import type { EvidenceClaim } from '../../../contracts/marketAnalysisContracts'

/**
 * Short handles for the frozen snapshot's machine references.
 *
 * The prompt used to hand the model the real `factId`/`evidenceRefId` and require it to echo them
 * verbatim. They are long and near-identical — `mi-fact-capital-BTC-etf-net-flow-usd-2026-08-31T00-00-00-000Z-2026-08-31`
 * differs from its neighbours only by a date, and `query:0xrouter:capital:BTC:etf-net-flow-usd:2026-08-31T00:00:00.000Z:98`
 * only by a trailing counter. One mistyped character made the whole output unrunnable
 * (`unknown-reference`, the rule the rejected run reported), and a *plausible* mistake that lands
 * on a neighbouring id would have been accepted with the wrong evidence — silently.
 *
 * So the model now quotes `f12` / `e7` and this module puts the real ids back before anything is
 * validated or stored. The map is derived from the snapshot in a stable order, so the prompt and
 * the validator agree without persisting it, and the published summary still carries the real ids
 * the audit trail needs.
 */
export const analysisReferenceHandlePolicy = Object.freeze({
  version: 'marketAnalysisReferenceHandles.v1',
  factPrefix: 'f',
  evidencePrefix: 'e'
})

export type AnalysisReferenceMap = Readonly<{
  factHandleById: ReadonlyMap<string, string>
  evidenceHandleById: ReadonlyMap<string, string>
  factIdByHandle: ReadonlyMap<string, string>
  evidenceIdByHandle: ReadonlyMap<string, string>
}>

export function buildAnalysisReferenceMap(input: Readonly<{
  facts: readonly Readonly<{ factId: string }>[]
  evidenceRefs: readonly Pick<EvidenceClaim, 'evidenceRefId'>[]
}>): AnalysisReferenceMap {
  const factIds = [...new Set(input.facts.map(fact => fact.factId))].sort()
  const evidenceIds = [...new Set(input.evidenceRefs.map(ref => ref.evidenceRefId))].sort()
  const factHandleById = new Map(factIds.map((id, index) => [id, `${analysisReferenceHandlePolicy.factPrefix}${index + 1}`]))
  const evidenceHandleById = new Map(evidenceIds.map((id, index) => [id, `${analysisReferenceHandlePolicy.evidencePrefix}${index + 1}`]))
  return {
    factHandleById,
    evidenceHandleById,
    factIdByHandle: new Map([...factHandleById].map(([id, handle]) => [handle, id])),
    evidenceIdByHandle: new Map([...evidenceHandleById].map(([id, handle]) => [handle, id]))
  }
}

/**
 * Puts the real ids back into a model output that quoted handles.
 *
 * A value that is already a real id is kept as it is, so an output that echoed the stored encoding
 * (an older prompt, a hand-written fixture) still validates. A handle is matched after trimming and
 * lower-casing, because that is the kind of variation a model produces; anything unrecognised is
 * left alone on purpose, so the existing rules still report it as an unknown reference instead of
 * this function quietly inventing a reference.
 */
export function resolveAnalysisReferences<T>(output: T, map: AnalysisReferenceMap): T {
  const factIds = new Set(map.factHandleById.keys())
  const evidenceIds = new Set(map.evidenceHandleById.keys())
  const resolveFact = (value: string): string => resolveReference(value, map.factIdByHandle, factIds)
  const resolveEvidence = (value: string): string => resolveReference(value, map.evidenceIdByHandle, evidenceIds)
  const record = output as Record<string, unknown>

  const rewriteClaims = <C extends Record<string, unknown>>(claims: unknown, rewrite: (claim: C) => C): unknown =>
    Array.isArray(claims) ? claims.map(claim => (claim && typeof claim === 'object' ? rewrite(claim as C) : claim)) : claims

  return {
    ...output,
    ...(Array.isArray(record.knownFacts) ? {
      knownFacts: rewriteClaims(record.knownFacts, claim => ({
        ...claim,
        ...(typeof claim.factId === 'string' ? { factId: resolveFact(claim.factId) } : {}),
        ...(Array.isArray(claim.evidenceRefIds) ? { evidenceRefIds: claim.evidenceRefIds.map(entry => typeof entry === 'string' ? resolveEvidence(entry) : entry) } : {})
      }))
    } : {}),
    // The operation directions cite evidence by handle like every other claim: the model is told to
    // use `e1..eM`, so an unresolvable handle here would fail the whole conclusion.
    ...(Array.isArray(record.directions) ? {
      directions: rewriteClaims(record.directions, claim => ({
        ...claim,
        ...(Array.isArray(claim.evidenceRefIds) ? { evidenceRefIds: claim.evidenceRefIds.map(entry => typeof entry === 'string' ? resolveEvidence(entry) : entry) } : {})
      }))
    } : {}),
    ...(Array.isArray(record.transmissionHypotheses) ? {
      transmissionHypotheses: rewriteClaims(record.transmissionHypotheses, claim => ({
        ...claim,
        ...(Array.isArray(claim.evidenceRefIds) ? { evidenceRefIds: claim.evidenceRefIds.map(entry => typeof entry === 'string' ? resolveEvidence(entry) : entry) } : {})
      }))
    } : {}),
    ...(Array.isArray(record.marketReaction) ? {
      marketReaction: rewriteClaims(record.marketReaction, claim => ({
        ...claim,
        ...(Array.isArray(claim.factIds) ? { factIds: claim.factIds.map(entry => typeof entry === 'string' ? resolveFact(entry) : entry) } : {}),
        ...(Array.isArray(claim.evidenceRefIds) ? { evidenceRefIds: claim.evidenceRefIds.map(entry => typeof entry === 'string' ? resolveEvidence(entry) : entry) } : {})
      }))
    } : {}),
    ...(Array.isArray(record.supportingEvidence) ? {
      supportingEvidence: rewriteClaims(record.supportingEvidence, claim => ({ ...claim, ...(typeof claim.evidenceRefId === 'string' ? { evidenceRefId: resolveEvidence(claim.evidenceRefId) } : {}) }))
    } : {}),
    ...(Array.isArray(record.counterEvidence) ? {
      counterEvidence: rewriteClaims(record.counterEvidence, claim => ({ ...claim, ...(typeof claim.evidenceRefId === 'string' ? { evidenceRefId: resolveEvidence(claim.evidenceRefId) } : {}) }))
    } : {}),
    ...(Array.isArray(record.nextCatalysts) ? {
      nextCatalysts: rewriteClaims(record.nextCatalysts, claim => ({
        ...claim,
        ...(Array.isArray(claim.evidenceRefIds) ? { evidenceRefIds: claim.evidenceRefIds.map(entry => typeof entry === 'string' ? resolveEvidence(entry) : entry) } : {})
      }))
    } : {}),
    ...(Array.isArray(record.evidenceRefs) ? { evidenceRefs: record.evidenceRefs.map(entry => typeof entry === 'string' ? resolveEvidence(entry) : entry) } : {})
  } as T
}

function resolveReference(value: string, byHandle: ReadonlyMap<string, string>, knownIds: ReadonlySet<string>): string {
  if (knownIds.has(value)) return value
  return byHandle.get(value.trim().toLowerCase()) ?? value
}
