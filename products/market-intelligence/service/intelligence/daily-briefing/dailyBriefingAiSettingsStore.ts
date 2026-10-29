import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  hasHalfBoundDailyBriefingModel,
  normalizeDailyBriefingAiSettings,
  type DailyBriefingAiSettings
} from '../schema/dailyBriefingAiSettings'

export type DailyBriefingAiSettingsStorage = Readonly<{
  read: () => Promise<DailyBriefingAiSettings | undefined>
  write: (settings: DailyBriefingAiSettings) => Promise<void>
}>

export type DailyBriefingAiSettingsStore = Readonly<{
  getSettings: () => Promise<DailyBriefingAiSettings>
  save: (settings: DailyBriefingAiSettings) => Promise<DailyBriefingAiSettings>
}>

export function createInMemoryDailyBriefingAiSettingsStorage(
  initial?: DailyBriefingAiSettings
): DailyBriefingAiSettingsStorage {
  let settings = initial
  return {
    async read() { return settings },
    async write(next) { settings = next }
  }
}

export function createDailyBriefingAiSettingsJsonStorage(filePath: string): DailyBriefingAiSettingsStorage {
  return {
    async read() {
      try {
        return normalizeDailyBriefingAiSettings(JSON.parse(await readFile(filePath, 'utf8')) as Partial<DailyBriefingAiSettings>)
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

export function createDailyBriefingAiSettingsStore(
  storage: DailyBriefingAiSettingsStorage,
  now: () => string = () => new Date().toISOString()
): DailyBriefingAiSettingsStore {
  return {
    async getSettings() {
      return normalizeDailyBriefingAiSettings(await storage.read(), now())
    },
    async save(settings) {
      const normalized = normalizeDailyBriefingAiSettings(settings, now())
      if (hasHalfBoundDailyBriefingModel(normalized)) throw new Error('daily-briefing-model-half-bound')
      await storage.write(normalized)
      return normalized
    }
  }
}
