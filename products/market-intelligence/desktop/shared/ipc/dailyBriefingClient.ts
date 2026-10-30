import {
  dailyBriefingPolicy,
  isDailyBriefingDocumentWithinBudget,
  isDailyBriefingLocale,
  isDailyBriefingReadingState,
  isFactImportanceTier,
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
  getSettings: 'intelligence.dailyBriefing.getSettings',
  saveSettings: 'intelligence.dailyBriefing.saveSettings'
})

export type DailyBriefingClientInput = Readonly<{ locale: 'zh-CN' | 'en-US'; timeZone: string }>
export type DailyBriefingClientGetInput = Readonly<{ date: string; locale: 'zh-CN' | 'en-US' }>

export type DailyBriefingClientTodayResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

export type DailyBriefingClientListResult =
  | Readonly<{ state: 'available'; result: DailyBriefingListResult }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

export type DailyBriefingClientGetResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
  | Readonly<{ state: 'missing' }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

export type DailyBriefingAiSettingsView = Readonly<{
  settings: Readonly<{ editorialEnabled: boolean; providerId: string; modelId: string }>
  resolved:
    | Readonly<{ state: 'disabled' }>
    | Readonly<{ state: 'agent'; providerId: string; modelId: string; source: 'default' | 'custom'; fallback?: 'custom-unavailable' }>
    | Readonly<{ state: 'unavailable'; reason: 'default-unavailable' }>
}>

export type DailyBriefingAiSettingsPatch = Readonly<{
  editorialEnabled?: boolean
  providerId?: string
  modelId?: string
}>

export type DailyBriefingSettingsResult =
  | Readonly<{ state: 'available'; view: DailyBriefingAiSettingsView }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

export type DailyBriefingClient = Readonly<{
  getToday: (input: DailyBriefingClientInput) => Promise<DailyBriefingClientTodayResult>
  list: (input: DailyBriefingClientInput) => Promise<DailyBriefingClientListResult>
  get: (input: DailyBriefingClientGetInput) => Promise<DailyBriefingClientGetResult>
  regenerate: (input: DailyBriefingClientInput) => Promise<DailyBriefingClientTodayResult>
  getSettings: () => Promise<DailyBriefingSettingsResult>
  saveSettings: (patch: DailyBriefingAiSettingsPatch) => Promise<DailyBriefingSettingsResult>
}>

export const dailyBriefingClient: DailyBriefingClient = {
  async getToday(input) {
    try {
      const value = await invoke(METHODS.getToday, input)
      if (isRecord(value) && value.state === 'unavailable' && isText(value.failureCode)) {
        return { state: 'unavailable', failureCode: value.failureCode }
      }
      if (isRecord(value) && value.state === 'available' && isDocument(value.document)) {
        return { state: 'available', document: value.document }
      }
      return unavailable()
    } catch {
      return unavailable()
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

async function readSettings(read: () => Promise<unknown>): Promise<DailyBriefingSettingsResult> {
  try {
    const value = await read()
    if (!isRecord(value) || !isRecord(value.settings) || !isAiSettings(value.settings) || !isResolvedModel(value.resolved)) {
      return { state: 'unavailable', failureCode: 'daily-briefing-settings-invalid' }
    }
    return { state: 'available', view: { settings: value.settings, resolved: value.resolved } }
  } catch {
    return { state: 'unavailable', failureCode: 'daily-briefing-request-failed' }
  }
}

function isAiSettings(value: Record<string, unknown>): value is { editorialEnabled: boolean; providerId: string; modelId: string } {
  return isExact(value, ['editorialEnabled', 'providerId', 'modelId']) &&
    typeof value.editorialEnabled === 'boolean' && typeof value.providerId === 'string' && typeof value.modelId === 'string'
}

function isResolvedModel(value: unknown): value is DailyBriefingAiSettingsView['resolved'] {
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
  if ((value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4 && value.schemaVersion !== 5) || (value.policyVersion !== 'daily-briefing.v1' && value.policyVersion !== 'daily-briefing.v2' && value.policyVersion !== 'daily-briefing.v3' && value.policyVersion !== 'daily-briefing.v4' && value.policyVersion !== 'daily-briefing.v5' && value.policyVersion !== 'daily-briefing.v6' && value.policyVersion !== 'daily-briefing.v7' && value.policyVersion !== 'daily-briefing.v8' && value.policyVersion !== 'daily-briefing.v9' && value.policyVersion !== 'daily-briefing.v10' && value.policyVersion !== 'daily-briefing.v11' && value.policyVersion !== 'daily-briefing.v12' && value.policyVersion !== 'daily-briefing.v13' && value.policyVersion !== 'daily-briefing.v14' && value.policyVersion !== 'daily-briefing.v15' && value.policyVersion !== 'daily-briefing.v16')) return false
  if (!isEdition(value.edition) || !isStatus(value.status) || !isLede(value.lede)) return false
  if (!isNews(value.news) || !isData(value.data) || !isConclusionOrNull(value.conclusion)) return false
  if (!isNext(value.next) || !Array.isArray(value.citations) || !isProvenance(value.provenance)) return false
  if (value.editorial !== undefined && !isEditorial(value.editorial)) return false
  return true
}

function isEdition(value: unknown): boolean {
  if (!isExact(value, ['date', 'locale', 'generatedAt', 'windowStart', 'windowEnd', 'timeZone'])) return false
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
  if (!isExact(value, ['items', 'macro', 'notes'], ['items', 'macro', 'notes'])) return false
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
  if (!isExact(value, ['market', 'funds', 'sentiment'])) return false
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
