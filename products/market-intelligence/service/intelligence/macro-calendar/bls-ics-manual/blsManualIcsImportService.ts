import type {
  ManualBlsIcsImportResult,
  ManualBlsIcsInput,
  ManualBlsIcsPreview
} from '../../../../contracts/macro/economicCalendarQueryContracts'
import type { MacroCalendarRevision } from '../macroCalendarContracts'
import type { MacroCalendarEvidenceStore } from '../macroCalendarEvidenceStore'
import type { MacroCalendarRepository } from '../macroCalendarRepository'
import { createMacroCalendarScheduleRevisions } from '../macroCalendarScheduleRevisionFactory'
import { manualBlsIcsParserPolicy, type ManualBlsIcsScheduleDraft } from './blsManualIcsContracts'
import { parseManualBlsIcs } from './blsManualIcsParser'

export const manualBlsIcsImportPolicy = {
  runIdPrefix: 'manual-bls-ics-import',
  storageReviewSnapshotCount: 60,
  storageReviewEvidenceBytes: 8 * 1024 * 1024,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  comparisonFields: [
    'eventKey', 'releaseGroupKey', 'eventFamily', 'eventNameKey', 'periodKey',
    'lifecycleState', 'revisionKind', 'scheduledDate', 'scheduledAt', 'parserVersion', 'caveats'
  ]
} as const

export type ManualBlsIcsImportService = {
  preview: (input: unknown) => ManualBlsIcsPreview
  import: (input: unknown) => ManualBlsIcsImportResult
}

type ImportDependencies = {
  evidence: Pick<MacroCalendarEvidenceStore, 'reserve' | 'release' | 'appendManualBlsIcs'>
  repository: Pick<MacroCalendarRepository, 'getEffectiveEventAsOf' | 'appendManyIfNew'>
  now: () => string
}

type ComparedImport = {
  parsed: Extract<ReturnType<typeof parseManualBlsIcs>, { state: 'parsed' }>
  detectedAt: string
  changedDrafts: ManualBlsIcsScheduleDraft[]
  insertedCount: number
  rescheduledCount: number
  unchangedCount: number
}

export function createManualBlsIcsImportService(deps: ImportDependencies): ManualBlsIcsImportService {
  return {
    preview(input) {
      const compared = compareInput(input, deps)
      if ('failureCode' in compared) return compared
      return { state: 'ready', ...counts(compared), ...parseCounts(compared.parsed) }
    },
    import(input) {
      if (!isValidInput(input)) return { state: 'failed', failureCode: 'invalid-file' }
      const body = input.body
      const reservation = deps.evidence.reserve(Buffer.byteLength(body, 'utf8'))
      if (!reservation) return persistenceFailed()
      try {
        const compared = compareInput(input, deps)
        if ('failureCode' in compared) return compared
        const parsedCounts = parseCounts(compared.parsed)
        if (compared.changedDrafts.length === 0) {
          return { state: 'unchanged', ...parsedCounts, unchangedCount: compared.unchangedCount }
        }
        const evidence = deps.evidence.appendManualBlsIcs({
          body,
          detectedAt: compared.detectedAt,
          runId: `${manualBlsIcsImportPolicy.runIdPrefix}:${compared.detectedAt}`
        }, reservation)
        if (!evidence) return persistenceFailed()
        const mapped = createMacroCalendarScheduleRevisions(
          { ...compared.parsed, drafts: compared.changedDrafts },
          evidence
        )
        if (mapped.state !== 'mapped' || mapped.revisions.length !== compared.changedDrafts.length) return persistenceFailed()
        const persisted = deps.repository.appendManyIfNew(mapped.revisions)
        if (!isCompletePersistenceResult(persisted, mapped.revisions.length)) return persistenceFailed()
        return { state: 'imported', ...parsedCounts, ...counts(compared) }
      } catch {
        return persistenceFailed()
      } finally {
        deps.evidence.release(reservation)
      }
    }
  }
}

function compareInput(
  input: unknown,
  deps: Pick<ImportDependencies, 'repository' | 'now'>
): ComparedImport | Extract<ManualBlsIcsPreview, { state: 'failed' }> {
  if (!isValidInput(input)) return { state: 'failed', failureCode: 'invalid-file' }
  const parsed = parseManualBlsIcs(input.body)
  if (parsed.state === 'failed') return parsed
  const detectedAt = deps.now()
  if (!isCanonicalUtcMillis(detectedAt)) return { state: 'failed', failureCode: 'persistence-failed' }

  const changedDrafts: ManualBlsIcsScheduleDraft[] = []
  let insertedCount = 0
  let rescheduledCount = 0
  let unchangedCount = 0
  try {
    for (const draft of parsed.drafts) {
      const current = deps.repository.getEffectiveEventAsOf({ eventKey: draft.eventKey, asOf: detectedAt })
      if (!current) {
        insertedCount += 1
        changedDrafts.push(draft)
      } else if (!sameSchedule(current, draft)) {
        rescheduledCount += 1
        changedDrafts.push(draft)
      } else {
        unchangedCount += 1
      }
    }
  } catch {
    return persistenceFailed()
  }
  return { parsed, detectedAt, changedDrafts, insertedCount, rescheduledCount, unchangedCount }
}

function isValidInput(input: unknown): input is ManualBlsIcsInput {
  return Boolean(input && typeof input === 'object' && !Array.isArray(input)) &&
    (input as ManualBlsIcsInput).truncated === false && typeof (input as ManualBlsIcsInput).body === 'string' &&
    (input as ManualBlsIcsInput).body.trim().length > 0 &&
    Buffer.byteLength((input as ManualBlsIcsInput).body, 'utf8') <= manualBlsIcsParserPolicy.maximumBodyBytes
}

function sameSchedule(current: MacroCalendarRevision, draft: ManualBlsIcsScheduleDraft): boolean {
  return JSON.stringify(scheduleTuple(current)) === JSON.stringify(scheduleTuple(draft))
}

function scheduleTuple(value: MacroCalendarRevision | ManualBlsIcsScheduleDraft): unknown[] {
  return [
    value.eventKey, value.releaseGroupKey, value.eventFamily, value.eventNameKey, value.periodKey,
    value.lifecycleState, value.revisionKind, value.scheduledDate, value.scheduledAt ?? null,
    value.parserVersion, value.caveats
  ]
}

function parseCounts(parsed: ComparedImport['parsed']) {
  return {
    totalEvents: parsed.totalEvents,
    supportedReleaseGroups: parsed.supportedReleaseGroups,
    generatedEvents: parsed.generatedEvents,
    unsupportedEvents: parsed.unsupportedEvents
  }
}

function counts(compared: ComparedImport) {
  return {
    insertedCount: compared.insertedCount,
    rescheduledCount: compared.rescheduledCount,
    unchangedCount: compared.unchangedCount
  }
}

function isCompletePersistenceResult(
  result: { insertedCount: number; dedupedCount: number },
  expectedCount: number
): boolean {
  return Number.isSafeInteger(result.insertedCount) && result.insertedCount >= 0 &&
    Number.isSafeInteger(result.dedupedCount) && result.dedupedCount >= 0 &&
    result.insertedCount + result.dedupedCount === expectedCount
}

function isCanonicalUtcMillis(value: string): boolean {
  if (typeof value !== 'string' || !manualBlsIcsImportPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function persistenceFailed(): Extract<ManualBlsIcsImportResult, { state: 'failed' }> {
  return { state: 'failed', failureCode: 'persistence-failed' }
}
