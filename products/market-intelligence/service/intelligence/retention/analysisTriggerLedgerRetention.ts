/**
 * How long a signal ledger row is kept.
 *
 * Fifteen days: the conclusion's fourteen days plus one. The ledger row is written *before* the
 * conclusion, so a fourteen-day ledger would expire first and leave a conclusion whose "why it ran"
 * is already gone. The extra day keeps the two readable together.
 *
 * This is a window of its own, not a cascade off "the group has no conclusion left". That cascade
 * deleted rows at an unpredictable instant — sometimes the same day they were written — which is
 * exactly the "why did nothing run" record the reader needs.
 */
export const analysisTriggerLedgerRetentionPolicy = Object.freeze({
  keepMs: 15 * 24 * 3_600_000,
  /** Rows per statement: a first pass over a long history must not hold the write lock for long. */
  batchSize: 500
})

/** The oldest `created_at` a ledger row may carry and survive, as the UTC instant the column stores. */
export function analysisTriggerLedgerCutoffIso(nowMs: number): string {
  return new Date(nowMs - analysisTriggerLedgerRetentionPolicy.keepMs).toISOString()
}
