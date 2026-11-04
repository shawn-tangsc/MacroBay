import { randomUUID } from 'node:crypto'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import {
  createDefaultBriefingPeriod,
  type BriefingPeriod,
  type BriefingPeriodDraft
} from '../../../contracts/dailyBriefingPeriod'
import {
  briefingPeriodConflict,
  briefingPeriodDraftIssue,
  readBriefingPeriods,
  type BriefingPeriodDraftIssue
} from './dailyBriefingPeriodValidation'

/**
 * The reader's period configuration, in its own file.
 *
 * It is a new store rather than the old "one period per day" settings shape: a period is an entity
 * with an identity that editions point at, not a daily setting. Reads never write. A file that was
 * never written reads as one default period in memory, so a fresh install still has a schedule; a
 * file that exists and holds no periods is a reader who deleted them all, and it stays empty.
 */
export type BriefingPeriodStorage = Readonly<{
  /**
   * Whatever is on disk, unparsed: reading is the pure reader's job.
   *
   * `undefined` means the file does not exist — never configured. A file that exists with an empty
   * `periods` array is a different fact: the reader deleted every period, and that is a real state.
   */
  read: () => Promise<unknown | undefined>
  write: (value: Readonly<{ version: 1; periods: readonly BriefingPeriod[] }>) => Promise<void>
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
  /** The configured periods, or the one default period when nothing is configured. */
  list: () => Promise<readonly BriefingPeriod[]>
  create: (draft: BriefingPeriodDraft) => Promise<BriefingPeriodSaveResult>
  /** Replaces one period's values while keeping its id: moving the hour never changes identity. */
  update: (id: string, draft: BriefingPeriodDraft) => Promise<BriefingPeriodSaveResult>
  remove: (id: string) => Promise<BriefingPeriodRemoveResult>
}>

export function createBriefingPeriodStore(deps: Readonly<{
  storage: BriefingPeriodStorage
  /** The language an empty configuration reads as; the caller owns the reader's interface language. */
  defaultLanguage: () => DailyBriefingLocale
  /** Test seams; production takes a random opaque id. */
  newId?: () => string
}>): BriefingPeriodStore {
  const newId = deps.newId ?? (() => `period_${randomUUID()}`)

  const readEffective = async (): Promise<readonly BriefingPeriod[]> => {
    const raw = await deps.storage.read()
    // Never configured: one period, so a fresh install still has a schedule.
    if (raw === undefined) return Object.freeze([createDefaultBriefingPeriod(deps.defaultLanguage())])
    // Configured and empty: the reader deleted every period. Inventing a default here would put a
    // 07:00 row back that nobody configured — the same class of lie as made-up data.
    return readBriefingPeriods(raw)
  }

  const persist = async (periods: readonly BriefingPeriod[]): Promise<readonly BriefingPeriod[]> => {
    await deps.storage.write({ version: 1, periods })
    return periods
  }

  return Object.freeze({
    list: readEffective,

    async create(draft) {
      const issue = briefingPeriodDraftIssue(draft)
      if (issue) return { state: 'rejected', code: 'daily-briefing-period-invalid', issue }
      const current = await readEffective()
      const conflict = briefingPeriodConflict(current, draft)
      if (conflict) return { state: 'rejected', code: 'daily-briefing-period-duplicate', conflict }
      const period: BriefingPeriod = Object.freeze({
        id: newId(),
        generationTime: draft.generationTime,
        windowHours: draft.windowHours as BriefingPeriod['windowHours'],
        language: draft.language
      })
      // The fallback default becomes a real row here: once two periods exist, the file has to carry
      // both, otherwise the one that was only implied would vanish on the next read.
      const periods = Object.freeze([...current.filter((entry) => entry.id !== period.id), period])
      return { state: 'saved', period, periods: await persist(periods) }
    },

    async update(id, draft) {
      const issue = briefingPeriodDraftIssue(draft)
      if (issue) return { state: 'rejected', code: 'daily-briefing-period-invalid', issue }
      const current = await readEffective()
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
      return { state: 'saved', period, periods: await persist(periods) }
    },

    async remove(id) {
      const current = await readEffective()
      if (!current.some((entry) => entry.id === id)) return { state: 'missing', id }
      const periods = Object.freeze(current.filter((entry) => entry.id !== id))
      return { state: 'removed', id, periods: await persist(periods) }
    }
  })
}
