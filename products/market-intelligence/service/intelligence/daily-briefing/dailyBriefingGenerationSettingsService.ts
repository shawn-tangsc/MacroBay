import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { DailyBriefingWindowHours } from '../../../contracts/dailyBriefing'
import {
  applyDailyBriefingGenerationSettingsPatch,
  dailyBriefingGenerationCronExpression,
  firstDailyBriefingPeriod,
  generationTimeZoneIssue,
  isDailyBriefingTimeZoneId,
  readDailyBriefingPeriodsSettings,
  type DailyBriefingGenerationSettingsPatch,
  type DailyBriefingPeriod,
  type DailyBriefingPeriodsSettings
} from './dailyBriefingGenerationSettings'

/**
 * One period as the page reads it. The zone verdict is derived here, never stored, and `cronExpression`
 * is derived from the same time the cutoff uses — so the row and the schedule cannot disagree.
 */
export type DailyBriefingPeriodView = Readonly<{
  id: string
  name?: string
  generationTime: string
  generationTimeZone: string | null
  generationTimeZoneInvalid: string | null
  windowHours: DailyBriefingWindowHours
  cronExpression: string
}>

/** The reader-facing shape. `cronExpression` is derived from the time, never stored. */
export type DailyBriefingGenerationSettingsView = Readonly<{
  generationTime: string
  /** The zone the time means, or null while it is unknown or unreadable. */
  generationTimeZone: string | null
  /** The raw value the reader saved when it is not a usable id; automatic generation is paused. */
  generationTimeZoneInvalid: string | null
  windowHours: DailyBriefingWindowHours
  cronExpression: string
  /**
   * Every saved period, projected. The page renders this list; the flat fields above stay for the
   * callers that only need one period (they are this list's first entry).
   */
  periods: readonly DailyBriefingPeriodView[]
}>

export type DailyBriefingGenerationSettingsStorage = Readonly<{
  /** Whatever is on disk, unparsed: reading is the pure reader's job, not the file's. */
  read: () => Promise<unknown>
  write: (settings: DailyBriefingPeriodsSettings) => Promise<void>
}>

export type DailyBriefingGenerationSettingsService = Readonly<{
  /**
   * The saved periods, unprojected — what the scheduler consumes.
   *
   * Read-only: it never writes, so opening settings or asking for the schedule cannot change what
   * the reader has on disk.
   */
  getPeriods: () => Promise<readonly DailyBriefingPeriod[]>
  getSettings: () => Promise<DailyBriefingPeriodsSettings>
  getView: () => Promise<DailyBriefingGenerationSettingsView>
  save: (patch: DailyBriefingGenerationSettingsPatch) => Promise<DailyBriefingGenerationSettingsView>
  /**
   * The period the reader's display zone applies to — the first one, until this version can show
   * more. It **writes nothing**: a period carries its own zone, and the display zone must not
   * rewrite the file behind the reader's back (that would upgrade an old file without a save).
   */
  reanchor: (timeZone: string) => Promise<DailyBriefingPeriod>
  /** The one zone judgement, exposed so the scheduler and the page share it. */
  generationTimeZoneIssue: typeof generationTimeZoneIssue
}>

export function createInMemoryDailyBriefingGenerationSettingsStorage(
  initial?: unknown
): DailyBriefingGenerationSettingsStorage {
  let stored: unknown = initial
  return {
    async read() { return stored },
    async write(next) { stored = next }
  }
}

export function createDailyBriefingGenerationSettingsJsonStorage(filePath: string): DailyBriefingGenerationSettingsStorage {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(filePath, 'utf8')) as unknown
      } catch {
        return undefined
      }
    },
    async write(settings) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8')
    }
  }
}

/**
 * Owns the schedule setting, not the schedule itself. `onSaved` is how the caller re-registers the
 * job: the settings service never touches the job runtime, so a failed reschedule cannot roll back a
 * saved preference, and the next startup applies the stored value anyway.
 *
 * **Reading never writes.** The old shape becomes periods in memory only; the file changes shape on
 * a reader's save and nowhere else. The previous version filled in a missing zone during a read,
 * which meant simply opening settings rewrote the reader's file — that is the habit this shape
 * cannot afford, because the same read is also the compatibility upgrade.
 */
export function createDailyBriefingGenerationSettingsService(deps: Readonly<{
  storage: DailyBriefingGenerationSettingsStorage
  now?: () => string
  /** The reader's display zone: the meaning of a period that carries none. Read, never stored. */
  timeZone?: () => string
  onSaved?: (period: DailyBriefingPeriod) => void
}>): DailyBriefingGenerationSettingsService {
  const now = deps.now ?? (() => new Date().toISOString())

  function project(period: DailyBriefingPeriod): DailyBriefingPeriodView {
    const storedZone = period.generationTimeZone
    const issue = generationTimeZoneIssue(storedZone)
    const readerZone = deps.timeZone?.()
    // A period with no zone means "the reader's zone", so the page can say which clock it uses
    // without anything being written. A zone we cannot read is reported as the raw value, not
    // repaired and not replaced by the reader's zone.
    return Object.freeze({
      id: period.id,
      ...(period.name ? { name: period.name } : {}),
      generationTime: period.generationTime,
      generationTimeZone: issue ? null : storedZone ?? (isDailyBriefingTimeZoneId(readerZone) ? readerZone! : null),
      generationTimeZoneInvalid: issue ? storedZone ?? null : null,
      windowHours: period.windowHours,
      cronExpression: dailyBriefingGenerationCronExpression(period)
    })
  }

  function view(settings: DailyBriefingPeriodsSettings): DailyBriefingGenerationSettingsView {
    const periods = Object.freeze(settings.periods.map(project))
    const first = periods[0]!
    return Object.freeze({
      generationTime: first.generationTime,
      generationTimeZone: first.generationTimeZone,
      generationTimeZoneInvalid: first.generationTimeZoneInvalid,
      windowHours: first.windowHours,
      cronExpression: first.cronExpression,
      periods
    })
  }

  async function load(): Promise<DailyBriefingPeriodsSettings> {
    let raw: unknown
    try {
      raw = await deps.storage.read()
    } catch {
      raw = undefined
    }
    return readDailyBriefingPeriodsSettings(raw, now())
  }

  return {
    async getPeriods() {
      return (await load()).periods
    },
    async getSettings() {
      return load()
    },
    async getView() {
      return view(await load())
    },
    async reanchor() {
      // A period owns its zone; the display zone only decides what a zone-less period means, and
      // that is decided at the read site. Nothing is persisted here on purpose.
      return firstDailyBriefingPeriod(await load())
    },
    generationTimeZoneIssue,
    async save(patch) {
      const current = await load()
      const next = applyDailyBriefingGenerationSettingsPatch(
        current,
        { generationTimeZone: deps.timeZone?.(), ...patch },
        now()
      )
      await deps.storage.write(next)
      deps.onSaved?.(firstDailyBriefingPeriod(next))
      return view(next)
    }
  }
}