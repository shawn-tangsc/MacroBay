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
  type DailyBriefingEditionSummary,
  type DailyBriefingListResult
} from '../../../contracts/dailyBriefing'

const PRODUCT_ID = 'market-intelligence'
const METHODS = Object.freeze({
  getToday: 'intelligence.dailyBriefing.getToday',
  list: 'intelligence.dailyBriefing.list',
  get: 'intelligence.dailyBriefing.get',
  regenerate: 'intelligence.dailyBriefing.regenerate',
  getProgress: 'intelligence.dailyBriefing.getProgress',
  getSettings: 'intelligence.dailyBriefing.getSettings',
  saveSettings: 'intelligence.dailyBriefing.saveSettings',
  getStorageState: 'intelligence.dailyBriefing.getStorageState',
  retryUpgrade: 'intelligence.dailyBriefing.retryUpgrade'
})

export type DailyBriefingClientInput = Readonly<{ locale: 'zh-CN' | 'en-US'; timeZone: string }>
export type DailyBriefingClientGetInput = Readonly<{ date: string; locale: 'zh-CN' | 'en-US' }>

export type DailyBriefingClientTodayResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
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

export type DailyBriefingClientGetResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

export type DailyBriefingGenerationSettingsView = Readonly<{
  generationTime: string
  /** The zone the time means; null while unknown or unreadable. */
  generationTimeZone: string | null
  /** The saved value that is not a usable zone; automatic generation is paused while it is set. */
  generationTimeZoneInvalid: string | null
  windowHours: number
  cronExpression: string
  /** Every saved period, projected by the service. Absent from an older main process. */
  periods?: readonly DailyBriefingPeriodView[]
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

export type DailyBriefingSettingsView = Readonly<{
  /** The AI editorial preference. */
  settings: Readonly<{ editorialEnabled: boolean; providerId: string; modelId: string; webSearchEnabled: boolean; webSearchAuthorizedAt?: string }>
  /** When the automatic edition runs and what interval it covers. */
  generation: DailyBriefingGenerationSettingsView
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
  regenerate: (input: DailyBriefingClientInput) => Promise<DailyBriefingClientTodayResult>
  getProgress: (input: DailyBriefingClientInput) => Promise<DailyBriefingClientProgressResult>
  getSettings: () => Promise<DailyBriefingSettingsResult>
  saveSettings: (patch: DailyBriefingSettingsPatch) => Promise<DailyBriefingSettingsResult>
  getStorageState: () => Promise<DailyBriefingStorageStateResult>
  retryUpgrade: () => Promise<DailyBriefingStorageStateResult>
}>

export const dailyBriefingClient: DailyBriefingClient = {
  async getToday(input) {
    try {
      const value = await invoke(METHODS.getToday, input)
      if (isRecord(value) && value.state === 'unavailable') return unavailableWithTrace(value)
      if (isRecord(value) && value.state === 'available' && isDocument(value.document)) {
        return { state: 'available', document: value.document }
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
      return { state: 'available', result: { editions: editions as readonly DailyBriefingEditionSummary[] } }
    } catch {
      return unavailable()
    }
  },
  async regenerate(input) {
    try {
      const value = await invoke(METHODS.regenerate, input)
      if (isRecord(value) && value.state === 'available' && isDocument(value.document)) {
        return { state: 'available', document: value.document }
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
  async retryUpgrade() {
    return readStorageState(() => invoke(METHODS.retryUpgrade, {}))
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
      !isGenerationSettings(value.generation) || typeof value.webSearchSupported !== 'boolean' ||
      !isResolvedModel(value.resolved)) {
      return { state: 'unavailable', failureCode: 'daily-briefing-settings-invalid' }
    }
    return {
      state: 'available',
      view: {
        settings: value.settings,
        generation: value.generation,
        webSearchSupported: value.webSearchSupported,
        resolved: value.resolved
      }
    }
  } catch {
    return { state: 'unavailable', failureCode: 'daily-briefing-request-failed' }
  }
}

function isGenerationSettings(value: unknown): value is DailyBriefingGenerationSettingsView {
  // Both zone fields are nullable on purpose: an older main process answers without them, and that
  // must read as "unknown", not as a failed settings read.
  return isExact(value, ['generationTime', 'windowHours', 'cronExpression'], ['generationTimeZone', 'generationTimeZoneInvalid', 'periods']) &&
    isText(value.generationTime) && typeof value.windowHours === 'number' && Number.isFinite(value.windowHours) &&
    isText(value.cronExpression) &&
    (value.generationTimeZone === undefined || value.generationTimeZone === null || isText(value.generationTimeZone)) &&
    (value.generationTimeZoneInvalid === undefined || value.generationTimeZoneInvalid === null || isText(value.generationTimeZoneInvalid)) &&
    (value.periods === undefined || (Array.isArray(value.periods) && value.periods.every(isPeriodView)))
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

function isResolvedModel(value: unknown): value is DailyBriefingSettingsView['resolved'] {
  if (!isRecord(value)) return false
  if (value.state === 'disabled') return true
  if (value.state === 'unavailable') return value.reason === 'default-unavailable'
  return value.state === 'agent' && isText(value.providerId) && isText(value.modelId) &&
    (value.source === 'default' || value.source === 'custom') &&
    (value.fallback === undefined || value.fallback === 'custom-unavailable')
}

function parseSummary(value: unknown): DailyBriefingEditionSummary | undefined {
  if (!isRecord(value) || !isText(value.date) || !isDailyBriefingLocale(value.locale) || !Array.isArray(value.availableLocales)) return undefined
  if (value.state !== 'generated' && value.state !== 'missing') return undefined
  if (!value.availableLocales.every(isDailyBriefingLocale)) return undefined
  if (value.state === 'generated' && (!isText(value.generatedAt) || !isText(value.windowEnd))) return undefined
  return Object.freeze({
    date: value.date,
    locale: value.locale,
    availableLocales: Object.freeze([...value.availableLocales]) as readonly ('zh-CN' | 'en-US')[],
    state: value.state,
    ...(isText(value.generatedAt) ? { generatedAt: value.generatedAt } : {}),
    ...(isText(value.summaryLine) ? { summaryLine: value.summaryLine } : {}),
    ...(typeof value.readingsAvailable === 'number' && Number.isSafeInteger(value.readingsAvailable)
      ? { readingsAvailable: value.readingsAvailable }
      : {}),
    ...(isText(value.windowEnd) ? { windowEnd: value.windowEnd } : {})
  })
}

function isDocument(value: unknown): value is DailyBriefingDocument {
  if (!isRecord(value) || !isDailyBriefingDocumentWithinBudget(value)) return false
  if ((value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4 && value.schemaVersion !== 5 && value.schemaVersion !== 6 && value.schemaVersion !== 7 && value.schemaVersion !== 8 && value.schemaVersion !== 9) || (value.policyVersion !== 'daily-briefing.v1' && value.policyVersion !== 'daily-briefing.v2' && value.policyVersion !== 'daily-briefing.v3' && value.policyVersion !== 'daily-briefing.v4' && value.policyVersion !== 'daily-briefing.v5' && value.policyVersion !== 'daily-briefing.v6' && value.policyVersion !== 'daily-briefing.v7' && value.policyVersion !== 'daily-briefing.v8' && value.policyVersion !== 'daily-briefing.v9' && value.policyVersion !== 'daily-briefing.v10' && value.policyVersion !== 'daily-briefing.v11' && value.policyVersion !== 'daily-briefing.v12' && value.policyVersion !== 'daily-briefing.v13' && value.policyVersion !== 'daily-briefing.v14' && value.policyVersion !== 'daily-briefing.v15' && value.policyVersion !== 'daily-briefing.v16' && value.policyVersion !== 'daily-briefing.v17' && value.policyVersion !== 'daily-briefing.v18' && value.policyVersion !== 'daily-briefing.v19' && value.policyVersion !== 'daily-briefing.v20')) return false
  if (!isEdition(value.edition, value.schemaVersion) || !isStatus(value.status) || !isLede(value.lede)) return false
  if (!isNews(value.news) || !isData(value.data) || !isConclusionOrNull(value.conclusion)) return false
  if (!isNext(value.next) || !Array.isArray(value.citations) || !isProvenance(value.provenance)) return false
  if (value.editorial !== undefined && !isEditorial(value.editorial)) return false
  return true
}

function isEdition(value: unknown, schemaVersion: unknown): boolean {
  if (!isExact(value, ['date', 'locale', 'generatedAt', 'windowStart', 'windowEnd', 'timeZone'], ['windowHours'])) return false
  if (value.windowHours !== undefined && typeof value.windowHours !== 'number') return false
  // From schema 7 the edition states the window it actually covered; older rows may omit it.
  if (typeof schemaVersion === 'number' && schemaVersion >= 7 && typeof value.windowHours !== 'number') return false
  return isText(value.date) && isDailyBriefingLocale(value.locale) && isText(value.generatedAt) &&
    isText(value.windowStart) && isText(value.windowEnd) && isText(value.timeZone)
}

function isStatus(value: unknown): boolean {
  if (!isExact(value, ['readings', 'readingsAvailable', 'readingsTotal'])) return false
  if (!Array.isArray(value.readings) || value.readings.length !== 4) return false
  if (typeof value.readingsAvailable !== 'number' || !Number.isSafeInteger(value.readingsAvailable) ||
    value.readingsAvailable < 0 || value.readingsAvailable > 4) return false
  if (value.readingsTotal !== 4) return false
  return value.readings.every((entry) => isRecord(entry) &&
    ['fear-greed', 'funding', 'capital', 'calendar'].includes(String(entry.id)) &&
    isDailyBriefingReadingState(entry.state))
}

function isLede(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.source !== 'template' && value.source !== 'agent') return false
  return typeof value.text === 'string' && isText(value.generatedAt) &&
    (value.factCount === undefined || (typeof value.factCount === 'number' && Number.isSafeInteger(value.factCount)))
}

function isNews(value: unknown): boolean {
  if (!isExact(value, ['items', 'macro', 'notes'], ['macroCandidates'])) return false
  if (!Array.isArray(value.items) || value.items.length > dailyBriefingPolicy.maximumNewsItems) return false
  if (!Array.isArray(value.macro) || value.macro.length > dailyBriefingPolicy.maximumMacroItems) return false
  if (!Array.isArray(value.items) || !value.items.every(isNewsItem)) return false
  if (!Array.isArray(value.macro) || !value.macro.every(isMacroItem)) return false
  return isRecord(value.notes)
}

function isNewsItem(value: unknown): boolean {
  return isRecord(value) && isText(value.itemId) && isText(value.title) && isText(value.sourceName) &&
    isText(value.publishedAt) && ['bullish', 'bearish', 'neutral', 'mixed'].includes(String(value.polarity)) &&
    typeof value.strength === 'number' && typeof value.confidence === 'number' && Array.isArray(value.symbols)
}

function isMacroItem(value: unknown): boolean {
  return isRecord(value) && isText(value.eventKey) && isText(value.title) && isText(value.scheduledAt) &&
    ['high', 'medium', 'low'].includes(String(value.importance)) && isRecord(value.surprise)
}

function isData(value: unknown): boolean {
  if (!isExact(value, ['market', 'funds', 'sentiment'], ['leverage', 'policyPath'])) return false
  if (!Array.isArray(value.market) || value.market.length > 7) return false
  if (!Array.isArray(value.funds) || value.funds.length > 5) return false
  if (!Array.isArray(value.market) || !value.market.every(isMarketRow)) return false
  if (!Array.isArray(value.funds) || !value.funds.every(isPulseRow)) return false
  return isRecord(value.sentiment) && (value.sentiment.fearGreed === null || isPulseRow(value.sentiment.fearGreed)) &&
    isRecord(value.sentiment.news)
}

function isMarketRow(value: unknown): boolean {
  return isRecord(value) && isText(value.labelKey) && isImportance(value.importance) &&
    isDailyBriefingReadingState(value.state) && isText(value.window)
}

function isPulseRow(value: unknown): boolean {
  return isRecord(value) && isText(value.labelKey) && isImportance(value.importance) &&
    isDailyBriefingReadingState(value.state) && isText(value.window)
}

function isImportance(value: unknown): boolean {
  return isRecord(value) && isFactImportanceTier(value.tier) && (value.source === 'rule' || value.source === 'agent') &&
    isText(value.reasonCode)
}

function isConclusionOrNull(value: unknown): boolean {
  if (value === null) return true
  if (!isRecord(value)) return false
  return isText(value.summaryId) && isText(value.publishedAt) && isText(value.direction) && isText(value.summary) &&
    Array.isArray(value.directions) && Array.isArray(value.conditions) && Array.isArray(value.invalidations) &&
    Array.isArray(value.counterEvidence) && Array.isArray(value.dataGaps) && Array.isArray(value.caveats)
}

function isNext(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > dailyBriefingPolicy.maximumNextItems) return false
  if (!value.items.every(isNextItem)) return false
  return value.focus === undefined || isNextItem(value.focus)
}

function isNextItem(value: unknown): boolean {
  if (!isRecord(value) || !isText(value.eventKey) || !isText(value.title) || !isText(value.at)) return false
  if (!['high', 'medium', 'low'].includes(String(value.importance))) return false
  if (!['economic-indicator', 'financial-event', 'central-bank-activity'].includes(String(value.category))) return false
  if (value.countryCode !== undefined && !isText(value.countryCode)) return false
  if (value.countryName !== undefined && !isText(value.countryName)) return false
  if (value.consensus !== undefined && !isText(value.consensus)) return false
  if (value.previous !== undefined && !isText(value.previous)) return false
  if (value.why !== undefined && !isText(value.why)) return false
  if (value.watch !== undefined) {
    if (!Array.isArray(value.watch) || value.watch.length > 3) return false
    if (!value.watch.every((entry) => isRecord(entry) && isText(entry.condition) && isText(entry.implication))) return false
  }
  return true
}

function isProvenance(value: unknown): boolean {
  return isRecord(value) && (value.summaryId === null || isText(value.summaryId)) && isText(value.readAt)
}

function isEditorial(value: unknown): boolean {
  return isRecord(value) && (value.dataNote === undefined || typeof value.dataNote === 'string') &&
    (value.invalidationNote === undefined || typeof value.invalidationNote === 'string')
}

function isExact(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key))
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

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.getOwnPropertySymbols(value).length === 0 &&
      Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => 'value' in descriptor)
  } catch {
    return false
  }
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
