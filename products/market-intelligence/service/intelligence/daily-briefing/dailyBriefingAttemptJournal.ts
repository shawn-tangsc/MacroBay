import type {
  BriefingGenerationTrace,
  DailyBriefingLocale,
  DailyBriefingRunTrigger
} from '../../../contracts/dailyBriefing'
import type { DailyBriefingStore } from './dailyBriefingService'

export type DailyBriefingAttemptStart = Readonly<{
  date: string
  /** Which issue this attempt belongs to; absent means `default`. */
  periodId?: string
  locale: DailyBriefingLocale
  startedAt: string
  /**
   * 这一次跑是怎么来的、覆盖多长的窗口、名义截止是哪一刻：写进尝试记录，列表据此说清这一行的
   * 身份（用户 2026-11-06；`nominalAt` 是 0.4.2 #19 补的）。缺省表示调用方不知道——老记录与
   * 旧调用点，界面写「未记录」，绝不拿当前设置回填。
   */
  trigger?: DailyBriefingRunTrigger
  windowHours?: number
  /** 这一次跑的窗口右端（`asOf`）：失败行没有正文，只能从这里知道自己该写哪个截止。 */
  nominalAt?: string
}>

/** The same row, settled. It is updated in place, never deleted: the attempt is history. */
export type DailyBriefingAttemptEnd = Readonly<{
  date: string
  periodId?: string
  locale: DailyBriefingLocale
  attemptNo: number
  state: 'succeeded' | 'failed'
  finishedAt: string
  failureCode?: string
  /** A failed attempt has no document, so its stage trace is the only record of what happened. */
  trace?: BriefingGenerationTrace
}>

/**
 * The attempt row of one generation: opened when the work starts, settled when it ends.
 *
 * Kept out of the service because the row gains fields and the service file sits at the size
 * ceiling: the service decides *when* an attempt begins and ends, this module decides how the row
 * is written. An attempt that is never settled stays `running`, which is exactly what an interrupted
 * run should look like to a later reader.
 */
export type DailyBriefingAttemptJournal = Readonly<{
  /** Whether this run has an attempt row; false means the store refused to write one. */
  open: () => Promise<boolean>
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
    now: () => string
    /** 这一次跑的来源、窗口与名义截止：写进尝试记录，列表据此说清这一行的身份。 */
    trigger?: DailyBriefingRunTrigger
    windowHours?: number
    nominalAt?: string
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
      // Never swallowed: a run that leaves no attempt row cannot be audited afterwards — "no attempt"
      // would then mean either "nothing ran" or "it ran and could not record itself". The answer goes
      // back to the caller, which fails the run instead of continuing unrecorded.
      try {
        attemptNo = await store.beginAttempt?.({
          date: input.date,
          periodId: input.periodId,
          locale: input.locale,
          startedAt: input.now(),
          ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
          ...(input.windowHours === undefined ? {} : { windowHours: input.windowHours }),
          ...(input.nominalAt === undefined ? {} : { nominalAt: input.nominalAt })
        })
        return true
      } catch {
        return false
      }
    },
    build,
    settle
  })
}
