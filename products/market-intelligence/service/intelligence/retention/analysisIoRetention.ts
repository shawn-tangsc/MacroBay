/**
 * How long one model call's prompt and raw answer are kept.
 *
 * Thirty days, or until the compressed bytes on disk pass a hundred megabytes — whichever comes
 * first. The byte ceiling is a backstop, not a promise: a month whose prompts run unusually large
 * really does keep less than thirty days, and the reader-facing copy says "30 天，或到 100 MB 时先删
 * 最旧" rather than a flat month.
 *
 * The sizes below are measured against the two gzip columns exactly as written
 * (`length(prompt_gzip) + length(output_gzip)`), never estimated from a daily average: a prompt is
 * not a fixed size, so "a few KB a day × 30" stops matching the file the moment the prompt changes.
 */
export const analysisIoRetentionPolicy = Object.freeze({
  keepMs: 30 * 24 * 3_600_000,
  byteBudget: 100 * 1024 * 1024,
  /** Rows per statement: a first pass over a month of calls must not hold the write lock for long. */
  batchSize: 200
})

/** The oldest `created_at` a call record may carry and survive, as the UTC instant the column stores. */
export function analysisIoCutoffIso(nowMs: number): string {
  return new Date(nowMs - analysisIoRetentionPolicy.keepMs).toISOString()
}
