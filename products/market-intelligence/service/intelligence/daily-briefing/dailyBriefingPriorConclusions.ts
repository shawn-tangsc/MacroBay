import type {
  AnalysisConclusionDirection,
  AnalysisSummary,
  TimelineEntry
} from '../../../contracts/marketAnalysisContracts'
import type {
  BriefingPriorConclusion,
  BriefingPriorConclusionConfidence,
  DailyBriefingDocument
} from '../../../contracts/dailyBriefing'

/**
 * How many earlier conclusions one prompt may carry.
 *
 * The packet is an input budget, not a history: eight conclusions is enough to cover a 24-72 hour
 * window (an analysis conclusion per regime change plus one or two brief editions), and the cap
 * keeps the prompt's FACTS block bounded. The newest conclusions win; older ones fall away.
 */
export const priorConclusionPolicy = Object.freeze({
  maximumItems: 8,
  maximumSummaryLength: 400,
  maximumRationaleLength: 400,
  maximumEvidenceRefs: 8
})

type AnalysisTimelineCandidate = Pick<
  TimelineEntry,
  'id' | 'kind' | 'status' | 'occurredAt' | 'summaryRef' | 'direction'
>

type StoredBriefingEdition = Readonly<{
  date: string
  generatedAt?: string
  document: DailyBriefingDocument
}>

/**
 * Reads the analysis conclusions published inside [windowStart, asOf].
 *
 * The timeline is the only ordering the store guarantees; the cutoff is enforced here as well as by
 * the caller so a future-dated node can never become a "previous" conclusion. A summary that has no
 * readable text is dropped instead of entering the prompt as an empty claim.
 */
export function collectAnalysisPriorConclusions(input: Readonly<{
  entries: readonly AnalysisTimelineCandidate[]
  windowStart: string
  asOf: string
  readSummary: (summaryId: string) => AnalysisSummary | undefined
}>): readonly BriefingPriorConclusion[] {
  const start = Date.parse(input.windowStart)
  const end = Date.parse(input.asOf)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return Object.freeze([])
  const seen = new Set<string>()
  const conclusions: BriefingPriorConclusion[] = []
  for (const entry of input.entries) {
    if (entry.status !== 'published') continue
    if (entry.kind !== 'analysis' && entry.kind !== 'review') continue
    if (!entry.summaryRef || seen.has(entry.summaryRef)) continue
    const occurredAt = Date.parse(entry.occurredAt)
    if (!Number.isFinite(occurredAt) || occurredAt < start || occurredAt > end) continue
    seen.add(entry.summaryRef)
    const summary = input.readSummary(entry.summaryRef)
    if (!summary) continue
    // A node can be stamped inside the window while its conclusion was written after the cutoff
    // (a backfill, a re-run). Only what existed at the cutoff may enter the packet.
    const createdAt = Date.parse(summary.createdAt)
    if (Number.isFinite(createdAt) && createdAt > end) continue
    const structured = summary.conclusion
    const summaryText = clipText(structured?.summary ?? summary.eventAssessment ?? '', priorConclusionPolicy.maximumSummaryLength)
    if (!summaryText) continue
    const rationale = clipText(
      structured?.change || structured?.causalChain || '',
      priorConclusionPolicy.maximumRationaleLength
    )
    conclusions.push(Object.freeze({
      id: `analysis:${summary.id}`,
      source: 'analysis' as const,
      observedAt: isInstant(summary.createdAt) ? summary.createdAt : entry.occurredAt,
      asOf: entry.occurredAt,
      direction: structured?.direction ?? entry.direction ?? 'undecided',
      confidence: summaryConfidence(summary),
      summary: summaryText,
      ...(rationale ? { rationale } : {}),
      evidenceRefs: Object.freeze([...(summary.evidenceRefs ?? [])]
        .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
        .slice(0, priorConclusionPolicy.maximumEvidenceRefs))
    }))
  }
  return Object.freeze(conclusions)
}

/**
 * Reads the daily-brief conclusions stored inside the window.
 *
 * A fact-layer edition (`synthesis: 'fallback'`) or a failed editorial is not an AI conclusion and
 * is skipped: feeding it back would launder the same copy the synthesis is meant to replace. The
 * edition being generated has its windowEnd at the current cutoff and is excluded by the half-open
 * interval, so a regeneration never synthesizes from itself.
 */
export function collectBriefingPriorConclusions(input: Readonly<{
  editions: readonly StoredBriefingEdition[]
  windowStart: string
  asOf: string
}>): readonly BriefingPriorConclusion[] {
  const start = Date.parse(input.windowStart)
  const end = Date.parse(input.asOf)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return Object.freeze([])
  const conclusions: BriefingPriorConclusion[] = []
  for (const edition of input.editions) {
    const document = edition.document
    const conclusion = document.conclusion
    if (!conclusion || document.provenance.editorialFailure !== undefined) continue
    if (conclusion.synthesis === 'fallback') continue
    const windowEnd = Date.parse(document.edition.windowEnd)
    if (!Number.isFinite(windowEnd) || windowEnd < start || windowEnd >= end) continue
    const observedAt = isInstant(document.edition.generatedAt)
      ? document.edition.generatedAt
      : isInstant(edition.generatedAt ?? '') ? edition.generatedAt! : document.edition.windowEnd
    // A late generation for an earlier window was not available at this edition's cutoff; using it
    // would let the brief "remember" a verdict that did not exist yet.
    if (Date.parse(observedAt) > end) continue
    const summary = clipText(conclusion.summary, priorConclusionPolicy.maximumSummaryLength)
    if (!summary) continue
    const coreTension = conclusion.synthesisDetail?.coreTension
    const rationale = clipText(
      coreTension || conclusion.change || conclusion.topSignal?.rationale || '',
      priorConclusionPolicy.maximumRationaleLength
    )
    const refs = [
      ...(conclusion.synthesisDetail?.evidenceRefs ?? []),
      ...document.citations.map((citation) => citation.refId)
    ]
    conclusions.push(Object.freeze({
      id: `daily-brief:${edition.date}:${document.edition.locale}`,
      source: 'daily-brief' as const,
      observedAt,
      asOf: document.edition.windowEnd,
      direction: conclusion.direction,
      confidence: briefingConfidence(conclusion.synthesisDetail?.confidence ?? conclusion.topSignal?.confidence),
      summary,
      ...(rationale ? { rationale } : {}),
      evidenceRefs: Object.freeze([...new Set(refs)]
        .filter((ref) => typeof ref === 'string' && ref.length > 0)
        .slice(0, priorConclusionPolicy.maximumEvidenceRefs))
    }))
  }
  return Object.freeze(conclusions)
}

/**
 * One ordered, deduplicated list, oldest first.
 *
 * Ordering is semantic: the editor has to read the window as a sequence to see a flip, so the list
 * is chronological even though the packet's other facts are relevance-ranked. When the cap bites,
 * the newest conclusions are kept and the oldest drop.
 */
export function mergePriorConclusions(
  groups: readonly (readonly BriefingPriorConclusion[])[]
): readonly BriefingPriorConclusion[] {
  const byId = new Map<string, BriefingPriorConclusion>()
  for (const group of groups) {
    for (const conclusion of group) {
      if (!byId.has(conclusion.id)) byId.set(conclusion.id, conclusion)
    }
  }
  return Object.freeze([...byId.values()]
    .sort(comparePriorConclusions)
    .slice(-priorConclusionPolicy.maximumItems))
}

export function comparePriorConclusions(left: BriefingPriorConclusion, right: BriefingPriorConclusion): number {
  const leftAt = Date.parse(left.observedAt)
  const rightAt = Date.parse(right.observedAt)
  if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) return leftAt - rightAt
  return left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id)
}

export type PriorConclusionConflict = 'none' | 'divergence' | 'flip'

/**
 * Whether the window's conclusions disagree, and whether they changed side over time.
 *
 * `undecided` and `mixed` are uncertainty, not a stance: they never create a conflict by themselves
 * (otherwise every cautious note would force a "divergence" sentence). A stance that changes between
 * two differently-timed conclusions is a `flip`; simultaneous disagreement is a `divergence`.
 */
export function detectPriorConclusionConflict(
  conclusions: readonly BriefingPriorConclusion[]
): PriorConclusionConflict {
  const stances = [...conclusions]
    .sort(comparePriorConclusions)
    .filter((conclusion) => isStance(conclusion.direction))
  const distinct = new Set(stances.map((conclusion) => conclusion.direction))
  if (distinct.size < 2) return 'none'
  for (let index = 1; index < stances.length; index++) {
    const previous = stances[index - 1]!
    const current = stances[index]!
    if (previous.direction !== current.direction && previous.observedAt !== current.observedAt) return 'flip'
  }
  return 'divergence'
}

/**
 * Copy detection runs on normalized characters, so punctuation, casing and whitespace edits cannot
 * disguise a copied conclusion. A short quotation is allowed; a whole summary (or most of it) is not.
 */
export function isCopiedConclusionText(output: string, candidates: readonly string[]): boolean {
  const normalizedOutput = normalizeConclusionText(output)
  if (normalizedOutput.length < 12) return false
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeConclusionText(candidate)
    if (normalizedCandidate.length < 12) continue
    if (normalizedOutput === normalizedCandidate) return true
    const shorter = normalizedOutput.length <= normalizedCandidate.length ? normalizedOutput : normalizedCandidate
    const longer = shorter === normalizedOutput ? normalizedCandidate : normalizedOutput
    if (shorter.length >= 20 && longer.includes(shorter)) return true
    if (normalizedOutput.length < 24) continue
    const threshold = Math.max(hasCjk(normalizedCandidate) ? 16 : 28, Math.floor(shorter.length * 0.6))
    if (longestCommonSubstringLength(normalizedOutput, normalizedCandidate) >= threshold) return true
  }
  return false
}

export function normalizeConclusionText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '')
}

/** A missing or malformed summary can only be `undecided`; it is never treated as a directional call. */
export function isConclusionDirection(value: unknown): value is AnalysisConclusionDirection {
  return value === 'bullish' || value === 'bearish' || value === 'range' || value === 'mixed' || value === 'undecided'
}

function isStance(direction: AnalysisConclusionDirection): boolean {
  return direction === 'bullish' || direction === 'bearish' || direction === 'range'
}

function summaryConfidence(summary: AnalysisSummary): BriefingPriorConclusionConfidence {
  const rank: Readonly<Record<string, number>> = { high: 3, medium: 2, low: 1 }
  const best = [...(summary.directions ?? [])]
    .filter((entry) => (rank[entry.confidence] ?? 0) > 0)
    .sort((left, right) => (rank[right.confidence] ?? 0) - (rank[left.confidence] ?? 0))[0]
  return briefingConfidence(best?.confidence)
}

function briefingConfidence(value: unknown): BriefingPriorConclusionConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'unknown'
}

function clipText(value: string, maximum: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > maximum ? text.slice(0, maximum).trimEnd() : text
}

function isInstant(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
}

/** O(min(n,m)) memory: enough for two bounded conclusion sentences. */
function longestCommonSubstringLength(left: string, right: string): number {
  if (left.length === 0 || right.length === 0) return 0
  const short = left.length <= right.length ? left : right
  const long = short === left ? right : left
  let previous = new Uint16Array(short.length + 1)
  let current = new Uint16Array(short.length + 1)
  let best = 0
  for (let row = 1; row <= long.length; row++) {
    for (let column = 1; column <= short.length; column++) {
      if (long[row - 1] === short[column - 1]) {
        const value = previous[column - 1]! + 1
        current[column] = value
        if (value > best) best = value
      } else {
        current[column] = 0
      }
    }
    const swap = previous
    previous = current
    current = swap
    current.fill(0)
  }
  return best
}
