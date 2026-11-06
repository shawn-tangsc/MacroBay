import { isModuleSignal, type ModuleSignal } from './moduleSignal'
import { isSignalWindow, type SignalWithWindow } from './moduleSignalEvidence'

/**
 * What one signal read answers: the signals, or the fact that the read did not happen.
 *
 * The two are not the same fact and the reader acts differently on them — "this signal has not been
 * analysed yet" means wait, "the record could not be read" means retry or report. A bare array made
 * them one value: a failed read looked exactly like a quiet market, and the chip simply disappeared.
 *
 * Three codes, not one, because the remedies differ:
 *
 * - `query-failed` — the read threw. Retry is honest: it can succeed next time.
 * - `invalid-as-of` — the caller's instant is not usable. Retry is a fake button: the same call can
 *   never succeed, so the reader is told the time is wrong instead of being offered a dead control.
 * - `contract-invalid` — the answer was not the shape this version reads. Not the reader's fault and
 *   not retryable; it is a defect, and it must be visible rather than filtered away.
 */
export type ModuleSignalReadFailureCode = 'query-failed' | 'invalid-as-of' | 'contract-invalid'

export type ModuleSignalRead =
  | Readonly<{
    state: 'available'
    signals: readonly SignalWithWindow[]
    /**
     * How many entries were dropped for not being a signal this version reads.
     *
     * Zero on a healthy read. A non-zero count means the producer and this contract disagree — the
     * entries are still dropped (a chip must never render half a reading) but the disagreement is
     * counted instead of hidden, which is the whole difference between "no signal" and "a bug".
     */
    droppedInvalid: number
  }>
  | Readonly<{ state: 'unavailable'; failureCode: ModuleSignalReadFailureCode }>

export const moduleSignalReadPolicy = Object.freeze({
  version: 'moduleSignalRead.v1',
  failureCodes: Object.freeze(['query-failed', 'invalid-as-of', 'contract-invalid'] as const),
  /**
   * The one statement of what each failure allows. Retryability is decided here and nowhere else, so
   * the main process, the client and the chip cannot disagree about whether the reader has something
   * to press.
   */
  failures: Object.freeze({
    'query-failed': Object.freeze({ retryable: true }),
    'invalid-as-of': Object.freeze({ retryable: false }),
    'contract-invalid': Object.freeze({ retryable: false })
  } satisfies Record<ModuleSignalReadFailureCode, Readonly<{ retryable: boolean }>>),
  /** Card-specific sentences live under `<base>.<code>`, so the wording can differ but not the rules. */
  copyKeySeparator: '.'
})

export function isModuleSignalRead(value: unknown): value is ModuleSignalRead {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (record.state === 'available') {
    return Array.isArray(record.signals) && Number.isSafeInteger(record.droppedInvalid) && (record.droppedInvalid as number) >= 0
  }
  return record.state === 'unavailable' &&
    typeof record.failureCode === 'string' &&
    moduleSignalReadPolicy.failureCodes.includes(record.failureCode as ModuleSignalReadFailureCode)
}

/**
 * Turns whatever came back into a read, counting the entries this version cannot render.
 *
 * One implementation for both sides of the bridge: the main process and the renderer used to run the
 * same filter twice, so a shape one accepted could become a chip with half its numbers on the other.
 */
export function toModuleSignalRead(value: unknown): ModuleSignalRead {
  if (!Array.isArray(value)) return { state: 'unavailable', failureCode: 'contract-invalid' }
  const signals: SignalWithWindow[] = []
  let droppedInvalid = 0
  for (const entry of value) {
    const candidate = entry as { signal?: unknown; window?: unknown } | undefined
    if (isModuleSignal(candidate?.signal) && isSignalWindow(candidate?.window)) {
      signals.push(entry as SignalWithWindow)
    } else {
      droppedInvalid += 1
    }
  }
  // Nothing readable and something dropped is not a quiet market: it is an answer we cannot read.
  if (signals.length === 0 && droppedInvalid > 0) return { state: 'unavailable', failureCode: 'contract-invalid' }
  return { state: 'available', signals: Object.freeze(signals), droppedInvalid }
}

/** Whether the reader is offered a retry for this failure. One place decides. */
export function isModuleSignalReadRetryable(code: ModuleSignalReadFailureCode): boolean {
  return moduleSignalReadPolicy.failures[code].retryable
}

/** The sentence for one card, chosen by the same code table the rules came from. */
export function moduleSignalReadCopyKey(base: string, code: ModuleSignalReadFailureCode): string {
  return `${base}${moduleSignalReadPolicy.copyKeySeparator}${code}`
}

/** Every signal in a successful read, without the window — what the chips project from. */
export function moduleSignalsOf(read: ModuleSignalRead): readonly ModuleSignal[] | undefined {
  return read.state === 'available' ? read.signals.map(entry => entry.signal) : undefined
}
