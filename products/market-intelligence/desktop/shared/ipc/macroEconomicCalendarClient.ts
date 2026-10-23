import {
  MACRO_ECONOMIC_CALENDAR_IPC_METHODS,
  type ClearMacroEconomicCalendarReleaseTimeInput,
  type SetMacroEconomicCalendarReleaseTimeInput,
  type MacroEconomicCalendarReleaseTimeResult,
  type MacroEconomicCalendarEventView,
  type ManualBlsIcsImportResult,
  type ManualBlsIcsInput,
  type ManualBlsIcsPreview,
  type RefreshBlsEmploymentReleaseInput,
  type RefreshBlsEmploymentReleaseResult,
  type RefreshFedFomcDecisionInput,
  type RefreshFedFomcDecisionResult,
  type SyncBlsEmploymentScheduleInput,
  type SyncBlsScheduleAndValuesResult
} from '../../../contracts/macro/economicCalendarQueryContracts'
import { macroEconomicCalendarCaveatPolicy } from '../macroEconomicCalendarCaveatPolicy'
import { macroEconomicCalendarConsensusPolicy } from '../macroEconomicCalendarConsensusPolicy'

const productId = 'market-intelligence'

export const macroEconomicCalendarClientPolicy = {
  productId,
  maximumEvents: 200,
  maximumTextLength: 160,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  monthPattern: /^\d{4}-(?:0[1-9]|1[0-2])$/,
  datePattern: /^\d{4}-\d{2}-\d{2}$/,
  providerIds: ['macro-calendar-fed', 'macro-calendar-bea', 'macro-calendar-bls'],
  responseIdentity: 'must-match-request',
  asOfVisibility: 'event-detected-at-must-not-exceed-requested-as-of',
  manualBlsIcsCountFields: [
    'totalEvents', 'supportedReleaseGroups', 'generatedEvents', 'unsupportedEvents',
    'insertedCount', 'rescheduledCount', 'unchangedCount'
  ],
  manualBlsIcsUnchangedCountFields: [
    'totalEvents', 'supportedReleaseGroups', 'generatedEvents', 'unsupportedEvents', 'unchangedCount'
  ],
  manualBlsIcsFailureCodes: ['invalid-file', 'unsupported-calendar', 'no-supported-events', 'persistence-failed'],
  manualBlsIcsInvalidInputFailureCode: 'invalid-file',
  manualBlsIcsUnavailableFailureCode: 'persistence-failed'
} as const

export type MacroEconomicCalendarMonthResult =
  | { state: 'available'; asOf: string; events: readonly MacroEconomicCalendarEventView[] }
  | { state: 'unavailable'; failureCode: 'query-input-invalid' | 'calendar-query-unavailable' }

export type MacroEconomicCalendarEventResult =
  | { state: 'available'; asOf: string; event: MacroEconomicCalendarEventView }
  | { state: 'unavailable'; failureCode: 'query-input-invalid' | 'event-not-found' | 'calendar-query-unavailable' }

export type MacroEconomicCalendarClient = {
  queryMonth: (input: { month: string; asOf: string }) => Promise<MacroEconomicCalendarMonthResult>
  getEventDetail: (input: { eventKey: string; asOf: string }) => Promise<MacroEconomicCalendarEventResult>
  previewManualBlsIcs: (input: ManualBlsIcsInput) => Promise<ManualBlsIcsPreview>
  importManualBlsIcs: (input: ManualBlsIcsInput) => Promise<ManualBlsIcsImportResult>
  refreshBlsEmploymentRelease: (input: RefreshBlsEmploymentReleaseInput) => Promise<RefreshBlsEmploymentReleaseResult>
  refreshFedFomcDecision: (input: RefreshFedFomcDecisionInput) => Promise<RefreshFedFomcDecisionResult>
  syncBlsEmploymentSchedule: (input: SyncBlsEmploymentScheduleInput) => Promise<SyncBlsScheduleAndValuesResult>
  /** The reader's own release time. Main is the only writer; the renderer only asks. */
  setReleaseTime: (input: SetMacroEconomicCalendarReleaseTimeInput) => Promise<MacroEconomicCalendarReleaseTimeResult>
  clearReleaseTime: (input: ClearMacroEconomicCalendarReleaseTimeInput) => Promise<MacroEconomicCalendarReleaseTimeResult>
}

export const macroEconomicCalendarClient: MacroEconomicCalendarClient = {
  async queryMonth(input) {
    if (!isMonthInput(input)) return monthUnavailable('query-input-invalid')
    return sanitizeMonth(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.queryMonth, input), input)
  },
  async getEventDetail(input) {
    if (!isDetailInput(input)) return detailUnavailable('query-input-invalid')
    return sanitizeDetail(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getEventDetail, input), input)
  },
  async previewManualBlsIcs(input) {
    if (!isManualBlsIcsInput(input)) return manualPreviewFailure(macroEconomicCalendarClientPolicy.manualBlsIcsInvalidInputFailureCode)
    return sanitizeManualPreview(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.previewManualBlsIcs, input))
  },
  async importManualBlsIcs(input) {
    if (!isManualBlsIcsInput(input)) return manualImportFailure(macroEconomicCalendarClientPolicy.manualBlsIcsInvalidInputFailureCode)
    return sanitizeManualImport(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.importManualBlsIcs, input))
  },
  async refreshBlsEmploymentRelease(input) {
    if (!isRefreshInput(input)) return refreshUnavailable()
    return sanitizeRefresh(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshBlsEmploymentRelease, input))
  },
  async refreshFedFomcDecision(input) {
    if (!isFedFomcRefreshInput(input)) return fedFomcRefreshUnavailable()
    return sanitizeFedFomcRefresh(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.refreshFedFomcDecision, input))
  },
  async syncBlsEmploymentSchedule(input) {
    if (!isScheduleSyncInput(input)) return scheduleUnavailable()
    return sanitizeScheduleSync(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.syncBlsEmploymentSchedule, input))
  },
  async setReleaseTime(input) {
    if (!isReleaseTimeInput(input)) return { state: 'rejected' }
    return sanitizeReleaseTime(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.setReleaseTime, input))
  },
  async clearReleaseTime(input) {
    if (!isClearReleaseTimeInput(input)) return { state: 'rejected' }
    return sanitizeReleaseTime(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.clearReleaseTime, input))
  }
}

function isReleaseTimeInput(value: unknown): value is SetMacroEconomicCalendarReleaseTimeInput {
  if (!isRecord(value)) return false
  return typeof value.eventKey === 'string' && typeof value.scheduledAt === 'string' && typeof value.scheduledDate === 'string'
}

function isClearReleaseTimeInput(value: unknown): value is ClearMacroEconomicCalendarReleaseTimeInput {
  return isRecord(value) && typeof value.eventKey === 'string'
}

/** Only the three states main can answer with; anything else is a refusal, not a silent success. */
function sanitizeReleaseTime(value: unknown): MacroEconomicCalendarReleaseTimeResult {
  if (!isRecord(value)) return { state: 'rejected' }
  if (value.state === 'cleared') return { state: 'cleared' }
  if (value.state !== 'saved' || typeof value.scheduledAt !== 'string' || typeof value.scheduledDate !== 'string') return { state: 'rejected' }
  return Number.isFinite(Date.parse(value.scheduledAt)) ? { state: 'saved', scheduledAt: value.scheduledAt, scheduledDate: value.scheduledDate } : { state: 'rejected' }
}

async function invoke(method: string, payload: unknown): Promise<unknown> {
  try {
    if (!window.platform?.products?.invoke) return undefined
    return await window.platform.products.invoke(productId, method, payload)
  } catch {
    return undefined
  }
}

function sanitizeMonth(value: unknown, input: { month: string; asOf: string }): MacroEconomicCalendarMonthResult {
  if (!isRecord(value)) return monthUnavailable('calendar-query-unavailable')
  if (value.state === 'unavailable' && hasExactFields(value, ['state', 'failureCode']) && isMonthFailureCode(value.failureCode)) {
    return { state: 'unavailable', failureCode: value.failureCode }
  }
  if (!hasExactFields(value, ['state', 'asOf', 'events']) || value.state !== 'available' || value.asOf !== input.asOf || !Array.isArray(value.events) || value.events.length > macroEconomicCalendarClientPolicy.maximumEvents) {
    return monthUnavailable('calendar-query-unavailable')
  }
  const events = value.events.map((event) => sanitizeEvent(event, input.asOf))
  return events.some((event) => !event)
    ? monthUnavailable('calendar-query-unavailable')
    : { state: 'available', asOf: value.asOf, events: events as MacroEconomicCalendarEventView[] }
}

function sanitizeDetail(value: unknown, input: { eventKey: string; asOf: string }): MacroEconomicCalendarEventResult {
  if (!isRecord(value)) return detailUnavailable('calendar-query-unavailable')
  if (value.state === 'unavailable' && hasExactFields(value, ['state', 'failureCode']) && isDetailFailureCode(value.failureCode)) {
    return { state: 'unavailable', failureCode: value.failureCode }
  }
  if (!hasExactFields(value, ['state', 'asOf', 'event']) || value.state !== 'available' || value.asOf !== input.asOf) {
    return detailUnavailable('calendar-query-unavailable')
  }
  const event = sanitizeEvent(value.event, input.asOf)
  return event && event.eventKey === input.eventKey
    ? { state: 'available', asOf: value.asOf, event }
    : detailUnavailable('calendar-query-unavailable')
}

function sanitizeManualPreview(value: unknown): ManualBlsIcsPreview {
  if (!isRecord(value)) return manualPreviewFailure(macroEconomicCalendarClientPolicy.manualBlsIcsUnavailableFailureCode)
  if (value.state === 'failed' && hasExactFields(value, ['state', 'failureCode']) && isManualBlsIcsFailureCode(value.failureCode)) {
    return { state: 'failed', failureCode: value.failureCode }
  }
  const counts = readManualBlsIcsCounts(value, macroEconomicCalendarClientPolicy.manualBlsIcsCountFields)
  return value.state === 'ready' && counts
    ? { state: 'ready', ...counts }
    : manualPreviewFailure(macroEconomicCalendarClientPolicy.manualBlsIcsUnavailableFailureCode)
}

function sanitizeManualImport(value: unknown): ManualBlsIcsImportResult {
  if (!isRecord(value)) return manualImportFailure(macroEconomicCalendarClientPolicy.manualBlsIcsUnavailableFailureCode)
  if (value.state === 'failed' && hasExactFields(value, ['state', 'failureCode']) && isManualBlsIcsFailureCode(value.failureCode)) {
    return { state: 'failed', failureCode: value.failureCode }
  }
  const importedCounts = readManualBlsIcsCounts(value, macroEconomicCalendarClientPolicy.manualBlsIcsCountFields)
  if (value.state === 'imported' && importedCounts) return { state: 'imported', ...importedCounts }
  const unchangedCounts = readManualBlsIcsCounts(value, macroEconomicCalendarClientPolicy.manualBlsIcsUnchangedCountFields)
  return value.state === 'unchanged' && unchangedCounts
    ? { state: 'unchanged', ...unchangedCounts }
    : manualImportFailure(macroEconomicCalendarClientPolicy.manualBlsIcsUnavailableFailureCode)
}

function readManualBlsIcsCounts(
  value: Record<string, unknown>,
  fields: readonly string[]
): Omit<Extract<ManualBlsIcsPreview, { state: 'ready' }>, 'state'> | undefined {
  if (!hasExactFields(value, ['state', ...fields])) return undefined
  const counts = fields.map((field) => value[field])
  if (!counts.every((count) => Number.isSafeInteger(count) && (count as number) >= 0)) return undefined
  return Object.fromEntries(fields.map((field, index) => [field, counts[index]!])) as Omit<Extract<ManualBlsIcsPreview, { state: 'ready' }>, 'state'>
}

function sanitizeEvent(value: unknown, asOf: string): MacroEconomicCalendarEventView | undefined {
  if (!isRecord(value) || !hasOnlyFields(value, [
    'eventKey', 'releaseGroupKey', 'eventFamily', 'titleKey', 'countryCode', 'importance', 'periodKey', 'lifecycleState',
    'coverage', 'scheduledDate', 'scheduledAt', 'releaseTimeSource', 'conventionScheduledAt', 'officialReleaseDate', 'publishedAt', 'detectedAt', 'actual', 'previous', 'consensus',
    'consensusState', 'surprise', 'providerIds', 'caveats'
  ]) || !hasRequiredFields(value, [
    'eventKey', 'releaseGroupKey', 'eventFamily', 'titleKey', 'countryCode', 'importance', 'periodKey', 'lifecycleState',
    'coverage', 'scheduledDate', 'detectedAt', 'consensus', 'consensusState', 'surprise', 'providerIds', 'caveats'
  ])) return undefined
  if (!isBoundedText(value.eventKey) || !isBoundedText(value.releaseGroupKey) || !isBoundedText(value.eventFamily) || !isBoundedText(value.titleKey) ||
    !isBoundedText(value.periodKey) || value.countryCode !== 'US' || value.importance !== 'high' || !isLifecycleState(value.lifecycleState) ||
    !isCoverage(value.coverage) || !isDate(value.scheduledDate) || !isCanonicalUtcMillis(value.detectedAt) || value.detectedAt > asOf ||
    !isOptionalCanonicalUtcMillis(value.scheduledAt) || !isReleaseTimeSource(value.releaseTimeSource) ||
    !isOptionalCanonicalUtcMillis(value.conventionScheduledAt) || !isOptionalDateProperty(value, 'officialReleaseDate') || !isOptionalCanonicalUtcMillis(value.publishedAt) ||
    !isValue(value.actual) || !isValue(value.previous) || !isConsensus(value.consensus) ||
    !macroEconomicCalendarConsensusPolicy.isState(value.consensusState) ||
    !macroEconomicCalendarConsensusPolicy.isSurprise(value.surprise) || !isProviderIds(value.providerIds) || !isCaveats(value.caveats)) return undefined
  return {
    eventKey: value.eventKey, releaseGroupKey: value.releaseGroupKey, eventFamily: value.eventFamily, titleKey: value.titleKey,
    countryCode: 'US', importance: 'high', periodKey: value.periodKey, lifecycleState: value.lifecycleState,
    coverage: value.coverage, scheduledDate: value.scheduledDate, ...(value.scheduledAt ? { scheduledAt: value.scheduledAt } : {}),
    releaseTimeSource: value.releaseTimeSource as MacroEconomicCalendarEventView['releaseTimeSource'],
    ...(value.conventionScheduledAt ? { conventionScheduledAt: value.conventionScheduledAt as string } : {}),
    ...(value.officialReleaseDate ? { officialReleaseDate: value.officialReleaseDate as string } : {}),
    ...(value.publishedAt ? { publishedAt: value.publishedAt } : {}), detectedAt: value.detectedAt,
    ...(value.actual ? { actual: value.actual } : {}), ...(value.previous ? { previous: value.previous } : {}),
    consensus: value.consensus, consensusState: value.consensusState, surprise: value.surprise,
    providerIds: [...value.providerIds], caveats: [...value.caveats]
  }
}

function isMonthInput(value: unknown): value is { month: string; asOf: string } {
  return isRecord(value) && hasExactFields(value, ['month', 'asOf']) && typeof value.month === 'string' &&
    macroEconomicCalendarClientPolicy.monthPattern.test(value.month) && isCanonicalUtcMillis(value.asOf)
}

function isDetailInput(value: unknown): value is { eventKey: string; asOf: string } {
  return isRecord(value) && hasExactFields(value, ['eventKey', 'asOf']) && isBoundedText(value.eventKey) && isCanonicalUtcMillis(value.asOf)
}

function isManualBlsIcsInput(value: unknown): value is ManualBlsIcsInput {
  return isRecord(value) && hasExactFields(value, ['body', 'truncated']) && typeof value.body === 'string' &&
    value.body.trim().length > 0 && typeof value.truncated === 'boolean'
}
function isRefreshInput(value: unknown): value is RefreshBlsEmploymentReleaseInput {
  return isRecord(value) && hasExactFields(value, ['eventKey', 'confirmed']) && isBoundedText(value.eventKey) && value.confirmed === true
}
function sanitizeRefresh(value: unknown): RefreshBlsEmploymentReleaseResult {
  return isRecord(value) && hasExactFields(value, ['state']) && (value.state === 'updated' || value.state === 'unchanged' || value.state === 'unavailable')
    ? Object.freeze({ state: value.state }) : refreshUnavailable()
}
function refreshUnavailable(): RefreshBlsEmploymentReleaseResult { return Object.freeze({ state: 'unavailable' }) }
function isFedFomcRefreshInput(value: unknown): value is RefreshFedFomcDecisionInput {
  return isRefreshInput(value) && /^US\.FOMC\.\d{4}-\d{2}-\d{2}$/.test(value.eventKey)
}
function sanitizeFedFomcRefresh(value: unknown): RefreshFedFomcDecisionResult {
  return isRecord(value) && hasExactFields(value, ['state']) && (value.state === 'updated' || value.state === 'unchanged' || value.state === 'unavailable')
    ? Object.freeze({ state: value.state }) : fedFomcRefreshUnavailable()
}
function fedFomcRefreshUnavailable(): RefreshFedFomcDecisionResult { return Object.freeze({ state: 'unavailable' }) }
function isScheduleSyncInput(value: unknown): value is SyncBlsEmploymentScheduleInput { return isRecord(value) && hasExactFields(value, ['year']) && typeof value.year === 'string' && /^\d{4}$/.test(value.year) }
function sanitizeScheduleSync(value: unknown): SyncBlsScheduleAndValuesResult {
  if (isExactDataRecord(value, ['state', 'schedule', 'values']) && value.state === 'completed' && isExactDataRecord(value.values, ['cpi', 'employment']) && (value.schedule === 'updated' || value.schedule === 'unchanged') && isCatchUpState(value.values.cpi) && isCatchUpState(value.values.employment)) {
    return Object.freeze({ state: 'completed', schedule: value.schedule, values: Object.freeze({ cpi: value.values.cpi, employment: value.values.employment }) })
  }
  return scheduleUnavailable()
}
function isCatchUpState(value: unknown): value is 'updated' | 'current' | 'not-required' | 'unavailable' { return value === 'updated' || value === 'current' || value === 'not-required' || value === 'unavailable' }
function scheduleUnavailable(): SyncBlsScheduleAndValuesResult { return Object.freeze({ state: 'unavailable' }) }

function isExactDataRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const record = value as Record<string, unknown>
    const names = Object.getOwnPropertyNames(record)
    return names.length === fields.length && Object.getOwnPropertySymbols(record).length === 0 && fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, field)
      return Boolean(descriptor && 'value' in descriptor)
    })
  } catch { return false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return hasOnlyFields(value, fields) && hasRequiredFields(value, fields)
}

function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.getOwnPropertyNames(value).every((field) => fields.includes(field)) && Object.getOwnPropertySymbols(value).length === 0
}

function hasRequiredFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => Object.hasOwn(value, field))
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= macroEconomicCalendarClientPolicy.maximumTextLength
}

function isCanonicalUtcMillis(value: unknown): value is string {
  if (typeof value !== 'string' || !macroEconomicCalendarClientPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isOptionalCanonicalUtcMillis(value: unknown): value is string | undefined {
  return value === undefined || isCanonicalUtcMillis(value)
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !macroEconomicCalendarClientPolicy.datePattern.test(value)) return false
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

function isOptionalDateProperty(value: Record<string, unknown>, field: string): boolean {
  if (!Object.hasOwn(value, field)) return true
  const descriptor = Object.getOwnPropertyDescriptor(value, field)
  return Boolean(descriptor && Object.hasOwn(descriptor, 'value') && isDate(descriptor.value))
}

function isLifecycleState(value: unknown): value is MacroEconomicCalendarEventView['lifecycleState'] {
  return value === 'scheduled' || value === 'released' || value === 'cancelled'
}

function isCoverage(value: unknown): value is MacroEconomicCalendarEventView['coverage'] {
  return value === 'available' || value === 'partial' || value === 'unavailable'
}

/** A displayed time must always say where it came from; anything else fails closed at the boundary. */
function isReleaseTimeSource(value: unknown): value is MacroEconomicCalendarEventView['releaseTimeSource'] {
  return value === 'official' || value === 'convention-default' || value === 'user-edited' || value === 'date-only'
}

/** The contract admits a real market consensus, so only the value shape is required here. */
function isConsensus(value: unknown): value is MacroEconomicCalendarEventView['consensus'] {
  return value === null || (isRecord(value) && isValue(value))
}

function isValue(value: unknown): value is MacroEconomicCalendarEventView['actual'] {
  return value === undefined || (isRecord(value) && hasOnlyFields(value, ['displayValue', 'numericValue', 'numericLowerBound', 'numericUpperBound', 'unit']) &&
    hasRequiredFields(value, ['displayValue']) && isBoundedText(value.displayValue) &&
    (value.numericValue === undefined || (typeof value.numericValue === 'number' && Number.isFinite(value.numericValue))) &&
    (value.numericLowerBound === undefined || (typeof value.numericLowerBound === 'number' && Number.isFinite(value.numericLowerBound))) &&
    (value.numericUpperBound === undefined || (typeof value.numericUpperBound === 'number' && Number.isFinite(value.numericUpperBound))) &&
    ((value.numericLowerBound === undefined && value.numericUpperBound === undefined) ||
      (value.numericLowerBound !== undefined && value.numericUpperBound !== undefined && value.numericLowerBound < value.numericUpperBound)) &&
    (value.unit === undefined || isBoundedText(value.unit)))
}

function isProviderIds(value: unknown): value is readonly MacroEconomicCalendarEventView['providerIds'][number][] {
  return Array.isArray(value) && value.length > 0 && value.every((providerId) =>
    typeof providerId === 'string' && (macroEconomicCalendarClientPolicy.providerIds as readonly string[]).includes(providerId)
  )
}

function isCaveats(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((caveat) =>
    macroEconomicCalendarCaveatPolicy.isAdmitted(caveat)
  )
}

function isMonthFailureCode(value: unknown): value is Extract<MacroEconomicCalendarMonthResult, { state: 'unavailable' }>['failureCode'] {
  return value === 'query-input-invalid' || value === 'calendar-query-unavailable'
}

function isDetailFailureCode(value: unknown): value is Extract<MacroEconomicCalendarEventResult, { state: 'unavailable' }>['failureCode'] {
  return isMonthFailureCode(value) || value === 'event-not-found'
}

function isManualBlsIcsFailureCode(value: unknown): value is Extract<ManualBlsIcsPreview, { state: 'failed' }>['failureCode'] {
  return typeof value === 'string' && (macroEconomicCalendarClientPolicy.manualBlsIcsFailureCodes as readonly string[]).includes(value)
}

function monthUnavailable(failureCode: Extract<MacroEconomicCalendarMonthResult, { state: 'unavailable' }>['failureCode']): MacroEconomicCalendarMonthResult {
  return { state: 'unavailable', failureCode }
}

function detailUnavailable(failureCode: Extract<MacroEconomicCalendarEventResult, { state: 'unavailable' }>['failureCode']): MacroEconomicCalendarEventResult {
  return { state: 'unavailable', failureCode }
}

function manualPreviewFailure(failureCode: Extract<ManualBlsIcsPreview, { state: 'failed' }>['failureCode']): ManualBlsIcsPreview {
  return { state: 'failed', failureCode }
}

function manualImportFailure(failureCode: Extract<ManualBlsIcsImportResult, { state: 'failed' }>['failureCode']): ManualBlsIcsImportResult {
  return { state: 'failed', failureCode }
}
