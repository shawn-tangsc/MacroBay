import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { isDailyBriefingEditionDate, isDailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingService } from '../daily-briefing/dailyBriefingService'

const PRODUCT_ID = 'market-intelligence'

export const DAILY_BRIEFING_IPC_METHODS = Object.freeze({
  getToday: 'intelligence.dailyBriefing.getToday',
  list: 'intelligence.dailyBriefing.list',
  get: 'intelligence.dailyBriefing.get'
})

/** Read-only: one generation per (day, locale) on first open, then the stored edition. */
export function registerDailyBriefingIpc(register: ProductIpcRegistrar, service: DailyBriefingService): void {
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.getToday, async (payload) =>
    service.getToday(readQuery(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.list, async (payload) =>
    service.list(readQuery(payload)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.get, async (payload) =>
    service.get(readGet(payload)))
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
