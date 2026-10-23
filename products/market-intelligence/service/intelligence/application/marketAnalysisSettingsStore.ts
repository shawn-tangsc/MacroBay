import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  createDefaultMarketAnalysisSettings,
  normalizeMarketAnalysisSettings,
  type MarketAnalysisSettings
} from './marketAnalysisSettings'

/**
 * Persistence for the analysis switches. This layer stores; it does not decide. Whether an empty
 * model may fall back to the platform default, and whether a chosen model can actually be called,
 * belongs to `marketAnalysisSettingsService`.
 */
export type MarketAnalysisSettingsStorage = Readonly<{
  read: () => Promise<MarketAnalysisSettings | undefined>
  write: (settings: MarketAnalysisSettings) => Promise<void>
}>

export type MarketAnalysisSettingsStore = Readonly<{
  getSettings: () => Promise<MarketAnalysisSettings>
  save: (settings: MarketAnalysisSettings) => Promise<MarketAnalysisSettings>
}>

export function createInMemoryMarketAnalysisSettingsStorage(
  initial?: MarketAnalysisSettings
): MarketAnalysisSettingsStorage {
  let settings = initial
  return {
    async read() {
      return settings
    },
    async write(next) {
      settings = next
    }
  }
}

export function createMarketAnalysisSettingsJsonStorage(filePath: string): MarketAnalysisSettingsStorage {
  return {
    async read() {
      try {
        const raw = await readFile(filePath, 'utf8')
        return normalizeMarketAnalysisSettings(JSON.parse(raw) as Partial<MarketAnalysisSettings>)
      } catch {
        // A missing or corrupt file is "never configured", never a crash on startup.
        return undefined
      }
    },
    async write(settings) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8')
    }
  }
}

export function createMarketAnalysisSettingsStore(
  storage: MarketAnalysisSettingsStorage,
  now: () => string = () => new Date().toISOString()
): MarketAnalysisSettingsStore {
  let cache: MarketAnalysisSettings | null = null

  async function load(): Promise<MarketAnalysisSettings> {
    if (cache) return cache
    cache = (await storage.read()) ?? createDefaultMarketAnalysisSettings(now())
    return cache
  }

  return {
    async getSettings() {
      return load()
    },
    async save(settings) {
      const next = normalizeMarketAnalysisSettings(settings, now())
      cache = next
      await storage.write(next)
      return next
    }
  }
}
