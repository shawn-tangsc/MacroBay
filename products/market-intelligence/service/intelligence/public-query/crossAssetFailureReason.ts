/**
 * Why a cross-asset read answered nothing, said out loud.
 *
 * The same `undefined` used to stand for three different situations — the query was never wired,
 * the query threw, or the answer failed validation. Every surface then said "cross-asset domain
 * missing", which reports a failed read as missing data and makes the three fixes
 * indistinguishable. One name each; bounded, because the message reaches a prompt and a screen.
 */
export type CrossAssetFailureReason = string

export function crossAssetNotWired(): CrossAssetFailureReason {
  return 'not-wired'
}

export function crossAssetThrew(error: unknown): CrossAssetFailureReason {
  const message = error instanceof Error ? error.message : String(error)
  return `threw:${message.replace(/\s+/g, ' ').slice(0, 120)}`
}

/** `field` names the check that rejected the answer; absent means the rejection itself is unknown. */
export function crossAssetRejected(field?: string): CrossAssetFailureReason {
  return field ? `rejected:${field}` : 'rejected:unparsed'
}

/**
 * The last failure recorded by the cross-asset outlet.
 *
 * Held here rather than in the service so the reason and its vocabulary live together, and so the
 * service does not grow a module-level mutable beside its read paths.
 */
let lastFailure: CrossAssetFailureReason | null = null

export function recordCrossAssetFailure(reason: CrossAssetFailureReason | null): void {
  lastFailure = reason
}

export function readCrossAssetFailure(): CrossAssetFailureReason | null {
  return lastFailure
}
