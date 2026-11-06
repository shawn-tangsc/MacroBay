import type { EventGroupType } from '../../../contracts/marketAnalysisContracts'
import type { SignalWithWindow } from '../../../contracts/moduleSignalEvidence'

/**
 * Turns one tick's derived signals into the runs it should ask for.
 *
 * The scan owns no rule: it reads what the module rules already produced and only decides which
 * entries may be queued and how they are grouped. Two things follow from that, and both are
 * deliberate:
 *
 * - **one batch per module** — the ledger's accounting unit is a run, not a signal, so all of one
 *   module's signals in one tick travel together and count once;
 * - **the board comes from the module**, not from the caller: open interest is the funding board,
 *   ETF flows are the capital board, the calendar is the macro board. A module outside that map is
 *   dropped rather than guessed, because a wrong board is a wrong group and a wrong analysis.
 *
 * Filtered out, never queued: low severity (the chip's business only), unavailable reads (spending
 * a call to be told the reading is missing), and signals another trigger key owns (the calendar
 * line already pays for those).
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
  skipped: Readonly<{ low: number; unreadable: number; ownedElsewhere: number; unknownModule: number }>
  batches: readonly SignalScanBatch[]
}>

const BOARD_BY_MODULE: Readonly<Record<string, EventGroupType>> = Object.freeze({
  'open-interest': 'funding',
  'etf-flows': 'capital',
  'macro-calendar': 'macro'
})

export function planSignalScan(entries: readonly SignalWithWindow[]): SignalScanPlan {
  const skipped = { low: 0, unreadable: 0, ownedElsewhere: 0, unknownModule: 0 }
  const byModule = new Map<string, { groupType: EventGroupType; signals: SignalWithWindow[] }>()
  for (const entry of entries) {
    const signal = entry.signal
    const groupType = BOARD_BY_MODULE[signal.moduleId]
    if (!groupType) {
      skipped.unknownModule += 1
      continue
    }
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
