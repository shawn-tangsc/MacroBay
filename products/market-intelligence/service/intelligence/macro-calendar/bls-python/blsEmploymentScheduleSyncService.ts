import { createHash } from 'node:crypto'

import type { MacroCalendarRevision } from '../macroCalendarContracts'
import type { MacroCalendarRepository } from '../macroCalendarRepository'
import type { BlsPythonBridgeOperation, BlsPythonBridgeResult } from './blsPythonRequestsBridge'

export const blsEmploymentScheduleSyncPolicy = Object.freeze({
  descriptorId: 'macro-calendar-bls-python-schedule',
  sourceUrl: (year: string) => `https://www.bls.gov/schedule/${year}/home.htm`,
  parserVersion: 'bls-employment-python-annual-schedule-v1',
  expectedAnnualRows: 12,
  employmentEventMembers: [
    ['NONFARM_PAYROLLS', 'nonfarm-payrolls'],
    ['UNEMPLOYMENT', 'unemployment'],
    ['AVERAGE_HOURLY_EARNINGS', 'average-hourly-earnings']
  ],
  cpiEventMembers: [
    ['CPI', 'cpi'],
    ['CORE_CPI', 'core-cpi']
  ],
  caveats: ['official-time-not-published', 'official-timezone-not-published', 'bls-python-schedule']
} as const)

export type BlsEmploymentScheduleSyncResult =
  | Readonly<{
    state: 'completed'
    schedule: 'updated' | 'unchanged'
    groups: readonly BlsScheduleGroupDescriptor[]
  }>
  | Readonly<{ state: 'unavailable' }>

export type BlsScheduleGroupDescriptor = Readonly<{
  family: 'cpi' | 'employment'
  scheduledDate: string
  period: `${number}-M${string}`
  eventKey: string
}>

export type BlsEmploymentScheduleSyncService = Readonly<{ sync: (input: unknown) => Promise<BlsEmploymentScheduleSyncResult> }>

type Dependencies = Readonly<{
  bridge: Readonly<{ run: (operation: BlsPythonBridgeOperation) => Promise<BlsPythonBridgeResult> }>
  repository: Pick<MacroCalendarRepository, 'appendManyIfNew'>
  now: () => string
}>

type ScheduleRow = Readonly<{ releaseDate: string; referencePeriod: `${number}-M${string}` }>

export function createBlsEmploymentScheduleSyncService(deps: Dependencies): BlsEmploymentScheduleSyncService {
  let inFlight = false
  return Object.freeze({
    async sync(input): Promise<BlsEmploymentScheduleSyncResult> {
      if (inFlight || !isInput(input)) return unavailable()
      inFlight = true
      try {
        const detectedAt = deps.now()
        if (!isCanonicalUtcMillis(detectedAt)) return unavailable()
        const result = await deps.bridge.run({ kind: 'employment-schedule', year: input.year })
        if (result.state !== 'schedule' || !hasAnnualFamilies(result, input.year)) return unavailable()
        const revisions = revisionsFor(result.employmentRows, result.cpiRows, detectedAt, input.year)
        const persisted = deps.repository.appendManyIfNew(revisions)
        if (!isCompleteWrite(persisted, revisions.length)) return unavailable()
        return Object.freeze({
          state: 'completed' as const,
          schedule: persisted.insertedCount === 0 ? 'unchanged' : 'updated',
          groups: descriptorsFor(result.employmentRows, result.cpiRows)
        })
      } catch {
        return unavailable()
      } finally {
        inFlight = false
      }
    }
  })
}

function descriptorsFor(employmentRows: readonly ScheduleRow[], cpiRows: readonly ScheduleRow[]): readonly BlsScheduleGroupDescriptor[] {
  return Object.freeze([
    ...cpiRows.map((row) => Object.freeze({ family: 'cpi' as const, scheduledDate: row.releaseDate, period: row.referencePeriod, eventKey: `US.CPI.RELEASE.${row.referencePeriod}` })),
    ...employmentRows.map((row) => Object.freeze({ family: 'employment' as const, scheduledDate: row.releaseDate, period: row.referencePeriod, eventKey: `US.NONFARM_PAYROLLS.RELEASE.${row.referencePeriod}` }))
  ])
}

function revisionsFor(employmentRows: readonly ScheduleRow[], cpiRows: readonly ScheduleRow[], detectedAt: string, year: string): readonly MacroCalendarRevision[] {
  const sourceUrl = blsEmploymentScheduleSyncPolicy.sourceUrl(year)
  const evidenceHash = hash(JSON.stringify({ employmentRows, cpiRows }))
  const employmentRevisions = employmentRows.flatMap((row) => blsEmploymentScheduleSyncPolicy.employmentEventMembers.map(([key, eventNameKey]) => {
    const eventKey = `US.${key}.RELEASE.${row.referencePeriod}`
    const releaseGroupKey = `US.EMPLOYMENT_SITUATION.RELEASE.${row.referencePeriod}`
    return {
      revisionId: hash(JSON.stringify([eventKey, row.releaseDate, evidenceHash])),
      eventKey,
      releaseGroupKey,
      eventFamily: 'employment-situation',
      eventNameKey,
      countryCode: 'US',
      importance: 'high',
      periodKey: row.referencePeriod,
      lifecycleState: 'scheduled',
      revisionKind: 'schedule',
      scheduledDate: row.releaseDate,
      detectedAt,
      recordedAt: detectedAt,
      providerId: 'macro-calendar-bls',
      descriptorId: blsEmploymentScheduleSyncPolicy.descriptorId,
      sourceUrl,
      evidenceHash,
      evidenceRefs: [{
        providerId: 'macro-calendar-bls', descriptorId: blsEmploymentScheduleSyncPolicy.descriptorId,
        sourceUrl, evidenceHash, detectedAt, fieldKinds: ['schedule']
      }],
      snapshotHash: 'calculated-by-repository',
      parserVersion: blsEmploymentScheduleSyncPolicy.parserVersion,
      caveats: [...blsEmploymentScheduleSyncPolicy.caveats]
    } satisfies MacroCalendarRevision
  }))
  const cpiRevisions = cpiRows.flatMap((row) => blsEmploymentScheduleSyncPolicy.cpiEventMembers.map(([key, eventNameKey]) => {
    const eventKey = `US.${key}.RELEASE.${row.referencePeriod}`
    const releaseGroupKey = `US.CPI.RELEASE.${row.referencePeriod}`
    return {
      revisionId: hash(JSON.stringify([eventKey, row.releaseDate, evidenceHash])),
      eventKey,
      releaseGroupKey,
      eventFamily: 'consumer-price-index',
      eventNameKey,
      countryCode: 'US',
      importance: 'high',
      periodKey: row.referencePeriod,
      lifecycleState: 'scheduled',
      revisionKind: 'schedule',
      scheduledDate: row.releaseDate,
      detectedAt,
      recordedAt: detectedAt,
      providerId: 'macro-calendar-bls',
      descriptorId: blsEmploymentScheduleSyncPolicy.descriptorId,
      sourceUrl,
      evidenceHash,
      evidenceRefs: [{
        providerId: 'macro-calendar-bls', descriptorId: blsEmploymentScheduleSyncPolicy.descriptorId,
        sourceUrl, evidenceHash, detectedAt, fieldKinds: ['schedule']
      }],
      snapshotHash: 'calculated-by-repository',
      parserVersion: blsEmploymentScheduleSyncPolicy.parserVersion,
      caveats: [...blsEmploymentScheduleSyncPolicy.caveats]
    } satisfies MacroCalendarRevision
  }))
  return Object.freeze([...employmentRevisions, ...cpiRevisions])
}

function hasAnnualFamilies(
  result: BlsPythonBridgeResult,
  year: string
): result is Extract<BlsPythonBridgeResult, { state: 'schedule' }> & Readonly<{
  employmentRows: readonly ScheduleRow[]
  cpiRows: readonly ScheduleRow[]
}> {
  return result.state === 'schedule' &&
    Array.isArray(result.employmentRows) && Array.isArray(result.cpiRows) &&
    isAnnualSchedule(result.employmentRows, year) && isAnnualSchedule(result.cpiRows, year)
}

function isAnnualSchedule(rows: readonly ScheduleRow[], year: string): boolean {
  if (rows.length !== blsEmploymentScheduleSyncPolicy.expectedAnnualRows) return false
  const releaseDates = new Set<string>()
  const expectedPeriods = annualReferencePeriods(year)
  return rows.every((row) => isDateInYear(row.releaseDate, year) && isPeriod(row.referencePeriod) &&
    !releaseDates.has(row.releaseDate) && expectedPeriods.has(row.referencePeriod) && Boolean(releaseDates.add(row.releaseDate))) &&
    new Set(rows.map((row) => row.referencePeriod)).size === expectedPeriods.size
}

function annualReferencePeriods(year: string): ReadonlySet<string> {
  return new Set([`${Number(year) - 1}-M12`, ...Array.from({ length: 11 }, (_, index) => `${year}-M${String(index + 1).padStart(2, '0')}`)])
}

function isInput(value: unknown): value is Readonly<{ year: `${number}` }> {
  return isPlainRecord(value) && Object.keys(value).length === 1 && typeof own(value, 'year') === 'string' && /^\d{4}$/.test(own(value, 'year') as string)
}
function isDateInYear(value: string, year: string): boolean { return new RegExp(`^${year}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$`).test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value }
function isPeriod(value: string): value is `${number}-M${string}` { return /^\d{4}-M(?:0[1-9]|1[0-2])$/.test(value) }
function isCanonicalUtcMillis(value: string): boolean { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value }
function isCompleteWrite(value: unknown, count: number): value is { insertedCount: number; dedupedCount: number } { return Boolean(value && typeof value === 'object' && Number.isSafeInteger((value as { insertedCount?: unknown }).insertedCount) && Number.isSafeInteger((value as { dedupedCount?: unknown }).dedupedCount) && (value as { insertedCount: number }).insertedCount + (value as { dedupedCount: number }).dedupedCount === count) }
function isPlainRecord(value: unknown): value is Record<string, unknown> { try { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0 } catch { return false } }
function own(value: Record<string, unknown>, name: string): unknown { const descriptor = Object.getOwnPropertyDescriptor(value, name); return descriptor && 'value' in descriptor ? descriptor.value : undefined }
function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
function unavailable(): BlsEmploymentScheduleSyncResult { return Object.freeze({ state: 'unavailable' }) }
