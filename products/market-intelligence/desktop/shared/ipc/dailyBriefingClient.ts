import { isDocument, isExact, isRecord, isText } from './dailyBriefingDocument'
import { DAILY_BRIEFING_DOCUMENT_INVALID, DAILY_BRIEFING_REQUEST_FAILED } from './dailyBriefingFailureCodes'
import {
  dailyBriefingPolicy,
  isBriefingGenerationTrace,
  isDailyBriefingDocumentWithinBudget,
  isDailyBriefingEditionLanguageReason,
  isDailyBriefingLocale,
  isDailyBriefingReadingState,
  isFactImportanceTier,
  briefingGenerationStageIds,
  type BriefingGenerationProgress,
  type BriefingGenerationStage,
  type BriefingGenerationStageId,
  type BriefingGenerationStageState,
  type BriefingGenerationTrace,
  type DailyBriefingDocument,
  type DailyBriefingEditionLanguage,
  type DailyBriefingRunTrigger,
  type DailyBriefingAttemptRecord,
  type DailyBriefingEditionSummary,
  type DailyBriefingListResult,
  type DailyBriefingLocale
} from '../../../contracts/dailyBriefing'

const PRODUCT_ID = 'market-intelligence'
const METHODS = Object.freeze({
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
  deletePeriod: 'intelligence.dailyBriefing.deletePeriod'
})

export type DailyBriefingClientInput = Readonly<{
  locale: 'zh-CN' | 'en-US'
  timeZone: string
  /** `false` opens the page as a read: the stored edition, or "nothing written yet". No run. */
  generate?: boolean
  /**
   * Which period of today to run. Absent keeps the first/only one, which is what the old call meant.
   * 进度查询读的也是这个期号——**发起这一次跑时记下的那个**，不是界面上当前选中的期。
   */
  periodId?: string
  /** A manual run's own cutoff and window; never written back into a period. */
  generation?: Readonly<{ asOf: string; windowHours?: 12 | 24 | 48 }>
  /** 重跑屏幕上那一版：用它自己的截止与窗口，不问期配置第一项（用户 2026-11-06）。 */
  rerun?: Readonly<{ periodTime: string; windowHours?: 12 | 24 | 48 }>
}>
export type DailyBriefingClientGetInput = Readonly<{ date: string; locale: 'zh-CN' | 'en-US'; periodId?: string }>

export type DailyBriefingClockSource = 'settings' | 'system'

export type DailyBriefingClientTodayResult =
  | Readonly<{
    state: 'available'
    document: DailyBriefingDocument
    /**
     * `system` means the settings zone was empty or invalid and the machine's zone was used; the
     * page must say so, otherwise the reader cannot tell why the day starts somewhere else.
     */
    timeZoneSource?: DailyBriefingClockSource
  }>
  | Readonly<{ state: 'unavailable'; failureCode: string; generationTrace?: BriefingGenerationTrace }>

export type DailyBriefingClientListResult =
  | Readonly<{ state: 'available'; result: DailyBriefingListResult }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

/**
 * Where the running generation has got to.
 *
 * `unavailable` is its own case on purpose: "could not read the progress" is not "nothing is
 * running", and a reader told "nothing is running" while a run is in flight would think it died.
 */
export type DailyBriefingClientProgressResult =
  | Readonly<{ state: 'idle' }>
  | Readonly<{ state: 'running'; progress: BriefingGenerationProgress }>
  | Readonly<{ state: 'unavailable' }>

export type DailyBriefingClientAttemptsResult = Readonly<
  | { state: 'available'; attempts: readonly DailyBriefingAttemptRecord[] }
  | { state: 'unavailable' }
>

export type DailyBriefingClientGetResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'unavailable'; failureCode: string; generationTrace?: BriefingGenerationTrace }>
export type DailyBriefingLanguageView = Readonly<{
  settings: Readonly<{ primary: 'follow-ui'; additional: readonly DailyBriefingLocale[] }>
  plan: Readonly<{
    locales: readonly DailyBriefingLocale[]
    primary: Readonly<{ requested: string; used: DailyBriefingLocale; fallbackReason?: 'ui-language-unsupported' }>
    writeCount: number
  }>
}>

export type DailyBriefingSettingsView = Readonly<{
  /** The AI editorial preference. */
  settings: Readonly<{ editorialEnabled: boolean; providerId: string; modelId: string; webSearchEnabled: boolean; webSearchAuthorizedAt?: string }>
  /** The one global language preference and the plan derived from it (primary, extras, write count). */
  language: DailyBriefingLanguageView
  /** Whether the editor agent's model can take Anthropic server-side WebSearch/WebFetch. */
  webSearchSupported: boolean
  resolved:
    | Readonly<{ state: 'disabled' }>
    | Readonly<{ state: 'agent'; providerId: string; modelId: string; source: 'default' | 'custom'; fallback?: 'custom-unavailable' }>
    | Readonly<{ state: 'unavailable'; reason: 'default-unavailable' }>
}>

export type DailyBriefingSettingsPatch = Readonly<{
  editorialEnabled?: boolean
  providerId?: string
  modelId?: string
  webSearchEnabled?: boolean
  webSearchAuthorizedAt?: string
  language?: Readonly<{ additional?: readonly DailyBriefingLocale[] }>
}>

export type DailyBriefingSettingsResult =
  | Readonly<{ state: 'available'; view: DailyBriefingSettingsView }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

/**
 * Which table shape the brief is running on. `incomplete` is a state the page has to show: the
 * reader's history is still there, but the upgrade did not finish and can be retried. A read that
 * failed is `unavailable`, never `ready` — that would report a finished upgrade nobody observed.
 */
export type DailyBriefingStorageStateResult =
  | Readonly<{ state: 'ready' }>
  | Readonly<{ state: 'incomplete'; reason: 'backup-failed' | 'migration-failed' }>
  | Readonly<{ state: 'unavailable' }>

export type DailyBriefingClient = Readonly<{
  getToday: (input: DailyBriefingClientInput) => Promise<DailyBriefingClientTodayResult>
  list: (input: DailyBriefingClientInput) => Promise<DailyBriefingClientListResult>
  get: (input: DailyBriefingClientGetInput) => Promise<DailyBriefingClientGetResult>
  listAttempts: (input: DailyBriefingClientGetInput & Readonly<{ periodId?: string }>) => Promise<DailyBriefingClientAttemptsResult>
  regenerate: (input: DailyBriefingClientInput) => Promise<DailyBriefingClientTodayResult>
  /**
   * 把这一版发布到手机（2026-11-05 口径）：主进程先写/更新当天的完成记录（只记不发，幂等合并），
   * 再按同一个键重投。结果原样交回——翻成读者的话是发布按钮自己的事，不在这里编。
   */
  publishToPhone: (input: Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US' }>) => Promise<unknown>
  getProgress: (input: DailyBriefingClientInput) => Promise<DailyBriefingClientProgressResult>
  getSettings: () => Promise<DailyBriefingSettingsResult>
  saveSettings: (patch: DailyBriefingSettingsPatch) => Promise<DailyBriefingSettingsResult>
  getStorageState: () => Promise<DailyBriefingStorageStateResult>
  retryUpgrade: () => Promise<DailyBriefingStorageStateResult>
  /** Deletes one edition (one language) across both databases; `allDone` is false when the links could not be removed. */
  deletePeriod: (input: Readonly<{
    date: string
    periodId: string
    locale: 'zh-CN' | 'en-US'
    /** 从哪颗入口删的：操作记录要能回答这个（用户 2026-11-06）。 */
    entry: 'toolbar' | 'row-menu'
  }>) => Promise<Readonly<{
    editions: number
    attempts: number
    periodRuns: number
    sessionLinks: number
    remaining: number | null
    allDone: boolean
  }>>
}>

export const dailyBriefingClient: DailyBriefingClient = {
  async publishToPhone(input) {
    return invoke(METHODS.publishToPhone, input)
  },
  async getToday(input) {
    try {
      const value = await invoke(METHODS.getToday, input)
      if (isRecord(value) && value.state === 'unavailable') return unavailableWithTrace(value)
      if (isRecord(value) && value.state === 'available') {
        // 读到了、但读不懂：**校验失败**，不是"这一次没读到"（`02` v2.129 G5）。两者必须分开报，
        // 否则页面只能报"失败"，右列也写不出原因。
        if (!isDocument(value.document)) return { state: 'unavailable', failureCode: DAILY_BRIEFING_DOCUMENT_INVALID }
        return { state: 'available', document: value.document, timeZoneSource: readClockSource(value) }
      }
      return unavailable()
    } catch {
      return unavailable()
    }
  },
  async getProgress(input) {
    try {
      const value = await invoke(METHODS.getProgress, input)
      if (!isRecord(value)) return { state: 'unavailable' }
      if (value.state === 'idle') return { state: 'idle' }
      if (value.state !== 'running' || !isRecord(value.progress)) return { state: 'unavailable' }
      const attemptId = value.progress.attemptId
      const startedAt = value.progress.startedAt
      const stages = parseProgressStages(value.progress.stages)
      if (typeof attemptId !== 'string' || typeof startedAt !== 'string' || !stages) return { state: 'unavailable' }
      return { state: 'running', progress: { attemptId, startedAt, stages } }
    } catch {
      return { state: 'unavailable' }
    }
  },
  async list(input) {
    try {
      const value = await invoke(METHODS.list, input)
      if (!isRecord(value) || value.state !== 'available' || !isRecord(value.result) || !Array.isArray(value.result.editions)) {
        return unavailable()
      }
      const editions = value.result.editions.map(parseSummary)
      if (editions.some((edition) => edition === undefined)) return unavailable()
      const today = typeof value.result.today === 'string' ? value.result.today : undefined
      // 日期集合是可选的：缺了就是旧服务端，页面退回"天头来自版次"的行为。
      const dates = Array.isArray(value.result.dates) ? value.result.dates : undefined
      return {
        state: 'available',
        result: {
          editions: editions as readonly DailyBriefingEditionSummary[],
          ...(today ? { today } : {}),
          ...(Array.isArray(dates) ? { dates: dates.filter((entry): entry is string => typeof entry === 'string') } : {})
        }
      }
    } catch {
      return unavailable()
    }
  },
  async regenerate(input) {
    try {
      const value = await invoke(METHODS.regenerate, input)
      if (isRecord(value) && value.state === 'available') {
        if (!isDocument(value.document)) return { state: 'unavailable', failureCode: DAILY_BRIEFING_DOCUMENT_INVALID }
        return { state: 'available', document: value.document, timeZoneSource: readClockSource(value) }
      }
      if (isRecord(value) && value.state === 'unavailable') return unavailableWithTrace(value)
      return unavailable()
    } catch {
      return unavailable()
    }
  },
  async getSettings() {
    return readSettings(() => invoke(METHODS.getSettings, {}))
  },
  async saveSettings(patch) {
    return readSettings(() => invoke(METHODS.saveSettings, patch))
  },
  async getStorageState() {
    return readStorageState(() => invoke(METHODS.getStorageState, {}))
  },
  async deletePeriod(input) {
    const result = await invoke(METHODS.deletePeriod, input)
    const record = result as Record<string, unknown> | null
    // A partial reply must not be read as a full one: every count and the allDone flag are checked.
    if (record === null || typeof record !== 'object'
      || !['editions', 'attempts', 'periodRuns', 'sessionLinks'].every((key) => typeof record[key] === 'number')
      || !(typeof record.remaining === 'number' || record.remaining === null)
      || typeof record.allDone !== 'boolean') throw new Error('daily-briefing-delete-invalid-result')
    return result as Readonly<{ editions: number; attempts: number; periodRuns: number; sessionLinks: number; remaining: number | null; allDone: boolean }>
  },
  async retryUpgrade() {
    return readStorageState(() => invoke(METHODS.retryUpgrade, {}))
  },
  async listAttempts(input) {
    try {
      const value = await invoke(METHODS.listAttempts, input)
      if (!isRecord(value) || value.state !== 'available' || !Array.isArray(value.attempts)) return { state: 'unavailable' }
      const attempts = value.attempts.map(parseAttempt)
      if (attempts.some((attempt) => attempt === undefined)) return { state: 'unavailable' }
      return { state: 'available', attempts: attempts as readonly DailyBriefingAttemptRecord[] }
    } catch {
      return { state: 'unavailable' }
    }
  },
  async get(input) {
    try {
      const value = await invoke(METHODS.get, input)
      if (isRecord(value) && value.state === 'missing') return { state: 'missing' }
      if (isRecord(value) && value.state === 'available') {
        if (!isDocument(value.document)) return { state: 'unavailable', failureCode: DAILY_BRIEFING_DOCUMENT_INVALID }
        return { state: 'available', document: value.document }
      }
      if (isRecord(value) && value.state === 'unavailable') return unavailableWithTrace(value)
      return unavailable()
    } catch {
      return unavailable()
    }
  }
}

async function invoke(method: string, payload: unknown): Promise<unknown> {
  const products = window.platform?.products
  if (!products?.invoke) throw new Error('product-bridge-missing')
  return products.invoke(PRODUCT_ID, method, payload)
}

function unavailable(): Readonly<{ state: 'unavailable'; failureCode: string }> {
  return { state: 'unavailable', failureCode: DAILY_BRIEFING_REQUEST_FAILED }
}

/** A failed attempt keeps its readable code and, when the service stored it, its stage trace. */
/** Only `system` changes what the reader must be told; anything else is the ordinary settings case. */
function readClockSource(value: Record<string, unknown>): DailyBriefingClockSource {
  return value.timeZoneSource === 'system' ? 'system' : 'settings'
}

function unavailableWithTrace(value: Record<string, unknown>): Readonly<{ state: 'unavailable'; failureCode: string; generationTrace?: BriefingGenerationTrace }> {
  const failureCode = isText(value.failureCode) ? value.failureCode : 'daily-briefing-request-failed'
  const generationTrace = isBriefingGenerationTrace(value.generationTrace) ? value.generationTrace : undefined
  return { state: 'unavailable', failureCode, ...(generationTrace ? { generationTrace } : {}) }
}

async function readStorageState(read: () => Promise<unknown>): Promise<DailyBriefingStorageStateResult> {
  try {
    const value = await read()
    if (!isRecord(value)) return { state: 'unavailable' }
    if (value.state === 'ready') return { state: 'ready' }
    if (value.state === 'incomplete' && (value.reason === 'backup-failed' || value.reason === 'migration-failed')) {
      return { state: 'incomplete', reason: value.reason }
    }
    return { state: 'unavailable' }
  } catch {
    return { state: 'unavailable' }
  }
}

async function readSettings(read: () => Promise<unknown>): Promise<DailyBriefingSettingsResult> {
  try {
    const value = await read()
    if (!isRecord(value) || !isRecord(value.settings) || !isAiSettings(value.settings) ||
      !isLanguageView(value.language) || typeof value.webSearchSupported !== 'boolean' ||
      !isResolvedModel(value.resolved)) {
      return { state: 'unavailable', failureCode: 'daily-briefing-settings-invalid' }
    }
    return {
      state: 'available',
      view: {
        settings: value.settings,
        language: value.language,
        webSearchSupported: value.webSearchSupported,
        resolved: value.resolved
      }
    }
  } catch {
    return { state: 'unavailable', failureCode: 'daily-briefing-request-failed' }
  }
}

function isAiSettings(value: Record<string, unknown>): value is { editorialEnabled: boolean; providerId: string; modelId: string; webSearchEnabled: boolean; webSearchAuthorizedAt?: string } {
  return isExact(value, ['editorialEnabled', 'providerId', 'modelId', 'webSearchEnabled'], ['webSearchAuthorizedAt']) &&
    typeof value.editorialEnabled === 'boolean' && typeof value.providerId === 'string' && typeof value.modelId === 'string' && typeof value.webSearchEnabled === 'boolean' && (value.webSearchAuthorizedAt === undefined || typeof value.webSearchAuthorizedAt === 'string')
}

function isLanguageView(value: unknown): value is DailyBriefingLanguageView {
  if (!isRecord(value) || !isRecord(value.settings) || !isRecord(value.plan)) return false
  const settings = value.settings
  const plan = value.plan
  if (settings.primary !== 'follow-ui' || !Array.isArray(settings.additional) || !settings.additional.every(isDailyBriefingLocale)) return false
  if (!Array.isArray(plan.locales) || !plan.locales.every(isDailyBriefingLocale)) return false
  if (!isRecord(plan.primary) || !isText(plan.primary.requested) || !isDailyBriefingLocale(plan.primary.used)) return false
  if (plan.primary.fallbackReason !== undefined && plan.primary.fallbackReason !== 'ui-language-unsupported') return false
  return typeof plan.writeCount === 'number' && Number.isSafeInteger(plan.writeCount) && plan.writeCount === plan.locales.length
}

function isResolvedModel(value: unknown): value is DailyBriefingSettingsView['resolved'] {
  if (!isRecord(value)) return false
  if (value.state === 'disabled') return true
  if (value.state === 'unavailable') return value.reason === 'default-unavailable'
  return value.state === 'agent' && isText(value.providerId) && isText(value.modelId) &&
    (value.source === 'default' || value.source === 'custom') &&
    (value.fallback === undefined || value.fallback === 'custom-unavailable')
}

function parseAttempt(value: unknown): DailyBriefingAttemptRecord | undefined {
  if (!isRecord(value) || typeof value.attemptNo !== 'number' || !Number.isSafeInteger(value.attemptNo)) return undefined
  if (value.state !== 'running' && value.state !== 'succeeded' && value.state !== 'failed') return undefined
  if (!isText(value.startedAt)) return undefined
  return Object.freeze({
    attemptNo: value.attemptNo,
    state: value.state,
    ...(isText(value.failureCode) ? { failureCode: value.failureCode } : {}),
    startedAt: value.startedAt,
    ...(isText(value.finishedAt) ? { finishedAt: value.finishedAt } : {}),
    ...(isText(value.cleanedAt) ? { cleanedAt: value.cleanedAt } : {})
  })
}

function parseSummary(value: unknown): DailyBriefingEditionSummary | undefined {
  if (!isRecord(value) || !isText(value.date) || !isDailyBriefingLocale(value.locale) || !Array.isArray(value.availableLocales)) return undefined
  if (value.state !== 'generated' && value.state !== 'missing' && value.state !== 'partial') return undefined
  if (!value.availableLocales.every(isDailyBriefingLocale)) return undefined
  // A list of languages this build cannot read is refused with the whole row, not shown half-read.
  const languages = value.languages === undefined ? undefined : parseSummaryLanguages(value.languages)
  if (languages === null) return undefined
  if (value.state === 'generated' && (!isText(value.generatedAt) || !isText(value.windowEnd))) return undefined
  return Object.freeze({
    date: value.date,
    periodId: isText(value.periodId) ? value.periodId : 'default',
    locale: value.locale,
    availableLocales: Object.freeze([...value.availableLocales]) as readonly ('zh-CN' | 'en-US')[],
    state: value.state,
    ...(isText(value.generatedAt) ? { generatedAt: value.generatedAt } : {}),
    ...(isText(value.summaryLine) ? { summaryLine: value.summaryLine } : {}),
    ...(typeof value.readingsAvailable === 'number' && Number.isSafeInteger(value.readingsAvailable)
      ? { readingsAvailable: value.readingsAvailable }
      : {}),
    ...(isText(value.windowEnd) ? { windowEnd: value.windowEnd } : {}),
    ...(typeof value.attemptCount === 'number' && Number.isSafeInteger(value.attemptCount) ? { attemptCount: value.attemptCount } : {}),
    ...(isText(value.scheduledTime) ? { scheduledTime: value.scheduledTime } : {}),
    ...(Array.isArray(value.expectedLocales) && value.expectedLocales.every(isDailyBriefingLocale)
      ? { expectedLocales: Object.freeze([...value.expectedLocales]) as readonly ('zh-CN' | 'en-US')[] }
      : {}),
    ...(isText(value.periodTime) ? { periodTime: value.periodTime } : {}),
    ...(value.periodKind === 'scheduled' || value.periodKind === 'manual' ? { periodKind: value.periodKind } : {}),
    ...(RUN_TRIGGERS.includes(value.runTrigger as never) ? { runTrigger: value.runTrigger as DailyBriefingRunTrigger } : {}),
    ...(typeof value.windowHours === 'number' && Number.isSafeInteger(value.windowHours) ? { windowHours: value.windowHours } : {}),
    ...(languages ? { languages } : {}),
    ...(value.periodDeleted === true ? { periodDeleted: true } : {}),
    ...(value.isCurrent === true ? { isCurrent: true } : {})
  })
}

const RUN_TRIGGERS = ['scheduled', 'catch-up', 'retry', 'auto-retry', 'manual'] as const

/** The per-language three-state, or `null` when one entry is not a value this build understands. */
function parseSummaryLanguages(value: unknown): readonly DailyBriefingEditionLanguage[] | null {
  if (!Array.isArray(value)) return null
  const parsed: DailyBriefingEditionLanguage[] = []
  for (const entry of value) {
    if (!isRecord(entry) || !isDailyBriefingLocale(entry.locale)) return null
    if (entry.state === 'published' || entry.state === 'generating') {
      parsed.push(Object.freeze({ locale: entry.locale, state: entry.state }))
      continue
    }
    if (entry.state !== 'missing') return null
    if (!isDailyBriefingEditionLanguageReason(entry.reason)) return null
    parsed.push(Object.freeze({ locale: entry.locale, state: 'missing' as const, reason: entry.reason }))
  }
  return Object.freeze(parsed)
}

const STAGE_STATES: readonly BriefingGenerationStageState[] = ['success', 'failed', 'skipped', 'pending']

/** A trace's stages, or `undefined` when any of them is not a stage this build understands. */
function parseProgressStages(value: unknown): readonly BriefingGenerationStage[] | undefined {
  if (!Array.isArray(value)) return undefined
  const parsed: BriefingGenerationStage[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return undefined
    const id = entry.id
    const state = entry.state
    if (typeof id !== 'string' || !(briefingGenerationStageIds as readonly string[]).includes(id)) return undefined
    if (typeof state !== 'string' || !(STAGE_STATES as readonly string[]).includes(state)) return undefined
    parsed.push(Object.freeze({
      id: id as BriefingGenerationStageId,
      state: state as BriefingGenerationStageState,
      ...(typeof entry.startedAt === 'string' ? { startedAt: entry.startedAt } : {}),
      ...(typeof entry.finishedAt === 'string' ? { finishedAt: entry.finishedAt } : {}),
      ...(typeof entry.durationMs === 'number' ? { durationMs: entry.durationMs } : {})
    }))
  }
  return parsed
}
