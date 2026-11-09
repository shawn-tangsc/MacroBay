import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingPeriodRun, DailyBriefingStore } from './dailyBriefingService'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { briefingSnapshot, type DailyBriefingSnapshot, type DailyBriefingFactSnapshot } from './dailyBriefingFactSnapshot'

/**
 * The run of one period: opened once its facts are frozen, settled when the writing ends.
 *
 * Kept out of the service because the service file sits at its size ceiling and the run will gain
 * fields (expected languages, fallback reason, writing rounds) as the period model lands. The
 * service decides when a run opens and how it ended; this module decides how that is written.
 */
export type DailyBriefingPeriodRunJournal = Readonly<{
  /** Freezes the facts and records the run; returns the snapshot both editions are written from. */
  open: (
    document: DailyBriefingDocument,
    factSnapshot: DailyBriefingFactSnapshot,
    facts: Readonly<{ rowIds: readonly string[]; direction: DailyBriefingPeriodRun['direction'] }>
  ) => Promise<DailyBriefingSnapshot>
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
    async open(document, factSnapshot, facts) {
      const snapshot = briefingSnapshot(document, factSnapshot)
      await store.openPeriodRun?.({
        date: input.date,
        periodId: input.periodId,
        locale: input.locale,
        expectedLocales: [input.locale],
        primaryRequested: input.locale,
        primaryUsed: input.locale,
        snapshotId: snapshot.id,
        snapshotHash: snapshot.hash,
        contentVersion: 1,
        writingRounds: 0,
        direction: facts.direction,
        editionRows: facts.rowIds,
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
        locale: input.locale,
        state,
        finishedAt: input.now(),
        writingRounds
      }).catch(() => undefined)
    }
  })
}

/**
 * The runs of a date range, read through the store.
 *
 * The list uses this to find a period whose run wrote **no edition at all** (still generating, failed,
 * or interrupted): edition rows are what name a period id, so a period that never published cannot be
 * found by iterating rows. A missing capability reads as "no runs known", never as "all finished".
 */
export async function readPeriodRuns(
  store: Readonly<{ listPeriodRuns?: (from: string, to: string) => Promise<readonly DailyBriefingPeriodRun[]> }>,
  from: string,
  to: string
): Promise<readonly DailyBriefingPeriodRun[]> {
  if (!store.listPeriodRuns) return Object.freeze([])
  return store.listPeriodRuns(from, to).catch(() => Object.freeze([]))
}
