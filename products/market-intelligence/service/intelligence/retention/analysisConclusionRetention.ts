/**
 * How long an AI analysis conclusion is kept.
 *
 * Fourteen days, and then it goes — the summaries, the runs and snapshots they were built from, the
 * predictions drawn from them, the verifications those predictions earned, and the timeline entries the
 * reader scrolls. All of it is one graph hanging off `mi_analysis_event_groups`, so it leaves as one
 * graph, in dependency order, in a single transaction.
 *
 * One guard, and only one: a conclusion is not deleted while any of its predictions is **not yet due for
 * verification** (`verification_due_at > now`). That is the only moment a deletion can destroy work the
 * product still intends to do — a prediction made this afternoon, due tomorrow, would become unverifiable
 * the moment its conclusion left. Once a prediction is due, the guard stops applying whether or not the
 * verifier has caught up: a rule that waited for a verdict would stall forever on the verdicts this
 * product actually produces, which on the current data are `insufficient-data` rather than a hit or a
 * miss.
 */
export const analysisConclusionRetentionPolicy = Object.freeze({
  keepMs: 14 * 24 * 3_600_000,
  /** Rows per statement: a first pass over months of history must not hold the write lock for long. */
  batchSize: 500
})

/**
 * The oldest `created_at` a conclusion may carry and survive, as the canonical UTC instant the column
 * stores — the ledger and the schema both use ISO strings, so the comparison stays a string comparison.
 */
export function analysisConclusionCutoffIso(nowMs: number): string {
  return new Date(nowMs - analysisConclusionRetentionPolicy.keepMs).toISOString()
}
