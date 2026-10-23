import {
  macroCalendarProviderSettingsPolicy,
  type MacroCalendarProviderActionResult,
  type MacroCalendarProviderPageResult,
  type MacroCalendarProviderPageState,
  type MacroCalendarProviderScheduleResult,
  type MacroCalendarSettingsProviderId,
  type SaveMacroCalendarProviderInput
} from '../../../contracts/macro/economicCalendarQueryContracts'
import type { MacroCalendarProviderHealthStore } from './macroCalendarProviderHealthStore'
import type { MacroCalendarProviderProfileStore } from './macroCalendarProviderProfileStore'
import type { MacroCalendarScheduleJobRuntime } from './macroCalendarScheduleJobRuntime'
import { macroCalendarScheduleJobPolicy } from './macroCalendarScheduleJobRuntime'

export const macroCalendarProviderSettingsServicePolicy = {
  providerOrder: macroCalendarProviderSettingsPolicy.providerIds,
  invalidFailureCode: 'provider-settings-unavailable'
} as const

export const macroCalendarProviderSchedulePolicy = {
  secondsPerMillisecond: 1_000,
  anchor: 'last-complete' as const,
  startupCatchUp: true as const,
  runNowAvailable: true as const
} as const

export type MacroCalendarProviderSettingsService = {
  getPageState: () => Promise<MacroCalendarProviderPageResult>
  saveProfile: (input: SaveMacroCalendarProviderInput) => Promise<MacroCalendarProviderActionResult>
  runProviderNow: (providerId: unknown) => Promise<MacroCalendarProviderActionResult>
  getProviderHealth: (providerId: unknown) => Promise<MacroCalendarProviderPageResult>
  getProviderSchedule: (providerId: unknown) => Promise<MacroCalendarProviderScheduleResult>
}

export function createMacroCalendarProviderSettingsService(deps: {
  profiles: Pick<MacroCalendarProviderProfileStore, 'list' | 'save'>
  health: Pick<MacroCalendarProviderHealthStore, 'getCurrent'>
  jobs: Pick<MacroCalendarScheduleJobRuntime, 'initialize' | 'runProviderNow'>
}): MacroCalendarProviderSettingsService {
  async function providerState(providerId: MacroCalendarSettingsProviderId, profiles: unknown): Promise<MacroCalendarProviderPageState | undefined> {
    const profile = Array.isArray(profiles) ? profiles.find((item) => isRecord(item) && item.providerId === providerId) : undefined
    if (profile !== undefined && (!isRecord(profile) || typeof profile.enabled !== 'boolean')) return undefined
    const health = deps.health.getCurrent(providerId)
    const healthState = safeHealth(health, providerId)
    if (!healthState) return undefined
    return {
      providerId,
      enabled: profile?.enabled === true,
      scheduleHealth: healthState.scheduleHealth,
      ...(healthState.lastCompletedAt ? { lastCompletedAt: healthState.lastCompletedAt } : {}),
      consecutiveFailures: healthState.consecutiveFailures,
    }
  }

  async function pageState(): Promise<MacroCalendarProviderPageResult> {
    try {
      const profiles = await deps.profiles.list()
      if (!Array.isArray(profiles)) return unavailable()
      const providers = await Promise.all(macroCalendarProviderSettingsServicePolicy.providerOrder.map((providerId) => providerState(providerId, profiles)))
      return providers.every(Boolean)
        ? { state: 'available', providers: providers as MacroCalendarProviderPageState[] }
        : unavailable()
    } catch {
      return unavailable()
    }
  }

  return {
    getPageState: pageState,
    async getProviderHealth(providerId) {
      if (!isProviderId(providerId)) return unavailable()
      return pageState()
    },
    async getProviderSchedule(providerId) {
      if (!isProviderId(providerId)) return unavailable()
      return {
        state: 'available',
        providerId,
        schedule: {
          mode: 'interval',
          intervalSeconds: macroCalendarScheduleJobPolicy.scheduleIntervalMs / macroCalendarProviderSchedulePolicy.secondsPerMillisecond,
          anchor: macroCalendarProviderSchedulePolicy.anchor,
          startupCatchUp: macroCalendarProviderSchedulePolicy.startupCatchUp,
          runNowAvailable: macroCalendarProviderSchedulePolicy.runNowAvailable
        }
      }
    },
    async saveProfile(input) {
      if (!isSaveInput(input)) return failed()
      try {
        const saved = await deps.profiles.save(input)
        if (!isRecord(saved) || saved.providerId !== input.providerId || saved.enabled !== input.enabled) return failed()
        await deps.jobs.initialize()
        const page = await pageState()
        const provider = page.state === 'available' ? page.providers.find((item) => item.providerId === input.providerId) : undefined
        return provider ? { state: 'saved', provider } : failed()
      } catch {
        return failed()
      }
    },
    async runProviderNow(providerId) {
      if (!isProviderId(providerId)) return { state: 'skipped', failureCode: 'provider-unavailable' }
      try {
        const profiles = await deps.profiles.list()
        if (!Array.isArray(profiles)) return failed()
        const profile = profiles.find((item) => isRecord(item) && item.providerId === providerId)
        if (!profile || profile.enabled !== true) return { state: 'skipped', failureCode: 'provider-disabled' }
        const outcome = await deps.jobs.runProviderNow(providerId)
        if (isExact(outcome, ['state']) && outcome.state === 'queued') return { state: 'queued', providerId }
        if (isExact(outcome, ['state', 'outcome']) && outcome.state === 'completed' && (outcome.outcome === 'succeeded' || outcome.outcome === 'failed')) {
          const latest = await deps.profiles.list()
          const current = Array.isArray(latest) ? latest.filter((item) => isRecord(item) && item.providerId === providerId && item.enabled === true) : []
          return current.length === 1 ? { state: 'completed', providerId, outcome: outcome.outcome } : failed()
        }
        if (isExact(outcome, ['state', 'failureCode']) && outcome.state === 'failed' && outcome.failureCode === 'schedule-provider-unavailable') return failed()
        if (isExact(outcome, ['state', 'failureCode']) && outcome.state === 'skipped' && outcome.failureCode === 'schedule-provider-unavailable') {
          return { state: 'skipped', failureCode: 'provider-unavailable' }
        }
        return failed()
      } catch {
        return failed()
      }
    }
  }
}

function safeHealth(value: unknown, providerId: MacroCalendarSettingsProviderId): Pick<MacroCalendarProviderPageState, 'scheduleHealth' | 'lastCompletedAt' | 'consecutiveFailures'> | undefined {
  if (value === undefined) return { scheduleHealth: 'never-run', consecutiveFailures: 0 }
  if (!hasOnly(value, ['providerId', 'status', 'updatedAt', 'lastSuccessAt', 'lastFailureAt', 'consecutiveFailures', 'checkpoint', 'safeSummary']) ||
    value.providerId !== providerId || !isCanonicalOptional(value.updatedAt) || !isFailureCount(value.consecutiveFailures) || !isCanonicalOptional(value.lastSuccessAt) || !isCanonicalOptional(value.lastFailureAt)) return undefined
  const scheduleHealth = value.status === 'healthy' ? 'healthy' : value.status === 'failed' ? 'failed' : value.status === 'degraded' || value.status === 'paused' ? 'degraded' : undefined
  if (!scheduleHealth) return undefined
  const lastCompletedAt = value.lastSuccessAt ?? value.lastFailureAt
  return { scheduleHealth, consecutiveFailures: value.consecutiveFailures, ...(lastCompletedAt ? { lastCompletedAt } : {}) }
}

function isSaveInput(value: unknown): value is SaveMacroCalendarProviderInput {
  return isExact(value, ['providerId', 'enabled']) && isProviderId(value.providerId) && typeof value.enabled === 'boolean'
}
function isProviderId(value: unknown): value is MacroCalendarSettingsProviderId { return typeof value === 'string' && macroCalendarProviderSettingsServicePolicy.providerOrder.includes(value as MacroCalendarSettingsProviderId) }
function isFailureCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function isCanonicalOptional(value: unknown): value is string | undefined { return value === undefined || (typeof value === 'string' && macroCalendarProviderSettingsPolicy.canonicalUtcMillisPattern.test(value) && new Date(value).toISOString() === value) }
function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
  } catch {
    return false
  }
}
function isExact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!isRecord(value)) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => Object.hasOwn(value, field)) && Object.getOwnPropertySymbols(value).length === 0 && names.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return Boolean(descriptor && 'value' in descriptor)
    })
  } catch {
    return false
  }
}
function hasOnly(value: unknown, fields: readonly string[]): value is Record<string, unknown> { return isRecord(value) && Object.getOwnPropertyNames(value).every((field) => fields.includes(field)) && Object.getOwnPropertySymbols(value).length === 0 }
function unavailable(): Extract<MacroCalendarProviderPageResult, { state: 'unavailable' }> { return { state: 'unavailable', failureCode: macroCalendarProviderSettingsServicePolicy.invalidFailureCode } }
function failed(): Extract<MacroCalendarProviderActionResult, { state: 'failed' }> { return { state: 'failed', failureCode: macroCalendarProviderSettingsServicePolicy.invalidFailureCode } }
