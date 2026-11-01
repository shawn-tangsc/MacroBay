import type { OpenInterestHistoryResult, OpenInterestWindow } from '../../../contracts/openInterestHistory'
import { isCanonicalSignalTime, type ModuleSignal } from '../../../contracts/moduleSignal'
import type { MacroRouteQuery } from '../public-query/macroRouteQuery'
import { normalizeMacroRouteMonths, queryMacroRoute } from '../public-query/macroRouteQuery'
import { createCalendarSignalQuery, createOpenInterestSignalQuery, type ModuleSignalProducer } from './moduleSignalQuery'

/**
 * The two readers behind `queryModuleSignals`, kept out of the public-query file.
 *
 * That file is a documented seam other lines read; it is also a file-size baseline that may only
 * shrink, and every leg that joins the list would otherwise add to it. The list itself stays here,
 * next to the legs it wires, so a new leg is an addition to this file and not to the seam.
 */
export type ModuleSignalHost = {
  queryOpenInterestHistory: (input: Readonly<{ asOf: string; window: OpenInterestWindow }>) => Promise<OpenInterestHistoryResult>
  queryModuleSignals: (input: Readonly<{ asOf: string }>) => Promise<readonly ModuleSignal[]>
  addModuleSignalProducer: (producer: ModuleSignalProducer) => void
} & MacroRouteQuery

export function attachModuleSignals(host: ModuleSignalHost): void {
  // The legs that can answer a signal today. The ETF leg joins this list when its own wiring lands —
  // as a producer that answers, never as a placeholder that returns nothing.
  const producers: ModuleSignalProducer[] = [
    createOpenInterestSignalQuery({ readHistory: input => host.queryOpenInterestHistory(input) }),
    // The calendar's own trigger key stays the only one that spends a call; this leg exists so the
    // chip and the analysis name the same release the same way.
    createCalendarSignalQuery({
      readObservations: async ({ asOf }) =>
        (await queryMacroRoute(host, { asOf, months: normalizeMacroRouteMonths(asOf, null) })).provider
    })
  ]
  host.addModuleSignalProducer = (producer) => { producers.push(producer) }
  host.queryModuleSignals = async (queryInput) => {
    if (!isCanonicalSignalTime(queryInput?.asOf)) return []
    // One leg that throws must not take the others down: each producer answers for itself, and a
    // failed read is already reported as an `unavailable` signal by the leg that owns it.
    const perProducer = await Promise.all(producers.map(async (producer) => {
      try {
        return await producer.query({ asOf: queryInput.asOf })
      } catch (error) {
        console.error('[signals] producer threw:', error instanceof Error ? `${error.name}: ${error.message}` : String(error))
        return []
      }
    }))
    return perProducer.flat()
  }
}
