import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { briefingDataFactIds } from './dailyBriefingDataSelection'

/**
 * The words a refused draft is answered with.
 *
 * A refusal exists to be acted on: the repair round can only fix what the sentence names. These
 * helpers turn a defect into that sentence, and they are kept apart from the validators so the rule
 * (what counts as invalid) and the report (what we say about it) never have to change together.
 */

/** What a value actually was, in the few characters a repair sentence can spend on it. */
export function describeValue(value: unknown): string {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `a list of ${value.length}`
  if (typeof value === 'string') return `"${value.slice(0, 40)}"`
  return typeof value
}

export function textFieldDefect(field: string, value: unknown, maximum: number): string {
  if (typeof value !== 'string') return `${field}: must be text (got ${describeValue(value)})`
  const length = value.trim().length
  if (length === 0) return `${field}: must not be empty`
  return `${field}: at most ${maximum} characters (got ${length})`
}

export function listFieldDefect(field: string, value: unknown, maximumItems: number, maximumLength: number): string {
  if (!Array.isArray(value)) return `${field}: must be a list of at most ${maximumItems} items (got ${describeValue(value)})`
  if (value.length === 0) return `${field}: at least one item is required`
  if (value.length > maximumItems) return `${field}: at most ${maximumItems} items (got ${value.length})`
  const overlong = value.findIndex((entry) => typeof entry !== 'string' || entry.trim().length === 0 || entry.trim().length > maximumLength)
  return `${field}[${overlong}]: each item must be text of at most ${maximumLength} characters`
}

const maximumEvidenceRefs = 8

/** Every id this edition can be cited by; a refusal is only useful if it can say which one failed. */
export function knownEvidenceIds(document: DailyBriefingDocument): ReadonlySet<string> {
  return new Set<string>([
    ...document.news.items.map((item) => `news:${item.itemId}`),
    ...document.news.macro.map((item) => `macro:${item.eventKey}`),
    ...briefingDataFactIds(document)
  ])
}

/**
 * Why a citation list was refused, in words the repair round can act on: which entry is unknown, or
 * how many were offered against the cap. A bare refusal taught the model nothing, so it repeated the
 * same answer until the run ran out of attempts.
 */
export function evidenceReferenceDefect(value: unknown, document: DailyBriefingDocument): string {
  if (!Array.isArray(value)) return 'evidenceRefs: list the news:/macro:/data: ids the call rests on.'
  if (value.length > maximumEvidenceRefs) {
    return `evidenceRefs: cite at most ${maximumEvidenceRefs} facts (got ${value.length}); keep the few the call actually rests on.`
  }
  const known = knownEvidenceIds(document)
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 200) {
      return 'evidenceRefs: every entry must be one news:/macro:/data: id printed in FACTS.'
    }
    if (!known.has(entry)) return `evidenceRefs: "${entry}" is not a fact in this brief; use an id printed in FACTS.`
  }
  return 'evidenceRefs: check the ids against FACTS.'
}
