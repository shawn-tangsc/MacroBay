import type { MacroCalendarRevision } from './macroCalendarContracts'
import type { MacroCalendarRepository } from './macroCalendarRepository'
import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'
import { formatBlsCalendarValue } from './bls-employment-refresh/blsCalendarDisplayValue'
import { macroCalendarConsensusFallback } from './macroCalendarPolicy'
import { resolveDisplayedReleaseTime } from './macroCalendarConventionTime'

export type MacroEconomicCalendarQueryService = {
  queryMonth: (input: unknown) => MacroEconomicCalendarMonthResult
  getEventDetail: (input: unknown) => MacroEconomicCalendarEventResult
  /**
   * The next FOMC meeting at or after `asOf`, read from the same month query the calendar grid uses.
   *
   * The policy block needs a meeting date to price against; without this the reader would have to
   * scan months itself and would get a different answer than the calendar shows.
   */
  nextFomcMeeting: (input: unknown) => MacroEconomicCalendarNextFomcResult
}

export type MacroEconomicCalendarNextFomcResult =
  | { state: 'available'; meeting: { eventKey: string; scheduledDate: string; scheduledAt?: string } }
  | { state: 'unavailable'; failureCode: 'query-input-invalid' | 'calendar-query-unavailable' | 'meeting-not-found' }

export type MacroEconomicCalendarMonthResult =
  | { state: 'available'; asOf: string; events: readonly MacroEconomicCalendarEventView[] }
  | { state: 'unavailable'; failureCode: 'query-input-invalid' | 'calendar-query-unavailable' }

export type MacroEconomicCalendarEventResult =
  | { state: 'available'; asOf: string; event: MacroEconomicCalendarEventView }
  | { state: 'unavailable'; failureCode: 'query-input-invalid' | 'event-not-found' | 'calendar-query-unavailable' }

export const macroEconomicCalendarQueryPolicy = {
  fedDecisionDescriptorId: 'macro-calendar-fed-statement',
  fedDecisionEventKeyPattern: /^US\.FOMC\.\d{4}-\d{2}-\d{2}$/,
  pythonAnnualScheduleDescriptorId: 'macro-calendar-bls-python-schedule',
  manualIcsDescriptorId: 'macro-calendar-bls-ics-manual',
  employmentRefreshDescriptorId: 'macro-calendar-bls-employment-refresh-api',
  calendarFamilyRefreshDescriptorId: 'macro-calendar-bls-calendar-family-refresh-api-v2',
  officialReleaseDate: {
    sourceField: 'scheduledDate',
    requiresLifecycleState: 'released',
    requiresActual: true,
    admittedRevisionKinds: ['official-release', 'official-revision']
  },
  blsValueFamilies: {
    'consumer-price-index': ['cpi', 'core-cpi'],
    'employment-situation': ['nonfarm-payrolls', 'unemployment', 'average-hourly-earnings']
  },
  eligibleSchedules: {
    'macro-calendar-fed': 'macro-calendar-fed-schedule',
    'macro-calendar-bea': 'macro-calendar-bea-schedule',
    'macro-calendar-bls': 'macro-calendar-bls-ics-manual'
  },
  monthResultLimit: 200,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  monthPattern: /^\d{4}-(?:0[1-9]|1[0-2])$/,
  nextFomcLookaheadMonths: 14,
  eventKeyMaxLength: 160
} as const

/**
 * The reader's edits, read **synchronously**: a calendar query is synchronous all the way to IPC, so
 * the edits are loaded once into main memory and re-read from there. The store stays the authority on
 * disk; this port only answers "has the reader edited this event, and to what".
 */
export type MacroCalendarReleaseTimeOverrides = Readonly<{
  get: (eventKey: string) => Readonly<{ scheduledAt: string; scheduledDate: string }> | undefined
}>

const noReleaseTimeOverrides: MacroCalendarReleaseTimeOverrides = Object.freeze({ get: () => undefined })

export function createMacroEconomicCalendarQueryService(deps: {
  repository: Pick<MacroCalendarRepository, 'listEffectiveMonthAsOf' | 'getEffectiveEventAsOf'>
  releaseTimeOverrides?: MacroCalendarReleaseTimeOverrides
}): MacroEconomicCalendarQueryService {
  const overrides = deps.releaseTimeOverrides ?? noReleaseTimeOverrides
  const toEvent = (revision: MacroCalendarRevision, asOf: string): MacroEconomicCalendarEventView =>
    toPublicEvent(revision, asOf, overrides)
  return {
    queryMonth(input) {
      if (!isMonthInput(input)) return monthUnavailable('query-input-invalid')
      const bounds = monthBounds(input.month)
      if (!bounds) return monthUnavailable('query-input-invalid')
      try {
        const limit = input.maxEvents ?? macroEconomicCalendarQueryPolicy.monthResultLimit
        const events = coalesceBlsCalendarRows(canonicalizeBlsValueFamilies(deps.repository.listEffectiveMonthAsOf({ ...bounds, asOf: input.asOf, limit })))
          .filter((revision, _index, all) => isEligible(revision, input.asOf, all))
          .slice(0, limit)
          .map((revision) => toEvent(revision, input.asOf))
        return { state: 'available', asOf: input.asOf, events }
      } catch {
        return monthUnavailable('calendar-query-unavailable')
      }
    },
    nextFomcMeeting(input) {
      if (!isNextFomcInput(input)) return { state: 'unavailable', failureCode: 'query-input-invalid' }
      try {
        for (let offset = 0; offset <= macroEconomicCalendarQueryPolicy.nextFomcLookaheadMonths; offset += 1) {
          const bounds = monthBounds(shiftMonth(input.asOf.slice(0, 7), offset))
          if (!bounds) return { state: 'unavailable', failureCode: 'query-input-invalid' }
          const meeting = deps.repository.listEffectiveMonthAsOf({ ...bounds, asOf: input.asOf, limit: macroEconomicCalendarQueryPolicy.monthResultLimit })
            .filter((revision) => revision.eventFamily === 'fomc' && revision.scheduledDate >= input.asOf.slice(0, 10))
            .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate) || left.scheduledAt?.localeCompare(right.scheduledAt ?? '') || 0)[0]
          if (meeting) return { state: 'available', meeting: { eventKey: meeting.eventKey, scheduledDate: meeting.scheduledDate, ...(meeting.scheduledAt ? { scheduledAt: meeting.scheduledAt } : {}) } }
        }
        return { state: 'unavailable', failureCode: 'meeting-not-found' }
      } catch {
        return { state: 'unavailable', failureCode: 'calendar-query-unavailable' }
      }
    },
    getEventDetail(input) {
      if (!isDetailInput(input)) return eventUnavailable('query-input-invalid')
      try {
        const revision = resolveEventDetail(deps.repository, input.eventKey, input.asOf)
        if (!revision) return eventUnavailable('event-not-found')
        const bounds = monthBounds(revision.scheduledDate.slice(0, 7))
        const peers = bounds
          ? deps.repository.listEffectiveMonthAsOf({ ...bounds, asOf: input.asOf, limit: macroEconomicCalendarQueryPolicy.monthResultLimit })
          : []
        return isEligible(revision, input.asOf, peers)
          ? { state: 'available', asOf: input.asOf, event: toEvent(revision, input.asOf) }
          : eventUnavailable('event-not-found')
      } catch {
        return eventUnavailable('calendar-query-unavailable')
      }
    }
  }
}

function resolveEventDetail(
  repository: Pick<MacroCalendarRepository, 'listEffectiveMonthAsOf' | 'getEffectiveEventAsOf'>,
  eventKey: string,
  asOf: string
): MacroCalendarRevision | undefined {
  const revision = repository.getEffectiveEventAsOf({ eventKey, asOf })
  if (!revision || (!isBlsCalendarSchedule(revision) && !isBlsCalendarValueRecord(revision))) return revision
  const bounds = monthBounds(revision.scheduledDate.slice(0, 7))
  if (!bounds) return revision
  return coalesceBlsCalendarRows(canonicalizeBlsValueFamilies([
    revision,
    ...repository.listEffectiveMonthAsOf({ ...bounds, asOf, limit: macroEconomicCalendarQueryPolicy.monthResultLimit })
      .filter((candidate) => candidate.revisionId !== revision.revisionId)
  ])).find((candidate) => candidate.eventKey === eventKey)
}

function canonicalizeBlsValueFamilies(revisions: readonly MacroCalendarRevision[]): MacroCalendarRevision[] {
  const groups = new Map<string, MacroCalendarRevision[]>()
  for (const revision of revisions) {
    if (!isBlsCalendarValueRecord(revision)) continue
    const key = [revision.eventFamily, revision.scheduledDate, revision.periodKey].join(':')
    const group = groups.get(key) ?? []
    group.push(revision)
    groups.set(key, group)
  }
  const canonical = new Map<MacroCalendarRevision, MacroCalendarRevision>()
  for (const group of groups.values()) {
    const expected = macroEconomicCalendarQueryPolicy.blsValueFamilies[group[0]!.eventFamily as keyof typeof macroEconomicCalendarQueryPolicy.blsValueFamilies]
    const releaseGroupKey = group[0]!.releaseGroupKey
    if (!expected || group.length !== expected.length || group.some((revision) => revision.releaseGroupKey !== releaseGroupKey) ||
      !expected.every((metric) => group.filter((revision) => revision.eventNameKey === metric).length === 1)) continue
    const formatted = group.map((revision) => canonicalizeBlsValue(revision))
    if (formatted.some((revision) => revision === undefined)) continue
    group.forEach((revision, index) => canonical.set(revision, formatted[index]!))
  }
  return revisions.flatMap((revision) => isBlsCalendarValueRecord(revision) ? canonical.get(revision) ?? [] : [revision])
}

function canonicalizeBlsValue(revision: MacroCalendarRevision): MacroCalendarRevision | undefined {
  const actual = revision.actual && typeof revision.actual.numericValue === 'number' && typeof revision.actual.unit === 'string'
    ? formatBlsCalendarValue(revision.eventNameKey, revision.actual.numericValue, revision.actual.unit)
    : undefined
  const previous = revision.previous && typeof revision.previous.numericValue === 'number' && typeof revision.previous.unit === 'string'
    ? formatBlsCalendarValue(revision.eventNameKey, revision.previous.numericValue, revision.previous.unit)
    : undefined
  return actual && previous ? { ...revision, actual, previous } : undefined
}

function coalesceBlsCalendarRows(revisions: readonly MacroCalendarRevision[]): MacroCalendarRevision[] {
  const automaticKeys = new Set<string>()
  const valuesByMetric = new Map<string, MacroCalendarRevision>()
  for (const revision of revisions) {
    if (isAutomaticBlsCalendarRecord(revision)) automaticKeys.add(metricKey(revision))
    if (isBlsCalendarValue(revision)) {
      const key = metricKey(revision)
      const current = valuesByMetric.get(key)
      if (!current || valuePriority(revision) > valuePriority(current)) valuesByMetric.set(key, revision)
    }
  }
  return revisions
    .filter((revision) => {
      const key = metricKey(revision)
      if (isManualBlsCalendarRecord(revision)) return !automaticKeys.has(key)
      return !isBlsCalendarValue(revision) || !revisions.some((candidate) => isBlsCalendarSchedule(candidate) && metricKey(candidate) === key)
    })
    .map((revision) => {
      if (!isBlsCalendarSchedule(revision)) return revision
      const value = valuesByMetric.get(metricKey(revision))
      return value ? { ...revision, lifecycleState: 'released', publishedAt: value.publishedAt, detectedAt: value.detectedAt, actual: value.actual, previous: value.previous } : revision
    })
}

function metricKey(revision: MacroCalendarRevision): string { return `${revision.providerId}:${revision.eventFamily}:${revision.eventNameKey}:${revision.scheduledDate}` }
function isBlsCalendarSchedule(revision: MacroCalendarRevision): boolean {
  return isAutomaticBlsSchedule(revision) || isManualBlsSchedule(revision)
}
function isAutomaticBlsCalendarRecord(revision: MacroCalendarRevision): boolean {
  return isAutomaticBlsSchedule(revision) || (isBlsCalendarValue(revision) && revision.caveats.includes('bls-python-schedule'))
}
function isManualBlsCalendarRecord(revision: MacroCalendarRevision): boolean {
  return isManualBlsSchedule(revision) || (isBlsCalendarValue(revision) && revision.caveats.includes('manual-ics-import'))
}
function isAutomaticBlsSchedule(revision: MacroCalendarRevision): boolean {
  return revision.providerId === 'macro-calendar-bls' && revision.revisionKind === 'schedule' &&
    revision.descriptorId === macroEconomicCalendarQueryPolicy.pythonAnnualScheduleDescriptorId &&
    (revision.eventFamily === 'consumer-price-index' || revision.eventFamily === 'employment-situation')
}
function isManualBlsSchedule(revision: MacroCalendarRevision): boolean {
  return revision.providerId === 'macro-calendar-bls' && revision.revisionKind === 'schedule' &&
    revision.descriptorId === macroEconomicCalendarQueryPolicy.manualIcsDescriptorId &&
    (revision.eventFamily === 'consumer-price-index' || revision.eventFamily === 'employment-situation')
}
function isBlsCalendarValue(revision: MacroCalendarRevision): boolean {
  return isBlsCalendarValueRecord(revision) && revision.actual !== undefined && revision.previous !== undefined
}
function isBlsCalendarValueRecord(revision: MacroCalendarRevision): boolean {
  return revision.providerId === 'macro-calendar-bls' &&
    (revision.eventFamily === 'consumer-price-index' || revision.eventFamily === 'employment-situation') &&
    (revision.descriptorId === macroEconomicCalendarQueryPolicy.calendarFamilyRefreshDescriptorId ||
      (revision.eventFamily === 'employment-situation' && revision.descriptorId === macroEconomicCalendarQueryPolicy.employmentRefreshDescriptorId)) &&
    (revision.revisionKind === 'official-release' || revision.revisionKind === 'official-revision')
}
function valuePriority(revision: MacroCalendarRevision): number {
  return revision.descriptorId === macroEconomicCalendarQueryPolicy.calendarFamilyRefreshDescriptorId ? 2 : 1
}

function isMonthInput(value: unknown): value is { month: string; asOf: string; maxEvents?: number } {
  return isObject(value) && typeof value.month === 'string' && macroEconomicCalendarQueryPolicy.monthPattern.test(value.month) &&
    isCanonicalUtcMillis(value.asOf) && (value.maxEvents === undefined || isMonthResultLimit(value.maxEvents))
}

function isDetailInput(value: unknown): value is { eventKey: string; asOf: string } {
  return isObject(value) && typeof value.eventKey === 'string' && value.eventKey.trim().length > 0 && value.eventKey.length <= macroEconomicCalendarQueryPolicy.eventKeyMaxLength && isCanonicalUtcMillis(value.asOf)
}

function isNextFomcInput(value: unknown): value is { asOf: string } {
  return isObject(value) && isCanonicalUtcMillis(value.asOf)
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthBounds(month: string): { monthStart: string; monthEndExclusive: string } | undefined {
  if (!macroEconomicCalendarQueryPolicy.monthPattern.test(month)) return undefined
  const [year, monthNumber] = month.split('-').map(Number)
  const next = new Date(Date.UTC(year, monthNumber, 1))
  return { monthStart: `${month}-01`, monthEndExclusive: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01` }
}

function isEligible(revision: MacroCalendarRevision, asOf: string, peers: readonly MacroCalendarRevision[] = []): boolean {
  return revision.detectedAt <= asOf &&
    ((revision.revisionKind === 'schedule' &&
      ((revision.providerId !== 'macro-calendar-bls' && revision.providerId in macroEconomicCalendarQueryPolicy.eligibleSchedules &&
        macroEconomicCalendarQueryPolicy.eligibleSchedules[revision.providerId] === revision.descriptorId) ||
        isAutomaticBlsSchedule(revision) || isManualBlsSchedule(revision))) ||
      (isBlsCalendarValue(revision) && revision.lifecycleState === 'released' &&
        revision.caveats.includes('bls-python-schedule')) ||
      isFedFomcDecisionRelease(revision) || isBeaOfficialRelease(revision, peers))
}

function isBeaOfficialRelease(revision: MacroCalendarRevision, peers: readonly MacroCalendarRevision[]): boolean {
  if (revision.providerId !== 'macro-calendar-bea' || revision.descriptorId !== 'macro-calendar-bea-release-rss' || revision.lifecycleState !== 'released' || revision.revisionKind !== 'official-release' || !revision.actual || !isCanonicalUtcMillis(revision.publishedAt)) return false
  if (revision.eventFamily === 'pce' || revision.eventFamily === 'core-pce') {
    const expectedKey = revision.eventFamily === 'pce' ? `US.PCE.${revision.periodKey}` : `US.CORE_PCE.${revision.periodKey}`
    const counterpartKey = revision.eventFamily === 'pce' ? `US.CORE_PCE.${revision.periodKey}` : `US.PCE.${revision.periodKey}`
    return revision.eventKey === expectedKey && revision.releaseGroupKey === `US.BEA.PCE.${revision.periodKey}` && revision.actual.unit === 'percent-yoy' &&
      peers.filter((peer) => peer.eventKey === counterpartKey && peer.releaseGroupKey === revision.releaseGroupKey && peer.providerId === revision.providerId && peer.descriptorId === revision.descriptorId && peer.lifecycleState === 'released' && peer.revisionKind === 'official-release' && peer.actual?.unit === 'percent-yoy' && isCanonicalUtcMillis(peer.publishedAt)).length === 1
  }
  const match = /^US\.GDP\.(\d{4}-Q[1-4])\.(ADVANCE|SECOND|THIRD)$/.exec(revision.eventKey)
  return Boolean(match && revision.periodKey === match[1] && revision.releaseGroupKey === `US.BEA.GDP.${match[1]}.${match[2]}` && revision.eventFamily === 'gdp' && revision.actual.unit === 'percent-saar')
}

/** Projects only an FOMC release that already carries independently verified actual evidence. */
function isFedFomcDecisionRelease(revision: MacroCalendarRevision): boolean {
  return revision.providerId === 'macro-calendar-fed' && revision.eventFamily === 'fomc' &&
    revision.descriptorId === macroEconomicCalendarQueryPolicy.fedDecisionDescriptorId &&
    macroEconomicCalendarQueryPolicy.fedDecisionEventKeyPattern.test(revision.eventKey) &&
    revision.releaseGroupKey === revision.eventKey && revision.periodKey === revision.scheduledDate &&
    (revision.revisionKind === 'official-release' || revision.revisionKind === 'official-revision') &&
    revision.lifecycleState === 'released' && revision.actual !== undefined && revision.publishedAt !== undefined
}

function toPublicEvent(revision: MacroCalendarRevision, asOf: string, overrides: MacroCalendarReleaseTimeOverrides): MacroEconomicCalendarEventView {
  const officialReleaseDate = officialReleaseDateFor(revision, asOf)
  const edited = overrides.get(revision.eventKey)
  // The convention is anchored to the **published** date: moving a row to another day must not move
  // the expectation that belongs to the schedule the source actually announced.
  const releaseTime = resolveDisplayedReleaseTime({
    eventFamily: revision.eventFamily, scheduledDate: revision.scheduledDate,
    ...(revision.scheduledAt === undefined ? {} : { officialScheduledAt: revision.scheduledAt }),
    ...(edited === undefined ? {} : { userEditedAt: edited.scheduledAt })
  })
  return {
    eventKey: revision.eventKey, releaseGroupKey: revision.releaseGroupKey, eventFamily: revision.eventFamily,
    titleKey: revision.eventNameKey, countryCode: revision.countryCode, importance: revision.importance,
    periodKey: revision.periodKey, lifecycleState: revision.lifecycleState, coverage: 'available',
    // An edit carries its own date: if the reader moved the release to another day, the row says so.
    scheduledDate: edited?.scheduledDate ?? revision.scheduledDate,
    // The displayed instant may be a convention rather than a published time, so it never travels
    // without its provenance: `releaseTimeSource` says which of the three supplied it, and
    // `conventionScheduledAt` keeps our expectation visible even when something outranked it.
    ...(releaseTime.scheduledAt === undefined ? {} : { scheduledAt: releaseTime.scheduledAt }),
    releaseTimeSource: releaseTime.provenance,
    ...(releaseTime.conventionAt === undefined ? {} : { conventionScheduledAt: releaseTime.conventionAt }),
    ...(officialReleaseDate ? { officialReleaseDate } : {}), publishedAt: revision.publishedAt,
    detectedAt: revision.detectedAt, actual: revision.actual, previous: revision.previous,
    ...macroCalendarConsensusFallback,
    providerIds: [revision.providerId], caveats: [...revision.caveats]
  }
}

function officialReleaseDateFor(revision: MacroCalendarRevision, asOf: string): string | undefined {
  if (revision.lifecycleState !== macroEconomicCalendarQueryPolicy.officialReleaseDate.requiresLifecycleState || !revision.actual ||
    !isCanonicalDate(revision.scheduledDate) || revision.scheduledDate > asOf.slice(0, 10)) return undefined
  const admittedKind = macroEconomicCalendarQueryPolicy.officialReleaseDate.admittedRevisionKinds.includes(
    revision.revisionKind as typeof macroEconomicCalendarQueryPolicy.officialReleaseDate.admittedRevisionKinds[number]
  )
  return (admittedKind && (isFedFomcDecisionRelease(revision) || isBlsCalendarValue(revision) || revision.providerId === 'macro-calendar-bea')) ||
    (revision.revisionKind === 'schedule' && isBlsCalendarSchedule(revision))
    ? revision.scheduledDate
    : undefined
}

function isCanonicalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

function isCanonicalUtcMillis(value: unknown): value is string {
  if (typeof value !== 'string' || !macroEconomicCalendarQueryPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isMonthResultLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= macroEconomicCalendarQueryPolicy.monthResultLimit
}

function monthUnavailable(failureCode: Extract<MacroEconomicCalendarMonthResult, { state: 'unavailable' }>['failureCode']): MacroEconomicCalendarMonthResult {
  return { state: 'unavailable' as const, failureCode }
}

function eventUnavailable(failureCode: Extract<MacroEconomicCalendarEventResult, { state: 'unavailable' }>['failureCode']): MacroEconomicCalendarEventResult {
  return { state: 'unavailable' as const, failureCode }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
