import { isCanonicalSignalTime, moduleSignalPolicy, type ModuleSignal, type SignalSeverity, type SignalWindow } from './moduleSignal'

/**
 * What a signal decision leaves behind, so a reader can ask "why was this not analysed".
 *
 * The trigger ledger already carries the decision, the reason and the instant; this is the one
 * optional column that keeps the readings that produced them. Thresholds move, and recomputing
 * those readings at read time would print today's answer under yesterday's row: the panel would
 * say "why this was skipped" using a threshold that had not existed then.
 *
 * **One column, two shapes, discriminated by `decision` — never by which keys are present.**
 * A `skipped` row is one signal that was refused; a `queued` row is one run that may carry several
 * signals. Reading the wrong shape silently yields an empty object, and the reader sees a row with
 * no reason at all, so each shape is validated as an exact key set ("no more, no fewer") and the
 * parser is told the decision rather than guessing it.
 *
 * A `recorded` row is usage, not a signal: it stores no evidence, and `signalEvidenceJson` refuses
 * to write one.
 */

export const moduleSignalEvidencePolicy = Object.freeze({
  version: 'marketModuleSignalEvidencePolicy.v1',
  /** Exactly these four: the readings behind one refused signal. */
  skippedKeys: Object.freeze(['severity', 'observedAt', 'window', 'values'] as const),
  /** Exactly these two: one queued run and the signals it carries. */
  queuedKeys: Object.freeze(['signalCount', 'signals'] as const),
  /** Exactly these seven: the skipped four plus what identifies the signal within a batch. */
  entryKeys: Object.freeze(['severity', 'observedAt', 'window', 'values', 'moduleId', 'ruleId', 'asset'] as const),
  decisions: Object.freeze({ skipped: 'skipped', queued: 'queued', recorded: 'recorded' } as const),
  /**
   * Batch order, most severe first. The same order the prompt truncates in, so the entry the panel
   * calls "the main one" is the one the analysis was allowed to read.
   */
  severityOrder: Object.freeze({ high: 0, medium: 1, low: 2 } as const)
})

export type SkippedSignalEvidence = Readonly<{
  severity: SignalSeverity
  observedAt: string
  window: SignalWindow
  values: Readonly<Record<string, number>>
}>

export type QueuedSignalEvidenceEntry = SkippedSignalEvidence & Readonly<{
  moduleId: ModuleSignal['moduleId']
  ruleId: string
  asset: ModuleSignal['asset']
}>

export type QueuedSignalEvidence = Readonly<{
  signalCount: number
  signals: readonly QueuedSignalEvidenceEntry[]
}>

export type SignalEvidence = SkippedSignalEvidence | QueuedSignalEvidence

/**
 * One signal plus the window its rule declares.
 *
 * `ModuleSignal` deliberately does not carry the window: the window is the rule's amount in its own
 * cadence's unit, and only the rule knows how many buckets or trading days it read. Passing it in
 * here keeps that one number with the rule that computed it.
 */
export type SignalWithWindow = Readonly<{ signal: ModuleSignal; window: SignalWindow }>

/** The evidence for one refused signal: exactly the four reading keys. */
export function skippedSignalEvidence(input: SignalWithWindow): SkippedSignalEvidence {
  return Object.freeze(reading(input))
}

/**
 * The evidence for one queued run: every signal the run carried, most severe first.
 *
 * `signalCount` is the array's length by construction. The display reads it instead of counting
 * ledger rows, so the two can never disagree about how many signals one run held.
 */
export function queuedSignalEvidence(inputs: readonly SignalWithWindow[]): QueuedSignalEvidence {
  const entries = [...inputs]
    .map(input => Object.freeze({ ...reading(input), moduleId: input.signal.moduleId, ruleId: input.signal.ruleId, asset: input.signal.asset }))
    .sort((left, right) =>
      moduleSignalEvidencePolicy.severityOrder[left.severity] - moduleSignalEvidencePolicy.severityOrder[right.severity] ||
      left.observedAt.localeCompare(right.observedAt))
  return Object.freeze({ signalCount: entries.length, signals: Object.freeze(entries) })
}

/**
 * The reading a refused run keeps, taken from the batch it carried.
 *
 * A run that was queued and then refused (out of budget, or could not be enqueued) must not keep the
 * batch shape under a `skipped` decision: the reader parses by the decision and would find nothing —
 * exactly when the reason matters most. The batch already holds every candidate, so it keeps the most
 * severe one, which is the same entry the prompt would have read first. A row with no batch has no
 * reading to restate, and this function is never asked to invent one.
 */
export function mostSevereSkippedEvidence(queued: QueuedSignalEvidence): SkippedSignalEvidence {
  const [first] = [...queued.signals].sort((left, right) =>
    moduleSignalEvidencePolicy.severityOrder[left.severity] - moduleSignalEvidencePolicy.severityOrder[right.severity] ||
    left.observedAt.localeCompare(right.observedAt))
  if (!first) throw new Error('signal-evidence-shape-mismatch')
  return Object.freeze({ severity: first.severity, observedAt: first.observedAt, window: first.window, values: first.values })
}

/**
 * The JSON to store for one decision, or `null` when that decision carries no evidence.
 *
 * Fails loudly on a mismatch instead of writing a shape the reader would refuse: a silently dropped
 * shape turns into a ledger row whose "why" reads blank, which is the defect this column exists to
 * prevent.
 */
export function signalEvidenceJson(decision: string, evidence: SignalEvidence | null | undefined): string | null {
  // Most deliveries carry no readings at all — the calendar line, the session slots, a restart
  // compensation — so "no evidence" is always allowed. Only a present reading is held to its shape.
  if (evidence === null || evidence === undefined) return null
  const { decisions } = moduleSignalEvidencePolicy
  if (decision === decisions.skipped) {
    if (!isSkippedShape(evidence)) throw new Error('signal-evidence-shape-mismatch')
    return JSON.stringify(evidence)
  }
  if (decision === decisions.queued) {
    if (!isQueuedShape(evidence)) throw new Error('signal-evidence-shape-mismatch')
    return JSON.stringify(evidence)
  }
  // `recorded` is usage, not a signal, and any older decision predates the column: neither may
  // carry a reading, because a reader would then translate it as "this analysed something".
  throw new Error('signal-evidence-shape-mismatch')
}

/**
 * The stored evidence for one decision, or `null`.
 *
 * The decision is an argument, not something inferred from the JSON: a row with the queued shape
 * read as skipped would otherwise still produce a plausible object with no signals in it. An
 * unreadable row answers `null` rather than throwing — a retention window or a hand-edited database
 * must not take the timeline down.
 */
export function parseSignalEvidence(decision: string, raw: string | null | undefined): SignalEvidence | null {
  if (raw === null || raw === undefined || raw.length === 0) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  const { decisions } = moduleSignalEvidencePolicy
  if (decision === decisions.skipped) return isSkippedShape(value) ? value : null
  if (decision === decisions.queued) return isQueuedShape(value) ? value : null
  return null
}

/** True when the value is a two-number coverage window, both shapes it can take. */
export function isSignalWindow(value: unknown): value is SignalWindow {
  if (!isPlainRecord(value)) return false
  if (value.unit === 'buckets') {
    return hasExactKeys(value, ['unit', 'amount', 'bucketMs', 'upperBoundMs']) &&
      Number.isSafeInteger(value.amount) && (value.amount as number) > 0 &&
      Number.isSafeInteger(value.bucketMs) && (value.bucketMs as number) > 0 && (value.bucketMs as number) <= moduleSignalPolicy.maximumBucketMs &&
      Number.isFinite(value.upperBoundMs) && value.upperBoundMs === (value.amount as number) * (value.bucketMs as number)
  }
  if (value.unit === 'trading-days') {
    return hasExactKeys(value, ['unit', 'amount', 'upperBoundMs']) &&
      Number.isSafeInteger(value.amount) && (value.amount as number) > 0 && value.upperBoundMs === null
  }
  return false
}

function reading(input: SignalWithWindow): SkippedSignalEvidence {
  const { signal } = input
  return {
    severity: signal.severity,
    observedAt: signal.observedAt,
    window: input.window,
    values: { ...signal.values }
  }
}

function isSkippedShape(value: unknown): value is SkippedSignalEvidence {
  return isPlainRecord(value) &&
    hasExactKeys(value, moduleSignalEvidencePolicy.skippedKeys) &&
    isReading(value)
}

function isQueuedShape(value: unknown): value is QueuedSignalEvidence {
  if (!isPlainRecord(value) || !hasExactKeys(value, moduleSignalEvidencePolicy.queuedKeys)) return false
  if (!Number.isSafeInteger(value.signalCount) || (value.signalCount as number) < 1) return false
  if (!Array.isArray(value.signals) || value.signals.length !== value.signalCount) return false
  return value.signals.every(entry => isPlainRecord(entry) &&
    hasExactKeys(entry, moduleSignalEvidencePolicy.entryKeys) &&
    isReading(entry) &&
    moduleSignalPolicy.modules.includes(entry.moduleId as never) &&
    typeof entry.ruleId === 'string' && entry.ruleId.length <= moduleSignalPolicy.maximumRuleIdLength && moduleSignalPolicy.ruleIdPattern.test(entry.ruleId) &&
    (entry.asset === null || entry.asset === 'btc' || entry.asset === 'eth'))
}

function isReading(value: Readonly<Record<string, unknown>>): boolean {
  return moduleSignalPolicy.severities.includes(value.severity as SignalSeverity) &&
    isCanonicalSignalTime(value.observedAt) &&
    isSignalWindow(value.window) &&
    isValues(value.values)
}

function isValues(value: unknown): value is Readonly<Record<string, number>> {
  if (!isPlainRecord(value)) return false
  const entries = Object.entries(value)
  return entries.length > 0 && entries.length <= moduleSignalPolicy.maximumValueEntries &&
    entries.every(([, reading]) => typeof reading === 'number' && Number.isFinite(reading))
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
