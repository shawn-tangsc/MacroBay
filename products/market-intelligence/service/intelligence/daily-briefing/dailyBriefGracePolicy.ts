/**
 * The late-data grace an edition accepts: a reading admits bars **stamped at or before the cutoff**
 * and **known within thirty minutes of it**. The window does not move — only "by when did we have to
 * know it" does. A bar from the afternoon is still never part of the morning edition, even though it
 * is newer.
 *
 * Why this lives in its own leaf module (no imports): the readiness gate and the body read both use
 * the number, and those two modules already import each other. When the constant lived in the body's
 * module and the gate read it at module top level, loading the body's module first hit the temporal
 * dead zone: `Cannot access 'briefingLateDataGraceMs' before initialization`. A leaf module cannot be
 * mid-initialisation, so the cycle can no longer decide whether the app starts.
 */
export const briefingLateDataGraceMs = 30 * 60_000

/**
 * The version cutoff for an edition: its own cutoff plus the late-data grace.
 *
 * **Never later than "now"**: nobody knows the future. When the edition is generated as it starts
 * (a manual run whose cutoff is the press), cutoff + grace lands half an hour ahead, the cross-asset
 * port rejects the input (`threw:invalid-query`) and the whole market block reads as missing. Clipped,
 * the grace still does its job for a backfill and simply cannot promise bars that have not arrived.
 */
export function briefingMarketKnowledgeAt(
  asOf: string,
  graceMs: number = briefingLateDataGraceMs,
  nowMs: number = Date.now()
): string | undefined {
  const cutoff = Date.parse(asOf)
  if (!Number.isFinite(cutoff)) return undefined
  const limit = Number.isFinite(nowMs) ? Math.min(cutoff + graceMs, nowMs) : cutoff + graceMs
  return new Date(limit).toISOString()
}
