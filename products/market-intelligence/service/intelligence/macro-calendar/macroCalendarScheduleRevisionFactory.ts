import { createHash } from 'node:crypto'

import type { MacroCalendarEvidenceParserResult } from './macroCalendarEvidenceParser'
import type { MacroCalendarEvidenceReference } from './macroCalendarEvidenceStore'
import type { MacroCalendarRevision } from './macroCalendarContracts'
import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import { manualBlsIcsParserPolicy, type ManualBlsIcsParserResult } from './bls-ics-manual/blsManualIcsContracts'
import type { MacroCalendarScheduleDraft } from './parsers/verifiedScheduleParserContracts'

export type MacroCalendarScheduleRevisionFactoryResult =
  | { state: 'mapped'; revisions: MacroCalendarRevision[] }
  | { state: 'failed'; failureCode: 'parser-unavailable' | 'schedule-input-invalid' }

export const macroCalendarScheduleRevisionFactoryPolicy = {
  eligibleDescriptorIds: ['macro-calendar-fed-schedule', 'macro-calendar-bea-schedule', 'macro-calendar-bls-ics-manual'],
  snapshotHashPlaceholder: 'pending-repository-snapshot-hash',
  revisionIdentity: 'sha256(JSON.stringify([eventKey,releaseGroupKey,eventFamily,eventNameKey,periodKey,lifecycleState,revisionKind,scheduledDate,scheduledAt,parserVersion,caveats,evidenceHash]))',
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const

export function createMacroCalendarScheduleRevisions(
  parsed: MacroCalendarEvidenceParserResult | ManualBlsIcsParserResult,
  evidence: MacroCalendarEvidenceReference
): MacroCalendarScheduleRevisionFactoryResult {
  const schedule = scheduleInput(parsed)
  if (!schedule) return { state: 'failed', failureCode: 'parser-unavailable' }
  const descriptor = getMacroCalendarOfficialSourceDescriptor(schedule.descriptorId)
  if (!descriptor || !isEligibleDescriptorId(descriptor.descriptorId)) {
    return { state: 'failed', failureCode: 'parser-unavailable' }
  }
  if (schedule.drafts.length === 0) return { state: 'failed', failureCode: 'schedule-input-invalid' }
  if (!isCoherentInput(schedule, evidence, descriptor)) return { state: 'failed', failureCode: 'schedule-input-invalid' }

  const eventKeys = new Set<string>()
  if (schedule.drafts.some((draft) => eventKeys.has(draft.eventKey) || !eventKeys.add(draft.eventKey))) return { state: 'failed', failureCode: 'schedule-input-invalid' }
  const revisions = schedule.drafts.map((draft) => {
    if (draft.providerId !== descriptor.providerId || draft.descriptorId !== descriptor.descriptorId) return undefined
    const identity = [draft.eventKey, draft.releaseGroupKey, draft.eventFamily, draft.eventNameKey, draft.periodKey, draft.lifecycleState, draft.revisionKind, draft.scheduledDate, draft.scheduledAt ?? null, draft.parserVersion, draft.caveats, evidence.evidenceHash]
    return {
      revisionId: createHash('sha256').update(JSON.stringify(identity)).digest('hex'),
      eventKey: draft.eventKey,
      releaseGroupKey: draft.releaseGroupKey,
      eventFamily: draft.eventFamily,
      eventNameKey: draft.eventNameKey,
      countryCode: 'US',
      importance: 'high',
      periodKey: draft.periodKey,
      lifecycleState: draft.lifecycleState,
      revisionKind: draft.revisionKind,
      scheduledDate: draft.scheduledDate,
      ...(draft.scheduledAt ? { scheduledAt: draft.scheduledAt } : {}),
      detectedAt: evidence.detectedAt,
      recordedAt: evidence.detectedAt,
      providerId: descriptor.providerId,
      descriptorId: descriptor.descriptorId,
      sourceUrl: descriptor.sourceUrl,
      rawRecordId: evidence.rawRecordId,
      evidenceHash: evidence.evidenceHash,
      evidenceRefs: [{ providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, sourceUrl: descriptor.sourceUrl, rawRecordId: evidence.rawRecordId, evidenceHash: evidence.evidenceHash, detectedAt: evidence.detectedAt, fieldKinds: ['schedule'] }],
      snapshotHash: macroCalendarScheduleRevisionFactoryPolicy.snapshotHashPlaceholder,
      parserVersion: draft.parserVersion,
      caveats: draft.caveats
    } satisfies MacroCalendarRevision
  })
  return revisions.some((revision) => !revision)
    ? { state: 'failed', failureCode: 'schedule-input-invalid' }
    : { state: 'mapped', revisions: revisions as MacroCalendarRevision[] }
}

function isEligibleDescriptorId(descriptorId: string): boolean {
  return (macroCalendarScheduleRevisionFactoryPolicy.eligibleDescriptorIds as readonly string[]).includes(descriptorId)
}

type ScheduleFactoryInput = {
  providerId: MacroCalendarRevision['providerId']
  descriptorId: string
  parserId: string
  drafts: Array<Omit<MacroCalendarScheduleDraft, 'sourceUrl'> | MacroCalendarScheduleDraft>
}

function scheduleInput(parsed: MacroCalendarEvidenceParserResult | ManualBlsIcsParserResult): ScheduleFactoryInput | undefined {
  if ('kind' in parsed) return parsed.kind === 'schedule-drafts' ? parsed : undefined
  if (parsed.state !== 'parsed') return undefined
  const descriptor = getMacroCalendarOfficialSourceDescriptor(manualBlsIcsParserPolicy.descriptorId)
  return descriptor
    ? { providerId: descriptor.providerId, descriptorId: descriptor.descriptorId, parserId: descriptor.parserId, drafts: parsed.drafts }
    : undefined
}

function isCoherentInput(
  parsed: ScheduleFactoryInput,
  evidence: MacroCalendarEvidenceReference,
  descriptor: NonNullable<ReturnType<typeof getMacroCalendarOfficialSourceDescriptor>>
): boolean {
  return parsed.providerId === descriptor.providerId && parsed.parserId === descriptor.parserId &&
    evidence.providerId === descriptor.providerId && evidence.descriptorId === descriptor.descriptorId &&
    evidence.parserVersion === descriptor.parserId && evidence.sourceUrl === descriptor.sourceUrl &&
    isCanonicalUtcMillis(evidence.detectedAt) && isNonBlank(evidence.rawRecordId) && isNonBlank(evidence.evidenceHash) &&
    parsed.drafts.every((draft) => draft.providerId === descriptor.providerId && draft.descriptorId === descriptor.descriptorId &&
      isNonBlank(draft.parserVersion) && draft.parserVersion === parsed.drafts[0]?.parserVersion &&
      (descriptor.descriptorId !== manualBlsIcsParserPolicy.descriptorId || draft.parserVersion === descriptor.parserId))
}

function isCanonicalUtcMillis(value: string): boolean {
  if (typeof value !== 'string' || !macroCalendarScheduleRevisionFactoryPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isNonBlank(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
