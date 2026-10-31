import type {
  BriefingConclusionSynthesis,
  BriefingPriorConclusion,
  DailyBriefingDocument
} from '../../../contracts/dailyBriefing'
import {
  detectPriorConclusionConflict,
  isConclusionDirection,
  isCopiedConclusionText
} from './dailyBriefingPriorConclusions'
import { briefingDataFactIds } from './dailyBriefingDataSelection'

export type ConclusionSynthesisFailure =
  | 'invalid-conclusion-synthesis'
  | 'missing-conclusion-synthesis'
  | 'copied-conclusion'
  | 'missing-conclusion-evidence'
  | 'missing-conclusion-divergence'

export type ConclusionSynthesisValidation =
  | Readonly<{ ok: true; value: BriefingConclusionSynthesis }>
  | Readonly<{ ok: false; failureCode: ConclusionSynthesisFailure; detail?: string }>

const maximumSummaryLength = 600
const maximumFieldLength = 300
const maximumEvidenceRefs = 8
const maximumListItems = 4
const maximumRationaleLength = 200

/**
 * Validates the editorial model's synthesis of the window's prior conclusions.
 *
 * The rules encode the product promise: the daily conclusion is a new verdict, not a copy; it stands
 * on frozen facts, not on the conclusions it is summarizing; and a window whose AI views disagreed
 * must say so instead of averaging them into a directionless middle.
 */
export function validateConclusionSynthesis(
  raw: unknown,
  document: DailyBriefingDocument,
  priorConclusions: readonly BriefingPriorConclusion[]
): ConclusionSynthesisValidation {
  if (priorConclusions.length === 0) return fail('missing-conclusion-synthesis')
  if (raw === undefined) return fail('missing-conclusion-synthesis')
  if (!isRecord(raw)) return fail('invalid-conclusion-synthesis')
  const expected = ['direction', 'confidence', 'summary', 'regimeChange', 'confirmed', 'refuted', 'coreTension', 'whatWouldChange', 'evidenceRefs']
  if (Object.keys(raw).length !== expected.length || !expected.every((key) => key in raw)) return fail('invalid-conclusion-synthesis')
  if (!isConclusionDirection(raw.direction)) return fail('invalid-conclusion-synthesis')
  if (raw.confidence !== 'high' && raw.confidence !== 'medium' && raw.confidence !== 'low') return fail('invalid-conclusion-synthesis')
  const summary = boundedText(raw.summary, maximumSummaryLength)
  if (summary === false) return fail('invalid-conclusion-synthesis')
  const regimeChange = boundedText(raw.regimeChange, maximumFieldLength)
  if (regimeChange === false) return fail('invalid-conclusion-synthesis')
  const coreTension = boundedText(raw.coreTension, maximumFieldLength)
  if (coreTension === false) return fail('invalid-conclusion-synthesis')
  const whatWouldChange = boundedText(raw.whatWouldChange, maximumFieldLength)
  if (whatWouldChange === false) return fail('invalid-conclusion-synthesis')
  const confirmed = textList(raw.confirmed)
  if (confirmed === false) return fail('invalid-conclusion-synthesis')
  const refuted = textList(raw.refuted)
  if (refuted === false) return fail('invalid-conclusion-synthesis')
  const evidenceRefs = evidenceReferences(raw.evidenceRefs, document)
  if (evidenceRefs === false) return fail('invalid-conclusion-synthesis')
  if (evidenceRefs.length === 0) return fail('missing-conclusion-evidence')
  // The conclusion is prose about the window's claims; it can never copy them word for word. The
  // fact-layer conclusion is included because on a one-conclusion window it *is* the prior claim.
  const copyCandidates = [
    ...priorConclusions.flatMap((conclusion) => [
      conclusion.summary,
      ...(conclusion.rationale ? [conclusion.rationale] : [])
    ]),
    ...(document.conclusion ? [document.conclusion.summary, document.conclusion.translation ?? ''] : [])
  ].filter((text) => text.trim().length > 0)
  if (isCopiedConclusionText(summary, copyCandidates)) return fail('copied-conclusion', 'summary')
  if (isCopiedConclusionText(regimeChange, copyCandidates)) return fail('copied-conclusion', 'regimeChange')
  // Conflict is a fact about the window, not a tone choice. If the AI views disagreed or flipped,
  // the synthesis has to name it; silently landing between them is the average this rejects.
  const conflict = detectPriorConclusionConflict(priorConclusions)
  if (conflict !== 'none') {
    const prose = [summary, regimeChange, coreTension, whatWouldChange, ...confirmed, ...refuted].join('\n')
    if (!acknowledgesDivergence(prose)) return fail('missing-conclusion-divergence', conflict)
  }
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      direction: raw.direction,
      confidence: raw.confidence,
      summary,
      regimeChange,
      confirmed: Object.freeze(confirmed.map((item) => item.trim())),
      refuted: Object.freeze(refuted.map((item) => item.trim())),
      coreTension,
      whatWouldChange,
      evidenceRefs: Object.freeze(evidenceRefs)
    })
  })
}

export function acknowledgesDivergence(text: string): boolean {
  return /分歧|翻转|反转|转向|相左|相反|冲突|反复|divergen|flip|revers|disagree|conflict|contradict|split|turned/i.test(text)
}

/**
 * Evidence has to be a fact id the frozen document actually carries. Prior conclusions are
 * deliberately not in this space: their assertions are claims, and citing a claim as evidence is
 * exactly the laundering the synthesis exists to stop.
 */
function evidenceReferences(
  value: unknown,
  document: DailyBriefingDocument
): readonly string[] | false {
  if (!Array.isArray(value) || value.length > maximumEvidenceRefs) return false
  const known = new Set<string>([
    ...document.news.items.map((item) => `news:${item.itemId}`),
    ...document.news.macro.map((item) => `macro:${item.eventKey}`),
    ...briefingDataFactIds(document)
  ])
  const refs: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 200) return false
    if (!known.has(entry)) return false
    if (!refs.includes(entry)) refs.push(entry)
  }
  return Object.freeze(refs)
}

function textList(value: unknown): readonly string[] | false {
  if (!Array.isArray(value) || value.length > maximumListItems) return false
  const items: string[] = []
  for (const entry of value) {
    const text = boundedText(entry, maximumRationaleLength)
    if (text === false) return false
    items.push(text)
  }
  return Object.freeze(items)
}

function boundedText(value: unknown, maximum: number): string | false {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (text.length === 0 || text.length > maximum) return false
  return text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fail(failureCode: ConclusionSynthesisFailure, detail?: string): ConclusionSynthesisValidation {
  return Object.freeze({ ok: false as const, failureCode, ...(detail ? { detail } : {}) })
}
