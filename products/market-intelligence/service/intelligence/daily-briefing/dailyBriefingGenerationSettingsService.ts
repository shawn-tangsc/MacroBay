import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { DailyBriefingWindowHours } from '../../../contracts/dailyBriefing'
import {
  applyDailyBriefingGenerationSettingsPatch,
  dailyBriefingGenerationCronExpression,
  normalizeDailyBriefingGenerationSettings,
  type DailyBriefingGenerationSettings,
  type DailyBriefingGenerationSettingsPatch
} from './dailyBriefingGenerationSettings'

/** The reader-facing shape. `cronExpression` is derived from the time, never stored. */
export type DailyBriefingGenerationSettingsView = Readonly<{
  generationTime: string
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
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8')
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
  onSaved?: (settings: DailyBriefingGenerationSettings) => void
}>): DailyBriefingGenerationSettingsService {
  const now = deps.now ?? (() => new Date().toISOString())

  function view(settings: DailyBriefingGenerationSettings): DailyBriefingGenerationSettingsView {
    return Object.freeze({
      generationTime: settings.generationTime,
      windowHours: settings.windowHours,
      cronExpression: dailyBriefingGenerationCronExpression(settings)
    })
  }

  return {
    async getSettings() {
      return normalizeDailyBriefingGenerationSettings(await deps.storage.read().catch(() => undefined), now())
    },
    async getView() {
      return view(normalizeDailyBriefingGenerationSettings(await deps.storage.read().catch(() => undefined), now()))
    },
    async save(patch) {
      const current = normalizeDailyBriefingGenerationSettings(await deps.storage.read().catch(() => undefined), now())
      const next = applyDailyBriefingGenerationSettingsPatch(current, patch, now())
      await deps.storage.write(next)
      deps.onSaved?.(next)
      return view(next)
    }
  }
}
