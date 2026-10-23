import {
  economicCalendarEventCategory,
  economicCalendarEventLabelKey,
  type EconomicCalendarTitleKey
} from '../../features/macro/economic-calendar'
import { macroEconomicCalendarCaveatPolicy } from '../../shared/macroEconomicCalendarCaveatPolicy'
import { macroEconomicCalendarConsensusPolicy } from '../../shared/macroEconomicCalendarConsensusPolicy'

export const dashboardMacroReleaseDynamicsPolicy = {
  visibleEventLimit: 5,
  monthQueries: {
    orderedInvocation: ['current', 'previous-if-released-group-missing', 'next-if-upcoming-group-missing'],
    maximumCalls: 3,
    fallbackFailure: 'fail-closed-before-later-fallback'
  },
  acceptedCoverage: 'available',
  unavailableFailureCodes: ['query-input-invalid', 'calendar-query-unavailable'],
  timedCountdown: {
    rounding: 'floor-to-whole-hours',
    underOneHour: 'less-than-one-hour',
    millisecondsPerHour: 3_600_000
  },
  dateOnlyCountdown: {
    calendar: 'UTC',
    zeroDays: 'today',
    millisecondsPerDay: 86_400_000
  },
  releasedGroup: {
    dateField: 'officialReleaseDate',
    order: 'proven-publishedAt-first-then-eventKey'
  },
  eventFields: [
    'eventKey', 'releaseGroupKey', 'eventFamily', 'titleKey', 'countryCode', 'importance', 'periodKey', 'lifecycleState',
    'coverage', 'scheduledDate', 'scheduledAt', 'officialReleaseDate', 'publishedAt', 'detectedAt', 'actual', 'previous', 'consensus',
    'consensusState', 'surprise', 'providerIds', 'caveats'
  ],
  requiredEventFields: [
    'eventKey', 'releaseGroupKey', 'eventFamily', 'titleKey', 'countryCode', 'importance', 'periodKey', 'lifecycleState',
    'coverage', 'scheduledDate', 'detectedAt', 'consensus', 'consensusState', 'surprise', 'providerIds', 'caveats'
  ],
  providerIds: ['macro-calendar-fed', 'macro-calendar-bea', 'macro-calendar-bls'],
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  datePattern: /^\d{4}-\d{2}-\d{2}$/,
  monthPattern: /^\d{4}-(?:0[1-9]|1[0-2])$/
} as const

export const dashboardEconomicCalendarSourcePolicy = {
  sourceId: 'economic-calendar',
  sourceStates: ['loading', 'available', 'empty', 'unavailable'],
  actions: ['open-calendar', 'manage-macro-calendar-settings']
} as const

export type DashboardUpcomingCountdown =
  | { state: 'timed'; days: number; hours: number }
  | { state: 'less-than-one-hour' }
  | { state: 'today' }
  | { state: 'date-only'; days: number }

export type DashboardMacroUpcomingEvent = {
  labelKey: EconomicCalendarTitleKey
  scheduledDate: string
  scheduledAt?: string
}

export type DashboardMacroReleasedEvent = {
  labelKey: EconomicCalendarTitleKey
  actual: string
  previous?: string
}

export type DashboardMacroUpcomingGroup = {
  scheduledDate: string
  countdown: DashboardUpcomingCountdown
  events: DashboardMacroUpcomingEvent[]
  overflowCount: number
}

export type DashboardMacroReleasedGroup = {
  officialReleaseDate: string
  events: DashboardMacroReleasedEvent[]
  overflowCount: number
}

export type DashboardMacroReleaseDynamicsMonthSelection =
  | { state: 'available'; upcoming?: DashboardMacroUpcomingGroup; released?: DashboardMacroReleasedGroup }
  | { state: 'unavailable' }

export type DashboardMacroReleaseDynamicsState =
  | { state: 'loading' }
  | { state: 'available'; upcoming?: DashboardMacroUpcomingGroup; released?: DashboardMacroReleasedGroup }
  | { state: 'empty' }
  | { state: 'unavailable' }

export function selectDashboardMacroReleaseDynamicsMonth(input: unknown, query: { month: string; asOf: string }): DashboardMacroReleaseDynamicsMonthSelection {
  const { month, asOf } = query
  if (!isMonth(month) || !isCanonicalUtcMillis(asOf) || !isPlainDataRecord(input)) return { state: 'unavailable' }
  if (isExactFields(input, ['state', 'failureCode']) && input.state === 'unavailable' && isMonthFailureCode(input.failureCode)) return { state: 'unavailable' }
  if (!isExactFields(input, ['state', 'asOf', 'events']) || input.state !== 'available' || input.asOf !== asOf || !Array.isArray(input.events)) return { state: 'unavailable' }

  const candidates = input.events.map((event) => toDashboardCandidate(event, { month, asOf }))
  if (candidates.some((candidate) => candidate === 'malformed')) return { state: 'unavailable' }
  const safeCandidates = candidates.filter((candidate): candidate is DashboardCandidate => Boolean(candidate))
  const upcoming = selectUpcomingGroup(safeCandidates.filter((candidate) => candidate.lifecycleState === 'scheduled'), asOf)
  const released = selectReleasedGroup(safeCandidates.filter((candidate) => candidate.lifecycleState === 'released'))
  return { state: 'available', ...(upcoming ? { upcoming } : {}), ...(released ? { released } : {}) }
}

type DashboardCandidate = {
  eventKey: string
  labelKey: EconomicCalendarTitleKey
  lifecycleState: 'scheduled' | 'released'
  scheduledDate: string
  scheduledAt?: string
  officialReleaseDate?: string
  publishedAt?: string
  actual?: string
  previous?: string
}

function toDashboardCandidate(value: unknown, query: { month: string; asOf: string }): DashboardCandidate | 'malformed' | undefined {
  const { month, asOf } = query
  if (!isPlainDataRecord(value) || !hasOnlyFields(value, dashboardMacroReleaseDynamicsPolicy.eventFields) || !hasRequiredFields(value, dashboardMacroReleaseDynamicsPolicy.requiredEventFields)) return 'malformed'
  if (!isBoundedText(value.eventKey) || !isBoundedText(value.releaseGroupKey) || !isBoundedText(value.eventFamily) || !isBoundedText(value.titleKey) ||
    !isBoundedText(value.periodKey) || value.countryCode !== 'US' || value.importance !== 'high' || !isLifecycleState(value.lifecycleState) ||
    !isCoverage(value.coverage) || !isDate(value.scheduledDate) || !isCanonicalUtcMillis(value.detectedAt) || !isOptionalCanonicalUtcMillis(value.scheduledAt) ||
    !isOptionalDate(value.officialReleaseDate) || !isOptionalCanonicalUtcMillis(value.publishedAt) || !isValue(value.actual) || !isValue(value.previous) ||
    !isConsensus(value.consensus) || !macroEconomicCalendarConsensusPolicy.isState(value.consensusState) ||
    !macroEconomicCalendarConsensusPolicy.isSurprise(value.surprise) || !isProviderIds(value.providerIds) || !isCaveats(value.caveats)) return 'malformed'

  const category = economicCalendarEventCategory(value.eventFamily)
  const labelKey = economicCalendarEventLabelKey({ titleKey: value.titleKey })
  if (!value.scheduledDate.startsWith(month)) return 'malformed'
  if (value.detectedAt > asOf || value.coverage !== dashboardMacroReleaseDynamicsPolicy.acceptedCoverage || !category || labelKey === 'unknown') return undefined
  if (value.lifecycleState === 'scheduled' && !isEligibleUpcomingSchedule(value.scheduledDate, value.scheduledAt, asOf)) return undefined
  if (value.lifecycleState === 'released' && (!value.officialReleaseDate || value.officialReleaseDate > asOf.slice(0, 10) || !value.actual)) return undefined
  if (value.lifecycleState === 'cancelled') return undefined

  return {
    eventKey: value.eventKey,
    labelKey,
    lifecycleState: value.lifecycleState,
    scheduledDate: value.scheduledDate,
    ...(value.scheduledAt ? { scheduledAt: value.scheduledAt } : {}),
    ...(value.officialReleaseDate ? { officialReleaseDate: value.officialReleaseDate } : {}),
    ...(value.publishedAt ? { publishedAt: value.publishedAt } : {}),
    ...(value.actual ? { actual: value.actual.displayValue } : {}),
    ...(value.previous ? { previous: value.previous.displayValue } : {})
  }
}

function selectUpcomingGroup(candidates: DashboardCandidate[], asOf: string): DashboardMacroUpcomingGroup | undefined {
  const scheduledDate = candidates.map((candidate) => candidate.scheduledDate).sort()[0]
  if (!scheduledDate) return undefined
  const group = candidates.filter((candidate) => candidate.scheduledDate === scheduledDate).sort(compareUpcomingCandidates)
  const timed = group.find((candidate) => candidate.scheduledAt)
  return {
    scheduledDate,
    countdown: timed?.scheduledAt ? timedCountdown(timed.scheduledAt, asOf) : dateOnlyCountdown(scheduledDate, asOf),
    events: group.slice(0, dashboardMacroReleaseDynamicsPolicy.visibleEventLimit).map((candidate) => ({
      labelKey: candidate.labelKey,
      scheduledDate: candidate.scheduledDate,
      ...(candidate.scheduledAt ? { scheduledAt: candidate.scheduledAt } : {})
    })),
    overflowCount: group.length - Math.min(group.length, dashboardMacroReleaseDynamicsPolicy.visibleEventLimit)
  }
}

function selectReleasedGroup(candidates: DashboardCandidate[]): DashboardMacroReleasedGroup | undefined {
  const officialReleaseDate = candidates.map((candidate) => candidate.officialReleaseDate).filter((date): date is string => Boolean(date)).sort().at(-1)
  if (!officialReleaseDate) return undefined
  const group = candidates
    .filter((candidate) => candidate.officialReleaseDate === officialReleaseDate && candidate.actual)
    .sort(compareReleasedCandidates)
  return {
    officialReleaseDate,
    events: group.slice(0, dashboardMacroReleaseDynamicsPolicy.visibleEventLimit).map((candidate) => ({
      labelKey: candidate.labelKey,
      actual: candidate.actual!,
      ...(candidate.previous ? { previous: candidate.previous } : {})
    })),
    overflowCount: group.length - Math.min(group.length, dashboardMacroReleaseDynamicsPolicy.visibleEventLimit)
  }
}

function compareUpcomingCandidates(left: DashboardCandidate, right: DashboardCandidate): number {
  const leftTime = left.scheduledAt ?? ''
  const rightTime = right.scheduledAt ?? ''
  if (leftTime && rightTime) return `${leftTime}\n${left.eventKey}`.localeCompare(`${rightTime}\n${right.eventKey}`)
  if (leftTime) return -1
  if (rightTime) return 1
  return left.eventKey.localeCompare(right.eventKey)
}

function compareReleasedCandidates(left: DashboardCandidate, right: DashboardCandidate): number {
  if (left.publishedAt && right.publishedAt) {
    const byPublishedAt = left.publishedAt.localeCompare(right.publishedAt)
    return byPublishedAt || left.eventKey.localeCompare(right.eventKey)
  }
  if (left.publishedAt) return -1
  if (right.publishedAt) return 1
  return left.eventKey.localeCompare(right.eventKey)
}

function timedCountdown(scheduledAt: string, asOf: string): DashboardUpcomingCountdown {
  const remainingHours = Math.floor((Date.parse(scheduledAt) - Date.parse(asOf)) / dashboardMacroReleaseDynamicsPolicy.timedCountdown.millisecondsPerHour)
  if (remainingHours === 0) return { state: 'less-than-one-hour' }
  return { state: 'timed', days: Math.floor(remainingHours / 24), hours: remainingHours % 24 }
}

function dateOnlyCountdown(scheduledDate: string, asOf: string): DashboardUpcomingCountdown {
  const asOfDate = asOf.slice(0, 10)
  const days = (Date.parse(`${scheduledDate}T00:00:00.000Z`) - Date.parse(`${asOfDate}T00:00:00.000Z`)) / dashboardMacroReleaseDynamicsPolicy.dateOnlyCountdown.millisecondsPerDay
  return days === 0 ? { state: 'today' } : { state: 'date-only', days }
}

function isEligibleUpcomingSchedule(scheduledDate: string, scheduledAt: string | undefined, asOf: string): boolean {
  return scheduledAt ? scheduledAt >= asOf : scheduledDate >= asOf.slice(0, 10)
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => 'value' in descriptor)
}

function isExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return hasOnlyFields(value, fields) && hasRequiredFields(value, fields)
}

function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.getOwnPropertyNames(value).every((field) => fields.includes(field)) && Object.getOwnPropertySymbols(value).length === 0
}

function hasRequiredFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => Object.hasOwn(value, field))
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160
}

function isCanonicalUtcMillis(value: unknown): value is string {
  if (typeof value !== 'string' || !dashboardMacroReleaseDynamicsPolicy.canonicalUtcMillisPattern.test(value)) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isOptionalCanonicalUtcMillis(value: unknown): value is string | undefined {
  return value === undefined || isCanonicalUtcMillis(value)
}

function isOptionalDate(value: unknown): value is string | undefined {
  return value === undefined || isDate(value)
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && dashboardMacroReleaseDynamicsPolicy.datePattern.test(value) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

function isLifecycleState(value: unknown): value is 'scheduled' | 'released' | 'cancelled' {
  return value === 'scheduled' || value === 'released' || value === 'cancelled'
}

/** The contract admits a real market consensus; this boundary therefore checks the shape. */
function isConsensus(value: unknown): boolean {
  return value === null || (isPlainDataRecord(value) && isValue(value))
}

function isCoverage(value: unknown): boolean {
  return value === 'available' || value === 'partial' || value === 'unavailable'
}

function isValue(value: unknown): value is { displayValue: string } | undefined {
  return value === undefined || (isPlainDataRecord(value) && hasOnlyFields(value, ['displayValue', 'numericValue', 'numericLowerBound', 'numericUpperBound', 'unit']) &&
    hasRequiredFields(value, ['displayValue']) && isBoundedText(value.displayValue) &&
    (value.numericValue === undefined || (typeof value.numericValue === 'number' && Number.isFinite(value.numericValue))) &&
    (value.numericLowerBound === undefined || (typeof value.numericLowerBound === 'number' && Number.isFinite(value.numericLowerBound))) &&
    (value.numericUpperBound === undefined || (typeof value.numericUpperBound === 'number' && Number.isFinite(value.numericUpperBound))) &&
    ((value.numericLowerBound === undefined && value.numericUpperBound === undefined) ||
      (value.numericLowerBound !== undefined && value.numericUpperBound !== undefined && value.numericLowerBound < value.numericUpperBound)) &&
    (value.unit === undefined || isBoundedText(value.unit)))
}

function isProviderIds(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((providerId) =>
    typeof providerId === 'string' && (dashboardMacroReleaseDynamicsPolicy.providerIds as readonly string[]).includes(providerId)
  )
}

function isCaveats(value: unknown): boolean {
  return Array.isArray(value) && value.every((caveat) =>
    macroEconomicCalendarCaveatPolicy.isAdmitted(caveat)
  )
}

function isMonthFailureCode(value: unknown): boolean {
  return (dashboardMacroReleaseDynamicsPolicy.unavailableFailureCodes as readonly string[]).includes(value as string)
}

function isMonth(value: string): boolean {
  return dashboardMacroReleaseDynamicsPolicy.monthPattern.test(value)
}
