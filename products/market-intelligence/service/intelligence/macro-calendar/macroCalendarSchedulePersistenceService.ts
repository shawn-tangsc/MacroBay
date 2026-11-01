import { createHash } from 'node:crypto'

import type { MacroCalendarEvidenceReference, MacroCalendarEvidenceStore } from './macroCalendarEvidenceStore'
import { macroCalendarEvidencePolicy } from './macroCalendarEvidenceStore'
import { parseMacroCalendarEvidence } from './macroCalendarEvidenceParser'
import type { MacroCalendarRepository } from './macroCalendarRepository'
import { createMacroCalendarScheduleRevisions } from './macroCalendarScheduleRevisionFactory'
import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'

export type MacroCalendarSchedulePersistenceService = {
  persistScheduleEvidence: (rawRecordId: string) => MacroCalendarSchedulePersistenceResult
}

export type MacroCalendarSchedulePersistenceResult =
  | { providerId: string; descriptorId: string; state: 'persisted'; insertedCount: number; dedupedCount: number }
  | { providerId?: string; descriptorId?: string; state: 'failed'; failureCode: 'evidence-not-found' | 'evidence-invalid' | 'parser-unavailable' | 'payload-invalid' | 'parser-output-empty' | 'schedule-input-invalid' | 'repository-write-failed'; insertedCount: number }

export const macroCalendarSchedulePersistencePolicy = {
  eligibleDescriptorIds: ['macro-calendar-fed-schedule', 'macro-calendar-bea-schedule'],
  payloadRefType: macroCalendarEvidencePolicy.payloadRefType,
  canonicalUtcMillisPattern: macroCalendarEvidencePolicy.canonicalUtcMillisPattern
} as const

export function createMacroCalendarSchedulePersistenceService(deps: {
  evidence: Pick<MacroCalendarEvidenceStore, 'getCalendarRecord' | 'readBody'>
  repository: Pick<MacroCalendarRepository, 'appendIfNew'>
  /**
   * Optional sink for the official policy facts. The projection marker (`8-9*`) exists only on the
   * parsed draft: the revision factory does not carry it, so this is its last chance to be stored.
   */
  policyFacts?: Pick<MacroCalendarRepository, 'policyFacts'>
}): MacroCalendarSchedulePersistenceService {
  return {
    persistScheduleEvidence(rawRecordId) {
      if (!isNonBlank(rawRecordId)) return failed('evidence-invalid')
      const record = deps.evidence.getCalendarRecord(rawRecordId)
      if (!record) return failed('evidence-not-found')
      const descriptor = getMacroCalendarOfficialSourceDescriptor(record.sourceId)
      if (!descriptor) return failed('evidence-invalid')
      const identity = { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId }
      if (!(macroCalendarSchedulePersistencePolicy.eligibleDescriptorIds as readonly string[]).includes(descriptor.descriptorId)) {
        return failed('parser-unavailable', identity)
      }
      if (!isValidEvidenceRecord(rawRecordId, record, descriptor)) return failed('evidence-invalid', identity)
      let body: string | undefined
      try {
        body = deps.evidence.readBody(record)
      } catch {
        return failed('evidence-invalid', identity)
      }
      if (!body || record.payloadHash !== hash(body) || record.payloadSizeBytes !== Buffer.byteLength(body, 'utf8')) return failed('evidence-invalid', identity)

      const parsed = parseMacroCalendarEvidence({ descriptorId: descriptor.descriptorId, body })
      if (!('kind' in parsed && parsed.kind === 'schedule-drafts')) return failed('state' in parsed && parsed.state === 'failed' ? parsed.failureCode : 'parser-unavailable', identity)
      const mapped = createMacroCalendarScheduleRevisions(parsed, reference(record, descriptor))
      if (mapped.state === 'failed') return failed(mapped.failureCode, identity)

      let insertedCount = 0
      let dedupedCount = 0
      try {
        for (const revision of mapped.revisions) {
          if (deps.repository.appendIfNew(revision).inserted) insertedCount += 1
          else dedupedCount += 1
        }
      } catch {
        return { ...identity, state: 'failed', failureCode: 'repository-write-failed', insertedCount }
      }
      if (descriptor.descriptorId === 'macro-calendar-fed-schedule') {
        for (const draft of parsed.drafts) {
          if (draft.eventFamily !== 'fomc' || draft.hasProjectionMaterials === undefined) continue
          deps.policyFacts?.policyFacts.recordSchedule({
            meetingDate: draft.scheduledDate,
            hasProjectionMaterials: draft.hasProjectionMaterials,
            detectedAt: record.detectedAt
          })
        }
      }
      return { ...identity, state: 'persisted', insertedCount, dedupedCount }
    }
  }
}

function isValidEvidenceRecord(
  rawRecordId: string,
  record: NonNullable<ReturnType<MacroCalendarEvidenceStore['getCalendarRecord']>>,
  descriptor: NonNullable<ReturnType<typeof getMacroCalendarOfficialSourceDescriptor>>
): record is NonNullable<ReturnType<MacroCalendarEvidenceStore['getCalendarRecord']>> {
  if (record.rawRecordId !== rawRecordId || record.processingOwner !== macroCalendarEvidencePolicy.processingOwner || record.sourceUrl !== descriptor.sourceUrl ||
    record.payloadFormat !== descriptor.payloadFormat || record.parserVersion !== descriptor.parserId ||
    record.payloadRefType !== macroCalendarSchedulePersistencePolicy.payloadRefType ||
    !isCanonicalUtcMillis(record.detectedAt) || !isNonBlank(record.payloadHash)) return false
  return Number.isSafeInteger(record.payloadSizeBytes) && (record.payloadSizeBytes ?? 0) > 0
}

function reference(
  record: NonNullable<ReturnType<MacroCalendarEvidenceStore['getCalendarRecord']>>,
  descriptor: NonNullable<ReturnType<typeof getMacroCalendarOfficialSourceDescriptor>>
): MacroCalendarEvidenceReference {
  return {
    rawRecordId: record.rawRecordId, providerId: descriptor.providerId, descriptorId: descriptor.descriptorId,
    sourceUrl: descriptor.sourceUrl, evidenceHash: record.payloadHash, detectedAt: record.detectedAt,
    parserVersion: descriptor.parserId, inserted: false, deduped: false
  }
}

function failed(
  failureCode: Extract<MacroCalendarSchedulePersistenceResult, { state: 'failed' }>['failureCode'],
  identity: Partial<{ providerId: string; descriptorId: string }> = {}
): Extract<MacroCalendarSchedulePersistenceResult, { state: 'failed' }> {
  return { ...identity, state: 'failed', failureCode, insertedCount: 0 }
}

function isCanonicalUtcMillis(value: string): boolean {
  if (typeof value !== 'string' || !macroCalendarSchedulePersistencePolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}
