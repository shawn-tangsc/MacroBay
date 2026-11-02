import { readFile } from 'node:fs/promises'

import { writeJsonFileAtomically } from '@platform/storage/jsonFileStorage'

import {
  createDefaultFocusMarketSettings,
  normalizeFocusMarketSettings,
  type IntelligenceFocusMarketSettings
} from './intelligenceFocusSettings'

export type IntelligenceFocusSettingsStorage = {
  read: () => Promise<IntelligenceFocusMarketSettings | undefined>
  write: (settings: IntelligenceFocusMarketSettings) => Promise<void>
}

export type IntelligenceFocusSettingsStore = {
  getSettings: () => Promise<IntelligenceFocusMarketSettings>
  saveSettings: (input: Partial<IntelligenceFocusMarketSettings>) => Promise<IntelligenceFocusMarketSettings>
}

export function createInMemoryFocusSettingsStorage(
  initial?: IntelligenceFocusMarketSettings
): IntelligenceFocusSettingsStorage {
  let settings = initial ?? createDefaultFocusMarketSettings()
  return {
    async read() {
      return settings
    },
    async write(next) {
      settings = next
    }
  }
}

export function createFocusSettingsJsonStorage(filePath: string): IntelligenceFocusSettingsStorage {
  return {
    async read() {
      try {
        const raw = await readFile(filePath, 'utf8')
        return normalizeFocusMarketSettings(JSON.parse(raw) as Partial<IntelligenceFocusMarketSettings>)
      } catch {
        return undefined
      }
    },
    async write(settings) {
      await writeJsonFileAtomically(filePath, settings)
    }
  }
}

export function createIntelligenceFocusSettingsStore(
  storage: IntelligenceFocusSettingsStorage
): IntelligenceFocusSettingsStore {
  let cache: IntelligenceFocusMarketSettings | null = null

  async function loadSettings(): Promise<IntelligenceFocusMarketSettings> {
    if (cache) return cache
    cache = normalizeFocusMarketSettings(await storage.read())
    return cache
  }

  return {
    async getSettings() {
      return loadSettings()
    },
    async saveSettings(input) {
      const current = await loadSettings()
      const next = normalizeFocusMarketSettings({
        ...current,
        ...input,
        updatedAt: new Date().toISOString()
      })
      cache = next
      await storage.write(next)
      return next
    }
  }
}
