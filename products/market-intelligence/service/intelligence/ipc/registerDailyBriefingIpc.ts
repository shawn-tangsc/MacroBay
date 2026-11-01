import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { isDailyBriefingEditionDate, isDailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingService } from '../daily-briefing/dailyBriefingService'
import type { DailyBriefingSettingsPatch, DailyBriefingSettingsService } from '../daily-briefing/dailyBriefingSettingsService'

const PRODUCT_ID = 'market-intelligence'

export const DAILY_BRIEFING_IPC_METHODS = Object.freeze({
  getToday: 'intelligence.dailyBriefing.getToday',
  list: 'intelligence.dailyBriefing.list',
  get: 'intelligence.dailyBriefing.get',
  regenerate: 'intelligence.dailyBriefing.regenerate',
  getSettings: 'intelligence.dailyBriefing.getSettings',
  saveSettings: 'intelligence.dailyBriefing.saveSettings'
})

/** Read-only: one generation per (day, locale) on first open, then the stored edition. */
export function registerDailyBriefingIpc(register: ProductIpcRegistrar, service: DailyBriefingService, settings?: DailyBriefingSettingsService): void {
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.getToday, async (payload) =>
    service.getToday(readQuery(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.list, async (payload) =>
    service.list(readQuery(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.regenerate, async (payload) =>
    service.regenerate(readQuery(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.get, async (payload) =>
    service.get(readGet(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.getSettings, async () => {
    if (!settings) throw new Error('daily-briefing-settings-unavailable')
    return settings.getView()
  })
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.saveSettings, async (payload) => {
    if (!settings) throw new Error('daily-briefing-settings-unavailable')
    return settings.save(readPatch(payload))
  })
}

/** Shape only. The allowed times and window lengths are the settings service's rule. */
function readPatch(payload: unknown): DailyBriefingSettingsPatch {
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  const keys = Object.keys(payload)
  if (keys.some((key) => !['editorialEnabled', 'providerId', 'modelId', 'webSearchEnabled', 'webSearchAuthorizedAt', 'generation'].includes(key))) throw new Error('daily-briefing-invalid-request')
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
    ...(payload.generation !== undefined ? { generation: readGenerationPatch(payload.generation) } : {})
  }
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

function readQuery(payload: unknown): Readonly<{ locale: 'zh-CN' | 'en-US'; timeZone: string }> {
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  const locale = payload.locale
  const timeZone = payload.timeZone
  if (!isDailyBriefingLocale(locale)) throw new Error('daily-briefing-invalid-locale')
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) {
    throw new Error('daily-briefing-invalid-time-zone')
  }
  return { locale, timeZone }
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
