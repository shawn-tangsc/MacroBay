import type { AgentFact, EvidenceSnapshot, SnapshotChange, SnapshotFactChange } from '../../../contracts/marketAnalysisContracts'
import { readableAnalysisFactValue, readableAnalysisName, type MarketAnalysisReadableLocale, type MarketAnalysisReadableNames } from '../../../contracts/marketAnalysisReadableText'
import { analysisModelVocabulary } from './analysisModelVocabulary'

/**
 * Policy for the frozen "what changed" record on a snapshot.
 *
 * The product owner requirement is that every automatic conclusion states which
 * data moved. The predecessor is therefore compared fact by fact and sealed into
 * the snapshot, rather than derived at read time from a mutable table.
 */
export const snapshotChangePolicy = Object.freeze({
  /** Facts are matched by factId; the comparison covers the displayed value only. */
  comparedFields: ['value'] as const,
  /** Bounded output: an unusually large diff is truncated rather than stored whole. */
  maximumFactChanges: 200,
  emptySequence: 1
})

/** Builds the change record for `current`, given the predecessor in the same event group. */
export function computeSnapshotChange(input: Readonly<{
  current: Pick<EvidenceSnapshot, 'facts' | 'missingDomains' | 'caveats' | 'evidenceRefs'>
  previous?: Pick<EvidenceSnapshot, 'snapshotHash' | 'facts' | 'missingDomains' | 'caveats' | 'evidenceRefs'> & { change?: SnapshotChange }
}>): SnapshotChange {
  if (!input.previous) {
    return {
      sequence: snapshotChangePolicy.emptySequence,
      previousSnapshotHash: null,
      facts: [],
      missingDomainsAdded: [],
      missingDomainsRemoved: [],
      caveatsAdded: [],
      caveatsRemoved: [],
      evidenceRefsAdded: [],
      evidenceRefsRemoved: []
    }
  }
  // 舆情事实每轮都会随窗口整体替换：把它们算进 change，结论的「本次变化」就会被几十条
  // 新闻的进/出淹没，真正的行情变化反而被挤到 200 条上限之外。舆情本身仍在 facts 里，模型
  // 照样会读到；change 只回答「市场数据动了什么」。
  const changeable = (fact: AgentFact): boolean => fact.metric !== 'news-sentiment'
  const previousFacts = new Map(input.previous.facts.filter(changeable).map(fact => [fact.factId, fact]))
  const currentFacts = new Map(input.current.facts.filter(changeable).map(fact => [fact.factId, fact]))
  const factChanges: SnapshotFactChange[] = []
  for (const [factId, fact] of currentFacts) {
    const before = previousFacts.get(factId)
    if (!before) factChanges.push(changedFact('added', fact, undefined))
    else if (before.value !== fact.value) factChanges.push(changedFact('changed', fact, before.value))
  }
  for (const [factId, fact] of previousFacts) {
    if (!currentFacts.has(factId)) factChanges.push(changedFact('removed', fact, fact.value))
  }
  factChanges.sort((left, right) => left.factId.localeCompare(right.factId))
  const newsEvidence = new Set(
    [...input.current.facts, ...input.previous.facts]
      .filter(fact => fact.metric === 'news-sentiment' && fact.evidenceRefId)
      .map(fact => fact.evidenceRefId as string)
  )
  const previousEvidence = new Set(input.previous.evidenceRefs.map(ref => ref.evidenceRefId).filter(id => !newsEvidence.has(id)))
  const currentEvidence = new Set(input.current.evidenceRefs.map(ref => ref.evidenceRefId).filter(id => !newsEvidence.has(id)))
  const missingDomains = diffSets(input.current.missingDomains, input.previous.missingDomains)
  const caveats = diffSets(input.current.caveats, input.previous.caveats)
  return {
    sequence: (input.previous.change?.sequence ?? 0) + 1,
    previousSnapshotHash: input.previous.snapshotHash,
    facts: factChanges.slice(0, snapshotChangePolicy.maximumFactChanges),
    missingDomainsAdded: missingDomains.added,
    missingDomainsRemoved: missingDomains.removed,
    caveatsAdded: caveats.added,
    caveatsRemoved: caveats.removed,
    evidenceRefsAdded: [...currentEvidence].filter(id => !previousEvidence.has(id)).sort(),
    evidenceRefsRemoved: [...previousEvidence].filter(id => !currentEvidence.has(id)).sort()
  }
}

/** True when the snapshot carries no difference against its predecessor. */
export function isUnchangedSnapshot(change: SnapshotChange): boolean {
  return change.facts.length === 0 && change.missingDomainsAdded.length === 0 && change.missingDomainsRemoved.length === 0 &&
    change.caveatsAdded.length === 0 && change.caveatsRemoved.length === 0 &&
    change.evidenceRefsAdded.length === 0 && change.evidenceRefsRemoved.length === 0
}

/** The snapshot fields the change comparison reads. */
export type SnapshotComparisonInput = Pick<EvidenceSnapshot, 'id' | 'eventGroupId' | 'createdAt' | 'snapshotHash' | 'facts' | 'missingDomains' | 'caveats' | 'evidenceRefs'> & { change?: SnapshotChange }

/**
 * Returns the snapshot with a usable change record.
 *
 * Snapshots frozen before the record existed carry none, so it is derived from the
 * immutable predecessor in `previousSnapshots`. The stored record always wins, so a
 * snapshot is never re-described differently from what was published.
 */
export function withSnapshotChange<T extends SnapshotComparisonInput>(
  snapshot: T,
  previousSnapshots: readonly SnapshotComparisonInput[]
): T & { change: SnapshotChange } {
  if (snapshot.change) return snapshot as T & { change: SnapshotChange }
  const predecessor = previousSnapshots
    .filter(candidate => candidate.eventGroupId === snapshot.eventGroupId && candidate.id !== snapshot.id && candidate.createdAt <= snapshot.createdAt)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .at(-1)
  const change = predecessor
    ? computeSnapshotChange({ current: snapshot, previous: predecessor })
    : computeSnapshotChange({ current: snapshot })
  return { ...snapshot, change }
}

/**
 * Human-readable one-line summary of the movement, for the model prompt.
 *
 * The stored record is a machine encoding (`~change-1d-usd:-406814368->-439273208`) and the
 * prompt tells the model to quote the fields that moved, so this used to hand the model raw
 * identifiers and raw integers to copy straight into the published conclusion. Names come from
 * the model vocabulary and values are scaled, so the model can quote what a reader can follow.
 */
export function describeSnapshotChange(
  change: SnapshotChange,
  names: MarketAnalysisReadableNames = analysisModelVocabulary,
  locale: MarketAnalysisReadableLocale = 'zh-CN'
): string {
  if (isUnchangedSnapshot(change)) return 'no-change'
  const parts: string[] = []
  for (const fact of change.facts) {
    const label = factLabel(names, fact)
    const current = factValue(names, fact.metric, fact.value ?? null, fact.unit, locale)
    const previous = factValue(names, fact.metric, fact.previousValue ?? null, fact.unit, locale)
    if (fact.kind === 'added') parts.push(`新增 ${label} = ${current}`)
    else if (fact.kind === 'removed') parts.push(`移除 ${label}（原 ${previous}）`)
    else parts.push(`${label}：${previous} → ${current}`)
  }
  for (const domain of change.missingDomainsAdded) parts.push(`新增缺失域：${readableAnalysisName(names, 'domain', domain)}`)
  for (const domain of change.missingDomainsRemoved) parts.push(`解除缺失域：${readableAnalysisName(names, 'domain', domain)}`)
  for (const caveat of change.caveatsAdded) parts.push(`新增数据限制：${readableAnalysisName(names, 'caveat', caveat)}`)
  for (const caveat of change.caveatsRemoved) parts.push(`解除数据限制：${readableAnalysisName(names, 'caveat', caveat)}`)
  // Evidence identity is a machine reference the model must not quote; only the movement matters.
  if (change.evidenceRefsAdded.length) parts.push(`新增证据 ${change.evidenceRefsAdded.length} 条`)
  if (change.evidenceRefsRemoved.length) parts.push(`移除证据 ${change.evidenceRefsRemoved.length} 条`)
  return parts.join('；')
}

function factLabel(names: MarketAnalysisReadableNames, fact: SnapshotFactChange): string {
  return [
    readableAnalysisName(names, 'domain', fact.domain),
    // The fact's own name wins where it has one: a calendar observation's subject is only its kind
    // (`economic-indicator`), so the vocabulary alone reads 「宏观 · 经济指标 · 生命周期」 for every
    // release — a sentence the model can quote and no reader can act on (design 141 §3.3).
    fact.subjectLabel ?? readableAnalysisName(names, 'subject', fact.subject),
    readableAnalysisName(names, 'metric', fact.metric)
  ].filter(Boolean).join(' · ')
}

function factValue(
  names: MarketAnalysisReadableNames,
  metric: string,
  value: string | number | null,
  unit: string | null | undefined,
  locale: MarketAnalysisReadableLocale
): string {
  return readableAnalysisFactValue(names, metric, value, unit ?? null, locale) ?? 'null'
}

function changedFact(kind: SnapshotFactChange['kind'], fact: AgentFact, previousValue: string | number | null | undefined): SnapshotFactChange {
  return {
    factId: fact.factId,
    domain: fact.domain,
    metric: fact.metric,
    ...(fact.subject ? { subject: fact.subject } : {}),
    ...(fact.subjectLabel ? { subjectLabel: fact.subjectLabel } : {}),
    ...(fact.unit !== undefined ? { unit: fact.unit } : {}),
    ...(fact.sourceLabel ? { sourceLabel: fact.sourceLabel } : {}),
    kind,
    ...(previousValue !== undefined ? { previousValue } : {}),
    ...(kind === 'removed' ? {} : { value: fact.value })
  }
}

function diffSets<T extends string>(current: readonly T[], previous: readonly T[]): { added: readonly T[]; removed: readonly T[] } {
  const before = new Set(previous)
  const after = new Set(current)
  return {
    added: [...after].filter(value => !before.has(value)).sort(),
    removed: [...before].filter(value => !after.has(value)).sort()
  }
}
