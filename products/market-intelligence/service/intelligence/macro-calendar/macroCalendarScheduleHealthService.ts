import type { MacroCalendarCollectionInput } from './macroCalendarCollectionService'
import { macroCalendarScheduleCollectionWorkflowPolicy, type MacroCalendarScheduleCollectionWorkflow } from './macroCalendarScheduleCollectionWorkflow'
import type { MacroCalendarProviderHealthRevision, MacroCalendarProviderId } from './macroCalendarContracts'
import type { MacroCalendarProviderHealthStore } from './macroCalendarProviderHealthStore'
import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'

export type MacroCalendarScheduleHealthService = {
  collectAndUpdateHealth: (input: MacroCalendarCollectionInput) => Promise<MacroCalendarScheduleHealthResult>
}

export type MacroCalendarScheduleHealthResult =
  | { descriptorId: string; state: 'skipped'; failureCode: 'descriptor-not-found' }
  | { providerId: string; descriptorId: string; state: 'skipped'; failureCode: 'schedule-descriptor-unavailable' }
  | { descriptorId: string; state: 'failed'; failureCode: 'collection-input-invalid' }
  | { providerId: string; descriptorId: string; state: 'failed'; failureCode: 'workflow-result-invalid' | 'workflow-execution-failed' | 'health-persist-failed' }
  | { providerId: string; descriptorId: string; state: 'updated'; healthStatus: 'healthy' | 'degraded' | 'failed' | 'paused'; consecutiveFailures: number }

export const macroCalendarScheduleHealthPolicy = {
  eligibleDescriptorIds: ['macro-calendar-fed-schedule', 'macro-calendar-bea-schedule'],
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  persistenceFailureCodes: ['evidence-not-found', 'evidence-invalid', 'parser-unavailable', 'payload-invalid', 'parser-output-empty', 'schedule-input-invalid', 'repository-write-failed']
} as const

export function createMacroCalendarScheduleHealthService(deps: {
  workflow: Pick<MacroCalendarScheduleCollectionWorkflow, 'collectAndPersistSchedule'>
  health: Pick<MacroCalendarProviderHealthStore, 'getCurrent' | 'appendMaterialChange'>
}): MacroCalendarScheduleHealthService {
  return {
    async collectAndUpdateHealth(input) {
      if (!isValidInput(input)) return { descriptorId: safeDescriptorId(input), state: 'failed', failureCode: 'collection-input-invalid' }
      const descriptor = getMacroCalendarOfficialSourceDescriptor(input.descriptorId)
      if (!descriptor) return { descriptorId: input.descriptorId, state: 'skipped', failureCode: 'descriptor-not-found' }
      const identity = { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId }
      if (!(macroCalendarScheduleHealthPolicy.eligibleDescriptorIds as readonly string[]).includes(descriptor.descriptorId)) {
        return { ...identity, state: 'skipped', failureCode: 'schedule-descriptor-unavailable' }
      }

      let outcome: unknown
      try {
        outcome = await deps.workflow.collectAndPersistSchedule(input)
      } catch {
        return { ...identity, state: 'failed', failureCode: 'workflow-execution-failed' }
      }
      let next
      try {
        next = healthRevision(outcome, identity, descriptor.parserId, input.detectedAt, deps.health.getCurrent)
      } catch {
        return { ...identity, state: 'failed', failureCode: 'health-persist-failed' }
      }
      if (!next) return { ...identity, state: 'failed', failureCode: 'workflow-result-invalid' }
      try {
        deps.health.appendMaterialChange(next.revision)
      } catch {
        return { ...identity, state: 'failed', failureCode: 'health-persist-failed' }
      }
      return { ...identity, state: 'updated', healthStatus: next.revision.status, consecutiveFailures: next.revision.consecutiveFailures }
    }
  }
}

function healthRevision(
  outcome: unknown,
  identity: { providerId: MacroCalendarProviderId; descriptorId: string },
  parserVersion: string,
  detectedAt: string,
  getCurrent: MacroCalendarProviderHealthStore['getCurrent']
): { revision: MacroCalendarProviderHealthRevision } | undefined {
  if (!isObject(outcome) || outcome.providerId !== identity.providerId || outcome.descriptorId !== identity.descriptorId) return undefined
  const base = { providerId: identity.providerId, updatedAt: detectedAt, checkpoint: { parserVersion } }
  if (isPersisted(outcome)) return { revision: { ...base, status: 'healthy' as const, lastSuccessAt: detectedAt, consecutiveFailures: 0 } }
  const priorFailures = safeFailureCount(getCurrent(identity.providerId)?.consecutiveFailures)
  if (isProviderDisabled(outcome)) return { revision: { ...base, status: 'paused' as const, consecutiveFailures: priorFailures } }
  if (isFailed(outcome)) return { revision: { ...base, status: 'failed' as const, lastFailureAt: detectedAt, consecutiveFailures: priorFailures + 1 } }
  return undefined
}

function isPersisted(value: Record<string, unknown>): boolean {
  return value.state === 'persisted' && isHttpSuccess(value.status) && isNonNegativeSafeInteger(value.acceptedBytes) &&
    isNonNegativeSafeInteger(value.insertedCount) && isNonNegativeSafeInteger(value.dedupedCount)
}

function isProviderDisabled(value: Record<string, unknown>): boolean {
  return value.state === 'skipped' && value.failureCode === 'provider-disabled' && value.status === undefined
}

function isFailed(value: Record<string, unknown>): boolean {
  if (value.state !== 'failed' || typeof value.failureCode !== 'string') return false
  if (value.failureCode === 'collection-result-invalid') return value.status === undefined && value.insertedCount === undefined
  if (macroCalendarScheduleHealthPolicy.persistenceFailureCodes.includes(value.failureCode as never)) {
    return value.status === undefined && (value.insertedCount === undefined || isNonNegativeSafeInteger(value.insertedCount))
  }
  if (!macroCalendarScheduleCollectionWorkflowPolicy.failedFailureCodes.includes(value.failureCode as never)) return false
  return isValidFailureStatus(value.failureCode, value.status)
}

function isValidFailureStatus(failureCode: string, status: unknown): boolean {
  if (status === undefined) return true
  const ranges = macroCalendarScheduleCollectionWorkflowPolicy.httpStatusRangesByFailureCode[
    failureCode as keyof typeof macroCalendarScheduleCollectionWorkflowPolicy.httpStatusRangesByFailureCode
  ]
  if (!ranges || typeof status !== 'number' || !Number.isInteger(status)) return false
  return ranges.some((range) => status >= range.minimum && status <= range.maximum)
}

function isValidInput(input: MacroCalendarCollectionInput): boolean {
  return Boolean(input && typeof input === 'object') && typeof input.descriptorId === 'string' &&
    typeof input.runId === 'string' && input.runId.trim().length > 0 && isCanonicalUtcMillis(input.detectedAt)
}

function isCanonicalUtcMillis(value: string): boolean {
  if (typeof value !== 'string' || !macroCalendarScheduleHealthPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isHttpSuccess(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 299
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function safeFailureCount(value: unknown): number {
  return isNonNegativeSafeInteger(value) && value < Number.MAX_SAFE_INTEGER ? value : 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeDescriptorId(input: MacroCalendarCollectionInput): string {
  return typeof input?.descriptorId === 'string' ? input.descriptorId : 'unknown-descriptor'
}
