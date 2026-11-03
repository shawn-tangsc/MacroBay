import { isDocument, isExact, isRecord, isText } from './dailyBriefingDocument'
import {
  dailyBriefingPolicy,
  isBriefingGenerationTrace,
  isDailyBriefingDocumentWithinBudget,
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
  getProgress: 'intelligence.dailyBriefing.getProgress',
  getSettings: 'intelligence.dailyBriefing.getSettings',
  saveSettings: 'intelligence.dailyBriefing.saveSettings',
  getStorageState: 'intelligence.dailyBriefing.getStorageState',
  retryUpgrade: 'intelligence.dailyBriefing.retryUpgrade',
  deletePeriod: 'intelligence.dailyBriefing.deletePeriod'
})

export type DailyBriefingClientInput = Readonly<{ locale: 'zh-CN' | 'en-US'; timeZone: string }>
export type DailyBriefingClientGetInput = Readonly<{ date: string; locale: 'zh-CN' | 'en-US' }>

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
  | Readonly<{ state: 'unavailable'; failureCode: string }>

export type DailyBriefingGenerationSettingsView = Readonly<{
  /** Every saved period, projected by the service. The list is the view; there is no flat copy. */
  periods: readonly DailyBriefingPeriodView[]
}>

export type DailyBriefingPeriodView = Readonly<{
  id: string
  name?: string
  generationTime: string
  generationTimeZone: string | null
  generationTimeZoneInvalid: string | null
  windowHours: number
  cronExpression: string
}>

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
  /** When the automatic edition runs and what interval it covers. */
  generation: DailyBriefingGenerationSettingsView
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
  generation?: Readonly<{ generationTime?: string; windowHours?: number }>
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
  getProgress: (input: DailyBriefingClientInput) => Promise<DailyBriefingClientProgressResult>
  getSettings: () => Promise<DailyBriefingSettingsResult>
  saveSettings: (patch: DailyBriefingSettingsPatch) => Promise<DailyBriefingSettingsResult>
  getStorageState: () => Promise<DailyBriefingStorageStateResult>
  retryUpgrade: () => Promise<DailyBriefingStorageStateResult>
  /** Deletes one edition (one language) across both databases; `allDone` is false when the links could not be removed. */
  deletePeriod: (input: Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US' }>) => Promise<Readonly<{
    editions: number
    attempts: number
    periodRuns: number
    sessionLinks: number
    remaining: number | null
    allDone: boolean
  }>>
}>

export const dailyBriefingClient: DailyBriefingClient = {
  async getToday(input) {
    try {
      const value = await invoke(METHODS.getToday, input)
      if (isRecord(value) && value.state === 'unavailable') return unavailableWithTrace(value)
      if (isRecord(value) && value.state === 'available' && isDocument(value.document)) {
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
      return { state: 'available', result: { editions: editions as readonly DailyBriefingEditionSummary[], ...(today ? { today } : {}) } }
    } catch {
      return unavailable()
    }
  },
  async regenerate(input) {
    try {
      const value = await invoke(METHODS.regenerate, input)
      if (isRecord(value) && value.state === 'available' && isDocument(value.document)) {
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
      if (isRecord(value) && value.state === 'available' && isDocument(value.document)) {
        return { state: 'available', document: value.document }
      }
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
  return { state: 'unavailable', failureCode: 'daily-briefing-request-failed' }
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
      !isGenerationSettings(value.generation) || !isLanguageView(value.language) || typeof value.webSearchSupported !== 'boolean' ||
      !isResolvedModel(value.resolved)) {
      return { state: 'unavailable', failureCode: 'daily-briefing-settings-invalid' }
    }
    return {
      state: 'available',
      view: {
        settings: value.settings,
        generation: value.generation,
        language: value.language,
        webSearchSupported: value.webSearchSupported,
        resolved: value.resolved
      }
    }
  } catch {
    return { state: 'unavailable', failureCode: 'daily-briefing-request-failed' }
  }
}

function isGenerationSettings(value: unknown): value is DailyBriefingGenerationSettingsView {
  // The list is the only statement of the schedule. A second copy of the first period at this level
  // is how the page and the schedule start disagreeing without anything breaking.
  return isExact(value, ['periods']) && Array.isArray(value.periods) &&
    value.periods.length > 0 && value.periods.every(isPeriodView)
}

function isPeriodView(value: unknown): value is DailyBriefingPeriodView {
  return isRecord(value) && isText(value.id) && isText(value.generationTime) && isText(value.cronExpression) &&
    typeof value.windowHours === 'number' && Number.isFinite(value.windowHours) &&
    (value.name === undefined || isText(value.name)) &&
    (value.generationTimeZone === null || isText(value.generationTimeZone)) &&
    (value.generationTimeZoneInvalid === null || isText(value.generationTimeZoneInvalid))
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
      : {})
  })
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
