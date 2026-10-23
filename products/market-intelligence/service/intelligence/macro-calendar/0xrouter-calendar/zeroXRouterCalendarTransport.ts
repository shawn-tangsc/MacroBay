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
  let automaticBatch: Promise<readonly CalendarTransportResult[]> | undefined
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
    requestAutomatic(descriptorIds?: readonly DescriptorId[]): Promise<readonly CalendarTransportResult[]> {
      if (automaticBatch) return automaticBatch
      const month = zeroXRouterCalendarAutomaticMonth(deps.now?.() ?? new Date())
      const selected = descriptorIds ?? Object.keys(zeroXRouterCalendarTransportPolicy.descriptorPaths) as DescriptorId[]
      automaticBatch = Promise.all(selected.flatMap((descriptorId) =>
        zeroXRouterCalendarTransportPolicy.locales.map((locale) =>
          request({ descriptorId, month, locale }, 'automatic'))))
        .finally(() => { automaticBatch = undefined })
      return automaticBatch
    }
  })
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
