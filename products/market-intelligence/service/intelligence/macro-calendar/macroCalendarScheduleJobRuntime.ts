import type { JobRunRecord, JobRuntime } from '@platform/jobs'

import { macroCalendarTransportPolicy } from './macroCalendarPolicy'
import type { MacroCalendarProviderId } from './macroCalendarContracts'
import type { MacroCalendarProviderProfileStore } from './macroCalendarProviderProfileStore'
import type { MacroCalendarScheduleHealthService } from './macroCalendarScheduleHealthService'

type MacroCalendarManualRunResult =
  | { state: 'queued' }
  | { state: 'completed'; outcome: 'succeeded' | 'failed' }
  | { state: 'skipped'; failureCode: 'schedule-provider-unavailable' }
  | { state: 'failed'; failureCode: 'schedule-provider-unavailable' }

const macroCalendarManualCompletionObservationMarginMs = 5_000
const macroCalendarManualCompletionBudgetMs =
  macroCalendarTransportPolicy.requestTimeoutMs * macroCalendarTransportPolicy.maxAttempts +
  macroCalendarManualCompletionObservationMarginMs

export type MacroCalendarScheduleJobRuntime = {
  initialize: () => Promise<void>
  runProviderNow: (providerId: MacroCalendarProviderId) => Promise<MacroCalendarManualRunResult>
  dispose: () => void
}

export const macroCalendarScheduleJobPolicy = {
  handlerId: 'market-intelligence.refreshMacroCalendar',
  intervalDefinitionId: 'market-intelligence.refreshMacroCalendar.schedule',
  eligibleProviders: {
    'macro-calendar-fed': 'macro-calendar-fed-schedule',
    'macro-calendar-bea': 'macro-calendar-bea-schedule'
  },
  scheduleIntervalMs: 6 * 60 * 60 * 1_000,
  jobDefinitionTimeoutMs: 2 * 60 * 1_000,
  manualCompletionObservationMarginMs: macroCalendarManualCompletionObservationMarginMs,
  manualCompletionBudgetMs: macroCalendarManualCompletionBudgetMs,
  manualCompletionPollIntervalMs: 100,
  jobRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 }
} as const

const safeJobFailureMessage = 'Macro calendar schedule run failed.'
const jobRecordFields = [
  'id', 'definitionId', 'handlerId', 'owner', 'productId', 'title', 'status', 'trigger', 'payload',
  'concurrencyKey', 'attempt', 'maxAttempts', 'createdAt', 'startedAt', 'completedAt', 'lastError', 'progress', 'logs'
] as const

export function createMacroCalendarScheduleJobRuntime(deps: {
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueStartup' | 'enqueueDefinition' | 'getRun'>
  profiles: Pick<MacroCalendarProviderProfileStore, 'list'>
  health: Pick<MacroCalendarScheduleHealthService, 'collectAndUpdateHealth'>
}): MacroCalendarScheduleJobRuntime {
  let disposed = false
  deps.jobRuntime.registerHandler(macroCalendarScheduleJobPolicy.handlerId, async (payload, context) => {
    const descriptors = await selectDescriptors(deps.profiles, payload)
    if (!descriptors) throw new Error(safeJobFailureMessage)

    let failed = false
    for (const descriptorId of descriptors) {
      try {
        const result = await deps.health.collectAndUpdateHealth({
          descriptorId, runId: context.jobRunId, detectedAt: new Date().toISOString(), signal: context.signal
        })
        if (!isSuccessfulHealth(result, descriptorId)) failed = true
      } catch {
        failed = true
      }
    }
    if (failed) throw new Error(safeJobFailureMessage)
  })

  return {
    async initialize() {
      if (disposed) return
      let descriptors: readonly string[] | undefined
      try {
        descriptors = await enabledDescriptors(deps.profiles)
      } catch {
        return
      }
      if (!descriptors?.length) {
        deps.jobRuntime.removeSchedule(macroCalendarScheduleJobPolicy.intervalDefinitionId)
        return
      }
      deps.jobRuntime.setSchedule(intervalDefinition())
      try {
        const run = await deps.jobRuntime.enqueueDefinition(startupDefinition())
        if (!validateJobRun(run, { definitionId: macroCalendarScheduleJobPolicy.intervalDefinitionId, triggerKind: 'startup' })) return
      } catch {
        return
      }
    },
    async runProviderNow(providerId) {
      if (disposed || !descriptorFor(providerId)) return skipped()
      try {
        if (!await enabledDescriptorFor(deps.profiles, providerId)) return skipped()
        const run = await deps.jobRuntime.enqueueDefinition(manualDefinition(providerId))
        if (!validateJobRun(run, { definitionId: manualDefinitionId(providerId), triggerKind: 'manual', providerId, status: 'queued' })) return failed()
        return await observeRun(run.id, providerId, deps.jobRuntime.getRun)
      } catch {
        return failed()
      }
    },
    dispose() {
      disposed = true
      deps.jobRuntime.removeSchedule(macroCalendarScheduleJobPolicy.intervalDefinitionId)
    }
  }
}

async function observeRun(
  runId: string,
  providerId: MacroCalendarProviderId,
  getRun: (runId: string) => JobRunRecord | undefined
): Promise<MacroCalendarManualRunResult> {
  const deadline = Date.now() + macroCalendarScheduleJobPolicy.manualCompletionBudgetMs
  while (true) {
    let observed: JobRunRecord | undefined
    try {
      observed = getRun(runId)
    } catch {
      return failed()
    }
    const status = validateJobRun(observed, {
      definitionId: manualDefinitionId(providerId), triggerKind: 'manual', providerId, runId
    })
    if (!status) return failed()
    if (status === 'completed') return { state: 'completed', outcome: 'succeeded' }
    if (status === 'failed' || status === 'cancelled') return { state: 'completed', outcome: 'failed' }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { state: 'queued' }
    await delay(Math.min(macroCalendarScheduleJobPolicy.manualCompletionPollIntervalMs, remaining))
  }
}

function startupDefinition() {
  return definition(macroCalendarScheduleJobPolicy.intervalDefinitionId, { kind: 'startup' }, {})
}

function intervalDefinition() {
  return definition(macroCalendarScheduleJobPolicy.intervalDefinitionId, {
    kind: 'interval', intervalMs: macroCalendarScheduleJobPolicy.scheduleIntervalMs, anchor: 'lastComplete'
  }, {})
}

function manualDefinition(providerId: MacroCalendarProviderId) {
  return definition(manualDefinitionId(providerId), { kind: 'manual' }, { providerId })
}

function manualDefinitionId(providerId: MacroCalendarProviderId): string {
  return `${macroCalendarScheduleJobPolicy.handlerId}.manual.${providerId}`
}

function definition(
  id: string,
  trigger: { kind: 'startup' } | { kind: 'manual' } | { kind: 'interval'; intervalMs: number; anchor: 'lastComplete' },
  payload: object
) {
  return {
    id,
    owner: 'product' as const,
    productId: 'market-intelligence',
    handlerId: macroCalendarScheduleJobPolicy.handlerId,
    title: 'Refresh macro calendar schedules',
    trigger,
    payload,
    concurrencyKey: macroCalendarScheduleJobPolicy.handlerId,
    timeoutMs: macroCalendarScheduleJobPolicy.jobDefinitionTimeoutMs,
    retryPolicy: macroCalendarScheduleJobPolicy.jobRetryPolicy
  }
}

async function enabledDescriptors(profiles: Pick<MacroCalendarProviderProfileStore, 'list'>): Promise<readonly string[] | undefined> {
  const values = await profiles.list()
  if (!Array.isArray(values)) return undefined
  const descriptors: string[] = []
  for (const profile of values) {
    if (!isPlainRecord(profile) || typeof profile.providerId !== 'string' || typeof profile.enabled !== 'boolean') return undefined
    if (!profile.enabled) continue
    const descriptor = descriptorFor(profile.providerId)
    if (!descriptor) return undefined
    descriptors.push(descriptor)
  }
  return descriptors
}

async function enabledDescriptorFor(profiles: Pick<MacroCalendarProviderProfileStore, 'list'>, providerId: unknown): Promise<string | undefined> {
  const descriptorId = descriptorFor(providerId)
  if (!descriptorId) return undefined
  const values = await profiles.list()
  if (!Array.isArray(values)) return undefined
  const matches = values.filter((profile) => isPlainRecord(profile) && profile.providerId === providerId && profile.enabled === true)
  return matches.length === 1 ? descriptorId : undefined
}

async function selectDescriptors(
  profiles: Pick<MacroCalendarProviderProfileStore, 'list'>,
  payload: unknown
): Promise<readonly string[] | undefined> {
  if (isExactPayload(payload, ['providerId'])) return enabledDescriptorFor(profiles, payload.providerId).then((descriptor) => descriptor ? [descriptor] : undefined)
  if (!isExactPayload(payload, [])) return undefined
  return enabledDescriptors(profiles)
}

function isSuccessfulHealth(value: unknown, descriptorId: string): boolean {
  if (!isPlainRecord(value) || !hasExactFields(value, ['providerId', 'descriptorId', 'state', 'healthStatus', 'consecutiveFailures'])) return false
  return value.providerId === providerForDescriptor(descriptorId) && value.descriptorId === descriptorId && value.state === 'updated' && value.healthStatus === 'healthy' && value.consecutiveFailures === 0
}

function providerForDescriptor(descriptorId: string): string | undefined {
  return Object.entries(macroCalendarScheduleJobPolicy.eligibleProviders).find(([, value]) => value === descriptorId)?.[0]
}

function validateJobRun(
  value: unknown,
  expected: { definitionId: string; triggerKind: 'startup' | 'manual'; providerId?: MacroCalendarProviderId; runId?: string; status?: 'queued' }
): JobRunRecord['status'] | undefined {
  try {
    if (!isPlainRecord(value) || !hasKnownFields(value) || !hasRequiredFields(value)) return undefined
    const record = value as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.trim().length === 0 || (expected.runId && record.id !== expected.runId)) return undefined
    if (record.definitionId !== expected.definitionId || record.handlerId !== macroCalendarScheduleJobPolicy.handlerId || record.owner !== 'product' || record.productId !== 'market-intelligence' || record.title !== 'Refresh macro calendar schedules') return undefined
    if (expected.status && record.status !== expected.status) return undefined
    if (!['queued', 'running', 'completed', 'failed', 'cancelled'].includes(record.status as string)) return undefined
    if (!isExactPayload(record.trigger, [{ kind: expected.triggerKind }])) return undefined
    if (expected.triggerKind === 'manual') {
      if (!isExactPayload(record.payload, ['providerId']) || record.payload.providerId !== expected.providerId) return undefined
    } else if (!isExactPayload(record.payload, [])) return undefined
    if (record.concurrencyKey !== macroCalendarScheduleJobPolicy.handlerId || !isSafePositiveInteger(record.attempt) || !isSafePositiveInteger(record.maxAttempts) || record.maxAttempts !== 1 || typeof record.createdAt !== 'string' || !isCanonicalTimestamp(record.createdAt) || !Array.isArray(record.logs)) return undefined
    if (!isOptionalTimestamp(record.startedAt) || !isOptionalTimestamp(record.completedAt) || !isOptionalString(record.lastError) || !isOptionalProgress(record.progress)) return undefined
    if ((record.status === 'running' && !isCanonicalTimestamp(record.startedAt as string)) || (['completed', 'failed', 'cancelled'].includes(record.status as string) && !isCanonicalTimestamp(record.completedAt as string))) return undefined
    return record.status as JobRunRecord['status']
  } catch {
    return undefined
  }
}

function hasKnownFields(value: Record<string, unknown>): boolean {
  try {
    const names = Object.getOwnPropertyNames(value)
    return names.every((name) => jobRecordFields.includes(name as never)) && Object.getOwnPropertySymbols(value).length === 0 && names.every((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      return Boolean(descriptor && 'value' in descriptor)
    })
  } catch {
    return false
  }
}

function hasRequiredFields(value: Record<string, unknown>): boolean {
  try {
    return ['id', 'definitionId', 'handlerId', 'owner', 'productId', 'title', 'status', 'trigger', 'payload', 'concurrencyKey', 'attempt', 'maxAttempts', 'createdAt', 'logs'].every((field) => Object.hasOwn(value, field))
  } catch {
    return false
  }
}

function isExactPayload(value: unknown, expected: readonly string[] | readonly [{ kind: string }]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false
  if (expected.length === 1 && typeof expected[0] !== 'string') return hasExactFields(value, ['kind']) && value.kind === expected[0].kind
  return hasExactFields(value, expected as readonly string[])
}

function hasExactFields(value: Record<string, unknown>, expected: readonly string[]): boolean {
  try {
    const names = Object.getOwnPropertyNames(value)
    return names.length === expected.length && expected.every((name) => Object.hasOwn(value, name)) && Object.getOwnPropertySymbols(value).length === 0 && names.every((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      return Boolean(descriptor && 'value' in descriptor)
    })
  } catch {
    return false
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
  } catch {
    return false
  }
}

function isSafePositiveInteger(value: unknown): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 }
function isOptionalString(value: unknown): boolean { return value === undefined || typeof value === 'string' }
function isOptionalTimestamp(value: unknown): boolean { return value === undefined || (typeof value === 'string' && isCanonicalTimestamp(value)) }
function isOptionalProgress(value: unknown): boolean {
  try {
    return value === undefined || (isPlainRecord(value) && Object.getOwnPropertyNames(value).every((name) => name === 'current' || name === 'total' || name === 'message'))
  } catch {
    return false
  }
}
function isCanonicalTimestamp(value: string): boolean { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value }
function descriptorFor(providerId: unknown): 'macro-calendar-fed-schedule' | 'macro-calendar-bea-schedule' | undefined {
  return providerId === 'macro-calendar-fed' || providerId === 'macro-calendar-bea' ? macroCalendarScheduleJobPolicy.eligibleProviders[providerId] : undefined
}
function skipped(): Extract<MacroCalendarManualRunResult, { state: 'skipped' }> { return { state: 'skipped', failureCode: 'schedule-provider-unavailable' } }
function failed(): Extract<MacroCalendarManualRunResult, { state: 'failed' }> { return { state: 'failed', failureCode: 'schedule-provider-unavailable' } }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)) }
