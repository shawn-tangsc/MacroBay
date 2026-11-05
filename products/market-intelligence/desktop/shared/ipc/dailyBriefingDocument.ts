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
  if ((value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4 && value.schemaVersion !== 5 && value.schemaVersion !== 6 && value.schemaVersion !== 7 && value.schemaVersion !== 8 && value.schemaVersion !== 9 && value.schemaVersion !== 10 && value.schemaVersion !== 11 && value.schemaVersion !== 12 && value.schemaVersion !== 13 && value.schemaVersion !== 14 && value.schemaVersion !== 15) || (value.policyVersion !== 'daily-briefing.v1' && value.policyVersion !== 'daily-briefing.v2' && value.policyVersion !== 'daily-briefing.v3' && value.policyVersion !== 'daily-briefing.v4' && value.policyVersion !== 'daily-briefing.v5' && value.policyVersion !== 'daily-briefing.v6' && value.policyVersion !== 'daily-briefing.v7' && value.policyVersion !== 'daily-briefing.v8' && value.policyVersion !== 'daily-briefing.v9' && value.policyVersion !== 'daily-briefing.v10' && value.policyVersion !== 'daily-briefing.v11' && value.policyVersion !== 'daily-briefing.v12' && value.policyVersion !== 'daily-briefing.v13' && value.policyVersion !== 'daily-briefing.v14' && value.policyVersion !== 'daily-briefing.v15' && value.policyVersion !== 'daily-briefing.v16' && value.policyVersion !== 'daily-briefing.v17' && value.policyVersion !== 'daily-briefing.v18' && value.policyVersion !== 'daily-briefing.v19' && value.policyVersion !== 'daily-briefing.v20' && value.policyVersion !== 'daily-briefing.v21' && value.policyVersion !== 'daily-briefing.v22' && value.policyVersion !== 'daily-briefing.v23' && value.policyVersion !== 'daily-briefing.v24')) return false
  if (!isEdition(value.edition, value.schemaVersion) || !isStatus(value.status) || !isLede(value.lede)) return false
  if (!isNews(value.news) || !isData(value.data) || !isConclusionOrNull(value.conclusion)) return false
  if (!isNext(value.next) || !Array.isArray(value.citations) || !isProvenance(value.provenance)) return false
  if (value.editorial !== undefined && !isEditorial(value.editorial)) return false
  return true
}

function isEdition(value: unknown, schemaVersion: unknown): boolean {
  if (!hasFields(value, ['date', 'locale', 'generatedAt', 'windowStart', 'windowEnd', 'timeZone'])) return false
  if (value.windowHours !== undefined && typeof value.windowHours !== 'number') return false
  // From schema 7 the edition states the window it actually covered; older rows may omit it.
  if (typeof schemaVersion === 'number' && schemaVersion >= 7 && typeof value.windowHours !== 'number') return false
  // From schema 13 the edition carries its period identity — periodId (an opaque identity), the
  // nominal cutoff periodTime, and the kind of period. All four fields of that step arrive together,
  // including runTrigger, which is not identity but *how this run happened* (scheduled / catch-up /
  // retry / manual); a document with only some of them is refused rather than guessed at.
  if (typeof schemaVersion === 'number' && schemaVersion >= 13) {
    if (!isText(value.periodId) || !isText(value.periodTime)) return false
    // A11.4: the nominal cutoff is stored at millisecond precision, like generatedAt. Without this
    // check a second-precision value would pass and the judge would quietly stop holding.
    if (!isIsoMilliseconds(value.periodTime)) return false
    if (value.periodKind !== 'scheduled' && value.periodKind !== 'manual') return false
    if (!['scheduled', 'catch-up', 'retry', 'manual'].includes(String(value.runTrigger))) return false
  } else if (value.periodId !== undefined || value.periodTime !== undefined || value.periodKind !== undefined || value.runTrigger !== undefined) {
    // Editions before 13 had no period fields; a half-written set would make the fallback ambiguous.
    return false
  }
  return isText(value.date) && isDailyBriefingLocale(value.locale) && isText(value.generatedAt) &&
    isText(value.windowStart) && isText(value.windowEnd) && isText(value.timeZone)
}

/** An ISO instant with milliseconds, in UTC, that survives a parse/format round trip. */
function isIsoMilliseconds(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isStatus(value: unknown): boolean {
  if (!hasFields(value, ['readings', 'readingsAvailable', 'readingsTotal'])) return false
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
  if (!hasFields(value, ['items', 'macro', 'notes'])) return false
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
  if (!isRecord(value) || !isText(value.eventKey) || !isText(value.title) || !isText(value.scheduledAt) ||
    !['high', 'medium', 'low'].includes(String(value.importance)) || !isRecord(value.surprise)) return false
  // Schema 14 carries the event's own lifecycle; absent on older rows, never a fourth state.
  return value.lifecycleState === undefined ||
    value.lifecycleState === 'scheduled' || value.lifecycleState === 'released' || value.lifecycleState === 'cancelled'
}

function isData(value: unknown): boolean {
  if (!hasFields(value, ['market', 'funds', 'sentiment'])) return false
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

/**
 * 只要求**必需字段在**，不认识的字段一律忽略（`02` v2.129 `G5` 前向兼容）。
 *
 * 以前这里是"白名单外即拒"：服务端给文档加了 `readAt`/`generatedAs`/`isBackfill` 之后，渲染层把
 * 整份文档判成不可信，页面报"失败"且没有原因——一次服务端加字段就把"成功"显示成"失败"。
 * 前向兼容的边界只留一条：**文档版本号更高才拒**（版本低/未知字段都能照常渲染）。
 */
function hasFields(value: unknown, required: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key))
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

/**
 * 严格版：白名单外即拒。**文档不用它**（`G5` 前向兼容），设置视图仍用它——设置是本地契约，
 * 多出字段说明两边版本错位，早失败比悄悄忽略好。
 */
export function isExact(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key))
}

export { isDocument, isRecord, isText }
