import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'

import {
  quarantineCorruptFile,
  recoverJsonArray,
  writeJsonFileAtomically
} from '@platform/storage/jsonFileStorage'
import type {
  IntelligenceTranslationRecord,
  IntelligenceTranslationSettings
} from '../schema/intelligenceTranslation'
import { createDefaultTranslationSettings } from '../application/intelligenceTranslationHelpers'

export type IntelligenceTranslationStorage = {
  readSettings: () => Promise<IntelligenceTranslationSettings>
  writeSettings: (settings: IntelligenceTranslationSettings) => Promise<void>
  readRecords: () => Promise<IntelligenceTranslationRecord[]>
  writeRecords: (records: IntelligenceTranslationRecord[]) => Promise<void>
}

export function readIntelligenceTranslationSettingsSync(
  filePath: string,
  appLanguage: 'zh-CN' | 'en-US' = 'en-US'
): IntelligenceTranslationSettings {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return normalizeSettings(parsed, appLanguage)
  } catch {
    return createDefaultTranslationSettings(appLanguage)
  }
}

export function readIntelligenceTranslationRecordsSync(filePath: string): IntelligenceTranslationRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return Array.isArray(parsed) ? parsed.filter(isTranslationRecord) : []
  } catch {
    return []
  }
}

export function createIntelligenceTranslationJsonStorage(deps: {
  settingsPath: string
  recordsPath: string
  appLanguage?: () => Promise<'zh-CN' | 'en-US'>
}): IntelligenceTranslationStorage {
  return {
    async readSettings() {
      try {
        const parsed = JSON.parse(await readFile(deps.settingsPath, 'utf8')) as unknown
        const appLanguage = deps.appLanguage ? await deps.appLanguage() : 'en-US'
        return normalizeSettings(parsed, appLanguage)
      } catch (error) {
        const appLanguage = deps.appLanguage ? await deps.appLanguage() : 'en-US'
        if (isMissingFileError(error)) return createDefaultTranslationSettings(appLanguage)
        await quarantineCorruptFile(deps.settingsPath, await readFile(deps.settingsPath, 'utf8').catch(() => ''))
        return createDefaultTranslationSettings(appLanguage)
      }
    },
    async writeSettings(settings) {
      await writeJsonFileAtomically(deps.settingsPath, settings)
    },
    async readRecords() {
      let raw: string
      try {
        raw = await readFile(deps.recordsPath, 'utf8')
      } catch (error) {
        if (isMissingFileError(error)) return []
        throw error
      }
      try {
        const parsed = JSON.parse(raw) as unknown
        return Array.isArray(parsed) ? parsed.filter(isTranslationRecord) : []
      } catch {
        const recovered = recoverJsonArray(raw)
        const records = (recovered ?? []).filter(isTranslationRecord)
        await quarantineCorruptFile(deps.recordsPath, raw)
        await writeJsonFileAtomically(deps.recordsPath, records)
        return records
      }
    },
    async writeRecords(records) {
      await writeJsonFileAtomically(deps.recordsPath, records)
    }
  }
}

export function createInMemoryIntelligenceTranslationStorage(
  appLanguage: 'zh-CN' | 'en-US' = 'en-US'
): IntelligenceTranslationStorage {
  let settings = createDefaultTranslationSettings(appLanguage)
  let records: IntelligenceTranslationRecord[] = []
  return {
    async readSettings() {
      return settings
    },
    async writeSettings(next) {
      settings = next
    },
    async readRecords() {
      return records
    },
    async writeRecords(next) {
      records = next
    }
  }
}

function normalizeSettings(
  value: unknown,
  appLanguage: 'zh-CN' | 'en-US'
): IntelligenceTranslationSettings {
  const defaults = createDefaultTranslationSettings(appLanguage)
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<IntelligenceTranslationSettings>
  return {
    autoTranslateEnabled: candidate.autoTranslateEnabled ?? defaults.autoTranslateEnabled,
    targetLocale: candidate.targetLocale ?? defaults.targetLocale,
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    translateTitle: candidate.translateTitle ?? defaults.translateTitle,
    translateSummary: candidate.translateSummary ?? defaults.translateSummary,
    translateEvidenceExcerpt: candidate.translateEvidenceExcerpt ?? defaults.translateEvidenceExcerpt,
    updatedAt: candidate.updatedAt ?? defaults.updatedAt
  }
}

function isTranslationRecord(value: unknown): value is IntelligenceTranslationRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<IntelligenceTranslationRecord>
  return Boolean(candidate.translationId && candidate.sourceId && candidate.sourceHash && candidate.status)
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
