import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { isDailyBriefingEditionDate, isDailyBriefingLocale, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingService } from '../daily-briefing/dailyBriefingService'
import type { DailyBriefingPeriodDeletion } from '../daily-briefing/dailyBriefingPeriodDeletion'
import type { DailyBriefingSettingsPatch, DailyBriefingSettingsService } from '../daily-briefing/dailyBriefingSettingsService'

const PRODUCT_ID = 'market-intelligence'

export const DAILY_BRIEFING_IPC_METHODS = Object.freeze({
  getToday: 'intelligence.dailyBriefing.getToday',
  list: 'intelligence.dailyBriefing.list',
  get: 'intelligence.dailyBriefing.get',
  listAttempts: 'intelligence.dailyBriefing.listAttempts',
  regenerate: 'intelligence.dailyBriefing.regenerate',
  getProgress: 'intelligence.dailyBriefing.getProgress',
  getSettings: 'intelligence.dailyBriefing.getSettings',
  saveSettings: 'intelligence.dailyBriefing.saveSettings',
  getStorageState: 'intelligence.dailyBriefing.getStorageState',
  retryUpgrade: 'intelligence.dailyBriefing.retryUpgrade',
  deletePeriod: 'intelligence.dailyBriefing.deletePeriod'
})

/** Read-only: one generation per (day, locale) on first open, then the stored edition. */
export function registerDailyBriefingIpc(register: ProductIpcRegistrar, service: DailyBriefingService, settings?: DailyBriefingSettingsService, deletePeriod?: DailyBriefingPeriodDeletion): void {
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.getToday, async (payload) =>
    service.getToday(readQuery(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.list, async (payload) =>
    service.list(readQuery(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.regenerate, async (payload) =>
    service.regenerate(readQuery(payload)))
  // Read-only and cheap: the answer is the live snapshot of the run in progress, never a new read
  // of the store, and it says `idle` as soon as that run settles.
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.getProgress, async (payload) =>
    service.getProgress(readQuery(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.get, async (payload) =>
    service.get(readGet(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.listAttempts, async (payload) =>
    service.listAttempts(readAttemptsQuery(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.getSettings, async () => {
    if (!settings) throw new Error('daily-briefing-settings-unavailable')
    return settings.getView()
  })
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.saveSettings, async (payload) => {
    if (!settings) throw new Error('daily-briefing-settings-unavailable')
    return settings.save(readPatch(payload))
  })
  // Read-only and cheap: the answer is which table shape the brief is running on right now.
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.getStorageState, async () => service.getStorageState())
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.retryUpgrade, async () => service.retryUpgrade())
  // Destructive and user-initiated: it removes one issue from both databases.
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.deletePeriod, async (payload) => {
    if (!deletePeriod) throw new Error('daily-briefing-delete-unavailable')
    return deletePeriod(readDeleteQuery(payload))
  })
}

/** Every field is required and validated: a missing one would delete another issue's edition. */
function readDeleteQuery(payload: unknown): Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }> {
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  const { date, periodId, locale } = payload
  if (typeof date !== 'string' || !isDailyBriefingEditionDate(date)) throw new Error('daily-briefing-invalid-request')
  if (typeof periodId !== 'string' || periodId.trim().length === 0 || periodId.length > 64) throw new Error('daily-briefing-invalid-request')
  if (!isDailyBriefingLocale(locale)) throw new Error('daily-briefing-invalid-request')
  return { date, periodId, locale }
}

/** Shape only. The allowed times and window lengths are the settings service's rule. */
function readPatch(payload: unknown): DailyBriefingSettingsPatch {
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  const keys = Object.keys(payload)
  if (keys.some((key) => !['editorialEnabled', 'providerId', 'modelId', 'webSearchEnabled', 'webSearchAuthorizedAt', 'generation', 'language'].includes(key))) throw new Error('daily-briefing-invalid-request')
  if (payload.editorialEnabled !== undefined && typeof payload.editorialEnabled !== 'boolean') throw new Error('daily-briefing-invalid-request')
  for (const key of ['providerId', 'modelId', 'webSearchAuthorizedAt'] as const) {
    const value = payload[key]
    if (value !== undefined && (typeof value !== 'string' || value.length > 256)) throw new Error('daily-briefing-invalid-request')
  }
  return {
    ...(typeof payload.editorialEnabled === 'boolean' ? { editorialEnabled: payload.editorialEnabled } : {}),
    ...(typeof payload.providerId === 'string' ? { providerId: payload.providerId } : {}),
    ...(typeof payload.modelId === 'string' ? { modelId: payload.modelId } : {}),
    ...(typeof payload.webSearchEnabled === 'boolean' ? { webSearchEnabled: payload.webSearchEnabled } : {}),
    ...(typeof payload.webSearchAuthorizedAt === 'string' ? { webSearchAuthorizedAt: payload.webSearchAuthorizedAt } : {}),
    ...(payload.generation !== undefined ? { generation: readGenerationPatch(payload.generation) } : {}),
    ...(payload.language !== undefined ? { language: readLanguagePatch(payload.language) } : {})
  }
}

/** The global language block: only the extra editions are writable; the primary follows the interface. */
function readLanguagePatch(value: unknown): Readonly<{ additional?: readonly ('zh-CN' | 'en-US')[] }> {
  if (!isRecord(value)) throw new Error('daily-briefing-invalid-request')
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.some((key) => key !== 'additional')) throw new Error('daily-briefing-invalid-request')
  if (!Array.isArray(value.additional) || !value.additional.every(isDailyBriefingLocale)) {
    throw new Error('daily-briefing-invalid-request')
  }
  return { additional: value.additional }
}

function readGenerationPatch(value: unknown): Readonly<{ generationTime?: string; windowHours?: number }> {
  if (!isRecord(value)) throw new Error('daily-briefing-invalid-request')
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.some((key) => key !== 'generationTime' && key !== 'windowHours')) {
    throw new Error('daily-briefing-invalid-request')
  }
  if (value.generationTime !== undefined && typeof value.generationTime !== 'string') throw new Error('daily-briefing-invalid-request')
  if (value.windowHours !== undefined && typeof value.windowHours !== 'number') throw new Error('daily-briefing-invalid-request')
  return {
    ...(typeof value.generationTime === 'string' ? { generationTime: value.generationTime } : {}),
    ...(typeof value.windowHours === 'number' ? { windowHours: value.windowHours } : {})
  }
}

function readQuery(payload: unknown): Readonly<{ locale: 'zh-CN' | 'en-US'; timeZone: string; generate?: boolean }> {
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  const locale = payload.locale
  const timeZone = payload.timeZone
  if (!isDailyBriefingLocale(locale)) throw new Error('daily-briefing-invalid-locale')
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) {
    throw new Error('daily-briefing-invalid-time-zone')
  }
  // Only `false` is meaningful: a read-the-stored-edition open. Anything else keeps the old shape.
  return payload.generate === false ? { locale, timeZone, generate: false } : { locale, timeZone }
}

function readAttemptsQuery(payload: unknown): Readonly<{ date: string; locale: DailyBriefingLocale; periodId?: string }> {
  const base = readGet(payload)
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  const periodId = payload.periodId
  if (periodId !== undefined && (typeof periodId !== 'string' || periodId.length === 0 || periodId.length > 64)) {
    throw new Error('daily-briefing-invalid-request')
  }
  return { ...base, ...(typeof periodId === 'string' ? { periodId } : {}) }
}

function readGet(payload: unknown): Readonly<{ date: string; locale: 'zh-CN' | 'en-US' }> {
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  if (!isDailyBriefingEditionDate(payload.date)) throw new Error('daily-briefing-invalid-date')
  if (!isDailyBriefingLocale(payload.locale)) throw new Error('daily-briefing-invalid-locale')
  return { date: payload.date, locale: payload.locale }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.getOwnPropertySymbols(value).length === 0
  } catch {
    return false
  }
}
