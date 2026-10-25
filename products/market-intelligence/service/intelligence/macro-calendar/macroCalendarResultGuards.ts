import {
  macroCalendarProviderSettingsPolicy,
  type ClearMacroEconomicCalendarReleaseTimeInput,
  type DashboardSourceConnectionResult,
  type MacroCalendarProviderActionResult,
  type MacroCalendarProviderPageResult,
  type MacroCalendarProviderPageState,
  type MacroCalendarProviderScheduleResult,
  type MacroCalendarSettingsProviderId,
  type ManualBlsIcsImportResult,
  type ManualBlsIcsPreview,
  type RefreshBlsEmploymentReleaseResult,
  type RefreshFedFomcDecisionResult,
  type SaveMacroCalendarProviderInput,
  type SetMacroEconomicCalendarReleaseTimeInput,
  type SyncBlsScheduleAndValuesResult
} from '../../../contracts/macro/economicCalendarQueryContracts'
import type { BlsEmploymentMvpRefreshService } from './bls-employment-refresh/blsEmploymentMvpRefreshService'
import type { BlsScheduleAndValuesSyncWorkflow } from './bls-schedule-catch-up/blsScheduleAndLatestValuesSyncWorkflow'
import type { FedFomcManualRefreshService } from './fed-statements/fedFomcManualRefreshService'

/**
 * The result boundary every calendar write crosses.
 *
 * The IPC registration and the agent facade both call these functions, so a
 * service result is sanitized exactly once and a domain rejection keeps its own
 * `{ state, failureCode }` shape instead of escaping as an exception.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
export function hasOnly(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.getOwnPropertyNames(value).every((field) => fields.includes(field)) && Object.getOwnPropertySymbols(value).length === 0
}
export function hasRequired(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => Object.hasOwn(value, field))
}
export function isExact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && hasRequired(value, fields) && Object.getOwnPropertySymbols(value).length === 0 && names.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return Boolean(descriptor && 'value' in descriptor)
    })
  } catch {
    return false
  }
}
export function isProviderId(value: unknown): value is MacroCalendarSettingsProviderId {
  return typeof value === 'string' && macroCalendarProviderSettingsPolicy.providerIds.includes(value as never)
}
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
export function isCanonicalOptional(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && macroCalendarProviderSettingsPolicy.canonicalUtcMillisPattern.test(value) && new Date(value).toISOString() === value)
}
export function isEmpty(value: unknown): boolean {
  try { return isRecord(value) && Object.getOwnPropertyNames(value).length === 0 && Object.getOwnPropertySymbols(value).length === 0 } catch { return false }
}
export function isProviderInput(value: unknown): value is { providerId: MacroCalendarSettingsProviderId } {
  if (!isExact(value, ['providerId'])) return false
  return isProviderId(value.providerId)
}
export function isSaveProviderInput(value: unknown): value is SaveMacroCalendarProviderInput {
  if (!isExact(value, ['providerId', 'enabled'])) return false
  return isProviderId(value.providerId) && typeof value.enabled === 'boolean'
}
export function providerUnavailable(): { state: 'unavailable'; failureCode: 'provider-settings-unavailable' } {
  return { state: 'unavailable' as const, failureCode: 'provider-settings-unavailable' as const }
}
export function providerUnavailableAction(): { state: 'failed'; failureCode: 'provider-settings-unavailable' } {
  return { state: 'failed' as const, failureCode: 'provider-settings-unavailable' as const }
}
export function dashboardConnectionUnavailable(): DashboardSourceConnectionResult {
  return { state: 'failed', failureCode: 'response-unavailable' }
}

export async function safeProviderPage(action: () => unknown): Promise<MacroCalendarProviderPageResult> {
  try {
    const value = await action()
    if (isExact(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === 'provider-settings-unavailable') return providerUnavailable()
    if (!isExact(value, ['state', 'providers']) || value.state !== 'available' || !Array.isArray(value.providers) || value.providers.length !== macroCalendarProviderSettingsPolicy.providerIds.length) return providerUnavailable()
    const providers = value.providers.map(safeProvider)
    const safeProviders = providers.filter((provider): provider is MacroCalendarProviderPageState => provider !== undefined)
    return safeProviders.length === providers.length && safeProviders.every((provider, index) => provider.providerId === macroCalendarProviderSettingsPolicy.providerIds[index])
      ? { state: 'available', providers: safeProviders }
      : providerUnavailable()
  } catch {
    return providerUnavailable()
  }
}

export async function safeProviderSchedule(action: () => unknown, providerId: string): Promise<MacroCalendarProviderScheduleResult> {
  try {
    const value = await action()
    if (!isExact(value, ['state', 'providerId', 'schedule']) || value.state !== 'available' || value.providerId !== providerId || !isProviderId(providerId) || !isRecord(value.schedule)) return providerUnavailable()
    const schedule = value.schedule
    if (!isExact(schedule, ['mode', 'intervalSeconds', 'anchor', 'startupCatchUp', 'runNowAvailable']) || schedule.mode !== 'interval' || !isNonNegativeSafeInteger(schedule.intervalSeconds) || schedule.intervalSeconds <= 0 || schedule.anchor !== 'last-complete' || schedule.startupCatchUp !== true || schedule.runNowAvailable !== true) return providerUnavailable()
    return {
      state: 'available',
      providerId,
      schedule: {
        mode: 'interval',
        intervalSeconds: schedule.intervalSeconds,
        anchor: 'last-complete',
        startupCatchUp: true,
        runNowAvailable: true
      }
    }
  } catch {
    return providerUnavailable()
  }
}

export function safeProvider(value: unknown): MacroCalendarProviderPageState | undefined {
  if (!isRecord(value) || !hasOnly(value, ['providerId', 'enabled', 'scheduleHealth', 'lastCompletedAt', 'consecutiveFailures']) ||
    !hasRequired(value, ['providerId', 'enabled', 'scheduleHealth', 'consecutiveFailures']) || !isProviderId(value.providerId) || typeof value.enabled !== 'boolean' ||
    !macroCalendarProviderSettingsPolicy.scheduleHealthStates.includes(value.scheduleHealth as never) ||
    !isNonNegativeSafeInteger(value.consecutiveFailures) || !isCanonicalOptional(value.lastCompletedAt)) return undefined
  return {
    providerId: value.providerId, enabled: value.enabled, scheduleHealth: value.scheduleHealth as MacroCalendarProviderPageState['scheduleHealth'],
    ...(value.lastCompletedAt ? { lastCompletedAt: value.lastCompletedAt as string } : {}), consecutiveFailures: value.consecutiveFailures
  }
}

export async function safeProviderAction(action: () => unknown, expectedProviderId?: string): Promise<MacroCalendarProviderActionResult> {
  try {
    const value = await action()
    if (isExact(value, ['state', 'provider']) && value.state === 'saved') {
      const provider = safeProvider(value.provider)
      return provider && (!expectedProviderId || provider.providerId === expectedProviderId) ? { state: 'saved', provider } : providerUnavailableAction()
    }
    if (isExact(value, ['state', 'providerId']) && value.state === 'queued' && isProviderId(value.providerId) && (!expectedProviderId || value.providerId === expectedProviderId)) {
      return { state: 'queued', providerId: value.providerId }
    }
    if (isExact(value, ['state', 'providerId', 'outcome']) && value.state === 'completed' && isProviderId(value.providerId) && (value.outcome === 'succeeded' || value.outcome === 'failed') && (!expectedProviderId || value.providerId === expectedProviderId)) {
      return { state: 'completed', providerId: value.providerId, outcome: value.outcome }
    }
    if (isExact(value, ['state', 'failureCode']) && value.state === 'skipped' && (value.failureCode === 'provider-disabled' || value.failureCode === 'provider-unavailable')) {
      return { state: 'skipped', failureCode: value.failureCode }
    }
    return providerUnavailableAction()
  } catch {
    return providerUnavailableAction()
  }
}

export async function safeDashboardConnection(action: () => unknown): Promise<DashboardSourceConnectionResult> {
  try {
    const value = await action()
    if (isExact(value, ['state']) && value.state === 'succeeded') return { state: 'succeeded' }
    if (isExact(value, ['state', 'failureCode']) && value.state === 'failed' && isDashboardConnectionFailure(value.failureCode)) return { state: 'failed', failureCode: value.failureCode }
  } catch {}
  return dashboardConnectionUnavailable()
}

function isDashboardConnectionFailure(value: unknown): value is Extract<DashboardSourceConnectionResult, { state: 'failed' }>['failureCode'] {
  return value === 'credential-not-configured' || value === 'transport-unavailable' || value === 'request-timeout' || value === 'response-unavailable'
}

export async function safeBlsEmploymentRefresh(
  service: BlsEmploymentMvpRefreshService | undefined,
  payload: unknown
): Promise<RefreshBlsEmploymentReleaseResult> {
  if (!service || !isRefreshInput(payload)) return refreshUnavailable()
  try {
    const value = await service.refresh(payload)
    return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === 1 && (value.state === 'updated' || value.state === 'unchanged' || value.state === 'unavailable')
      ? Object.freeze({ state: value.state }) : refreshUnavailable()
  } catch { return refreshUnavailable() }
}
export function isRefreshInput(value: unknown): value is { eventKey: string; confirmed: true } {
  if (!isExact(value, ['eventKey', 'confirmed'])) return false
  return typeof value.eventKey === 'string' && value.eventKey.trim().length > 0 && value.eventKey.length <= 160 && value.confirmed === true
}
function refreshUnavailable(): RefreshBlsEmploymentReleaseResult { return Object.freeze({ state: 'unavailable' }) }

export async function safeFedFomcRefresh(
  service: FedFomcManualRefreshService | undefined,
  payload: unknown
): Promise<RefreshFedFomcDecisionResult> {
  if (!service || !isFedFomcRefreshInput(payload)) return fedFomcRefreshUnavailable()
  try {
    const value = await service.refresh(payload)
    return value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === 1 && (value.state === 'updated' || value.state === 'unchanged' || value.state === 'unavailable')
      ? Object.freeze({ state: value.state }) : fedFomcRefreshUnavailable()
  } catch { return fedFomcRefreshUnavailable() }
}
function isFedFomcRefreshInput(value: unknown): value is { eventKey: string; confirmed: true } {
  return isRefreshInput(value) && /^US\.FOMC\.\d{4}-\d{2}-\d{2}$/.test(value.eventKey)
}
function fedFomcRefreshUnavailable(): RefreshFedFomcDecisionResult { return Object.freeze({ state: 'unavailable' }) }

export async function safeBlsEmploymentSchedule(service: BlsScheduleAndValuesSyncWorkflow | undefined, payload: unknown): Promise<SyncBlsScheduleAndValuesResult> {
  if (!service || !isScheduleSyncInput(payload)) return Object.freeze({ state: 'unavailable' })
  try {
    const value = await service.sync(payload)
    return sanitizeScheduleAndValues(value)
  } catch { return Object.freeze({ state: 'unavailable' }) }
}
function sanitizeScheduleAndValues(value: unknown): SyncBlsScheduleAndValuesResult {
  if (!isExact(value, ['state', 'schedule', 'values']) || value.state !== 'completed' || !isExact(value.values, ['cpi', 'employment'])) return Object.freeze({ state: 'unavailable' })
  const valid = (state: unknown): state is 'updated' | 'current' | 'not-required' | 'unavailable' => state === 'updated' || state === 'current' || state === 'not-required' || state === 'unavailable'
  return (value.schedule === 'updated' || value.schedule === 'unchanged') && valid(value.values.cpi) && valid(value.values.employment)
    ? Object.freeze({ state: 'completed', schedule: value.schedule, values: Object.freeze({ cpi: value.values.cpi, employment: value.values.employment }) })
    : Object.freeze({ state: 'unavailable' })
}
function isScheduleSyncInput(value: unknown): value is { year: `${number}` } { return isExact(value, ['year']) && typeof value.year === 'string' && /^\d{4}$/.test(value.year) }

export function safeManualPreview(action: () => unknown): ManualBlsIcsPreview {
  try {
    return sanitizeManualPreview(action())
  } catch {
    return { state: 'failed', failureCode: 'persistence-failed' }
  }
}
export function safeManualImport(action: () => unknown): ManualBlsIcsImportResult {
  try {
    return sanitizeManualImport(action())
  } catch {
    return { state: 'failed', failureCode: 'persistence-failed' }
  }
}

type SafeManualResult = ManualBlsIcsPreview | ManualBlsIcsImportResult
type ManualResultRecord = Record<string, unknown>

function sanitizeManualPreview(value: unknown): ManualBlsIcsPreview {
  const result = sanitizeManualResult(value)
  return result.state === 'ready' || result.state === 'failed' ? result : persistenceFailed()
}
function sanitizeManualImport(value: unknown): ManualBlsIcsImportResult {
  const result = sanitizeManualResult(value)
  return result.state === 'imported' || result.state === 'unchanged' || result.state === 'failed' ? result : persistenceFailed()
}
function sanitizeManualResult(value: unknown): SafeManualResult {
  if (!isRecord(value)) return persistenceFailed()
  if (value.state === 'failed') return hasExactFields(value, ['state', 'failureCode']) && isFailureCode(value.failureCode)
    ? { state: 'failed', failureCode: value.failureCode }
    : persistenceFailed()
  if (value.state === 'unchanged' && hasExactFields(value, ['state', 'totalEvents', 'supportedReleaseGroups', 'generatedEvents', 'unsupportedEvents', 'unchangedCount'])) {
    const commonCounts = readSafeCounts(value, ['totalEvents', 'supportedReleaseGroups', 'generatedEvents', 'unsupportedEvents', 'unchangedCount'])
    if (!commonCounts) return persistenceFailed()
    const [totalEvents, supportedReleaseGroups, generatedEvents, unsupportedEvents, unchangedCount] = commonCounts
    return { state: 'unchanged', totalEvents, supportedReleaseGroups, generatedEvents, unsupportedEvents, unchangedCount }
  }
  if (value.state !== 'ready' && value.state !== 'imported') return persistenceFailed()
  if (!hasExactFields(value, ['state', 'totalEvents', 'supportedReleaseGroups', 'generatedEvents', 'unsupportedEvents', 'insertedCount', 'rescheduledCount', 'unchangedCount'])) {
    return persistenceFailed()
  }
  const commonCounts = readSafeCounts(value, ['totalEvents', 'supportedReleaseGroups', 'generatedEvents', 'unsupportedEvents', 'unchangedCount'])
  if (!commonCounts) return persistenceFailed()
  const [totalEvents, supportedReleaseGroups, generatedEvents, unsupportedEvents, unchangedCount] = commonCounts
  const changeCounts = readSafeCounts(value, ['insertedCount', 'rescheduledCount'])
  if (changeCounts) {
    const [insertedCount, rescheduledCount] = changeCounts
    return {
      state: value.state, totalEvents, supportedReleaseGroups, generatedEvents, unsupportedEvents, insertedCount,
      rescheduledCount, unchangedCount
    }
  }
  return persistenceFailed()
}
function readSafeCounts(value: ManualResultRecord, names: readonly string[]): number[] | undefined {
  const counts = names.map((name) => value[name])
  return counts.every((count) => Number.isSafeInteger(count) && (count as number) >= 0)
    ? counts as number[]
    : undefined
}
function hasExactFields(value: ManualResultRecord, names: readonly string[]): boolean {
  const fields = Object.getOwnPropertyNames(value)
  return fields.length === names.length && names.every((name) => fields.includes(name)) && Object.getOwnPropertySymbols(value).length === 0
}
function isFailureCode(value: unknown): value is Extract<SafeManualResult, { state: 'failed' }>['failureCode'] {
  return value === 'invalid-file' || value === 'unsupported-calendar' || value === 'no-supported-events' || value === 'persistence-failed'
}
function persistenceFailed(): Extract<SafeManualResult, { state: 'failed' }> {
  return { state: 'failed', failureCode: 'persistence-failed' }
}

/** The reader's edit: an instant and the date they picked, both canonical, both required. */
export function isReleaseTimeInput(value: unknown): value is SetMacroEconomicCalendarReleaseTimeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const fields = Object.getOwnPropertyNames(record)
  return fields.length === 3 && ['eventKey', 'scheduledAt', 'scheduledDate'].every((field) => fields.includes(field)) &&
    Object.getOwnPropertySymbols(record).length === 0 &&
    typeof record.eventKey === 'string' && typeof record.scheduledAt === 'string' && typeof record.scheduledDate === 'string'
}
export function isClearReleaseTimeInput(value: unknown): value is ClearMacroEconomicCalendarReleaseTimeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.getOwnPropertyNames(record).length === 1 && Object.hasOwn(record, 'eventKey') &&
    Object.getOwnPropertySymbols(record).length === 0 && typeof record.eventKey === 'string'
}
