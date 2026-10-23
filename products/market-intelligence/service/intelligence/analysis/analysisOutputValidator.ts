import {
  MARKET_ANALYSIS_ERROR_CODES,
  isMarketAnalysisFiniteNumber,
  type AnalysisDirectionHorizon,
  type AnalysisScenarioHorizon,
  type DirectionAdvice,
  type FactClaim,
  type Hypothesis,
  type ReactionClaim,
  type EvidenceClaim,
  type Catalyst,
  type Scenario,
  type AgentFact,
  type AnalysisConclusion
} from '../../../contracts/marketAnalysisContracts'
import { isMarketReactionFact, marketAnalysisUnsafeOutputPolicy, marketAnalysisValidationPolicy } from './analysisConstants'
import { buildAnalysisReferenceMap, resolveAnalysisReferences } from './analysisReferenceHandles'

export type FrozenAnalysisEvidence = Readonly<{
  facts: readonly Pick<AgentFact, 'factId' | 'evidenceRefId' | 'metric' | 'comparability' | 'freshness'>[]
  evidenceRefs: readonly Pick<EvidenceClaim, 'evidenceRefId'>[]
}>

export type ValidatedAnalysisModelOutput = Readonly<{
  conclusion: AnalysisConclusion
  knownFacts: readonly FactClaim[]
  transmissionHypotheses: readonly Hypothesis[]
  marketReaction: readonly ReactionClaim[]
  supportingEvidence: readonly EvidenceClaim[]
  counterEvidence: readonly EvidenceClaim[]
  scenarios: readonly Scenario[]
  directions: readonly DirectionAdvice[]
  nextCatalysts: readonly Catalyst[]
  dataCaveats: readonly string[]
  evidenceRefs: readonly string[]
}>

/** A value that matched a prohibited pattern, named so the failure is diagnosable. */
export type AnalysisOutputRedaction = Readonly<{ path: string; pattern: string }>

/**
 * Which rule rejected an output.
 *
 * All three used to report the same `analysis-missing-evidence`, so a rejection could not be told
 * apart from a genuinely missing source: the reader was told to check intelligence sources when
 * the model had, say, attached a second evidence id to a fact claim. The rule is recorded as the
 * run's failure detail and printed as a diagnostic marker, and the prompt now states each rule
 * the model can actually break.
 */
export const analysisValidationRules = Object.freeze({
  unknownReference: 'unknown-reference',
  factEvidenceMismatch: 'fact-evidence-mismatch',
  ineligibleMarketReaction: 'ineligible-market-reaction',
  /** The three operation horizons are not all present, or one of them repeats. */
  directionHorizonsIncomplete: 'direction-horizons-incomplete',
  /** An operation direction cites evidence this snapshot does not hold. */
  directionEvidenceMismatch: 'direction-evidence-mismatch'
})

export type AnalysisValidationRule = typeof analysisValidationRules[keyof typeof analysisValidationRules]

export type AnalysisOutputValidationResult =
  | Readonly<{ ok: true; value: ValidatedAnalysisModelOutput; redactions: readonly AnalysisOutputRedaction[] }>
  | Readonly<{ ok: false; errorCode: typeof MARKET_ANALYSIS_ERROR_CODES.invalidJson | typeof MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema | typeof MARKET_ANALYSIS_ERROR_CODES.missingEvidence | typeof MARKET_ANALYSIS_ERROR_CODES.unsafeOutput; rule?: AnalysisValidationRule }>

function missingEvidence(rule: AnalysisValidationRule): AnalysisOutputValidationResult {
  return { ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence, rule }
}

const outputKeys = [
  'conclusion', 'knownFacts', 'transmissionHypotheses', 'marketReaction', 'supportingEvidence', 'counterEvidence',
  'scenarios', 'directions', 'nextCatalysts', 'dataCaveats', 'evidenceRefs'
] as const

/**
 * The conclusion as data: a language-neutral direction key plus prose fields. No markers, no
 * section labels, nothing to parse — which is why adding another reader language costs nothing here.
 */
function isConclusion(value: unknown): value is AnalysisConclusion {
  if (!isPlainRecord(value)) return false
  if (!hasExactKeys(value, ['direction', 'summary', 'change', 'causalChain', 'conditions', 'macro', 'evidenceStrength', 'dataGaps'])) return false
  return isDirectionKey(value.direction)
    && isBoundedText(value.summary)
    && isBoundedText(value.change)
    && isBoundedText(value.causalChain)
    && isBoundedTextCollection(value.conditions)
    && (value.macro === null || isBoundedText(value.macro))
    && (value.evidenceStrength === null || isBoundedText(value.evidenceStrength))
    && isBoundedTextCollection(value.dataGaps)
}

function isDirectionKey(value: unknown): value is AnalysisConclusion['direction'] {
  return typeof value === 'string'
    && (marketAnalysisValidationPolicy.analysisDirectionKeys as readonly string[]).includes(value)
}

export function validateAnalysisModelOutput(input: string, snapshot: FrozenAnalysisEvidence): AnalysisOutputValidationResult {
  if (utf8Length(input) > marketAnalysisValidationPolicy.maximumOutputBytes) return invalidSchema()

  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    return { ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidJson }
  }
  if (!hasExactKeys(value, outputKeys)) return invalidSchema()
  // A prohibited pattern is removed in place and recorded rather than failing the
  // whole run. Rejecting everything made a usable conclusion disappear because the
  // model cited a URL, and it left no record of what triggered the rule.
  const { value: safeValue, redactions } = redactUnsafeOutput(value)
  value = safeValue

  // `hasExactKeys` already established the shape, so the record fields are safe to read.
  const record = value as Record<string, unknown>
  if (!isConclusion(record.conclusion) ||
    !isFactClaims(record.knownFacts) ||
    !isHypotheses(record.transmissionHypotheses) ||
    !isReactionClaims(record.marketReaction) ||
    !isEvidenceClaims(record.supportingEvidence) ||
    !isEvidenceClaims(record.counterEvidence) ||
    !isScenarios(record.scenarios) ||
    !isDirections(record.directions) ||
    !isCatalysts(record.nextCatalysts) ||
    !isBoundedTextCollection(record.dataCaveats) ||
    !isNonEmptyStringCollection(record.evidenceRefs)) return invalidSchema()

  const factIds = new Set(snapshot.facts.map((fact) => fact.factId))
  const evidenceRefIds = new Set(snapshot.evidenceRefs.map((evidence) => evidence.evidenceRefId))
  // The model quotes short handles (`f12`, `e7`) instead of transcribing the stored encodings; the
  // real ids are put back before any reference rule runs, so what is validated and published is
  // exactly what the snapshot holds.
  const output = resolveAnalysisReferences(record as unknown as ValidatedAnalysisModelOutput, buildAnalysisReferenceMap(snapshot))
  // Every horizon must be answered for: a conclusion that speaks for one day and stays silent
  // about the month is not the answer the reader asked for, and the rule names itself so a
  // rejection is diagnosable.
  if (!hasCompleteDirectionHorizons(output.directions)) return invalidSchema(analysisValidationRules.directionHorizonsIncomplete)
  // The directions are checked first and by name: "the month's direction cites evidence this
  // snapshot does not hold" is a different defect from "some claim cites an unknown reference", and
  // the shared code alone could not tell them apart.
  if (!output.directions.flatMap(entry => entry.evidenceRefIds).every(reference => evidenceRefIds.has(reference))) {
    return missingEvidence(analysisValidationRules.directionEvidenceMismatch)
  }
  if (!hasKnownReferences(output, factIds, evidenceRefIds)) return missingEvidence(analysisValidationRules.unknownReference)
  const evidenceByFact = new Map(snapshot.facts.map(fact => [fact.factId, fact.evidenceRefId]))
  const matchesFacts = (ids: readonly string[], refs: readonly string[]): boolean => {
    const expected = ids.map(id => evidenceByFact.get(id))
    return expected.every(ref => !!ref && refs.includes(ref)) && refs.every(ref => expected.includes(ref))
  }
  if (!output.knownFacts.every(claim => matchesFacts([claim.factId], claim.evidenceRefIds)) ||
    !output.marketReaction.every(claim => matchesFacts(claim.factIds, claim.evidenceRefIds))) return missingEvidence(analysisValidationRules.factEvidenceMismatch)
  const reactionFactIds = new Set(snapshot.facts.filter(isMarketReactionFact).map(fact => fact.factId))
  if (!output.marketReaction.every(claim => claim.factIds.every(id => reactionFactIds.has(id)))) return missingEvidence(analysisValidationRules.ineligibleMarketReaction)

  return { ok: true, value: output, redactions }
}

export function formatMarketAnalysisAcceptanceMarker(details: Readonly<{
  valid: number
  rejectedUnsafe: number
  rejectedMissingEvidence: number
}>): string {
  return JSON.stringify({
    marker: 'MI_ANALYSIS_ACCEPTANCE',
    package: 'MI-A01',
    event: 'output-validator',
    status: 'pass',
    details
  })
}

/** A shape rejection, optionally naming the rule so the run's failure detail is diagnosable. */
function invalidSchema(rule?: AnalysisValidationRule): AnalysisOutputValidationResult {
  return { ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema, ...(rule ? { rule } : {}) }
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value) || Object.keys(value).length !== keys.length) return false
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function isFactClaims(value: unknown): value is FactClaim[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['factId', 'statement', 'evidenceRefIds']) &&
    isBoundedText(item.factId) && isBoundedText(item.statement) && isNonEmptyStringCollection(item.evidenceRefIds))
}

function isHypotheses(value: unknown): value is Hypothesis[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['statement', 'evidenceRefIds']) &&
    isBoundedText(item.statement) && isNonEmptyStringCollection(item.evidenceRefIds))
}

function isReactionClaims(value: unknown): value is ReactionClaim[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['statement', 'factIds', 'evidenceRefIds']) &&
    isBoundedText(item.statement) && isNonEmptyStringCollection(item.factIds) && isNonEmptyStringCollection(item.evidenceRefIds))
}

function isEvidenceClaims(value: unknown): value is EvidenceClaim[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['statement', 'evidenceRefId']) &&
    isBoundedText(item.statement) && isBoundedText(item.evidenceRefId))
}

function isScenarios(value: unknown): value is Scenario[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['asset', 'horizon', 'baseCase', 'conditions', 'invalidation', 'status']) &&
    (item.asset === 'BTC' || item.asset === 'ETH') &&
    isScenarioHorizon(item.horizon) &&
    isBoundedText(item.baseCase) &&
    isBoundedTextCollection(item.conditions) && item.conditions.length > 0 &&
    isBoundedText(item.invalidation) && item.status === marketAnalysisValidationPolicy.modelPredictionStatus)
}

/**
 * One entry per horizon, in the five terms the panel already colours, with a rationale and the
 * evidence it rests on. Shape only: the horizon set is checked separately so a missing horizon gets
 * its own failure detail instead of a generic schema rejection.
 */
function isDirections(value: unknown): value is DirectionAdvice[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['horizon', 'direction', 'rationale', 'confidence', 'evidenceRefIds']) &&
    isDirectionHorizon(item.horizon) &&
    isDirectionKey(item.direction) &&
    isBoundedText(item.rationale) &&
    typeof item.confidence === 'string' && (marketAnalysisValidationPolicy.directionConfidences as readonly string[]).includes(item.confidence) &&
    isNonEmptyStringCollection(item.evidenceRefIds))
}

function hasCompleteDirectionHorizons(directions: readonly DirectionAdvice[]): boolean {
  const horizons = directions.map(entry => entry.horizon)
  return horizons.length === marketAnalysisValidationPolicy.directionHorizons.length &&
    new Set(horizons).size === horizons.length &&
    marketAnalysisValidationPolicy.directionHorizons.every(horizon => horizons.includes(horizon))
}

function isCatalysts(value: unknown): value is Catalyst[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['statement', 'evidenceRefIds']) &&
    isBoundedText(item.statement) && isNonEmptyStringCollection(item.evidenceRefIds))
}

function hasKnownReferences(output: ValidatedAnalysisModelOutput, factIds: ReadonlySet<string>, evidenceRefIds: ReadonlySet<string>): boolean {
  const referencedFactIds = [
    ...output.knownFacts.map((claim) => claim.factId),
    ...output.marketReaction.flatMap((claim) => claim.factIds)
  ]
  const referencedEvidenceIds = [
    ...output.knownFacts.flatMap((claim) => claim.evidenceRefIds),
    ...output.transmissionHypotheses.flatMap((claim) => claim.evidenceRefIds),
    ...output.marketReaction.flatMap((claim) => claim.evidenceRefIds),
    ...output.supportingEvidence.map((claim) => claim.evidenceRefId),
    ...output.counterEvidence.map((claim) => claim.evidenceRefId),
    ...output.nextCatalysts.flatMap((claim) => claim.evidenceRefIds),
    ...output.directions.flatMap(entry => entry.evidenceRefIds),
    ...output.evidenceRefs
  ]
  return referencedFactIds.every((reference) => factIds.has(reference)) &&
    referencedEvidenceIds.every((reference) => evidenceRefIds.has(reference))
}

function isDirectionHorizon(value: unknown): value is AnalysisDirectionHorizon {
  return typeof value === 'string' && (marketAnalysisValidationPolicy.directionHorizons as readonly string[]).includes(value)
}

function isScenarioHorizon(value: unknown): value is AnalysisScenarioHorizon {
  return typeof value === 'string' && (marketAnalysisValidationPolicy.scenarioHorizons as readonly string[]).includes(value)
}

function isBoundedCollection(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= marketAnalysisValidationPolicy.maximumCollectionItems
}

function isStringCollection(value: unknown): value is string[] {
  return isBoundedCollection(value) && value.every(isBoundedText)
}

function isNonEmptyStringCollection(value: unknown): value is string[] {
  return isStringCollection(value) && value.length > 0
}

function isBoundedTextCollection(value: unknown): value is string[] {
  return isStringCollection(value)
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= marketAnalysisValidationPolicy.maximumFieldCharacters
}

/**
 * Removes prohibited patterns from every string in the payload, in place.
 *
 * The walker visits keys as well as values, so a pattern cannot survive by hiding in
 * a field name, and it reports each removal with its JSON path.
 */
function redactUnsafeOutput(value: unknown): { value: unknown; redactions: readonly AnalysisOutputRedaction[] } {
  const redactions: AnalysisOutputRedaction[] = []
  const walk = (item: unknown, path: string): unknown => {
    if (typeof item === 'string') {
      let next = item
      for (const pattern of marketAnalysisUnsafeOutputPolicy.prohibitedPatterns) {
        if (!pattern.test(next)) continue
        next = next.replace(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`), marketAnalysisUnsafeOutputPolicy.redactionToken)
        redactions.push({ path, pattern: pattern.source })
      }
      return next
    }
    if (Array.isArray(item)) return item.map((entry, index) => walk(entry, `${path}[${index}]`))
    if (isPlainRecord(item)) {
      const result: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(item)) {
        const safeKey = typeof key === 'string' ? walk(key, `${path}.${key}#key`) as string : key
        result[safeKey] = walk(entry, `${path}.${key}`)
      }
      return result
    }
    return item
  }
  return { value: walk(value, ''), redactions }
}

function containsUnsafeOutput(value: unknown): boolean {
  if (typeof value === 'string') return marketAnalysisUnsafeOutputPolicy.prohibitedPatterns.some((pattern) => pattern.test(value))
  if (Array.isArray(value)) return value.some(containsUnsafeOutput)
  if (isPlainRecord(value)) return Object.entries(value).some(([key, item]) => containsUnsafeOutput(key) || containsUnsafeOutput(item))
  return typeof value === 'number' && !isMarketAnalysisFiniteNumber(value)
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
}

/**
 * One-line record of what was removed from a model output.
 *
 * Without it a removed URL is invisible: the run succeeds and nobody can tell that
 * part of the conclusion was rewritten.
 */
export function formatUnsafeOutputRedaction(runId: string, redactions: readonly AnalysisOutputRedaction[]): string {
  const fields = [...new Set(redactions.map(redaction => redaction.path))]
  return JSON.stringify({ marker: 'MI_ANALYSIS_REDACTION', runId, count: redactions.length, fields })
}
