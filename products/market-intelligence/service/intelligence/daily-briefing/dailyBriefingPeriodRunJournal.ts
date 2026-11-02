import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingStore } from './dailyBriefingService'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { briefingSnapshot, type DailyBriefingSnapshot } from './dailyBriefingSnapshot'

/**
 * The run of one period: opened once its facts are frozen, settled when the writing ends.
 *
 * Kept out of the service because the service file sits at its size ceiling and the run will gain
 * fields (expected languages, fallback reason, writing rounds) as the period model lands. The
 * service decides when a run opens and how it ended; this module decides how that is written.
 */
export type DailyBriefingPeriodRunJournal = Readonly<{
  /** Freezes the facts and records the run; returns the snapshot both editions are written from. */
  open: (document: DailyBriefingDocument, packet: DailyBriefingFactPacket) => Promise<DailyBriefingSnapshot>
  settle: (state: 'published' | 'partial' | 'failed', writingRounds: number) => Promise<void>
}>

export function createDailyBriefingPeriodRunJournal(
  store: DailyBriefingStore,
  input: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale; now: () => string }>
): DailyBriefingPeriodRunJournal {
  // A run that never froze its facts has nothing to record: the snapshot columns are not optional,
  // and a failed source read is already visible through the attempt's trace.
  let opened = false
  return Object.freeze({
    async open(document, packet) {
      const snapshot = briefingSnapshot(document, packet)
      await store.openPeriodRun?.({
        date: input.date,
        periodId: input.periodId,
        expectedLocales: [input.locale],
        primaryRequested: input.locale,
        primaryUsed: input.locale,
        snapshotId: snapshot.id,
        snapshotHash: snapshot.hash,
        contentVersion: 1,
        writingRounds: 0,
        state: 'running',
        startedAt: input.now()
      }).catch(() => undefined)
      opened = true
      return snapshot
    },
    async settle(state, writingRounds) {
      if (!opened) return
      await store.settlePeriodRun?.({
        date: input.date,
        periodId: input.periodId,
        state,
        finishedAt: input.now(),
        writingRounds
      }).catch(() => undefined)
    }
  })
}
