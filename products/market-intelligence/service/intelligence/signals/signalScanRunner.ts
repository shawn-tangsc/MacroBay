import type { SignalWithWindow } from '../../../contracts/moduleSignalEvidence'
import type { SignalAnalysisOutcome, SignalAnalysisRequest } from '../jobs/requestSignalAnalysis'
import { planSignalScan } from './signalScan'

/**
 * One tick's signal phase: read the derived signals once, then ask for one analysis per module.
 *
 * This is the only entry that calls analyses for module signals. The push paths on the refresh
 * routes lost that right in the same change: two triggers for one fact would make "when did it
 * fire" have two answers, and a push lost between "data written" and "hand-off" would never be
 * repaired. The scan recomputes from the same read on the next tick, so a crash costs one tick at
 * most — at the price of the chip being visible before its analysis (the chip is rendered, not
 * scanned).
 */
export type SignalScanRunnerDependencies = Readonly<{
  now: () => string
  querySignals: (input: Readonly<{ asOf: string }>) => Promise<readonly SignalWithWindow[]>
  requestAnalysis: (request: SignalAnalysisRequest) => Promise<SignalAnalysisOutcome>
  log: (input: Readonly<{
    level: 'info' | 'warn'
    message: string
    metadata: Readonly<Record<string, unknown>>
  }>) => Promise<void>
}>

export function createSignalScanRunner(deps: SignalScanRunnerDependencies) {
  return async function runSignalScan(): Promise<void> {
    let entries: readonly SignalWithWindow[]
    try {
      entries = await deps.querySignals({ asOf: deps.now() })
    } catch {
      // A dead read is reported, not swallowed into "nothing happened": the scan is the engine, and
      // a silent engine failure would look exactly like a quiet market.
      await deps.log({ level: 'warn', message: 'Market analysis signal scan: query failed', metadata: {} })
      return
    }
    const plan = planSignalScan(entries)
    let queued = 0
    let refused = 0
    for (const batch of plan.batches) {
      try {
        const outcome = await deps.requestAnalysis({ signals: batch.signals, groupType: batch.groupType })
        if (outcome.state === 'queued') queued += 1
      } catch (error) {
        // One batch failing must not take the others down, but it must not vanish either: a batch
        // that disappeared leaves `queued` short by one and nothing else, and the reader who later
        // asks "why was this not analysed" would find no row, no reason and no hint that it was lost.
        refused += 1
        await deps.log({
          level: 'warn',
          message: 'Market analysis signal scan: batch refused',
          metadata: { moduleId: batch.moduleId, signalCount: batch.signals.length, error: error instanceof Error ? error.message : String(error) }
        })
      }
    }
    await deps.log({
      level: 'info',
      message: 'Market analysis signal scan',
      // Counts only: no readings, no full trigger keys. The ledger is where a row explains itself.
      metadata: { scanned: plan.scanned, eligible: plan.eligible, queued, refused, skipped: plan.skipped }
    })
  }
}
