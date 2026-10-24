import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { NewsSentimentSettings } from '../schema/newsSentiment'
import {
  applyNewsSentimentSettingsPatch,
  createDefaultNewsSentimentSettings,
  normalizeNewsSentimentSettings
} from './newsSentimentSettings'

export type NewsSentimentSettingsStorage = Readonly<{
  read: () => Promise<NewsSentimentSettings | undefined>
  write: (settings: NewsSentimentSettings) => Promise<void>
}>

export type NewsSentimentSettingsStore = Readonly<{
  getSettings: () => Promise<NewsSentimentSettings>
  save: (patch: Partial<NewsSentimentSettings>) => Promise<NewsSentimentSettings>
}>

export function createInMemoryNewsSentimentSettingsStorage(
  initial?: NewsSentimentSettings
): NewsSentimentSettingsStorage {
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

export function createNewsSentimentSettingsJsonStorage(filePath: string): NewsSentimentSettingsStorage {
  return {
    async read() {
      try {
        const raw = await readFile(filePath, 'utf8')
        return normalizeNewsSentimentSettings(JSON.parse(raw) as Partial<NewsSentimentSettings>)
      } catch {
        // Missing or corrupt settings mean "never configured", never a startup failure.
        return undefined
      }
    },
    async write(settings) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(settings, null, 2), 'utf8')
    }
  }
}

export function createNewsSentimentSettingsStore(
  storage: NewsSentimentSettingsStorage,
  now: () => string = () => new Date().toISOString()
): NewsSentimentSettingsStore {
  let cache: NewsSentimentSettings | null = null

  async function load(): Promise<NewsSentimentSettings> {
    if (cache) return cache
    cache = normalizeNewsSentimentSettings((await storage.read()) ?? undefined, now())
    return cache
  }

  return {
    async getSettings() {
      return load()
    },
    async save(patch) {
      const current = await load()
      const next = applyNewsSentimentSettingsPatch(current, patch, now())
      cache = next
      await storage.write(next)
      return next
    }
  }
}

export { createDefaultNewsSentimentSettings }
