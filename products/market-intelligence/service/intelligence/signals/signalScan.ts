import type { EventGroupType } from '../../../contracts/marketAnalysisContracts'
import type { SignalWithWindow } from '../../../contracts/moduleSignalEvidence'
import { moduleSignalPolicy } from '../../../contracts/moduleSignal'

/**
 * Turns one tick's derived signals into the runs it should ask for.
 *
 * The scan owns no rule: it reads what the module rules already produced and only decides which
 * entries may be queued and how they are grouped. Two things follow from that, and both are
 * deliberate:
 *
 * - **one batch per module** — the ledger's accounting unit is a run, not a signal, so all of one
 *   module's signals in one tick travel together and count once;
 * - **the board comes from the module**, read from the contract's `moduleBoards` rather than from a
 *   table kept here: a module without a board must fail to compile, not vanish from the scan.
 *
 * Filtered out, never queued: low severity (the chip's business only), unavailable reads (spending
 * a call to be told the reading is missing), and signals another trigger key owns (the calendar
 * line already pays for those). Each of those is a fact about the signal itself and is counted, so
 * a reader asking "why was this not analysed" gets an answer.
 */
export type SignalScanBatch = Readonly<{
  moduleId: SignalWithWindow['signal']['moduleId']
  groupType: EventGroupType
  signals: readonly SignalWithWindow[]
}>

export type SignalScanPlan = Readonly<{
  /** Everything the query returned. */
  scanned: number
  /** Entries that may be queued. */
  eligible: number
  /** Entries filtered out, by why — counts only, no readings. */
  skipped: Readonly<{ low: number; unreadable: number; ownedElsewhere: number }>
  batches: readonly SignalScanBatch[]
}>

export function planSignalScan(entries: readonly SignalWithWindow[]): SignalScanPlan {
  const skipped = { low: 0, unreadable: 0, ownedElsewhere: 0 }
  const byModule = new Map<string, { groupType: EventGroupType; signals: SignalWithWindow[] }>()
  for (const entry of entries) {
    const signal = entry.signal
    // Total by construction: `moduleBoards` is typed against the module closed set, so there is no
    // "not in the table" branch to fall into. A module that does not compile here is a module that
    // was never given a board — which is the only way to be sure none is dropped silently.
    const groupType = moduleSignalPolicy.moduleBoards[signal.moduleId]
    if (signal.severity === 'low') {
      skipped.low += 1
      continue
    }
    if (signal.readiness !== 'available') {
      skipped.unreadable += 1
      continue
    }
    if (signal.triggerOwner !== 'module-signal') {
      skipped.ownedElsewhere += 1
      continue
    }
    const existing = byModule.get(signal.moduleId)
    if (existing) existing.signals.push(entry)
    else byModule.set(signal.moduleId, { groupType, signals: [entry] })
  }
  const batches = [...byModule.entries()].map(([moduleId, value]) => Object.freeze({
    moduleId: moduleId as SignalWithWindow['signal']['moduleId'],
    groupType: value.groupType,
    signals: Object.freeze([...value.signals])
  }))
  return Object.freeze({
    scanned: entries.length,
    eligible: batches.reduce((total, batch) => total + batch.signals.length, 0),
    skipped: Object.freeze(skipped),
    batches: Object.freeze(batches)
  })
}
