/**
 * The two errors a signal-ledger caller is allowed to branch on.
 *
 * Both are ordinary `Error`s carrying a stable `code` equal to the message, because the receiver must
 * tell two situations apart that look identical from the outside:
 *
 * - `rewriteRefused` — another caller won the retry, or the row is not in the one state that may be
 *   re-opened. Normal; the caller returns `duplicate`.
 * - `shapeMismatch` — the evidence does not match the shape its decision reads. That is a bug in the
 *   caller, and it must stay loud: swallowed as a duplicate, it would look like deduplication working
 *   while every retry silently failed.
 *
 * Matching on message text worked until a copy of the string drifted. The code is the branch, the
 * message is for humans.
 */
export const signalLedgerErrorCodes = Object.freeze({
  rewriteRefused: 'signal-trigger-rewrite-refused',
  shapeMismatch: 'signal-evidence-shape-mismatch'
} as const)

export type SignalLedgerErrorCode = (typeof signalLedgerErrorCodes)[keyof typeof signalLedgerErrorCodes]

export class SignalLedgerError extends Error {
  readonly code: SignalLedgerErrorCode

  constructor(code: SignalLedgerErrorCode) {
    super(code)
    this.name = 'SignalLedgerError'
    this.code = code
  }
}

/** True when `value` is one of these errors with the expected code. */
export function isSignalLedgerError(value: unknown, code: SignalLedgerErrorCode): boolean {
  return value instanceof Error && (value as { code?: unknown }).code === code
}
