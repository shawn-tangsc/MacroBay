import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { isCanonicalSignalTime } from '../../../contracts/moduleSignal'
import { isModuleSignalRead } from '../../../contracts/moduleSignalRead'
import type { ModuleSignalAnalysisRead } from '../../../service/intelligence/analysis/signalAnalysisRead'
import type { SignalAnalysisStateView } from '../../../service/intelligence/analysis/signalAnalysisState'

/**
 * The renderer's door to the module signals the chips read, **together with their analysis state**.
 *
 * It hands back a read, not an array: "we could not read" and "nothing happened" are different
 * facts, and the chip above this door says something different for each. The shape check is the same
 * one the IPC handler runs, so a shape one side accepts cannot become a chip with half its numbers
 * on the other, and a malformed entry is dropped and counted rather than hidden.
 *
 * 2026-11-06: switched to `queryModuleSignalRead` together with the two cards and the deletion of
 * the old method. The state block is required: a signal without its state would be read on the card
 * as "还没轮到" — the exact confusion the block exists to end. When the block is missing, the whole
 * read is unavailable (the card says it cannot read the record), never "not triggered yet".
 */
export const moduleSignalClient = {
  async query(input: Readonly<{ asOf: string }>): Promise<ModuleSignalAnalysisRead> {
    try {
      if (!isCanonicalSignalTime(input.asOf)) return { state: 'unavailable', failureCode: 'invalid-as-of' }
      // A missing bridge is a failed read, not a malformed answer: the two get different sentences
      // and only the first one is worth a retry.
      const products = window.platform?.products
      if (!products || typeof products.invoke !== 'function') return { state: 'unavailable', failureCode: 'query-failed' }
      const value = await products.invoke(
        'market-intelligence',
        INTELLIGENCE_PUBLIC_QUERY_METHODS.queryModuleSignalRead,
        { asOf: input.asOf }
      )
      return toDisplayRead(value)
    } catch {
      // A bridge that is missing or threw is a failed read, not an empty market.
      return { state: 'unavailable', failureCode: 'query-failed' }
    }
  }
}

export type ModuleSignalClient = typeof moduleSignalClient

/** The states the projection may answer; a value outside this set is a contract defect. */
const analysisStates = new Set<SignalAnalysisStateView['analysisState']>([
  'not-triggered', 'queued', 'published', 'skipped', 'failed', 'stopped'
])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
}

function isAnalysisState(value: unknown): value is SignalAnalysisStateView {
  if (!isPlainRecord(value)) return false
  return typeof value.analysisOffByReader === 'boolean' &&
    typeof value.analysisState === 'string' &&
    analysisStates.has(value.analysisState as SignalAnalysisStateView['analysisState']) &&
    (value.analysisReason === undefined || typeof value.analysisReason === 'string')
}

/**
 * Turns the handler's answer into the one shape the cards read.
 *
 * Three outcomes, kept apart on purpose:
 * - the whole state block absent (old main process, reader not mounted) → **unavailable**, so the
 *   card says it cannot read the record instead of claiming every signal is "not triggered yet";
 * - an entry of the wrong shape → `contract-invalid` (a defect; not retryable);
 * - a signal with no entry of its own → also unavailable: the producer writes one entry per hash,
 *   and a missing one is not the same fact as an explicit `not-triggered`.
 */
export function toDisplayRead(value: unknown): ModuleSignalAnalysisRead {
  if (!isModuleSignalRead(value)) return { state: 'unavailable', failureCode: 'contract-invalid' }
  if (value.state === 'unavailable') return value
  const analysis = (value as { analysis?: unknown }).analysis
  // The base read is valid without states (older bridge). No block means no states — not "none".
  if (analysis === undefined) return { state: 'unavailable', failureCode: 'query-failed' }
  if (!isPlainRecord(analysis)) return { state: 'unavailable', failureCode: 'contract-invalid' }
  const states: Record<string, SignalAnalysisStateView> = {}
  for (const [hash, state] of Object.entries(analysis)) {
    if (!isAnalysisState(state)) return { state: 'unavailable', failureCode: 'contract-invalid' }
    states[hash] = state
  }
  if (value.signals.some(entry => !(entry.signal.dedupeKey in states))) {
    return { state: 'unavailable', failureCode: 'query-failed' }
  }
  return { state: 'available', signals: value.signals, droppedInvalid: value.droppedInvalid, analysis: states }
}
