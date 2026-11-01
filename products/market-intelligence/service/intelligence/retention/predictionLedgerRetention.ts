/**
 * How long a verdict is kept, and how big the ledger that holds it may get.
 *
 * A conclusion leaves after fourteen days. The verdict about it is the only thing that can be counted
 * six months later — a hit rate over fourteen days of one product's output is a sample, not a result —
 * so the ledger has its own window instead of riding on the conclusion that produced it.
 *
 * The window is measured from the verdict, not from the prediction: a three-day horizon judged today
 * and a fifteen-minute horizon judged today have to age the same way, or the ledger's population would
 * depend on the horizon it exists to explain.
 *
 * The row shape is fixed, not compressed: `PREDICTION_LEDGER_SHAPE_POLICY` caps what a row may store, and
 * a row that hits a cap says so through its full counts. The ceiling below is a ceiling — the typical row
 * is a few hundred bytes — and it exists so a run that suddenly produces more predictions cannot turn a
 * six-month ledger into an unbounded file.
 */
export const predictionLedgerRetentionPolicy = Object.freeze({
  keepMs: 180 * 24 * 3_600_000,
  /** Six predictions a day is the ceiling the budget is sized against, not a quota. */
  maximumRowsPerDay: 6,
  /** One serialized row at the shape caps. The budget test fails if a cap raises this without the ceiling. */
  maximumRowBytes: 1_536,
  /** 180 days × 6 rows × 1,536 B ≈ 1.6 MiB, so two megabytes is the ledger's own disk ceiling. */
  budgetBytes: 2 * 1024 * 1024,
  /** Rows per statement: a first pass over months of verdicts must not hold the write lock for long. */
  batchSize: 500
})

/** The oldest `evaluated_at` a verdict may carry and survive, as the canonical UTC instant the column stores. */
export function predictionLedgerCutoffIso(nowMs: number): string {
  return new Date(nowMs - predictionLedgerRetentionPolicy.keepMs).toISOString()
}

/**
 * The whole ledger at its worst, as the two numbers a reader can check without a database: how many rows
 * the window permits and what they may occupy. `withinBudget` is what the budget test asserts, so a later
 * cap change cannot pass by quietly leaving the ceiling behind.
 */
export function predictionLedgerBudget(): Readonly<{ maximumRows: number; maximumBytes: number; withinBudget: boolean }> {
  const days = predictionLedgerRetentionPolicy.keepMs / (24 * 3_600_000)
  const maximumRows = predictionLedgerRetentionPolicy.maximumRowsPerDay * days
  const maximumBytes = maximumRows * predictionLedgerRetentionPolicy.maximumRowBytes
  return Object.freeze({ maximumRows, maximumBytes, withinBudget: maximumBytes <= predictionLedgerRetentionPolicy.budgetBytes })
}
