/**
 * Which source supplies a market fact, decided from configuration rather than a hard-coded id.
 *
 * A source declares what it can supply (`provides`), and three facts decide whether it is the one
 * answering right now: the job is really registered, the reader left it on, and it is ready. The
 * middle one matters because "the switch looks on" and "a job is registered" are different facts —
 * the aggregate anchor shows on while nothing schedules it, so a resolver built on the switch alone
 * answers with a source that never runs.
 *
 * One implementation only: two copies would let a card name one source while storage writes another,
 * which is exactly the class of lie the ETF switch was meant to end (architect, 2026-11-13).
 */

export type MarketFactId = 'etf-net-flow'

/** The part of a source definition the resolver needs; `SourceView` satisfies it. */
export type FactSourceCandidate = Readonly<{
  sourceId: string
  provides?: readonly MarketFactId[]
  enabled?: boolean
  jobRegistered?: boolean
  readiness?: string
}>

export type FactSourceResolution =
  /** Exactly one candidate supplies the fact right now. */
  | Readonly<{ kind: 'resolved'; sourceId: string }>
  /** No candidate: the reader renders this as "not configured / not enabled", never "unreadable". */
  | Readonly<{ kind: 'none' }>
  /** More than one candidate: fail closed. Nobody picks the first — not collection, not the card. */
  | Readonly<{ kind: 'conflict'; sourceIds: readonly string[] }>

export function resolveFactSource(input: Readonly<{
  factId: MarketFactId
  sources: readonly FactSourceCandidate[]
}>): FactSourceResolution {
  const candidates = input.sources.filter((source) => isCandidate(source, input.factId)).map((source) => source.sourceId)
  if (candidates.length === 0) return Object.freeze({ kind: 'none' })
  if (candidates.length === 1) return Object.freeze({ kind: 'resolved', sourceId: candidates[0]! })
  return Object.freeze({ kind: 'conflict', sourceIds: Object.freeze([...candidates]) })
}

function isCandidate(source: FactSourceCandidate, factId: MarketFactId): boolean {
  if (source.provides === undefined || !source.provides.includes(factId)) return false
  if (source.enabled !== true) return false
  // The real fact from `listSchedules()`, not the reader's switch.
  if (source.jobRegistered !== true) return false
  return source.readiness === undefined || source.readiness === 'live'
}
