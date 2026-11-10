import { createJsonFileStorage } from '@platform/storage/jsonFileStorage'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { BriefingPeriod, BriefingPeriodDraft } from '../../../contracts/dailyBriefingPeriod'
import { runBriefingPeriodDataMigration, type LegacySavedPeriod } from './dailyBriefingPeriodDataMigration'
import { createBriefingPeriodStore, type BriefingPeriodSaveResult } from './dailyBriefingPeriodStore'

/**
 * The runtime's period list: the reader's own configuration, not the old global settings.
 *
 * This is the switch §11.6b names. It never creates a period: a never-configured install reads as
 * one default period in the reader's language, which is the same schedule the old settings produced
 * when the reader never changed them. The one thing it writes is a period's missing `language`,
 * filled in once, into that row and no other.
 *
 * It also runs the one-time move of the old generation settings' periods into this file, on the
 * first read and never again in this process. That is the last moment that can be trusted to be
 * before anything acts on periods: the job registration below reads this list during module start,
 * and — unlike a call at construction time — the first read happens after the services this move
 * reads have been assembled.
 *
 * The store is created here rather than shared with the IPC seam because both sides build one over
 * the same file: one creates periods when the reader asks, this one answers "what is configured
 * now". Neither can lock the file against the other, so the language repair merges by id.
 */
export function createBriefingPeriodsSource(input: Readonly<{
  filePath: string
  /** The reader's interface language, asked lazily: the answer can change between calls. */
  locale: () => Promise<DailyBriefingLocale>
  /**
   * Lazy, and only read when a stored period is missing its language: the links of every edition
   * before today, as periodId → the languages those editions were written in.
   */
  editionLocales?: () => Promise<ReadonlyMap<string, ReadonlySet<DailyBriefingLocale>>>
  /**
   * The old generation settings, read only by the one-time move. Absent where periods are not the
   * runtime's source (tests, or a build that has not switched yet).
   */
  legacyPeriodsMigration?: Readonly<{
    readLegacyPeriods: () => Promise<readonly LegacySavedPeriod[]>
    additionalLanguages: () => Promise<readonly DailyBriefingLocale[]>
    /** Platform log: the move's failures are reported there, never swallowed. */
    log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  }>
  /**
   * Called after a write through `editor` actually saved. The schedule is rebuilt from the same
   * file the runtime reads, so a hour changed in settings takes effect without a restart.
   */
  onPeriodsChanged?: () => void
}>): Readonly<{
  getPeriods: () => Promise<readonly BriefingPeriod[]>
  /**
   * The settings seam's write path, over the same store the runtime reads: the first period is
   * edited by id, a store with no periods creates one. Both wait for the one-time move first, so a
   * save can never act on a file the migration has not written yet.
   */
  editor: Readonly<{
    list: (locale: DailyBriefingLocale) => Promise<readonly BriefingPeriod[]>
    update: (id: string, draft: BriefingPeriodDraft) => Promise<BriefingPeriodSaveResult>
    create: (draft: BriefingPeriodDraft) => Promise<BriefingPeriodSaveResult>
  }>
}> {
  const storage = createJsonFileStorage<unknown>(input.filePath, undefined)
  const store = createBriefingPeriodStore({
    storage,
    // Only reached when the caller passes no language; every call below passes the reader's own.
    defaultLanguage: () => 'zh-CN',
    ...(input.editionLocales ? { editionLocales: input.editionLocales } : {})
  })
  // Started once, on the first read, and awaited by every read: two readers arriving together must
  // not both decide the file is empty and both migrate. A failed move is a result, not an error —
  // it is reported on the platform log with its reason, the old settings stay the source, and the
  // next start retries.
  let prepared: Promise<unknown> | undefined
  const prepare = (): Promise<unknown> => {
    if (prepared === undefined) {
      prepared = input.legacyPeriodsMigration
        ? runBriefingPeriodDataMigration({
          storage,
          language: input.locale,
          now: () => new Date().toISOString(),
          ...input.legacyPeriodsMigration
        }).then(() => undefined, () => undefined)
        : Promise.resolve()
    }
    return prepared
  }
  return Object.freeze({
    getPeriods: async () => {
      await prepare()
      return store.list(await input.locale())
    },
    editor: Object.freeze({
      list: async (locale: DailyBriefingLocale) => {
        await prepare()
        return store.list(locale)
      },
      update: async (id: string, draft: BriefingPeriodDraft) => {
        await prepare()
        const result = await store.update(id, draft)
        if (result.state === 'saved') input.onPeriodsChanged?.()
        return result
      },
      create: async (draft: BriefingPeriodDraft) => {
        await prepare()
        const result = await store.create(draft)
        if (result.state === 'saved') input.onPeriodsChanged?.()
        return result
      }
    })
  })
}
