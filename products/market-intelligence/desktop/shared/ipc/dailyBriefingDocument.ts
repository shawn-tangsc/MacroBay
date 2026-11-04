import {
  dailyBriefingPolicy,
  isDailyBriefingDocumentWithinBudget,
  isDailyBriefingLocale,
  isDailyBriefingReadingState,
  isFactImportanceTier,
  type DailyBriefingDocument
} from '../../../contracts/dailyBriefing'

/**
 * Reading a brief document off the wire.
 *
 * The renderer must not trust what arrives: an older main process, a truncated write or a
 * hand-edited file all arrive the same way, and a half-understood document must be refused whole
 * rather than rendered with missing pieces. These are the guards the client applies before it shows
 * anything; keeping them here leaves the client as transport and this file as the judgement.
 */

function isDocument(value: unknown): value is DailyBriefingDocument {
  if (!isRecord(value) || !isDailyBriefingDocumentWithinBudget(value)) return false
  if ((value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4 && value.schemaVersion !== 5 && value.schemaVersion !== 6 && value.schemaVersion !== 7 && value.schemaVersion !== 8 && value.schemaVersion !== 9 && value.schemaVersion !== 10) || (value.policyVersion !== 'daily-briefing.v1' && value.policyVersion !== 'daily-briefing.v2' && value.policyVersion !== 'daily-briefing.v3' && value.policyVersion !== 'daily-briefing.v4' && value.policyVersion !== 'daily-briefing.v5' && value.policyVersion !== 'daily-briefing.v6' && value.policyVersion !== 'daily-briefing.v7' && value.policyVersion !== 'daily-briefing.v8' && value.policyVersion !== 'daily-briefing.v9' && value.policyVersion !== 'daily-briefing.v10' && value.policyVersion !== 'daily-briefing.v11' && value.policyVersion !== 'daily-briefing.v12' && value.policyVersion !== 'daily-briefing.v13' && value.policyVersion !== 'daily-briefing.v14' && value.policyVersion !== 'daily-briefing.v15' && value.policyVersion !== 'daily-briefing.v16' && value.policyVersion !== 'daily-briefing.v17' && value.policyVersion !== 'daily-briefing.v18' && value.policyVersion !== 'daily-briefing.v19' && value.policyVersion !== 'daily-briefing.v20' && value.policyVersion !== 'daily-briefing.v21')) return false
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

export { isDocument, isRecord, isText, isExact }
