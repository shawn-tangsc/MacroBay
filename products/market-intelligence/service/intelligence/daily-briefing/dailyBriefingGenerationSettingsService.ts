import { readFile } from 'node:fs/promises'

import { writeJsonFileAtomically } from '@platform/storage/jsonFileStorage'

import type { DailyBriefingWindowHours } from '../../../contracts/dailyBriefing'
import {
  applyDailyBriefingGenerationSettingsPatch,
  dailyBriefingGenerationCronExpression,
  isDailyBriefingTimeZoneId,
  normalizeDailyBriefingGenerationSettings,
  type DailyBriefingGenerationSettings,
  type DailyBriefingGenerationSettingsPatch
} from './dailyBriefingGenerationSettings'

/** The reader-facing shape. `cronExpression` is derived from the time, never stored. */
export type DailyBriefingGenerationSettingsView = Readonly<{
  generationTime: string
  /** The zone the time means, or null while it is unknown or unreadable. */
  generationTimeZone: string | null
  /** The value the reader saved when it was not a usable id; automatic generation is paused. */
  generationTimeZoneInvalid: string | null
  windowHours: DailyBriefingWindowHours
  cronExpression: string
}>

export type DailyBriefingGenerationSettingsStorage = Readonly<{
  read: () => Promise<Partial<DailyBriefingGenerationSettings> | undefined>
  write: (settings: DailyBriefingGenerationSettings) => Promise<void>
}>

export type DailyBriefingGenerationSettingsService = Readonly<{
  getSettings: () => Promise<DailyBriefingGenerationSettings>
  getView: () => Promise<DailyBriefingGenerationSettingsView>
  save: (patch: DailyBriefingGenerationSettingsPatch) => Promise<DailyBriefingGenerationSettingsView>
  /**
   * Move the stored zone to the reader's display zone after they change it.
   *
   * The schedule's clock has to follow the reader: 08:05 was meant as their 08:05, and leaving the
   * old zone behind means the job fires at one boundary while the page counts its day at another —
   * which is how one real day produced two editions. Returns the settings as they now read; a write
   * is skipped when the zone already matches.
   */
  reanchor: (timeZone: string) => Promise<DailyBriefingGenerationSettings>
}>

export function createInMemoryDailyBriefingGenerationSettingsStorage(
  initial?: DailyBriefingGenerationSettings
): DailyBriefingGenerationSettingsStorage {
  let settings = initial
  return {
    async read() { return settings },
    async write(next) { settings = next }
  }
}

export function createDailyBriefingGenerationSettingsJsonStorage(filePath: string): DailyBriefingGenerationSettingsStorage {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(filePath, 'utf8')) as Partial<DailyBriefingGenerationSettings>
      } catch {
        return undefined
      }
    },
    async write(settings) {
      await writeJsonFileAtomically(filePath, settings)
    }
  }
}

/**
 * Owns the schedule setting, not the schedule itself. `onSaved` is how the caller re-registers the
 * job: the settings service never touches the job runtime, so a failed reschedule cannot roll back a
 * saved preference, and the next startup applies the stored value anyway.
 */
export function createDailyBriefingGenerationSettingsService(deps: Readonly<{
  storage: DailyBriefingGenerationSettingsStorage
  now?: () => string
  /**
   * The reader's display zone. It is only read while the stored setting has no zone of its own:
   * a bare 08:05 was always meant as the reader's 08:05, so that is what it is migrated to.
   */
  timeZone?: () => string
  onSaved?: (settings: DailyBriefingGenerationSettings) => void
}>): DailyBriefingGenerationSettingsService {
  const now = deps.now ?? (() => new Date().toISOString())

  function view(settings: DailyBriefingGenerationSettings): DailyBriefingGenerationSettingsView {
    return Object.freeze({
      generationTime: settings.generationTime,
      generationTimeZone: settings.generationTimeZone ?? null,
      generationTimeZoneInvalid: settings.generationTimeZoneInvalid ?? null,
      windowHours: settings.windowHours,
      cronExpression: dailyBriefingGenerationCronExpression(settings)
    })
  }

  /**
   * Read the setting, filling in the missing zone exactly once.
   *
   * The write is idempotent by construction: it only happens while the stored file has no zone, and
   * the next read sees the zone and writes nothing. The moment is never changed — the same 08:05
   * that used to mean "whatever the display zone currently is" now says which zone that was.
   */
  async function load(): Promise<DailyBriefingGenerationSettings> {
    const stored = await deps.storage.read().catch(() => undefined)
    const normalized = normalizeDailyBriefingGenerationSettings(stored, now())
    // A saved value that is not a usable id is reported, not repaired: repairing it would hide the
    // typo and quietly move the schedule.
    if (normalized.generationTimeZone || normalized.generationTimeZoneInvalid) return normalized
    const zone = deps.timeZone?.()
    if (!isDailyBriefingTimeZoneId(zone)) return normalized
    const migrated = normalizeDailyBriefingGenerationSettings({ ...normalized, generationTimeZone: zone }, now())
    // A failed write leaves the setting exactly as stored; the next read tries again.
    await deps.storage.write(migrated).catch(() => undefined)
    return migrated
  }

  async function applyReanchor(current: DailyBriefingGenerationSettings, timeZone: string): Promise<DailyBriefingGenerationSettings> {
    const next = normalizeDailyBriefingGenerationSettings({ ...current, generationTimeZone: timeZone }, now())
    await deps.storage.write(next).catch(() => undefined)
    return next
  }

  return {
    async getSettings() {
      return load()
    },
    async getView() {
      return view(await load())
    },
    async reanchor(timeZone) {
      const current = await load()
      if (!isDailyBriefingTimeZoneId(timeZone) || current.generationTimeZone === timeZone) return current
      const next = await applyReanchor(current, timeZone)
      return next
    },
    async save(patch) {
      const current = await load()
      const next = applyDailyBriefingGenerationSettingsPatch(current, { generationTimeZone: deps.timeZone?.(), ...patch }, now())
      await deps.storage.write(next)
      deps.onSaved?.(next)
      return view(next)
    }
  }
}
