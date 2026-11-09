import { copyFile, readFile } from 'node:fs/promises'

import { writeJsonFileAtomically } from '@platform/storage/jsonFileStorage'

import {
  hasHalfBoundDailyBriefingModel,
  normalizeDailyBriefingAiSettings,
  type DailyBriefingAiSettings
} from '../schema/dailyBriefingAiSettings'

/**
 * What the file said. `absent` and `unreadable` are different facts: the reader who never
 * configured anything may start from defaults and save, while a file we could not read must not
 * be replaced by defaults (that silently erases the model binding and the editorial switch).
 */
export type DailyBriefingAiSettingsRead =
  | Readonly<{ state: 'absent' }>
  | Readonly<{ state: 'available'; settings: DailyBriefingAiSettings }>
  | Readonly<{ state: 'unreadable' }>

export type DailyBriefingAiSettingsStorage = Readonly<{
  read: () => Promise<DailyBriefingAiSettingsRead>
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
    async read() {
      return settings === undefined
        ? { state: 'absent' as const }
        : { state: 'available' as const, settings }
    },
    async write(next) { settings = next }
  }
}

export function createDailyBriefingAiSettingsJsonStorage(
  filePath: string,
  /** The suffix clock, injectable so the corrupt-copy name is a fact a test can assert. */
  corruptTimestamp: () => number = Date.now
): DailyBriefingAiSettingsStorage {
  return {
    async read() {
      let raw: string
      try {
        raw = await readFile(filePath, 'utf8')
      } catch (error) {
        // 文件不存在 = 从没配过，可以用默认；其余读失败（权限、磁盘）都是「读不到」。
        return isMissingFileError(error)
          ? { state: 'absent' as const }
          : { state: 'unreadable' as const }
      }
      try {
        return {
          state: 'available' as const,
          settings: normalizeDailyBriefingAiSettings(JSON.parse(raw) as Partial<DailyBriefingAiSettings>)
        }
      } catch {
        // 损坏先留一份原样副本（内容原样、不重写原文件）；留档失败就 fail-closed——
        // 没有副本就无法事后追查，这一笔不能继续，也不能让调用方拿默认值去覆盖。
        try {
          await copyFile(filePath, `${filePath}.corrupt-${corruptTimestamp()}`)
        } catch {
          return { state: 'unreadable' as const }
        }
        return { state: 'unreadable' as const }
      }
    },
    async write(settings) {
      await writeJsonFileAtomically(filePath, settings)
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}

export function createDailyBriefingAiSettingsStore(
  storage: DailyBriefingAiSettingsStorage,
  now: () => string = () => new Date().toISOString()
): DailyBriefingAiSettingsStore {
  return {
    async getSettings() {
      const read = await storage.read()
      // 读不到时页面仍要能打开：先显示默认值；真正的保护在 save——那一步会拒绝覆盖。
      return normalizeDailyBriefingAiSettings(read.state === 'available' ? read.settings : undefined, now())
    },
    async save(settings) {
      // 读失败就拒绝这一次保存：拿默认值写回去等于把读者的模型绑定与写作档位整份抹掉。
      const read = await storage.read()
      if (read.state === 'unreadable') throw new Error('daily-briefing-ai-settings-unreadable')
      const normalized = normalizeDailyBriefingAiSettings(settings, now())
      if (hasHalfBoundDailyBriefingModel(normalized)) throw new Error('daily-briefing-model-half-bound')
      await storage.write(normalized)
      return normalized
    }
  }
}
