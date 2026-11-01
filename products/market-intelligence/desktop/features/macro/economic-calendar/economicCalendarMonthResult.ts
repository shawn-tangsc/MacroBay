import type { MacroEconomicCalendarEventView } from '../../../../contracts/macro/economicCalendarQueryContracts'
import { macroEconomicCalendarCaveatPolicy } from '../../../shared/macroEconomicCalendarCaveatPolicy'
import { createEconomicCalendarProjection, isReleaseTimeSource, type EconomicCalendarEventView, type EconomicCalendarProjection } from './economicCalendarModel'
import type { EconomicCalendarText } from './economicCalendarText'

/** Bounds one month read, and names the verdict the page shows when it produced nothing. */
export const economicCalendarMonthLoadingPolicy = {
  budgetMs: 15_000,
  unavailableFailureCode: 'calendar-query-unavailable'
} as const

export type EconomicCalendarMonthFailure = keyof EconomicCalendarText['failures']

/** One month's own read, before a grid window composes it with its neighbours. */
export type EconomicCalendarMonthRead =
  | { state: 'unavailable'; failureCode: EconomicCalendarMonthFailure }
  | { state: 'available'; projection: EconomicCalendarProjection }

/**
 * Validate one month page and project it.
 *
 * The wire is not trusted: an as-of that does not match the query, an event array with the
 * wrong shape, or a failure code outside the vocabulary all mean "this month could not be read",
 * never "draw what we got".
 */
export function toMonthState(result: unknown, query: { month: string; asOf: string }): EconomicCalendarMonthRead {
  try {
    if (isExactRecord(result, ['state', 'failureCode']) && result.state === 'unavailable' && isMonthFailureCode(result.failureCode)) {
      return { state: 'unavailable', failureCode: result.failureCode }
    }
    if (!isExactRecord(result, ['state', 'asOf', 'events']) || result.state !== 'available' || result.asOf !== query.asOf || !isExactEventArray(result.events, query.asOf)) {
      return { state: 'unavailable', failureCode: economicCalendarMonthLoadingPolicy.unavailableFailureCode }
    }
    return { state: 'available', projection: createEconomicCalendarProjection({ month: query.month, asOf: query.asOf, events: result.events }) }
  } catch {
    return { state: 'unavailable', failureCode: economicCalendarMonthLoadingPolicy.unavailableFailureCode }
  }
}

/**
 * Validate one event detail result.
 *
 * The detail is projected in the event's own month, not in the month the page is named after:
 * the grid draws its neighbouring months too, so an event on the grid's edge is still its own day.
 */
export function toDetailEvent(result: unknown, eventKey: string, asOf: string): EconomicCalendarEventView | undefined {
  try {
    if (!isExactRecord(result, ['state', 'asOf', 'event']) || result.state !== 'available' || result.asOf !== asOf || !isExactEvent(result.event, asOf)) return undefined
    const projection = createEconomicCalendarProjection({ month: result.event.scheduledDate.slice(0, 7), asOf, events: [result.event] })
    return projection.events[0]?.eventKey === eventKey ? projection.events[0] : undefined
  } catch {
    return undefined
  }
}

function isMonthFailureCode(value: unknown): value is EconomicCalendarMonthFailure {
  return value === 'query-input-invalid' || value === 'calendar-query-unavailable'
}

function isExactEventArray(value: unknown, asOf: string): value is readonly MacroEconomicCalendarEventView[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) return false
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
    const names = Object.getOwnPropertyNames(value)
    return Number.isSafeInteger(length) && names.length === length + 1 && names.every((name) => name === 'length' || /^(?:0|[1-9]\d*)$/.test(name)) &&
      Array.from({ length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index))).every((descriptor) => descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') && isExactEvent(descriptor.value, asOf))
  } catch {
    return false
  }
}

function isExactEvent(value: unknown, asOf: string): value is MacroEconomicCalendarEventView {
  const required = [
    'eventKey', 'releaseGroupKey', 'eventFamily', 'titleKey', 'countryCode', 'importance', 'periodKey', 'lifecycleState',
    'coverage', 'scheduledDate', 'detectedAt', 'consensus', 'consensusState', 'surprise', 'providerIds', 'caveats'
  ]
  // `releaseTimeSource` is optional here although the contract requires it: main always sends it, but a
  // payload from a main process that predates it must still draw — making it required here blanked the
  // detail pane. A missing source means neither a convention nor an edit is on record, so it is
  // normalised to the published-time case rather than rejected.
  const optional = ['scheduledAt', 'releaseTimeSource', 'conventionScheduledAt', 'officialReleaseDate', 'publishedAt', 'actual', 'previous']
  if (!isExactRecord(value, [...required, ...optional], required)) return false
  return isBoundedText(value.eventKey) && isBoundedText(value.releaseGroupKey) && isBoundedText(value.eventFamily) && isBoundedText(value.titleKey) &&
    isBoundedText(value.periodKey) && value.countryCode === 'US' && value.importance === 'high' && isLifecycleState(value.lifecycleState) &&
    isCoverage(value.coverage) && isDate(value.scheduledDate) && isCanonicalUtcMillis(value.detectedAt) && value.detectedAt <= asOf &&
    value.consensus === null && value.consensusState === 'unavailable' && value.surprise === 'consensus-unavailable' &&
    isExactStringArray(value.providerIds, ['macro-calendar-fed', 'macro-calendar-bea', 'macro-calendar-bls'], 1) &&
    isExactStringArray(value.caveats, macroEconomicCalendarCaveatPolicy.admittedCaveats) &&
    (value.releaseTimeSource === undefined || isReleaseTimeSource(value.releaseTimeSource)) &&
    isOptionalCanonicalUtcMillis(value.scheduledAt) && isOptionalDate(value.officialReleaseDate) && isOptionalCanonicalUtcMillis(value.publishedAt) && isOptionalValue(value.actual) && isOptionalValue(value.previous)
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160
}

function isCanonicalUtcMillis(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const timestamp = Date.parse(value)
  const date = new Date(timestamp)
  return Number.isFinite(timestamp) && `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}.${String(date.getUTCMilliseconds()).padStart(3, '0')}Z` === value
}

function isOptionalCanonicalUtcMillis(value: unknown): boolean {
  return value === undefined || isCanonicalUtcMillis(value)
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}` === value
}

function isOptionalDate(value: unknown): boolean {
  return value === undefined || isDate(value)
}

function isLifecycleState(value: unknown): boolean {
  return value === 'scheduled' || value === 'released' || value === 'cancelled'
}

function isCoverage(value: unknown): boolean {
  return value === 'available' || value === 'partial' || value === 'unavailable'
}

function isOptionalValue(value: unknown): boolean {
  return value === undefined || (isExactRecord(value, ['displayValue', 'numericValue', 'numericLowerBound', 'numericUpperBound', 'unit'], ['displayValue']) && typeof value.displayValue === 'string' &&
    (value.numericValue === undefined || (typeof value.numericValue === 'number' && Number.isFinite(value.numericValue))) &&
    (value.numericLowerBound === undefined || (typeof value.numericLowerBound === 'number' && Number.isFinite(value.numericLowerBound))) &&
    (value.numericUpperBound === undefined || (typeof value.numericUpperBound === 'number' && Number.isFinite(value.numericUpperBound))) &&
    ((value.numericLowerBound === undefined && value.numericUpperBound === undefined) ||
      (value.numericLowerBound !== undefined && value.numericUpperBound !== undefined && value.numericLowerBound < value.numericUpperBound)) &&
    (value.unit === undefined || isBoundedText(value.unit)))
}

function isExactStringArray(value: unknown, allowed: readonly string[], minimumLength = 0): boolean {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) return false
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
    const names = Object.getOwnPropertyNames(value)
    const values = Array.from({ length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
    return Number.isSafeInteger(length) && length >= minimumLength && names.length === length + 1 && names.every((name) => name === 'length' || /^(?:0|[1-9]\d*)$/.test(name)) &&
      values.every((descriptor) => descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' && allowed.includes(descriptor.value)) &&
      new Set(values.map((descriptor) => descriptor?.value)).size === length
  } catch {
    return false
  }
}

function isExactRecord(value: unknown, allowed: readonly string[], required = allowed): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return false
    const names = Object.getOwnPropertyNames(value)
    return names.every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key)) && names.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return Boolean(descriptor && Object.hasOwn(descriptor, 'value'))
    })
  } catch {
    return false
  }
}
