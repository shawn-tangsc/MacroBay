import { randomUUID } from 'node:crypto'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import {
  createDefaultBriefingPeriod,
  type BriefingPeriod,
  type BriefingPeriodDraft
} from '../../../contracts/dailyBriefingPeriod'
import {
  applyPeriodLanguageRepairs,
  briefingPeriodConflict,
  briefingPeriodDraftIssue,
  briefingPeriodsDocument,
  readBriefingPeriodsWithRepair,
  removeBriefingPeriodRow,
  upsertBriefingPeriodRow,
  type BriefingPeriodDraftIssue,
  type BriefingPeriodLanguageRepair
} from './dailyBriefingPeriodValidation'

/**
 * The reader's period configuration, in its own file.
 *
 * It is a new store rather than the old "one period per day" settings shape: a period is an entity
 * with an identity that editions point at, not a daily setting. A read writes only to fill in a
 * missing `language` once, and only into the rows that lacked one. A save touches one row: adding,
 * editing or deleting writes that id and leaves every other row — including a row this build cannot
 * read — exactly as it came in. A file that was never written reads as one default period in
 * memory, so a fresh install still has a schedule; a file that exists and holds no periods is a
 * reader who deleted them all, and it stays empty.
 */
export type BriefingPeriodStorage = Readonly<{
  /**
   * Whatever is on disk, unparsed: reading is the pure reader's job.
   *
   * `undefined` means the file does not exist — never configured. A file that exists with an empty
   * `periods` array is a different fact: the reader deleted every period, and that is a real state.
   */
  read: () => Promise<unknown | undefined>
  /**
   * The whole JSON value, not a list of periods: the language repair writes the file back with only
   * the missing languages filled in, so rows and keys this build cannot read must pass through
   * untouched. Handing this a validated list would make the drop impossible to avoid.
   */
  write: (value: unknown) => Promise<void>
}>

export type BriefingPeriodSaveResult =
  | Readonly<{ state: 'saved'; period: BriefingPeriod; periods: readonly BriefingPeriod[] }>
  | Readonly<{ state: 'rejected'; code: 'daily-briefing-period-invalid'; issue: BriefingPeriodDraftIssue }>
  | Readonly<{ state: 'rejected'; code: 'daily-briefing-period-duplicate'; conflict: BriefingPeriod }>
  | Readonly<{ state: 'rejected'; code: 'daily-briefing-period-missing'; id: string }>

export type BriefingPeriodRemoveResult =
  | Readonly<{ state: 'removed'; id: string; periods: readonly BriefingPeriod[] }>
  | Readonly<{ state: 'missing'; id: string }>

export type BriefingPeriodStore = Readonly<{
  /**
   * The configured periods, or the one default period when nothing is configured. `language` is the
   * reader's current interface language: the never-configured fallback period speaks it. When the
   * caller does not know it, the store's own fallback is used.
   */
  list: (language?: DailyBriefingLocale) => Promise<readonly BriefingPeriod[]>
  create: (draft: BriefingPeriodDraft, language?: DailyBriefingLocale) => Promise<BriefingPeriodSaveResult>
  /** Replaces one period's values while keeping its id: moving the hour never changes identity. */
  update: (id: string, draft: BriefingPeriodDraft, language?: DailyBriefingLocale) => Promise<BriefingPeriodSaveResult>
  remove: (id: string, language?: DailyBriefingLocale) => Promise<BriefingPeriodRemoveResult>
}>

export function createBriefingPeriodStore(deps: Readonly<{
  storage: BriefingPeriodStorage
  /** The language an empty configuration reads as; the caller owns the reader's interface language. */
  defaultLanguage: () => DailyBriefingLocale
  /** Test seams; production takes a random opaque id. */
  newId?: () => string
  /**
   * The languages the editions of a period were actually written in, read lazily and only when a
   * period from before the language belonged to a period needs one. A set with exactly one entry
   * is a fact; anything else cannot name a language.
   */
  editionLocales?: () => Promise<ReadonlyMap<string, ReadonlySet<DailyBriefingLocale>>>
}>): BriefingPeriodStore {
  const newId = deps.newId ?? (() => `period_${randomUUID()}`)

  /**
   * Fill in the missing languages **in the file as it is now**, not in the list we read.
   *
   * Two reasons, both about not losing data. The list above is filtered (a row this build cannot
   * run is left out of it), so writing that list back would delete every such row in the same
   * file. And re-reading here merges the other writer: a period added between our read and this
   * write is still there afterwards instead of being overwritten by it.
   */
  const writeLanguageRepairs = async (repairs: readonly BriefingPeriodLanguageRepair[]): Promise<void> => {
    const latest = await deps.storage.read()
    if (latest === undefined) return
    const patched = applyPeriodLanguageRepairs(latest, repairs)
    if (patched.changed) await deps.storage.write(patched.value)
  }

  const readEffective = async (language?: DailyBriefingLocale): Promise<readonly BriefingPeriod[]> => {
    const raw = await deps.storage.read()
    // Never configured: one period, so a fresh install still has a schedule, in the reader's own
    // language (the caller passes it; the constructor's fallback is only for callers that cannot).
    if (raw === undefined) return Object.freeze([createDefaultBriefingPeriod(language ?? deps.defaultLanguage())])
    // Configured and empty: the reader deleted every period. Inventing a default here would put a
    // 07:00 row back that nobody configured — the same class of lie as made-up data.
    // The one exception to "reads never write": a period written before language belonged to a
    // period gets one (fact from its editions, otherwise the interface language) and the repaired
    // file is written back **once**. The next read finds every language present and stops.
    const repairedRead = await readBriefingPeriodsWithRepair(raw, {
      fallbackLanguage: language ?? deps.defaultLanguage(),
      ...(deps.editionLocales ? { editionLocales: deps.editionLocales } : {})
    })
    if (repairedRead.languageRepairs.length > 0) await writeLanguageRepairs(repairedRead.languageRepairs)
    return repairedRead.periods
  }

  // One operation at a time per store: two readers acting together must not both read, both write,
  // and let the later write forget the earlier one. This cannot cover the IPC seam, which builds
  // its own store over the same file — that is why the repair merges by id instead of replacing.
  let tail: Promise<unknown> = Promise.resolve()
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation)
    tail = run.then(() => undefined, () => undefined)
    return run
  }

  return Object.freeze({
    list: (language?: DailyBriefingLocale) => serialized(() => readEffective(language)),

    create: (draft, language) => serialized(async () => {
      const issue = briefingPeriodDraftIssue(draft)
      if (issue) return { state: 'rejected', code: 'daily-briefing-period-invalid', issue }
      const current = await readEffective(language)
      const conflict = briefingPeriodConflict(current, draft)
      if (conflict) return { state: 'rejected', code: 'daily-briefing-period-duplicate', conflict }
      const period: BriefingPeriod = Object.freeze({
        id: newId(),
        generationTime: draft.generationTime,
        windowHours: draft.windowHours as BriefingPeriod['windowHours'],
        language: draft.language
      })
      // The file is rewritten **around** this row, not replaced by the list above: a row this build
      // cannot read is still the reader's row, and adding one period is no licence to drop it. When
      // there is no file yet, the fallback default becomes a real row here — otherwise the one that
      // was only implied would vanish on the next read.
      const raw = await deps.storage.read()
      await deps.storage.write(raw === undefined
        ? briefingPeriodsDocument([...current.filter((entry) => entry.id !== period.id), period])
        : upsertBriefingPeriodRow(raw, period))
      // The answer is what the settings surface now shows, not what the file holds: hidden rows stay
      // hidden until a build can read them.
      return { state: 'saved' as const, period, periods: Object.freeze([...current.filter((entry) => entry.id !== period.id), period]) }
    }),

    update: (id, draft, language) => serialized(async () => {
      const issue = briefingPeriodDraftIssue(draft)
      if (issue) return { state: 'rejected', code: 'daily-briefing-period-invalid', issue }
      const current = await readEffective(language)
      const existing = current.find((entry) => entry.id === id)
      if (!existing) return { state: 'rejected', code: 'daily-briefing-period-missing', id }
      const conflict = briefingPeriodConflict(current, draft, id)
      if (conflict) return { state: 'rejected', code: 'daily-briefing-period-duplicate', conflict }
      const period: BriefingPeriod = Object.freeze({
        ...existing,
        generationTime: draft.generationTime,
        windowHours: draft.windowHours as BriefingPeriod['windowHours'],
        language: draft.language
      })
      // Keep the list's order: an edit must not make the reader's rows jump around.
      const periods = Object.freeze(current.map((entry) => entry.id === id ? period : entry))
      const raw = await deps.storage.read()
      await deps.storage.write(raw === undefined ? briefingPeriodsDocument(periods) : upsertBriefingPeriodRow(raw, period))
      return { state: 'saved' as const, period, periods }
    }),

    remove: (id, language) => serialized(async () => {
      const current = await readEffective(language)
      if (!current.some((entry) => entry.id === id)) return { state: 'missing', id }
      const periods = Object.freeze(current.filter((entry) => entry.id !== id))
      const raw = await deps.storage.read()
      await deps.storage.write(raw === undefined ? briefingPeriodsDocument([]) : removeBriefingPeriodRow(raw, id))
      return { state: 'removed' as const, id, periods }
    })
  })
}
