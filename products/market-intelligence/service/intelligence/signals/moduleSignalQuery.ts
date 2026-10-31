import type { OpenInterestHistoryResult, OpenInterestWindow } from '../../../contracts/openInterestHistory'
import type { ModuleSignal } from '../../../contracts/moduleSignal'
import { openInterestSignalsFromHistory } from './openInterestSignals'

/**
 * The signal reads the dashboard will call, one per leg that can answer today.
 *
 * It owns no rule of its own: it asks the same `queryOpenInterestHistory` the panel asks, so the
 * chip and the mark are computed from one read and cannot describe different buckets. When Q-1b
 * lands its ETF leg and the calendar leg gets its baseline, they join this list — the shape is a
 * list of signals for one instant, not a per-module tree.
 */
export type ModuleSignalQuery = Readonly<{
  query: (input: Readonly<{ asOf: string }>) => Promise<readonly ModuleSignal[]>
}>

export function createOpenInterestSignalQuery(deps: Readonly<{
  readHistory: (input: Readonly<{ asOf: string; window: OpenInterestWindow }>) => Promise<OpenInterestHistoryResult>
}>): ModuleSignalQuery {
  return {
    async query(input) {
      try {
        const reading = await deps.readHistory({ asOf: input.asOf, window: '24h' })
        return openInterestSignalsFromHistory(reading, input.asOf)
      } catch {
        // A thrown read is a failed read, not a quiet market: it must reach the card as `unavailable`
        // instead of an empty list, which is what a reader would read as "nothing happened".
        return openInterestSignalsFromHistory({ state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' }, input.asOf)
      }
    }
  }
}
