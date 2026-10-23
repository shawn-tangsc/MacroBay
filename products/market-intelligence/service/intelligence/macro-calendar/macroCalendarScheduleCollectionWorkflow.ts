import type { MacroCalendarCollectionInput, MacroCalendarCollectionResult, MacroCalendarCollectionService } from './macroCalendarCollectionService'
import type { MacroCalendarSchedulePersistenceService } from './macroCalendarSchedulePersistenceService'
import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'

export type MacroCalendarScheduleCollectionWorkflow = {
  collectAndPersistSchedule: (input: MacroCalendarCollectionInput) => Promise<MacroCalendarScheduleCollectionWorkflowResult>
}

export type MacroCalendarScheduleCollectionWorkflowResult =
  | { descriptorId: string; state: 'skipped'; failureCode: 'descriptor-not-found' }
  | { providerId: string; descriptorId: string; state: 'skipped'; failureCode: 'schedule-descriptor-unavailable' | 'provider-disabled' }
  | { descriptorId: string; state: 'failed'; failureCode: 'collection-input-invalid' }
  | { providerId: string; descriptorId: string; state: 'failed'; failureCode: string; status?: number; insertedCount?: number }
  | { providerId: string; descriptorId: string; state: 'persisted'; status: number; acceptedBytes: number; insertedCount: number; dedupedCount: number }

export const macroCalendarScheduleCollectionWorkflowPolicy = {
  eligibleDescriptorIds: ['macro-calendar-fed-schedule', 'macro-calendar-bea-schedule'],
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  skippedFailureCodes: ['provider-disabled'],
  failedFailureCodes: ['descriptor-not-allowed', 'credential-required', 'run-time-invalid', 'network-request-failed', 'request-timeout', 'redirect-rejected', 'response-body-too-large', 'http-response-not-success', 'profile-read-failed', 'http-request-failed', 'response-descriptor-mismatch', 'evidence-persist-failed'],
  httpStatusRangesByFailureCode: {
    'redirect-rejected': [{ minimum: 300, maximum: 399 }],
    'http-response-not-success': [{ minimum: 100, maximum: 199 }, { minimum: 400, maximum: 599 }]
  }
} as const

export function createMacroCalendarScheduleCollectionWorkflow(deps: {
  collection: Pick<MacroCalendarCollectionService, 'collectDescriptor'>
  persistence: Pick<MacroCalendarSchedulePersistenceService, 'persistScheduleEvidence'>
}): MacroCalendarScheduleCollectionWorkflow {
  return {
    async collectAndPersistSchedule(input) {
      if (!isValidInput(input)) return { descriptorId: safeDescriptorId(input), state: 'failed', failureCode: 'collection-input-invalid' }
      const descriptor = getMacroCalendarOfficialSourceDescriptor(input.descriptorId)
      if (!descriptor) return { descriptorId: input.descriptorId, state: 'skipped', failureCode: 'descriptor-not-found' }
      const identity = { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId }
      if (!(macroCalendarScheduleCollectionWorkflowPolicy.eligibleDescriptorIds as readonly string[]).includes(descriptor.descriptorId)) {
        return { ...identity, state: 'skipped', failureCode: 'schedule-descriptor-unavailable' }
      }

      const collected = await deps.collection.collectDescriptor({ descriptorId: descriptor.descriptorId, runId: input.runId, detectedAt: input.detectedAt, signal: input.signal })
      if (!isObject(collected)) return { ...identity, state: 'failed', failureCode: 'collection-result-invalid' }
      if (collected.state !== 'persisted') return collectionFailure(collected, identity)
      if (!isValidCollectionResult(collected, identity)) return { ...identity, state: 'failed', failureCode: 'collection-result-invalid' }

      const persisted = deps.persistence.persistScheduleEvidence(collected.evidence.rawRecordId)
      return persisted.state === 'persisted'
        ? { ...identity, state: 'persisted', status: collected.status, acceptedBytes: collected.acceptedBytes, insertedCount: persisted.insertedCount, dedupedCount: persisted.dedupedCount }
        : { ...identity, state: 'failed', failureCode: persisted.failureCode, insertedCount: persisted.insertedCount }
    }
  }
}

function isValidInput(input: MacroCalendarCollectionInput): boolean {
  return Boolean(input && typeof input === 'object') && typeof input.descriptorId === 'string' &&
    typeof input.runId === 'string' && input.runId.trim().length > 0 && isCanonicalUtcMillis(input.detectedAt)
}

function isValidCollectionResult(
  result: Extract<Awaited<ReturnType<MacroCalendarCollectionService['collectDescriptor']>>, { state: 'persisted' }>,
  identity: { providerId: string; descriptorId: string }
): boolean {
  return result.providerId === identity.providerId && result.descriptorId === identity.descriptorId &&
    Number.isInteger(result.status) && result.status >= 200 && result.status <= 299 &&
    Number.isSafeInteger(result.acceptedBytes) && result.acceptedBytes >= 0 &&
    Boolean(result.evidence && typeof result.evidence === 'object') &&
    isNonBlank(result.evidence.rawRecordId) && isNonBlank(result.evidence.evidenceHash)
}

function collectionFailure(
  result: Exclude<MacroCalendarCollectionResult, { state: 'persisted' }>,
  identity: { providerId: string; descriptorId: string }
): MacroCalendarScheduleCollectionWorkflowResult {
  // Two failure shapes carry no provider id; they can never match the identity.
  if (
    !('providerId' in result) ||
    result.providerId !== identity.providerId ||
    result.descriptorId !== identity.descriptorId
  ) {
    return invalidCollectionResult(identity)
  }

  const status = 'status' in result ? result.status : undefined
  const skippedFailureCodes: readonly string[] = macroCalendarScheduleCollectionWorkflowPolicy.skippedFailureCodes
  const failedFailureCodes: readonly string[] = macroCalendarScheduleCollectionWorkflowPolicy.failedFailureCodes

  if (result.state === 'skipped' && status === undefined && skippedFailureCodes.includes(result.failureCode)) {
    return { ...identity, state: 'skipped', failureCode: 'provider-disabled' }
  }
  if (
    result.state === 'failed' &&
    failedFailureCodes.includes(result.failureCode) &&
    isValidFailureStatus(result.failureCode, status)
  ) {
    return { ...identity, state: 'failed', failureCode: result.failureCode, ...(status === undefined ? {} : { status }) }
  }
  return invalidCollectionResult(identity)
}

function invalidCollectionResult(identity: { providerId: string; descriptorId: string }): MacroCalendarScheduleCollectionWorkflowResult {
  return { ...identity, state: 'failed', failureCode: 'collection-result-invalid' }
}

function isValidFailureStatus(failureCode: string, status: unknown): boolean {
  if (status === undefined) return true
  const ranges = macroCalendarScheduleCollectionWorkflowPolicy.httpStatusRangesByFailureCode[
    failureCode as keyof typeof macroCalendarScheduleCollectionWorkflowPolicy.httpStatusRangesByFailureCode
  ]
  if (!ranges || typeof status !== 'number' || !Number.isInteger(status)) return false
  return ranges.some((range) => status >= range.minimum && status <= range.maximum)
}

function isCanonicalUtcMillis(value: string): boolean {
  if (typeof value !== 'string' || !macroCalendarScheduleCollectionWorkflowPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeDescriptorId(input: MacroCalendarCollectionInput): string {
  return typeof input?.descriptorId === 'string' ? input.descriptorId : 'unknown-descriptor'
}
