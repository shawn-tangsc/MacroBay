import {
  requestZeroXRouterCalendarJsonBody,
  type ZeroXRouterBodyTransportResult
} from '../../application/zeroXRouterHttpTransport'
import { createSourceRequestGovernanceQueue } from '../../application/sourceRequestGovernance'
import {
  isSafeZeroXRouterApiKey,
  calendarMonthResponseBudgetPolicy,
  zeroXRouterCalendarEvidenceAdmissionPolicy,
  zeroXRouterCalendarTransportPolicy,
  zeroXRouterHttpTransportPolicy,
  zeroXRouterSourcePolicy
} from '../../application/zeroXRouterSourcePolicy'

type DescriptorId = keyof typeof zeroXRouterCalendarTransportPolicy.descriptorPaths
type Locale = (typeof zeroXRouterCalendarTransportPolicy.locales)[number]
type RequestIntent = 'automatic' | 'user'
type CalendarRequest = Readonly<{ descriptorId: DescriptorId; month: string; locale: Locale }>
export type CalendarCollectionOutcome =
  | Readonly<{ state: 'succeeded'; status: 'success' | 'success-empty' | 'all-skipped' | 'partial'; inputRows: number; skippedRows: number; storedRows: number }>
  | Readonly<{ state: 'unavailable'; failureCode: 'archive-unavailable' | 'parse-unavailable' | 'storage-unavailable' | 'storage-pressure' }>
/** Consumer verdicts this seam is allowed to forward verbatim; anything else is not proved safe to name. */
export const calendarCollectionFailurePolicy = Object.freeze({
  forwarded: ['archive-unavailable', 'parse-unavailable', 'storage-unavailable', 'storage-pressure'] as const
})
export type CalendarAcceptedResponse = CalendarRequest & Readonly<{
  body: string; status: number; contentType: string; acceptedBytes: number; detectedAt: string
}>
type CalendarTransportResult =
  | Readonly<{ state: 'succeeded'; descriptorId: DescriptorId; month: string; locale: Locale; acceptedBytes: number; collection?: Extract<CalendarCollectionOutcome, { state: 'succeeded' }> }>
  | Readonly<{ state: 'unavailable'; failureCode: 'input-invalid' | 'credential-not-configured' | 'response-unavailable' | Extract<CalendarCollectionOutcome, { state: 'unavailable' }>['failureCode'] }>

const manualInputKeys = Object.freeze(['descriptorId', 'month', 'locale'])

// Calendar-owned waiting budget, changed only through product acceptance.
// Holds one six-item batch plus manual work; overflow fails closed. This is not a quota.
const calendarLocalSchedulingPolicy = Object.freeze({ maximumPendingRequests: 10 })
type PendingRequest = {
  key: string
  input: CalendarRequest
  intent: RequestIntent
  promise: Promise<CalendarTransportResult>
  resolve: (result: CalendarTransportResult) => void
}

export function createZeroXRouterCalendarTransport(deps: Readonly<{
  requestGovernanceQueue: ReturnType<typeof createSourceRequestGovernanceQueue>
  getApiKey: () => Promise<string | undefined>
  requestJsonBody?: (input: Readonly<{ url: string; apiKey: string }>) => Promise<ZeroXRouterBodyTransportResult>
  now?: () => Date
  consumeAcceptedResponse?: (input: CalendarAcceptedResponse) => Promise<CalendarCollectionOutcome | void>
}>) {
  const inFlight = new Map<string, PendingRequest>()
  const pending: PendingRequest[] = []
  let draining = false
  // One in-flight batch per requested descriptor set. A single shared promise made two
  // feeds' concurrent ticks read the first feed's results, so their own source was never
  // requested and was reported failed.
  const automaticBatches = new Map<string, Promise<CalendarAutomaticBatch>>()
  // Months that already came back with a successful collection, so a tick does not ask again.
  const prefetchedMonths = new Set<string>()
  const requestBody = deps.requestJsonBody ?? requestZeroXRouterCalendarJsonBody

  function request(input: CalendarRequest, intent: RequestIntent): Promise<CalendarTransportResult> {
    if (!isCalendarRequest(input)) return Promise.resolve(unavailable('input-invalid'))
    const key = `${input.descriptorId}\n${input.month}\n${input.locale}`
    const existing = inFlight.get(key)
    if (existing) {
      if (intent === 'user' && pending.includes(existing)) existing.intent = 'user'
      return existing.promise
    }
    if (pending.length >= calendarLocalSchedulingPolicy.maximumPendingRequests) {
      return Promise.resolve(unavailable('response-unavailable'))
    }
    let resolve!: PendingRequest['resolve']
    const promise = new Promise<CalendarTransportResult>((done) => { resolve = done })
    const entry = { key, input: { ...input }, intent, promise, resolve }
    inFlight.set(key, entry)
    pending.push(entry)
    void drain()
    return promise
  }

  async function drain(): Promise<void> {
    if (draining) return
    draining = true
    while (pending.length > 0) {
      // Select after credential resolution: all work still local can be promoted.
      let apiKey: string | undefined
      try { apiKey = await deps.getApiKey() } catch { apiKey = undefined }
      const manualIndex = pending.findIndex((entry) => entry.intent === 'user')
      const entry = pending.splice(manualIndex < 0 ? 0 : manualIndex, 1)[0]!
      let result: CalendarTransportResult
      try {
        // Await completion before submitting the next item; shared FIFO work is untouched.
        result = await collect(entry.input, entry.intent, apiKey)
      } catch {
        result = unavailable('response-unavailable')
      }
      inFlight.delete(entry.key)
      entry.resolve(result)
    }
    draining = false
  }

  async function collect(input: CalendarRequest, intent: RequestIntent, apiKey: string | undefined): Promise<CalendarTransportResult> {
    if (!isSafeZeroXRouterApiKey(apiKey)) return unavailable('credential-not-configured')
    let result: ZeroXRouterBodyTransportResult
    let detectedAt: string | undefined
    try {
      result = await deps.requestGovernanceQueue.enqueue({
        sourceId: zeroXRouterSourcePolicy.sourceId,
        policy: zeroXRouterSourcePolicy.requestGovernance,
        apiKey,
        intent,
        run: async () => {
          const response = await requestBody({ url: requestUrl(input), apiKey })
          detectedAt = (deps.now?.() ?? new Date()).toISOString()
          return response
        }
      })
    } catch {
      return unavailable('response-unavailable')
    }
    if (result.state === 'failed' || !isAcceptedResponse(result)) return unavailable('response-unavailable')
    const outcome = await deps.consumeAcceptedResponse?.({ ...input, body: result.body, status: result.status,
      contentType: result.contentType, acceptedBytes: result.acceptedBytes, detectedAt: detectedAt! })
    if (outcome?.state === 'unavailable') {
      // A refused write keeps its own name: the panel reads this verdict to say "storage
      // limited" instead of "the source did not answer".
      return unavailable((calendarCollectionFailurePolicy.forwarded as readonly string[]).includes(outcome.failureCode)
        ? outcome.failureCode : 'response-unavailable')
    }
    return {
      state: 'succeeded', descriptorId: input.descriptorId, month: input.month,
      locale: input.locale, acceptedBytes: result.acceptedBytes,
      ...(outcome?.state === 'succeeded' ? { collection: { state: outcome.state, status: outcome.status,
        inputRows: outcome.inputRows, skippedRows: outcome.skippedRows, storedRows: outcome.storedRows } } : {})
    }
  }

  return Object.freeze({
    requestManual(input: CalendarRequest): Promise<CalendarTransportResult> {
      if (!hasOnlyKeys(input, manualInputKeys)) return Promise.resolve(unavailable('input-invalid'))
      return request(input, 'user')
    },
    requestAutomatic(descriptorIds?: readonly DescriptorId[]): Promise<CalendarAutomaticBatch> {
      const now = deps.now?.() ?? new Date()
      const selected = descriptorIds ?? Object.keys(zeroXRouterCalendarTransportPolicy.descriptorPaths) as DescriptorId[]
      const key = selected.join('\n')
      const existing = automaticBatches.get(key)
      if (existing) return existing
      const scopes = automaticScopes(selected, now, prefetchedMonths)
      const batch: Promise<CalendarAutomaticBatch> = Promise.all(scopes.map((scope) => request(scope, 'automatic')))
        .then((results) => {
          const current = zeroXRouterCalendarAutomaticMonth(now)
          results.forEach((result, index) => {
            const scope = scopes[index]!
            if (scope.month === current || result.state !== 'succeeded') return
            prefetchedMonths.add(prefetchKey(scope.month, scope.descriptorId))
          })
          return { scopes, results }
        })
        .finally(() => { automaticBatches.delete(key) })
      automaticBatches.set(key, batch)
      return batch
    }
  })
}

/**
 * Which (month, descriptor, locale) rows one automatic tick asks for.
 *
 * Always the current UTC month. When the month is about to end, the hour's own
 * feed also prefetches the next UTC month once; a later tick skips it until that
 * month has one successful collection. The rotation keeps the extra work at two
 * requests, inside the ten-per-minute budget the three feeds already share, and
 * never asks for three months at once (design 164 §5.1).
 */
export const zeroXRouterCalendarAutomaticPolicy = Object.freeze({
  /** Days before the end of the UTC month from which the next month is prefetched. */
  prefetchWindowDays: 3,
  /** One feed owns the prefetch for a whole UTC hour, then the next one takes over. */
  prefetchRotationHours: 1
})

export type CalendarAutomaticScope = Readonly<{ descriptorId: DescriptorId; month: string; locale: Locale }>
export type CalendarAutomaticBatch = Readonly<{
  scopes: readonly CalendarAutomaticScope[]
  results: readonly CalendarTransportResult[]
}>

function automaticScopes(
  selected: readonly DescriptorId[], now: Date, prefetched: ReadonlySet<string>
): readonly CalendarAutomaticScope[] {
  const current = zeroXRouterCalendarAutomaticMonth(now)
  const prefetch = zeroXRouterCalendarPrefetchMonth(now)
  const owner = zeroXRouterCalendarPrefetchOwner(now)
  return selected.flatMap((descriptorId) => {
    const months = prefetch !== undefined && descriptorId === owner && !prefetched.has(prefetchKey(prefetch, descriptorId))
      ? [current, prefetch] : [current]
    return months.flatMap((month) => zeroXRouterCalendarTransportPolicy.locales.map((locale) => ({ descriptorId, month, locale })))
  })
}

function prefetchKey(month: string, descriptorId: DescriptorId): string {
  return `${month}\n${descriptorId}`
}

/**
 * The one UTC month an automatic tick covers (design 118:206).
 *
 * One owner for the derivation: the transport requests it and the runtime keys the
 * automatic attempt record by it, so a displayed verdict cannot point at another month.
 */
export function zeroXRouterCalendarAutomaticMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The UTC month an automatic tick may prefetch, or undefined outside the end-of-month window. */
export function zeroXRouterCalendarPrefetchMonth(now: Date): string | undefined {
  const policy = zeroXRouterCalendarAutomaticPolicy
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  if (now.getUTCDate() < daysInMonth - policy.prefetchWindowDays + 1) return undefined
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return zeroXRouterCalendarAutomaticMonth(next)
}

/**
 * The feed that owns this hour's prefetch.
 *
 * A fixed rotation over the descriptor list: each feed gets one hour at a time, so a
 * failed prefetch is retried soon but never by all three feeds in the same minute.
 */
export function zeroXRouterCalendarPrefetchOwner(now: Date): DescriptorId | undefined {
  const descriptors = Object.keys(zeroXRouterCalendarTransportPolicy.descriptorPaths) as DescriptorId[]
  if (!descriptors.length) return undefined
  const slot = Math.floor(now.getUTCHours() / zeroXRouterCalendarAutomaticPolicy.prefetchRotationHours)
  return descriptors[slot % descriptors.length]
}

function isCalendarRequest(input: unknown): input is CalendarRequest {
  if (!input || typeof input !== 'object') return false
  const value = input as Record<string, unknown>
  return isDescriptor(value.descriptorId) && isLocale(value.locale) &&
    typeof value.month === 'string' && zeroXRouterCalendarTransportPolicy.monthPattern.test(value.month)
}

function isDescriptor(value: unknown): value is DescriptorId {
  return typeof value === 'string' && Object.hasOwn(zeroXRouterCalendarTransportPolicy.descriptorPaths, value)
}

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && zeroXRouterCalendarTransportPolicy.locales.includes(value as Locale)
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): boolean {
  return Boolean(value && typeof value === 'object' && Object.keys(value).every((key) => allowed.includes(key)))
}

function requestUrl(input: CalendarRequest): string {
  const [year, month] = input.month.split('-').map(Number)
  const start = Date.UTC(year!, month! - 1, 1)
  const end = Date.UTC(year!, month!, 1) - 1
  const parameters = zeroXRouterCalendarTransportPolicy.parameterNames
  const url = new URL(`${zeroXRouterCalendarEvidenceAdmissionPolicy.baseUrl}/${zeroXRouterCalendarTransportPolicy.descriptorPaths[input.descriptorId]}`)
  url.searchParams.set(parameters.locale, input.locale)
  url.searchParams.set(parameters.start, String(start))
  url.searchParams.set(parameters.end, String(end))
  return url.toString()
}

function isAcceptedResponse(result: Extract<ZeroXRouterBodyTransportResult, { state: 'succeeded' }>): boolean {
  if (result.status < zeroXRouterHttpTransportPolicy.successStatus.minimum ||
    result.status >= zeroXRouterHttpTransportPolicy.successStatus.maximumExclusive ||
    result.acceptedBytes < 1 || result.acceptedBytes > calendarMonthResponseBudgetPolicy.maximumBodyBytes ||
    result.acceptedBytes !== Buffer.byteLength(result.body, 'utf8') ||
    result.contentType.split(';', 1)[0]?.trim().toLowerCase() !== zeroXRouterHttpTransportPolicy.responseMimeEssence) return false
  try {
    const value = JSON.parse(result.body) as unknown
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
      (value as { code?: unknown }).code === zeroXRouterCalendarTransportPolicy.successEnvelope.code &&
      typeof (value as { msg?: unknown }).msg === 'string' && Array.isArray((value as { data?: unknown }).data))
  } catch {
    return false
  }
}

function unavailable(failureCode: Extract<CalendarTransportResult, { state: 'unavailable' }>['failureCode']): CalendarTransportResult {
  return { state: 'unavailable', failureCode }
}
