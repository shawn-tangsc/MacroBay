// Product-owned public boundary for design 122. No storage/provider-native identities.
export const marketCalendarPublicPolicy = Object.freeze({
  maximumEvents: 100, pageBytes: 256 * 1024, eventBytes: 8 * 1024, textCharacters: 512, textBytes: 1024,
  /** Bound on the stable observation identity a projection may carry. */
  maximumObservationKeyChars: 256,
  monthPattern: /^\d{4}-(?:0[1-9]|1[0-2])$/,
  instantPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  opaquePattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  kinds: ['economic-indicator', 'financial-event', 'central-bank-activity'],
  importance: ['high', 'medium', 'low'], countryCodePattern: /^[A-Z]{2,3}$/, forbiddenCountryCodes: ['ZZ'],
  statuses: ['success', 'success-empty', 'all-skipped', 'partial', 'unavailable'],
  /** Batch-level verdicts. `storage-pressure` is a refused write (the shared calendar is full),
   *  not a transport failure, so a reader can tell "wait" from "storage is down". */
  refreshFailures: ['input-invalid', 'disabled', 'credential-not-configured', 'readiness-unavailable', 'busy', 'storage-unavailable', 'storage-pressure'],
  /** The verdicts and origins one individual source attempt may carry. */
  attemptFailures: ['input-invalid', 'credential-not-configured', 'response-unavailable',
    'archive-unavailable', 'parse-unavailable', 'storage-unavailable', 'storage-pressure'],
  attemptTriggers: ['manual', 'automatic'],
  descriptors: ['macro-calendar-0xrouter-economic-data', 'macro-calendar-0xrouter-financial-events', 'macro-calendar-0xrouter-central-bank-activities'],
  methods: { refresh: 'intelligence.macro.marketCalendar.refreshManual', query: 'intelligence.macro.marketCalendar.queryMonth' }
} as const)
export type MarketCalendarScope = Readonly<{ month: string; locale: 'zh' | 'en' }>
export type MarketCalendarQuery = MarketCalendarScope & Readonly<{ asOf: string; cursor?: string }>
export type MarketCalendarValue = Readonly<{ displayValue: string }> | null
// Query-only link, never a promotion of the provider observation's revision identity.
export type MarketCalendarOfficialLink = Readonly<{
  officialEventKey: string; officialPeriodKey: string; officialScheduledDate: string
  officialScheduledAt: string | null; officialDetectedAt: string
  timeDisplaySource: 'official-scheduled' | 'provider-scheduled' | 'date-only'
  displayScheduledAt: string | null
  officialActual: Readonly<{ displayValue: string }> | null
  officialPrevious: Readonly<{ displayValue: string }> | null
}>
export type MarketCalendarEvent = Readonly<{
  eventKey: string; title: string; countryCode: string | null; countryName?: string
  /**
   * Stable identity of the underlying observation.
   *
   * `eventKey` is an HMAC of the per-batch `observation_id`, so it changes on every
   * collection and cannot identify the same event across refreshes. This key comes
   * from the stored `market_fact_key`, which is verified stable across batches, so a
   * consumer that needs to track an event over time (the analysis facts) can rely on
   * it. Optional on the wire: a service that does not supply it keeps working.
   */
  observationKey?: string
  eventType: typeof marketCalendarPublicPolicy.kinds[number]; importance: typeof marketCalendarPublicPolicy.importance[number]
  scheduledAt: string; consensus: MarketCalendarValue; providerPrevious: MarketCalendarValue; providerActual: MarketCalendarValue
  source: '0xRouter'; sourceObservedAt: string; coverage: 'observed-unverified'
  officialLink?: MarketCalendarOfficialLink
}>
/**
 * The most recent refresh attempt for one source, whichever path ran it.
 *
 * `failureCode` and `trigger` are optional so a service that only knows "failed at T"
 * keeps working. They exist because an automatic run that was refused by the shared
 * calendar ceiling is invisible otherwise: the page can show stale data and look like
 * the source simply has not published yet.
 */
export type MarketCalendarRefreshAttempt = Readonly<{ state: 'succeeded' | 'failed'; attemptedAt: string
  failureCode?: typeof marketCalendarPublicPolicy.attemptFailures[number]
  trigger?: typeof marketCalendarPublicPolicy.attemptTriggers[number] }>
export type MarketCalendarSource = Readonly<{ eventType: MarketCalendarEvent['eventType']; status: typeof marketCalendarPublicPolicy.statuses[number]; sourceObservedAt: string | null;
  latestAttempt?: MarketCalendarRefreshAttempt }>
export type MarketCalendarPage = Readonly<{ state: 'available'; month: string; locale: 'zh' | 'en'; asOf: string;
  events: readonly MarketCalendarEvent[]; sources: readonly MarketCalendarSource[]; nextCursor?: string }> |
  Readonly<{ state: 'unavailable'; failureCode: 'input-invalid' | 'query-unavailable' }>
export type MarketCalendarRefreshResult = Readonly<{ state: 'completed' | 'partial' | 'unavailable';
  sources: readonly MarketCalendarSource[]; failureCode?: typeof marketCalendarPublicPolicy.refreshFailures[number] }>

export function marketExact(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false
    const keys = Reflect.ownKeys(value)
    return required.every(key => keys.includes(key)) && keys.every(key => typeof key === 'string' &&
      (required.includes(key) || optional.includes(key)) && 'value' in Object.getOwnPropertyDescriptor(value, key)!)
  } catch { return false }
}
export function marketInstant(value: unknown): value is string {
  return typeof value === 'string' && marketCalendarPublicPolicy.instantPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function scope(value: Record<string, unknown>): boolean {
  return typeof value.month === 'string' && marketCalendarPublicPolicy.monthPattern.test(value.month) && (value.locale === 'zh' || value.locale === 'en')
}
export function isMarketCalendarScope(value: unknown): value is MarketCalendarScope {
  return marketExact(value, ['month', 'locale']) && scope(value)
}
export function isMarketCalendarQuery(value: unknown): value is MarketCalendarQuery {
  return marketExact(value, ['month', 'locale', 'asOf'], ['cursor']) && scope(value) && marketInstant(value.asOf) &&
    (!Object.hasOwn(value, 'cursor') || typeof value.cursor === 'string' && marketCalendarPublicPolicy.opaquePattern.test(value.cursor))
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= marketCalendarPublicPolicy.textCharacters &&
    new TextEncoder().encode(value).length <= marketCalendarPublicPolicy.textBytes && !/[\u0000-\u001f\u007f]/u.test(value)
}
function display(value: unknown): value is MarketCalendarValue {
  return value === null || marketExact(value, ['displayValue']) && text(value.displayValue) && !['-', '--', '—', 'n/a', 'null'].includes(value.displayValue.toLowerCase())
}
export function isMarketCalendarOfficialLink(value: unknown, providerScheduledAt?: string): value is MarketCalendarOfficialLink {
  if (!marketExact(value, ['officialEventKey', 'officialPeriodKey', 'officialScheduledDate', 'officialScheduledAt',
    'officialDetectedAt', 'timeDisplaySource', 'displayScheduledAt']) || !text(value.officialEventKey) ||
    !text(value.officialPeriodKey) || !marketInstant(value.officialDetectedAt) ||
    typeof value.officialScheduledDate !== 'string' || !marketInstant(`${value.officialScheduledDate}T00:00:00.000Z`)) return false
  if (value.timeDisplaySource === 'official-scheduled') return marketInstant(value.officialScheduledAt) && value.displayScheduledAt === value.officialScheduledAt
  if (value.officialScheduledAt !== null) return false
  if (value.timeDisplaySource === 'provider-scheduled') return marketInstant(providerScheduledAt) && value.displayScheduledAt === providerScheduledAt
  return value.timeDisplaySource === 'date-only' && value.displayScheduledAt === null && providerScheduledAt === undefined
}
export function isMarketCalendarEvent(value: unknown): value is MarketCalendarEvent {
  return marketExact(value, ['eventKey', 'title', 'countryCode', 'eventType', 'importance', 'scheduledAt', 'consensus',
    'providerPrevious', 'providerActual', 'source', 'sourceObservedAt', 'coverage'], ['officialLink', 'countryName', 'observationKey']) &&
    (!Object.hasOwn(value, 'observationKey') || (typeof value.observationKey === 'string' && value.observationKey.length > 0 && value.observationKey.length <= marketCalendarPublicPolicy.maximumObservationKeyChars)) &&
    typeof value.eventKey === 'string' && marketCalendarPublicPolicy.opaquePattern.test(value.eventKey) && text(value.title) &&
    (value.countryCode === null || typeof value.countryCode === 'string' && marketCalendarPublicPolicy.countryCodePattern.test(value.countryCode) && !(marketCalendarPublicPolicy.forbiddenCountryCodes as readonly string[]).includes(value.countryCode)) &&
    (!Object.hasOwn(value, 'countryName') || text(value.countryName)) &&
    marketCalendarPublicPolicy.kinds.includes(value.eventType as never) && marketCalendarPublicPolicy.importance.includes(value.importance as never) &&
    marketInstant(value.scheduledAt) && marketInstant(value.sourceObservedAt) && value.source === '0xRouter' && value.coverage === 'observed-unverified' &&
    [value.consensus, value.providerPrevious, value.providerActual].every(display) &&
    (value.eventType === 'economic-indicator' || [value.consensus, value.providerPrevious, value.providerActual].every(item => item === null)) &&
    (!Object.hasOwn(value, 'officialLink') || value.eventType === 'economic-indicator' &&
      isMarketCalendarOfficialLink(value.officialLink, value.scheduledAt as string)) &&
    new TextEncoder().encode(JSON.stringify(value)).length <= marketCalendarPublicPolicy.eventBytes
}
function refreshAttempt(value: unknown): value is MarketCalendarRefreshAttempt {
  return marketExact(value, ['state', 'attemptedAt'], ['failureCode', 'trigger']) &&
    ['succeeded', 'failed'].includes(value.state as string) && marketInstant(value.attemptedAt) &&
    // A reason belongs to a failure, and only to a verdict this boundary can name.
    (!Object.hasOwn(value, 'failureCode') || value.state === 'failed' &&
      marketCalendarPublicPolicy.attemptFailures.includes(value.failureCode as never)) &&
    (!Object.hasOwn(value, 'trigger') || marketCalendarPublicPolicy.attemptTriggers.includes(value.trigger as never))
}
function source(value: unknown): value is MarketCalendarSource {
  return marketExact(value, ['eventType', 'status', 'sourceObservedAt'], ['latestAttempt']) && marketCalendarPublicPolicy.kinds.includes(value.eventType as never) &&
    marketCalendarPublicPolicy.statuses.includes(value.status as never) &&
    (!Object.hasOwn(value, 'latestAttempt') || refreshAttempt(value.latestAttempt)) &&
    (value.status === 'unavailable' ? value.sourceObservedAt === null : marketInstant(value.sourceObservedAt))
}
function safeArray<T>(value: unknown, item: (value: unknown) => value is T): value is readonly T[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false
    const keys = Reflect.ownKeys(value)
    if (!keys.includes('length') || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^\d+$/.test(key)))) return false
    const length = value.length
    if (keys.length !== length + 1) return false
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || !descriptor.writable || !descriptor.configurable || !item(descriptor.value)) return false
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    return Boolean(lengthDescriptor && 'value' in lengthDescriptor && lengthDescriptor.value === length)
  } catch { return false }
}
export function isMarketCalendarPage(value: unknown, query: MarketCalendarQuery): value is MarketCalendarPage {
  if (marketExact(value, ['state', 'failureCode']) && value.state === 'unavailable') return value.failureCode === 'input-invalid' || value.failureCode === 'query-unavailable'
  return marketExact(value, ['state', 'month', 'locale', 'asOf', 'events', 'sources'], ['nextCursor']) && value.state === 'available' &&
    value.month === query.month && value.locale === query.locale && value.asOf === query.asOf &&
    safeArray(value.events, isMarketCalendarEvent) && value.events.length <= marketCalendarPublicPolicy.maximumEvents && value.events.every(item =>
      isMarketCalendarEvent(item) && item.sourceObservedAt <= query.asOf && item.scheduledAt.startsWith(query.month + '-')) &&
    safeArray(value.sources, source) && value.sources.length === marketCalendarPublicPolicy.kinds.length && value.sources.every((item, i) =>
      source(item) && item.eventType === marketCalendarPublicPolicy.kinds[i] && (!item.sourceObservedAt || item.sourceObservedAt <= query.asOf) &&
      (!item.latestAttempt || item.latestAttempt.attemptedAt <= query.asOf)) &&
    (!Object.hasOwn(value, 'nextCursor') || typeof value.nextCursor === 'string' && marketCalendarPublicPolicy.opaquePattern.test(value.nextCursor)) &&
    new TextEncoder().encode(JSON.stringify(value)).length <= marketCalendarPublicPolicy.pageBytes
}
export function isMarketCalendarRefreshResult(value: unknown): value is MarketCalendarRefreshResult {
  return marketExact(value, ['state', 'sources'], ['failureCode']) && ['completed', 'partial', 'unavailable'].includes(value.state as string) &&
    safeArray(value.sources, source) && (value.sources.length === 0 && value.state === 'unavailable' ||
      value.sources.length === marketCalendarPublicPolicy.kinds.length && value.sources.every((item, i) => source(item) && item.eventType === marketCalendarPublicPolicy.kinds[i])) &&
    (!Object.hasOwn(value, 'failureCode') || marketCalendarPublicPolicy.refreshFailures.includes(value.failureCode as never))
}
