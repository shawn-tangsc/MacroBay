import {
  MACRO_ECONOMIC_CALENDAR_IPC_METHODS,
  macroCalendarProviderSettingsPolicy,
  type MacroCalendarProviderActionResult,
  type MacroCalendarProviderPageResult,
  type MacroCalendarProviderPageState,
  type MacroCalendarSettingsProviderId,
  type SaveMacroCalendarProviderInput,
  type DashboardSourceConnectionResult,
  type MacroCalendarProviderScheduleResult
} from '../../../contracts/macro/economicCalendarQueryContracts'

const productId = 'market-intelligence'

export const macroCalendarProviderClientPolicy = {
  providerIds: macroCalendarProviderSettingsPolicy.providerIds,
  unavailableFailureCode: 'provider-settings-unavailable',
  skippedFailureCodes: ['provider-disabled', 'provider-unavailable']
} as const

export type MacroCalendarProviderClient = {
  getPageState: () => Promise<MacroCalendarProviderPageResult>
  saveProfile: (input: SaveMacroCalendarProviderInput) => Promise<MacroCalendarProviderActionResult>
  runProviderNow: (providerId: MacroCalendarSettingsProviderId) => Promise<MacroCalendarProviderActionResult>
  getProviderHealth: (providerId: MacroCalendarSettingsProviderId) => Promise<MacroCalendarProviderPageResult>
  testProviderConnection: (providerId: MacroCalendarSettingsProviderId) => Promise<DashboardSourceConnectionResult>
  getProviderSchedule: (providerId: MacroCalendarSettingsProviderId) => Promise<MacroCalendarProviderScheduleResult>
}

type DashboardConnectionFailureCode = Extract<DashboardSourceConnectionResult, { state: 'failed' }>['failureCode']

export const macroCalendarProviderClient: MacroCalendarProviderClient = {
  async getPageState() { return safePage(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderPageState, {})) },
  async saveProfile(input) {
    if (!isSaveInput(input)) return failed()
    return safeAction(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.saveProviderProfile, input), input.providerId)
  },
  async runProviderNow(providerId) {
    if (!isProviderId(providerId)) return { state: 'skipped', failureCode: 'provider-unavailable' }
    return safeAction(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.runProviderNow, { providerId }), providerId)
  },
  async getProviderHealth(providerId) {
    if (!isProviderId(providerId)) return unavailable()
    return safePage(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderHealth, { providerId }))
  }
  , async testProviderConnection(providerId) {
    if (!isProviderId(providerId)) return connectionUnavailable()
    return safeConnection(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.testProviderConnection, { providerId }), providerId)
  }
  , async getProviderSchedule(providerId) {
    if (!isProviderId(providerId)) return scheduleUnavailable()
    return safeSchedule(await invoke(MACRO_ECONOMIC_CALENDAR_IPC_METHODS.getProviderSchedule, { providerId }), providerId)
  }
}

async function invoke(method: string, payload: unknown): Promise<unknown> {
  try {
    if (!window.platform?.products?.invoke) return undefined
    return await window.platform.products.invoke(productId, method, payload)
  } catch {
    return undefined
  }
}

function safePage(value: unknown): MacroCalendarProviderPageResult {
  try {
    if (isExact(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === macroCalendarProviderClientPolicy.unavailableFailureCode) return unavailable()
    if (!isExact(value, ['state', 'providers']) || value.state !== 'available' || !Array.isArray(value.providers) || value.providers.length !== macroCalendarProviderClientPolicy.providerIds.length) return unavailable()
    const providers = value.providers.map(safeProvider)
    const safeProviders = providers.filter((provider): provider is MacroCalendarProviderPageState => provider !== undefined)
    return safeProviders.length === providers.length && safeProviders.every((provider, index) => provider.providerId === macroCalendarProviderClientPolicy.providerIds[index])
      ? { state: 'available', providers: safeProviders }
      : unavailable()
  } catch {
    return unavailable()
  }
}

function safeAction(value: unknown, providerId: MacroCalendarSettingsProviderId): MacroCalendarProviderActionResult {
  try {
    if (isExact(value, ['state', 'provider']) && value.state === 'saved') {
      const provider = safeProvider(value.provider)
      return provider?.providerId === providerId ? { state: 'saved', provider } : failed()
    }
    if (isExact(value, ['state', 'providerId']) && value.state === 'queued' && value.providerId === providerId) return { state: 'queued', providerId }
    if (isExact(value, ['state', 'providerId', 'outcome']) && value.state === 'completed' && value.providerId === providerId && (value.outcome === 'succeeded' || value.outcome === 'failed')) return { state: 'completed', providerId, outcome: value.outcome }
    if (isExact(value, ['state', 'failureCode']) && value.state === 'skipped' && typeof value.failureCode === 'string' && macroCalendarProviderClientPolicy.skippedFailureCodes.includes(value.failureCode as never)) {
      return { state: 'skipped', failureCode: value.failureCode as Extract<MacroCalendarProviderActionResult, { state: 'skipped' }>['failureCode'] }
    }
    return failed()
  } catch {
    return failed()
  }
}

function safeProvider(value: unknown): MacroCalendarProviderPageState | undefined {
  if (!isRecord(value) || !hasOnly(value, ['providerId', 'enabled', 'scheduleHealth', 'lastCompletedAt', 'consecutiveFailures']) ||
    !hasRequired(value, ['providerId', 'enabled', 'scheduleHealth', 'consecutiveFailures']) || !isProviderId(value.providerId) ||
    typeof value.enabled !== 'boolean' || !macroCalendarProviderSettingsPolicy.scheduleHealthStates.includes(value.scheduleHealth as never) ||
    !isSafeCount(value.consecutiveFailures) || !isCanonicalOptional(value.lastCompletedAt)) return undefined
  return {
    providerId: value.providerId, enabled: value.enabled, scheduleHealth: value.scheduleHealth as MacroCalendarProviderPageState['scheduleHealth'],
    ...(value.lastCompletedAt ? { lastCompletedAt: value.lastCompletedAt as string } : {}),
    consecutiveFailures: value.consecutiveFailures
  }
}

function isSaveInput(value: unknown): value is SaveMacroCalendarProviderInput { return isExact(value, ['providerId', 'enabled']) && isProviderId(value.providerId) && typeof value.enabled === 'boolean' }
function isProviderId(value: unknown): value is MacroCalendarSettingsProviderId { return typeof value === 'string' && macroCalendarProviderClientPolicy.providerIds.includes(value as MacroCalendarSettingsProviderId) }
function isSafeCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function isCanonicalOptional(value: unknown): boolean { return value === undefined || (typeof value === 'string' && macroCalendarProviderSettingsPolicy.canonicalUtcMillisPattern.test(value) && new Date(value).toISOString() === value) }
function isRecord(value: unknown): value is Record<string, unknown> {
  try { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype } catch { return false }
}
function hasOnly(value: Record<string, unknown>, fields: readonly string[]): boolean { return Object.getOwnPropertyNames(value).every((field) => fields.includes(field)) && Object.getOwnPropertySymbols(value).length === 0 }
function hasRequired(value: Record<string, unknown>, fields: readonly string[]): boolean { return fields.every((field) => Object.hasOwn(value, field)) }
function isExact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!isRecord(value)) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && hasRequired(value, fields) && Object.getOwnPropertySymbols(value).length === 0 && names.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return Boolean(descriptor && 'value' in descriptor)
    })
  } catch {
    return false
  }
}
function unavailable(): Extract<MacroCalendarProviderPageResult, { state: 'unavailable' }> { return { state: 'unavailable', failureCode: macroCalendarProviderClientPolicy.unavailableFailureCode } }
function failed(): Extract<MacroCalendarProviderActionResult, { state: 'failed' }> { return { state: 'failed', failureCode: macroCalendarProviderClientPolicy.unavailableFailureCode } }

function safeConnection(value: unknown, providerId: MacroCalendarSettingsProviderId): DashboardSourceConnectionResult {
  try {
    if (isExact(value, ['state']) && value.state === 'succeeded') return Object.freeze({ state: 'succeeded' })
    if (isExact(value, ['state', 'failureCode']) && value.state === 'failed' &&
      (value.failureCode === 'transport-unavailable' || value.failureCode === 'request-timeout' || value.failureCode === 'response-unavailable' ||
        value.failureCode === 'credential-not-configured' && providerId === 'macro-calendar-bea')) {
      return Object.freeze({ state: 'failed', failureCode: value.failureCode as DashboardConnectionFailureCode })
    }
  } catch { /* hostile bridge value */ }
  return connectionUnavailable()
}
function safeSchedule(value: unknown, providerId: MacroCalendarSettingsProviderId): MacroCalendarProviderScheduleResult {
  try {
    if (!isExact(value, ['state', 'providerId', 'schedule']) || value.state !== 'available' || value.providerId !== providerId) return scheduleUnavailable()
    const schedule: unknown = value.schedule
    if (!isExact(schedule, ['mode', 'intervalSeconds', 'anchor', 'startupCatchUp', 'runNowAvailable'])) return scheduleUnavailable()
    const intervalSeconds = typeof schedule.intervalSeconds === 'number' && Number.isSafeInteger(schedule.intervalSeconds) && schedule.intervalSeconds > 0
      ? schedule.intervalSeconds
      : undefined
    if (schedule.mode !== 'interval' ||
      intervalSeconds === undefined || schedule.anchor !== 'last-complete' || schedule.startupCatchUp !== true || schedule.runNowAvailable !== true) return scheduleUnavailable()
    return Object.freeze({ state: 'available', providerId, schedule: Object.freeze({ mode: 'interval' as const, intervalSeconds, anchor: 'last-complete' as const, startupCatchUp: true as const, runNowAvailable: true as const }) })
  } catch { return scheduleUnavailable() }
}
function connectionUnavailable(): DashboardSourceConnectionResult { return Object.freeze({ state: 'failed', failureCode: 'response-unavailable' }) }
function scheduleUnavailable(): Extract<MacroCalendarProviderScheduleResult, { state: 'unavailable' }> { return Object.freeze({ state: 'unavailable', failureCode: macroCalendarProviderClientPolicy.unavailableFailureCode }) }
