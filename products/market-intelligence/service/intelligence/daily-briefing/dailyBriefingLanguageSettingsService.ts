import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import {
  applyEditionLanguageSettingsPatch,
  readEditionLanguageSettings,
  resolveGenerationLanguages,
  type EditionLanguageSettings,
  type EditionLanguageSettingsPatch,
  type GenerationLanguagesPlan
} from './dailyBriefingLanguageSettings'

export type EditionLanguageSettingsStorage = Readonly<{
  read: () => Promise<unknown>
  write: (settings: EditionLanguageSettings) => Promise<void>
}>

export type EditionLanguageSettingsView = Readonly<{
  settings: Readonly<{ primary: 'follow-ui'; additional: readonly DailyBriefingLocale[] }>
  /** The plan the page renders: primary language, fallback reason, and how many writing passes. */
  plan: GenerationLanguagesPlan
}>

export type EditionLanguageSettingsService = Readonly<{
  getSettings: () => Promise<EditionLanguageSettings>
  getPlan: () => Promise<GenerationLanguagesPlan>
  getView: () => Promise<EditionLanguageSettingsView>
  save: (patch: EditionLanguageSettingsPatch) => Promise<EditionLanguageSettingsView>
}>

export function createInMemoryEditionLanguageSettingsStorage(initial?: unknown): EditionLanguageSettingsStorage {
  let stored: unknown = initial
  return {
    async read() { return stored },
    async write(next) { stored = next }
  }
}

export function createEditionLanguageSettingsJsonStorage(filePath: string): EditionLanguageSettingsStorage {
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
 * Owns the global language preference and the plan derived from it.
 *
 * Reading never writes: a missing file is the default, and the plan (which languages, how many
 * writing passes) is computed on every read so it cannot go stale against the stored preference.
 */
export function createEditionLanguageSettingsService(deps: Readonly<{
  storage: EditionLanguageSettingsStorage
  /** The interface language, reported by the platform; read on every plan so a switch applies at once. */
  uiLanguage: () => Promise<string> | string
  now?: () => string
}>): EditionLanguageSettingsService {
  const now = deps.now ?? (() => new Date().toISOString())

  async function load(): Promise<EditionLanguageSettings> {
    let raw: unknown
    try {
      raw = await deps.storage.read()
    } catch {
      raw = undefined
    }
    return readEditionLanguageSettings(raw, now())
  }

  async function plan(settings: EditionLanguageSettings): Promise<GenerationLanguagesPlan> {
    return resolveGenerationLanguages({ settings, uiLanguage: await deps.uiLanguage() })
  }

  async function view(settings: EditionLanguageSettings): Promise<EditionLanguageSettingsView> {
    return Object.freeze({
      settings: Object.freeze({ primary: settings.primary, additional: settings.additional }),
      plan: await plan(settings)
    })
  }

  return {
    getSettings: load,
    async getPlan() {
      return plan(await load())
    },
    async getView() {
      return view(await load())
    },
    async save(patch) {
      const next = applyEditionLanguageSettingsPatch(await load(), patch, now())
      await deps.storage.write(next)
      return view(next)
    }
  }
}
