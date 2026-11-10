import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { isDailyBriefingEditionDate, isDailyBriefingLocale, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingService } from '../daily-briefing/dailyBriefingService'
import type { DailyBriefingWindowHours } from '../../../contracts/dailyBriefing'
import type { DailyBriefingPeriodDeletion } from '../daily-briefing/dailyBriefingPeriodDeletion'
import type { DailyBriefingSettingsPatch, DailyBriefingSettingsService } from '../daily-briefing/dailyBriefingSettingsService'
import { withRunDeadline } from '../daily-briefing/dailyBriefingRunDeadline'
import type { BriefingPeriodsEditor } from '../daily-briefing/dailyBriefingPeriodsSource'
import { registerDailyBriefingPeriodIpc } from './registerDailyBriefingPeriodIpc'

const PRODUCT_ID = 'market-intelligence'

export const DAILY_BRIEFING_IPC_METHODS = Object.freeze({
  getToday: 'intelligence.dailyBriefing.getToday',
  list: 'intelligence.dailyBriefing.list',
  get: 'intelligence.dailyBriefing.get',
  listAttempts: 'intelligence.dailyBriefing.listAttempts',
  regenerate: 'intelligence.dailyBriefing.regenerate',
  publishToPhone: 'intelligence.dailyBriefing.publishToPhone',
  getProgress: 'intelligence.dailyBriefing.getProgress',
  getSettings: 'intelligence.dailyBriefing.getSettings',
  saveSettings: 'intelligence.dailyBriefing.saveSettings',
  getStorageState: 'intelligence.dailyBriefing.getStorageState',
  retryUpgrade: 'intelligence.dailyBriefing.retryUpgrade',
  deletePeriod: 'intelligence.dailyBriefing.deletePeriod',
  listPeriods: 'intelligence.dailyBriefing.listPeriods',
  createPeriod: 'intelligence.dailyBriefing.createPeriod',
  updatePeriod: 'intelligence.dailyBriefing.updatePeriod',
  removePeriod: 'intelligence.dailyBriefing.removePeriod'
})

/** Read-only: one generation per (day, locale) on first open, then the stored edition. */
export function registerDailyBriefingIpc(register: ProductIpcRegistrar, service: DailyBriefingService, settings?: DailyBriefingSettingsService, deletePeriod?: DailyBriefingPeriodDeletion, periods?: BriefingPeriodsEditor): void {
  // The period configuration's four methods hang off the runtime's own store. It is the same
  // instance the scheduler reads, so every write passes the one-time move and no second store can
  // produce a file without the move's marker.
  if (periods) registerDailyBriefingPeriodIpc(register, periods)
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.getToday, async (payload) =>
    service.getToday(await readQueryForPeriod(payload, periods)))
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.list, async (payload) =>
    service.list(readQuery(payload)))
  // A run is the one long call here: it waits for the market and then for the model. Every part has
  // its own budget, and this is the caller's — without it a promise that never settles leaves the
  // reader with a spinner and no answer at all.
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.regenerate, async (payload) =>
    withRunDeadline(service.regenerate(readRegenerateQuery(payload))))
  // Read-only and cheap: the answer is the live snapshot of the run in progress, never a new read
  // of the store, and it says `idle` as soon as that run settles.
  // 读者按下「推送到手机」：先写/更新当天记录（只记不发），再按同一个键重投——见服务里那段说明。
  register(PRODUCT_ID, DAILY_BRIEFING_IPC_METHODS.publishToPhone, async (payload) =>
    service.publishToPhone(readPushQuery(payload)))
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

/**
 * 推送的输入：`{ date, periodId, locale }`，三条都必填且校验——缺一个就会推别的版次或别的日子。
 *
 * **不许复用删除的校验**：删除还要一个 `entry`（从工具栏还是行菜单删的），那是删除的审计语义；
 * 推送没有"从哪点的"这件事。曾经把两者并成一条，于是每次推送都被要求带 `entry`、被判非法
 * （`daily-briefing-invalid-request`），请求根本到不了通道那一步（用户 2026-11-07 报"发布频道发不出去"）。
 */
function readPushQuery(payload: unknown): Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }> {
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  const { date, periodId, locale } = payload
  if (typeof date !== 'string' || !isDailyBriefingEditionDate(date)) throw new Error('daily-briefing-invalid-request')
  if (typeof periodId !== 'string' || periodId.trim().length === 0 || periodId.length > 64) throw new Error('daily-briefing-invalid-request')
  if (!isDailyBriefingLocale(locale)) throw new Error('daily-briefing-invalid-request')
  return { date, periodId, locale }
}

/** Every field is required and validated: a missing one would delete another issue's edition. */
function readDeleteQuery(payload: unknown): Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale; entry: 'toolbar' | 'row-menu' }> {
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  const { date, periodId, locale, entry } = payload
  if (typeof date !== 'string' || !isDailyBriefingEditionDate(date)) throw new Error('daily-briefing-invalid-request')
  if (typeof periodId !== 'string' || periodId.trim().length === 0 || periodId.length > 64) throw new Error('daily-briefing-invalid-request')
  if (!isDailyBriefingLocale(locale)) throw new Error('daily-briefing-invalid-request')
  // 入口是**必填**：操作记录要能回答"从哪删的"，缺了就拒，不许悄悄当工具栏。
  if (entry !== 'toolbar' && entry !== 'row-menu') throw new Error('daily-briefing-invalid-request')
  return { date, periodId, locale, entry }
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

function readQuery(payload: unknown): Readonly<{ locale: 'zh-CN' | 'en-US'; timeZone: string; generate?: boolean; periodId?: string }> {
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  const locale = payload.locale
  const timeZone = payload.timeZone
  if (!isDailyBriefingLocale(locale)) throw new Error('daily-briefing-invalid-locale')
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) {
    throw new Error('daily-briefing-invalid-time-zone')
  }
  // **哪一期**也是这次读取的一部分。以前这里只回 locale/timeZone/generate，期号在半路被丢掉：
  // 多期读者看到的是 `default` 期、窗口按期配置第一项算，而排期跑的是他选的那一期。
  const periodId = payload.periodId
  if (periodId !== undefined && (typeof periodId !== 'string' || periodId.length === 0 || periodId.length > 64)) {
    throw new Error('daily-briefing-invalid-request')
  }
  // Only `false` is meaningful: a read-the-stored-edition open. Anything else keeps the old shape.
  return {
    locale, timeZone,
    ...(payload.generate === false ? { generate: false as const } : {}),
    ...(typeof periodId === 'string' ? { periodId } : {})
  }
}

/**
 * 「读这一期」：期号之外，还要带上**那一期自己**的时刻与窗口。
 *
 * 只带期号不够：服务端的窗口在没有 `generation` 时按期配置**第一项**算，于是同一个「今天」会有
 * 两套截止时刻——排期用 20:00，页面按 08:00 算。期号读不懂、或配置里已经没有这一期，一律拒绝，
 * 不静默退回 `default`：那正是这次事故的形态（读者选的期消失，而界面照常回答）。
 */
async function readQueryForPeriod(
  payload: unknown,
  periods: BriefingPeriodsEditor | undefined
): Promise<Readonly<{
  locale: 'zh-CN' | 'en-US'
  timeZone: string
  generate?: boolean
  periodId?: string
  generation?: Readonly<{ generationTime: string; windowHours: DailyBriefingWindowHours }>
}>> {
  const base = readQuery(payload)
  if (base.periodId === undefined || periods === undefined) return base
  const configured = (await periods.list()).find((period) => period.id === base.periodId)
  if (configured === undefined) throw new Error('daily-briefing-period-unknown')
  return {
    ...base,
    generation: { generationTime: configured.generationTime, windowHours: configured.windowHours }
  }
}

/**
 * The regenerate payload: the run's identity, verbatim.
 *
 * `readQuery` answers "which edition am I reading" and deliberately returns only the locale and the
 * zone. Reusing it here dropped the period and the chosen cutoff, so a manual run arrived at the
 * service as `periodId: undefined` and the store filed it under `default` — overwriting the very
 * edition the reader was looking at. A chosen cutoff or period that fails validation is refused
 * loudly; silently discarding them is what made the reader's choice disappear.
 */
function readRegenerateQuery(payload: unknown): Readonly<{
  locale: 'zh-CN' | 'en-US'
  timeZone: string
  periodId?: string
  generation?: Readonly<{ asOf: string; windowHours?: 12 | 24 | 48 }>
  rerun?: Readonly<{ periodTime: string; windowHours?: 12 | 24 | 48 }>
}> {
  const base = readQuery(payload)
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  const periodId = payload.periodId
  if (periodId !== undefined && (typeof periodId !== 'string' || periodId.length === 0 || periodId.length > 64)) {
    throw new Error('daily-briefing-invalid-request')
  }
  const generation = payload.generation
  let parsedGeneration: Readonly<{ asOf: string; windowHours?: 12 | 24 | 48 }> | undefined
  if (generation !== undefined) {
    if (!isRecord(generation)) throw new Error('daily-briefing-invalid-request')
    const keys = Object.keys(generation)
    if (keys.length === 0 || keys.some((key) => key !== 'asOf' && key !== 'windowHours')) throw new Error('daily-briefing-invalid-request')
    const asOf = generation.asOf
    if (typeof asOf !== 'string' || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString() !== asOf) {
      throw new Error('daily-briefing-invalid-request')
    }
    const windowHours = generation.windowHours
    if (windowHours !== undefined && windowHours !== 12 && windowHours !== 24 && windowHours !== 48) {
      throw new Error('daily-briefing-invalid-request')
    }
    parsedGeneration = Object.freeze({ asOf, ...(windowHours === undefined ? {} : { windowHours }) }) as Readonly<{ asOf: string; windowHours?: 12 | 24 | 48 }>
  }
  // 重跑屏幕上那一版：截止与窗口由那一版自己给。同样逐字段校验，读不懂就拒，不悄悄丢掉。
  const rerun = payload.rerun
  let parsedRerun: Readonly<{ periodTime: string; windowHours?: 12 | 24 | 48 }> | undefined
  if (rerun !== undefined) {
    if (!isRecord(rerun)) throw new Error('daily-briefing-invalid-request')
    if (Object.keys(rerun).some((key) => key !== 'periodTime' && key !== 'windowHours')) throw new Error('daily-briefing-invalid-request')
    const periodTime = rerun.periodTime
    if (typeof periodTime !== 'string' || !Number.isFinite(Date.parse(periodTime)) || new Date(periodTime).toISOString() !== periodTime) {
      throw new Error('daily-briefing-invalid-request')
    }
    const hours = rerun.windowHours
    if (hours !== undefined && hours !== 12 && hours !== 24 && hours !== 48) throw new Error('daily-briefing-invalid-request')
    parsedRerun = Object.freeze({ periodTime, ...(hours === undefined ? {} : { windowHours: hours }) })
  }
  return {
    ...base,
    ...(typeof periodId === 'string' ? { periodId } : {}),
    ...(parsedGeneration === undefined ? {} : { generation: parsedGeneration }),
    ...(parsedRerun === undefined ? {} : { rerun: parsedRerun })
  }
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

function readGet(payload: unknown): Readonly<{ date: string; locale: 'zh-CN' | 'en-US'; periodId?: string }> {
  if (!isRecord(payload)) throw new Error('daily-briefing-invalid-request')
  if (!isDailyBriefingEditionDate(payload.date)) throw new Error('daily-briefing-invalid-date')
  if (!isDailyBriefingLocale(payload.locale)) throw new Error('daily-briefing-invalid-locale')
  if (payload.periodId !== undefined && (typeof payload.periodId !== 'string' || payload.periodId.length === 0 || payload.periodId.length > 64)) {
    throw new Error('daily-briefing-invalid-request')
  }
  return { date: payload.date, locale: payload.locale, ...(typeof payload.periodId === 'string' ? { periodId: payload.periodId } : {}) }
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
