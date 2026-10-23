import { createHash } from 'node:crypto'

import { parseBlsCalendarFamilyValues, type BlsCalendarFamilyValuesResult } from '../bls-observations/blsObservedValuesParser'
import type { MacroCalendarEvidenceRef, MacroCalendarRevision, MacroCalendarValue } from '../macroCalendarContracts'
import type { MacroCalendarRepository } from '../macroCalendarRepository'
import type { BlsEmploymentMvpEvidence } from './blsEmploymentMvpEvidence'
import type { BlsPythonBridgeOperation, BlsPythonBridgeResult } from '../bls-python/blsPythonRequestsBridge'
import { formatBlsCalendarValue } from './blsCalendarDisplayValue'
import type { BlsAutomaticRefreshInput } from '../bls-schedule-catch-up/blsScheduleAndLatestValuesSyncWorkflow'

export const blsEmploymentMvpRefreshPolicy = Object.freeze({
  maximumResponseBytes: 1_500_000,
  childDeadlineMs: 17_000,
  descriptorId: 'macro-calendar-bls-calendar-family-refresh-api-v2',
  legacyEmploymentDescriptorId: 'macro-calendar-bls-employment-refresh-api',
  sourceUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
  parserVersion: 'bls-calendar-family-refresh-v2',
  cpi: Object.freeze({ eventKeys: ['CPI', 'CORE_CPI'], eventNames: ['cpi', 'core-cpi'] }),
  employment: Object.freeze({ eventKeys: ['NONFARM_PAYROLLS', 'UNEMPLOYMENT', 'AVERAGE_HOURLY_EARNINGS'], eventNames: ['nonfarm-payrolls', 'unemployment', 'average-hourly-earnings'] })
} as const)

export type BlsEmploymentMvpRefreshResult = Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>
export type BlsEmploymentMvpRefreshService = Readonly<{
  refresh: (input: unknown) => Promise<BlsEmploymentMvpRefreshResult>
  refreshAutomatic: (input: BlsAutomaticRefreshInput) => Promise<BlsEmploymentMvpRefreshResult>
}>
type Family = 'cpi' | 'employment'
type CalendarValues = Readonly<{ actual: number; calendarPrevious: number }>
type FormattedCalendarValues = Readonly<{ actual: MacroCalendarValue; previous: MacroCalendarValue }>
type Group = Readonly<{ family: Family; period: `${number}-M${string}`; revisions: readonly MacroCalendarRevision[] }>
type Dependencies = Readonly<{
  valuesBridge?: Readonly<{ run: (operation: BlsPythonBridgeOperation) => Promise<BlsPythonBridgeResult> }>
  repository: Pick<MacroCalendarRepository, 'getEffectiveEventAsOf' | 'appendManyIfNew'>
  evidence?: BlsEmploymentMvpEvidence
  now: () => string
}>

export function createBlsEmploymentMvpRefreshService(deps: Dependencies): BlsEmploymentMvpRefreshService {
  const inFlight = new Map<Family, symbol>()
  return Object.freeze({
    refresh(input): Promise<BlsEmploymentMvpRefreshResult> {
      if (!isInput(input)) return Promise.resolve(unavailable())
      const now = readNow(deps)
      return refreshFamily(familyForEventKey(input.eventKey), now, () => now ? readEligibleGroup(input.eventKey, now, deps.repository) : undefined, false, deps, inFlight)
    },
    refreshAutomatic(input): Promise<BlsEmploymentMvpRefreshResult> {
      if (!isAutomaticInput(input)) return Promise.resolve(unavailable())
      return refreshFamily(input.family, input.workflowAsOf, () => readAutomaticGroup(input, deps.repository), true, deps, inFlight)
    }
  })
}

function refreshFamily(family: Family | undefined, now: string | undefined, readGroup: () => Group | undefined, automatic: boolean, deps: Dependencies, inFlight: Map<Family, symbol>): Promise<BlsEmploymentMvpRefreshResult> {
      if (!family || !now || !deps.valuesBridge || !deps.evidence || inFlight.has(family)) return Promise.resolve(unavailable())
      const owner = Symbol(family)
      inFlight.set(family, owner)
      const valuesBridge = deps.valuesBridge
      const evidenceStore = deps.evidence
      let timedOut = false
      let resolveDeadline: (result: BlsEmploymentMvpRefreshResult) => void = () => undefined
      const deadline = new Promise<BlsEmploymentMvpRefreshResult>((resolve) => { resolveDeadline = resolve })
      const work = (async (): Promise<BlsEmploymentMvpRefreshResult> => {
        try {
        const group = readGroup()
        if (!group || group.family !== family) return unavailable()
        if (automatic && isCompleteOfficialGroup(group)) return unchanged()
        let reservation = evidenceStore.reserve(blsEmploymentMvpRefreshPolicy.maximumResponseBytes)
        if (!reservation) return unavailable()
        try {
          const result = await valuesBridge.run({ kind: 'calendar-family-values', family: group.family, period: group.period })
          if (timedOut || !isSuccessfulResponse(result)) return unavailable()
          const parsed = parseBlsCalendarFamilyValues(parseResponse(result.body), { family: group.family, period: group.period })
          if (timedOut || parsed.state !== 'available' || parsed.family !== group.family) return unavailable()
          if (sameValues(group, parsed)) return unchanged()
          const formattedValues = formatCalendarValues(group, parsed)
          if (!formattedValues) return unavailable()
          const evidence = evidenceStore.appendApiBody(result.body, now, reservation)
          reservation = undefined
          if (timedOut || !evidence) return unavailable()
          const revisions = revisionsFor(group, formattedValues, now, evidence)
          if (timedOut || !revisions || revisions.length !== group.revisions.length) return unavailable()
          return isCompleteWrite(deps.repository.appendManyIfNew(revisions), revisions.length) ? updated() : unavailable()
        } finally {
          if (reservation) evidenceStore.release(reservation)
        }
      } catch {
        return unavailable()
      } finally {
        if (inFlight.get(family) === owner) inFlight.delete(family)
      }
      })()
      const timer = setTimeout(() => { timedOut = true; resolveDeadline(unavailable()) }, blsEmploymentMvpRefreshPolicy.childDeadlineMs)
      void work.finally(() => { clearTimeout(timer) })
      return Promise.race([work, deadline])
    }

function readNow(deps: Dependencies): string | undefined {
  try { const value = deps.now(); return isCanonicalUtcMillis(value) ? value : undefined } catch { return undefined }
}

function readAutomaticGroup(input: BlsAutomaticRefreshInput, repository: Dependencies['repository']): Group | undefined {
  if (!isCanonicalUtcMillis(input.workflowAsOf)) return undefined
  const expectedKey = input.family === 'cpi' ? `US.CPI.RELEASE.${input.period}` : `US.NONFARM_PAYROLLS.RELEASE.${input.period}`
  if (input.eventKey !== expectedKey) return undefined
  const group = readEligibleGroup(input.eventKey, input.workflowAsOf, repository)
  return group && group.family === input.family && group.period === input.period && group.revisions[0]?.scheduledDate === input.scheduledDate ? group : undefined
}

function familyForEventKey(eventKey: string): Family | undefined {
  const match = /^US\.(CPI|CORE_CPI|NONFARM_PAYROLLS|UNEMPLOYMENT|AVERAGE_HOURLY_EARNINGS)\.RELEASE\.\d{4}-M(?:0[1-9]|1[0-2])$/.exec(eventKey)
  return match && (match[1] === 'CPI' || match[1] === 'CORE_CPI') ? 'cpi' : match ? 'employment' : undefined
}

function isAutomaticInput(value: unknown): value is BlsAutomaticRefreshInput {
  if (!isExactPlainRecord(value, ['family', 'eventKey', 'period', 'scheduledDate', 'workflowAsOf', 'trigger'])) return false
  return (value.family === 'cpi' || value.family === 'employment') && typeof value.eventKey === 'string' &&
    typeof value.period === 'string' && /^\d{4}-M(?:0[1-9]|1[0-2])$/.test(value.period) && typeof value.scheduledDate === 'string' &&
    isCanonicalUtcMillis(value.workflowAsOf) && value.scheduledDate < value.workflowAsOf.slice(0, 10) && value.trigger === 'schedule-latest-catch-up'
}

function isExactPlainRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const record = value as Record<string, unknown>
    const names = Object.getOwnPropertyNames(record)
    return names.length === fields.length && Object.getOwnPropertySymbols(record).length === 0 && fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, field)
      return Boolean(descriptor && 'value' in descriptor)
    })
  } catch { return false }
}

function readEligibleGroup(eventKey: string, now: string, repository: Dependencies['repository']): Group | undefined {
  const match = /^US\.(CPI|CORE_CPI|NONFARM_PAYROLLS|UNEMPLOYMENT|AVERAGE_HOURLY_EARNINGS)\.RELEASE\.(\d{4}-M(?:0[1-9]|1[0-2]))$/.exec(eventKey)
  if (!match) return undefined
  const period = match[2] as `${number}-M${string}`
  const family: Family = ['CPI', 'CORE_CPI'].includes(match[1]!) ? 'cpi' : 'employment'
  const keys = blsEmploymentMvpRefreshPolicy[family].eventKeys
  const revisions = keys.map((key) => repository.getEffectiveEventAsOf({ eventKey: `US.${key}.RELEASE.${period}`, asOf: now }))
  if (revisions.some((revision) => !isEligibleMember(revision))) return undefined
  const typed = revisions as MacroCalendarRevision[]
  const expectedNames = blsEmploymentMvpRefreshPolicy[family].eventNames
  const expectedReleaseGroupKey = family === 'cpi' ? `US.CPI.RELEASE.${period}` : `US.EMPLOYMENT_SITUATION.RELEASE.${period}`
  if (!typed.every((revision, index) => revision.eventKey === `US.${keys[index]!}.RELEASE.${period}` && revision.eventNameKey === expectedNames[index] && revision.periodKey === period && revision.releaseGroupKey === expectedReleaseGroupKey) || !sameGroup(typed) || !released(typed, now)) return undefined
  return Object.freeze({ family, period, revisions: Object.freeze(typed) })
}

function isEligibleMember(value: MacroCalendarRevision | undefined): value is MacroCalendarRevision {
  return Boolean(value && value.providerId === 'macro-calendar-bls' && value.lifecycleState !== 'cancelled' &&
    ((value.revisionKind === 'schedule' && (value.descriptorId === 'macro-calendar-bls-python-schedule' || value.descriptorId === 'macro-calendar-bls-ics-manual')) ||
      ((value.revisionKind === 'official-release' || value.revisionKind === 'official-revision') &&
        (value.descriptorId === blsEmploymentMvpRefreshPolicy.descriptorId || value.descriptorId === blsEmploymentMvpRefreshPolicy.legacyEmploymentDescriptorId))))
}

function sameGroup(revisions: readonly MacroCalendarRevision[]): boolean {
  const first = revisions[0]!
  return revisions.every((revision) => revision.releaseGroupKey === first.releaseGroupKey && revision.scheduledDate === first.scheduledDate && revision.scheduledAt === first.scheduledAt)
}

function released(revisions: readonly MacroCalendarRevision[], now: string): boolean {
  const scheduledAt = revisions[0]!.scheduledAt
  return scheduledAt === undefined
    ? revisions[0]!.scheduledDate <= now.slice(0, 10)
    : isCanonicalUtcMillis(scheduledAt) && scheduledAt <= now && revisions.every((revision) => revision.scheduledAt === scheduledAt)
}

function isCompleteOfficialGroup(group: Group): boolean {
  const expectedReleaseGroupKey = group.family === 'cpi'
    ? `US.CPI.RELEASE.${group.period}`
    : `US.EMPLOYMENT_SITUATION.RELEASE.${group.period}`
  const eventKeys = blsEmploymentMvpRefreshPolicy[group.family].eventKeys
  const eventNames = blsEmploymentMvpRefreshPolicy[group.family].eventNames
  return group.revisions.every((revision, index) =>
    revision.eventKey === `US.${eventKeys[index]!}.RELEASE.${group.period}` &&
    revision.eventNameKey === eventNames[index] &&
    revision.releaseGroupKey === expectedReleaseGroupKey &&
    revision.descriptorId === blsEmploymentMvpRefreshPolicy.descriptorId &&
    (revision.revisionKind === 'official-release' || revision.revisionKind === 'official-revision') &&
    revision.lifecycleState === 'released' &&
    isSafeCalendarValue(revision.eventNameKey, revision.actual) && isSafeCalendarValue(revision.eventNameKey, revision.previous)
  )
}

function isSafeCalendarValue(metric: string, value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const calendarValue = value as MacroCalendarValue
  return typeof calendarValue.numericValue === 'number' && Number.isFinite(calendarValue.numericValue) &&
    typeof calendarValue.unit === 'string' && formatBlsCalendarValue(metric, calendarValue.numericValue, calendarValue.unit) !== undefined
}

function sameValues(group: Group, result: Extract<BlsCalendarFamilyValuesResult, { state: 'available' }>): boolean {
  const values = calendarValues(result)
  return group.revisions.every((revision, index) => revision.descriptorId === blsEmploymentMvpRefreshPolicy.descriptorId &&
    sameToTenDecimalPlaces(revision.actual?.numericValue, values[index]!.actual) &&
    sameToTenDecimalPlaces(revision.previous?.numericValue, values[index]!.calendarPrevious))
}

function sameToTenDecimalPlaces(left: unknown, right: number): boolean {
  return typeof left === 'number' && Number.isFinite(left) && Number.isFinite(right) && left.toFixed(10) === right.toFixed(10)
}

function formatCalendarValues(group: Group, result: Extract<BlsCalendarFamilyValuesResult, { state: 'available' }>): readonly FormattedCalendarValues[] | undefined {
  const values = calendarValues(result)
  const formatted = group.revisions.map((current, index) => {
    const actual = formatBlsCalendarValue(current.eventNameKey, values[index]!.actual)
    const previous = formatBlsCalendarValue(current.eventNameKey, values[index]!.calendarPrevious)
    return actual && previous ? { actual, previous } : undefined
  })
  return formatted.every((value): value is FormattedCalendarValues => value !== undefined)
    ? Object.freeze(formatted)
    : undefined
}

function revisionsFor(group: Group, values: readonly FormattedCalendarValues[], now: string, evidence: { rawRecordId: string; evidenceHash: string }): readonly MacroCalendarRevision[] | undefined {
  return Object.freeze(group.revisions.map((current, index) => makeRevision(current, group.period, values[index]!, now, evidence)))
}

function calendarValues(result: Extract<BlsCalendarFamilyValuesResult, { state: 'available' }>): readonly CalendarValues[] {
  return result.family === 'cpi'
    ? [result.values.cpi, result.values.coreCpi]
    : [result.values.nonfarm, result.values.unemployment, result.values.averageHourlyEarnings]
}

function makeRevision(current: MacroCalendarRevision, period: string, values: FormattedCalendarValues, now: string, evidence: { rawRecordId: string; evidenceHash: string }): MacroCalendarRevision {
  const { actual, previous } = values
  const revisionKind: MacroCalendarRevision['revisionKind'] = current.descriptorId === blsEmploymentMvpRefreshPolicy.descriptorId ? 'official-revision' : 'official-release'
  const evidenceRef: MacroCalendarEvidenceRef = { providerId: 'macro-calendar-bls', descriptorId: blsEmploymentMvpRefreshPolicy.descriptorId, sourceUrl: blsEmploymentMvpRefreshPolicy.sourceUrl, rawRecordId: evidence.rawRecordId, evidenceHash: evidence.evidenceHash, detectedAt: now, fieldKinds: ['actual', 'previous'] }
  const semantic = { ...current, periodKey: period, lifecycleState: 'released' as const, revisionKind, detectedAt: now, recordedAt: now, actual, previous, descriptorId: blsEmploymentMvpRefreshPolicy.descriptorId, sourceUrl: blsEmploymentMvpRefreshPolicy.sourceUrl, rawRecordId: evidence.rawRecordId, evidenceHash: evidence.evidenceHash, evidenceRefs: [evidenceRef], parserVersion: blsEmploymentMvpRefreshPolicy.parserVersion, replacesRevisionId: current.revisionId }
  return { ...semantic, revisionId: createHash('sha256').update(JSON.stringify([current.eventKey, period, actual.numericValue, previous.numericValue, evidence.evidenceHash])).digest('hex'), snapshotHash: 'calculated-by-repository' }
}

function isSuccessfulResponse(value: BlsPythonBridgeResult): value is Extract<BlsPythonBridgeResult, { state: 'response' }> { return value.state === 'response' && value.status >= 200 && value.status < 300 }
function parseResponse(body: string): unknown { try { return JSON.parse(body) } catch { return undefined } }
function isInput(value: unknown): value is { eventKey: string; confirmed: true } { return isPlainRecord(value) && Object.keys(value).length === 2 && typeof own(value, 'eventKey') === 'string' && (own(value, 'eventKey') as string).length > 0 && (own(value, 'eventKey') as string).length <= 160 && own(value, 'confirmed') === true }
function isPlainRecord(value: unknown): value is Record<string, unknown> { try { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0 } catch { return false } }
function own(value: Record<string, unknown>, name: string): unknown { const descriptor = Object.getOwnPropertyDescriptor(value, name); return descriptor && 'value' in descriptor ? descriptor.value : undefined }
function isCanonicalUtcMillis(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value }
function isCompleteWrite(value: unknown, count: number): boolean { return Boolean(value && typeof value === 'object' && Number.isSafeInteger((value as { insertedCount?: unknown }).insertedCount) && Number.isSafeInteger((value as { dedupedCount?: unknown }).dedupedCount) && (value as { insertedCount: number }).insertedCount + (value as { dedupedCount: number }).dedupedCount === count) }
function unavailable(): BlsEmploymentMvpRefreshResult { return Object.freeze({ state: 'unavailable' }) }
function updated(): BlsEmploymentMvpRefreshResult { return Object.freeze({ state: 'updated' }) }
function unchanged(): BlsEmploymentMvpRefreshResult { return Object.freeze({ state: 'unchanged' }) }
