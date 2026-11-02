import type {
  BriefingGenerationTrace,
  DailyBriefingLocale
} from '../../../contracts/dailyBriefing'
import type { DailyBriefingAttemptEnd, DailyBriefingStore } from './dailyBriefingService'

/**
 * The attempt row of one generation: opened when the work starts, settled when it ends.
 *
 * Kept out of the service because the row gains fields and the service file sits at the size
 * ceiling: the service decides *when* an attempt begins and ends, this module decides how the row
 * is written. An attempt that is never settled stays `running`, which is exactly what an interrupted
 * run should look like to a later reader.
 */
export type DailyBriefingAttemptJournal = Readonly<{
  open: () => Promise<void>
  /** The settled row, for the call that has to write it together with the edition. */
  build: (
    state: 'succeeded' | 'failed',
    finishedAt: string,
    extra?: Readonly<{ failureCode?: string; trace?: BriefingGenerationTrace }>
  ) => DailyBriefingAttemptEnd | undefined
  settle: (
    state: 'succeeded' | 'failed',
    finishedAt: string,
    extra?: Readonly<{ failureCode?: string; trace?: BriefingGenerationTrace }>
  ) => Promise<void>
}>

export function createDailyBriefingAttemptJournal(
  store: DailyBriefingStore,
  input: Readonly<{
    date: string
    periodId: string
    locale: DailyBriefingLocale
    /** Called at open time, not at construction: the row records when the work actually started. */
    now: () => string
  }>
): DailyBriefingAttemptJournal {
  let attemptNo: number | undefined

  const build: DailyBriefingAttemptJournal['build'] = (state, finishedAt, extra = {}) => {
    if (attemptNo === undefined) return undefined
    return {
      date: input.date,
      periodId: input.periodId,
      locale: input.locale,
      attemptNo,
      state,
      finishedAt,
      ...(extra.failureCode ? { failureCode: extra.failureCode } : {}),
      ...(extra.trace ? { trace: extra.trace } : {})
    }
  }

  const settle: DailyBriefingAttemptJournal['settle'] = async (state, finishedAt, extra = {}) => {
    const attempt = build(state, finishedAt, extra)
    if (!attempt) return
    await store.finishAttempt?.(attempt).catch(() => undefined)
  }

  return Object.freeze({
    async open() {
      attemptNo = await store.beginAttempt?.({
        date: input.date,
        periodId: input.periodId,
        locale: input.locale,
        startedAt: input.now()
      }).catch(() => undefined)
    },
    build,
    settle
  })
}
