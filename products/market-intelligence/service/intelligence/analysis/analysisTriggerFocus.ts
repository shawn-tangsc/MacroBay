import type { AnalysisConclusion, SnapshotChange } from '../../../contracts/marketAnalysisContracts'
import type { ValidatedAnalysisModelOutput } from './analysisOutputValidator'

/**
 * What counts as "answering the thing that triggered this run".
 *
 * A conclusion that cites evidence and then talks about the macro backdrop is the failure this
 * rule exists for: the run was triggered by one change, the answer never returned to it. The
 * criterion is deliberately two-part and closed-set: the trigger's evidence must be cited in a
 * *reasoning* section (the `knownFacts` inventory does not count — that is registration, not an
 * answer), and the trigger's own subject must appear in the conclusion's change or causal chain.
 *
 * A snapshot with no change record, or one whose change facts were cut before freezing, never ran
 * this rule. Those runs are not "passed strict" — mixing them into the denominator is how a pass
 * rate becomes quietly inflated.
 */
export type TriggerFocusMode =
  | 'strict'
  | 'reference-only'
  | 'not-applicable:no-change'
  | 'not-applicable:truncated'
  | 'not-applicable:empty-set'

export type TriggerFocusFact = Readonly<{
  factId: string
  evidenceRefId: string
  /** Display name carried by the change record; absent on snapshots frozen before it existed. */
  subject?: string
}>

export type TriggerFocus = Readonly<{
  mode: TriggerFocusMode
  /** The whole set is the trigger source; any one of them answering is enough. */
  triggers: readonly TriggerFocusFact[]
}>

type FocusFact = Readonly<{ factId: string; evidenceRefId?: string | null; subject?: string }>

type FocusSnapshot = Readonly<{
  change?: SnapshotChange
  facts: readonly FocusFact[]
}>

export function resolveTriggerFocus(snapshot: FocusSnapshot): TriggerFocus {
  const changes = snapshot.change?.facts ?? []
  if (changes.length === 0) return { mode: 'not-applicable:no-change', triggers: [] }
  const frozen = new Map(snapshot.facts.map(fact => [fact.factId, fact]))
  const triggers: TriggerFocusFact[] = []
  let missing = 0
  for (const change of changes) {
    const fact = frozen.get(change.factId)
    if (!fact) {
      missing += 1
      continue
    }
    const evidenceRefId = fact.evidenceRefId ?? ''
    // A change fact whose evidence was dropped is the same defect as a cut fact: the rule cannot
    // judge an answer to a question it no longer holds.
    if (!evidenceRefId) {
      missing += 1
      continue
    }
    triggers.push({
      factId: change.factId,
      evidenceRefId,
      ...((change.subject ?? fact.subject) ? { subject: change.subject ?? fact.subject } : {})
    })
  }
  if (missing > 0) return { mode: 'not-applicable:truncated', triggers: [] }
  if (triggers.length === 0) return { mode: 'not-applicable:empty-set', triggers: [] }
  // One trigger without a display name degrades the whole run to the reference check: the strict
  // half cannot be evaluated for it, and silently dropping that fact would shrink the source set.
  const strict = triggers.every(trigger => typeof trigger.subject === 'string' && trigger.subject.length > 0)
  return { mode: strict ? 'strict' : 'reference-only', triggers }
}

/** Evidence cited where the conclusion reasons, not where it lists what it knows. */
function reasoningEvidenceIds(output: ValidatedAnalysisModelOutput): ReadonlySet<string> {
  return new Set([
    ...output.supportingEvidence.map(claim => claim.evidenceRefId),
    ...output.marketReaction.flatMap(claim => claim.evidenceRefIds),
    ...output.directions.flatMap(entry => entry.evidenceRefIds)
  ])
}

/**
 * True when the conclusion failed to answer the trigger.
 *
 * Any single trigger satisfying both halves is enough; picking "the first" or "the most severe"
 * would give "who triggered this" two answers.
 */
export function missingTriggerFocus(output: ValidatedAnalysisModelOutput, focus: TriggerFocus): boolean {
  if (focus.mode.startsWith('not-applicable')) return false
  const cited = reasoningEvidenceIds(output)
  const prose = `${output.conclusion.change}\n${output.conclusion.causalChain}`
  const strict = focus.mode === 'strict'
  return !focus.triggers.some(trigger => {
    if (!cited.has(trigger.evidenceRefId)) return false
    if (!strict) return true
    // Substring of the data's own subject on purpose: a synonym or token match is what a model
    // slips past, while the evidence citation is a closed set it cannot invent.
    return typeof trigger.subject === 'string' && trigger.subject.length > 0 && prose.includes(trigger.subject)
  })
}

/** Kept for callers that only hold a conclusion; the criterion never reads anything else. */
export type TriggerFocusConclusion = Pick<AnalysisConclusion, 'change' | 'causalChain'>
