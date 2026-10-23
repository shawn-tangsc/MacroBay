import {
  applyBlsApiRequestIdentity,
  type BlsApiRequestIdentityCapability
} from './blsApiRequestIdentity'

export const blsApiCompatibilityDescriptorPolicy = Object.freeze({
  endpoint: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
  method: 'POST',
  contentTypeHeader: 'Content-Type',
  contentType: 'application/json',
  requestedSeries: Object.freeze(['CES0000000001', 'LNS14000000'] as const),
  startYear: '2026',
  endYear: '2026',
  responseYear: '2026',
  responsePeriod: 'M07',
  deadlineMs: 15_000,
  redirect: 'error',
  attempts: 1,
  authentication: 'none',
  responseMaximumBytes: 1_500_000,
  requestBody: '{"seriesid":["CES0000000001","LNS14000000"],"startyear":"2026","endyear":"2026"}'
} as const)

export const blsApiCompatibilityRecognizerPolicy = Object.freeze({
  successfulStatus: 'REQUEST_SUCCEEDED',
  canonicalDecimalPattern: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/,
  maximumJsonNestingDepth: 64
} as const)

export type CanonicalBlsDecimal = string & { readonly __canonicalBlsDecimal: unique symbol }

type BlsApiCompatibilitySuccess = Readonly<{ state: 'api-compatible'; observations: readonly [
  Readonly<{ seriesId: 'CES0000000001'; period: '2026-M07'; value: CanonicalBlsDecimal }>,
  Readonly<{ seriesId: 'LNS14000000'; period: '2026-M07'; value: CanonicalBlsDecimal }>
] }>

export type BlsApiCompatibilityResult =
  | BlsApiCompatibilitySuccess
  | Readonly<{ state: 'access-denied-or-unavailable' }>
  | Readonly<{ state: 'invalid-response' }>
  | Readonly<{ state: 'indeterminate' }>

export type BlsApiCompatibilityFetch = (input: string, init: RequestInit) => Promise<Response>

export type BlsApiCompatibilityProbe = Readonly<{ probe: () => Promise<BlsApiCompatibilityResult> }>

export function createBlsApiCompatibilityProbe(deps: Readonly<{
  fetch?: BlsApiCompatibilityFetch
  identity?: BlsApiRequestIdentityCapability
}>): BlsApiCompatibilityProbe {
  let inFlight = false
  const safeDeps = readDependencies(deps)
  const identity = safeDeps.identity

  return Object.freeze({
    probe: (): Promise<BlsApiCompatibilityResult> => {
      if (inFlight || !safeDeps.fetch || !identity) return Promise.resolve(indeterminate())
      inFlight = true
      const fetch = safeDeps.fetch
      const controller = new AbortController()
      const operation = (async (): Promise<BlsApiCompatibilityResult> => {
        try {
          const headers = new Headers({ [blsApiCompatibilityDescriptorPolicy.contentTypeHeader]: blsApiCompatibilityDescriptorPolicy.contentType })
          if (!applyBlsApiRequestIdentity(identity, headers)) return indeterminate()
          const response = await fetch(blsApiCompatibilityDescriptorPolicy.endpoint, {
            method: blsApiCompatibilityDescriptorPolicy.method,
            headers,
            body: blsApiCompatibilityDescriptorPolicy.requestBody,
            redirect: blsApiCompatibilityDescriptorPolicy.redirect,
            signal: controller.signal
          })
          if (controller.signal.aborted) return indeterminate()
          const result = await classifyResponse(response)
          return controller.signal.aborted ? indeterminate() : result
        } catch {
          return indeterminate()
        }
      })()
      void operation.finally(() => { inFlight = false })
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          controller.abort()
          resolve(indeterminate())
        }, blsApiCompatibilityDescriptorPolicy.deadlineMs)
        void operation.then((result) => {
          clearTimeout(timeout)
          resolve(result)
        })
      })
    }
  })
}

function readDependencies(value: unknown): Readonly<{ fetch?: BlsApiCompatibilityFetch; identity?: BlsApiRequestIdentityCapability }> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return Object.freeze({})
    const fetch = readOwnData(value as Record<string, unknown>, 'fetch')
    const identity = readOwnData(value as Record<string, unknown>, 'identity')
    return Object.freeze({
      ...(typeof fetch === 'function' ? { fetch: fetch as BlsApiCompatibilityFetch } : {}),
      ...(identity !== undefined ? { identity: identity as BlsApiRequestIdentityCapability } : {})
    })
  } catch {
    return Object.freeze({})
  }
}

export function recognizeBlsApiCompatibilityEnvelope(value: unknown): BlsApiCompatibilityResult | undefined {
  try {
    if (!isNormalJsonValue(value, new WeakSet(), 0) || !isNormalRecord(value)) return undefined
    if (readOwnData(value, 'status') !== blsApiCompatibilityRecognizerPolicy.successfulStatus) return undefined
    const results = readOwnData(value, 'Results')
    if (!isNormalRecord(results)) return undefined
    const series = readOwnData(results, 'series')
    if (!isDenseNormalArray(series, blsApiCompatibilityDescriptorPolicy.requestedSeries.length)) return undefined

    const observations = new Map<string, CanonicalBlsDecimal>()
    for (const item of series) {
      if (!isNormalRecord(item)) return undefined
      const seriesId = readOwnData(item, 'seriesID')
      const data = readOwnData(item, 'data')
      if (!isExpectedSeriesId(seriesId) || observations.has(seriesId) || !isDenseNormalArray(data)) return undefined
      const valueForPeriod = uniqueObservation(data)
      if (!valueForPeriod) return undefined
      observations.set(seriesId, valueForPeriod)
    }
    if (observations.size !== blsApiCompatibilityDescriptorPolicy.requestedSeries.length) return undefined
    const first = observations.get(blsApiCompatibilityDescriptorPolicy.requestedSeries[0])
    const second = observations.get(blsApiCompatibilityDescriptorPolicy.requestedSeries[1])
    return first && second ? compatible(first, second) : undefined
  } catch {
    return undefined
  }
}

async function classifyResponse(response: Response): Promise<BlsApiCompatibilityResult> {
  try {
    const status = response.status
    if (!Number.isInteger(status)) return indeterminate()
    if (status < 200 || status >= 300) {
      await discardBody(response.body)
      return unavailable()
    }
    if (!isDeclaredSizeAccepted(response.headers)) {
      await discardBody(response.body)
      return indeterminate()
    }
    const body = await readBoundedBody(response.body)
    if (body === undefined) return indeterminate()
    const parsed = parseJson(body)
    return recognizeBlsApiCompatibilityEnvelope(parsed) ?? invalidResponse()
  } catch {
    return indeterminate()
  }
}

function uniqueObservation(data: readonly unknown[]): CanonicalBlsDecimal | undefined {
  let selected: CanonicalBlsDecimal | undefined
  for (const item of data) {
    if (!isNormalRecord(item)) return undefined
    const year = readOwnData(item, 'year')
    const period = readOwnData(item, 'period')
    if (year !== blsApiCompatibilityDescriptorPolicy.responseYear || period !== blsApiCompatibilityDescriptorPolicy.responsePeriod) continue
    const value = readOwnData(item, 'value')
    if (selected || typeof value !== 'string' || value.length === 0 || !blsApiCompatibilityRecognizerPolicy.canonicalDecimalPattern.test(value)) return undefined
    selected = value as CanonicalBlsDecimal
  }
  return selected
}

function isExpectedSeriesId(value: unknown): value is (typeof blsApiCompatibilityDescriptorPolicy.requestedSeries)[number] {
  return typeof value === 'string' && blsApiCompatibilityDescriptorPolicy.requestedSeries.includes(value as never)
}

function isDeclaredSizeAccepted(headers: Headers): boolean {
  const value = headers.get('content-length')
  return value !== null && /^(?:0|[1-9][0-9]*)$/.test(value) && Number(value) <= blsApiCompatibilityDescriptorPolicy.responseMaximumBytes
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null): Promise<string | undefined> {
  if (!body) return undefined
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let acceptedBytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!(next.value instanceof Uint8Array)) {
        await discardReader(reader)
        return undefined
      }
      acceptedBytes += next.value.byteLength
      if (acceptedBytes > blsApiCompatibilityDescriptorPolicy.responseMaximumBytes) {
        await discardReader(reader)
        return undefined
      }
      chunks.push(next.value)
    }
    const bytes = new Uint8Array(acceptedBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    await discardReader(reader)
    return undefined
  } finally {
    try { reader.releaseLock() } catch { /* safe discard */ }
  }
}

async function discardReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try { await reader.cancel() } catch { /* safe discard */ }
}

async function discardBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try { await body?.cancel() } catch { /* safe discard */ }
}

function parseJson(body: string): unknown {
  try { return JSON.parse(body) } catch { return undefined }
}

function isNormalJsonValue(value: unknown, seen: WeakSet<object>, depth: number): boolean {
  if (depth > blsApiCompatibilityRecognizerPolicy.maximumJsonNestingDepth) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
      const names = Object.getOwnPropertyNames(value)
      if (names.length !== value.length + 1 || !names.includes('length')) return false
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !('value' in descriptor) || !isNormalJsonValue(descriptor.value, seen, depth + 1)) return false
      }
      return true
    }
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
    for (const name of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !isNormalJsonValue(descriptor.value, seen, depth + 1)) return false
    }
    return true
  } catch {
    return false
  }
}

function isNormalRecord(value: unknown): value is Record<string, unknown> {
  try {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
  } catch {
    return false
  }
}

function isDenseNormalArray(value: unknown, exactLength?: number): value is unknown[] {
  try {
    return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype &&
      (exactLength === undefined || value.length === exactLength) &&
      [...Array(value.length).keys()].every((index) => Object.hasOwn(value, index))
  } catch {
    return false
  }
}

function readOwnData(value: Record<string, unknown>, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, name)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function compatible(first: CanonicalBlsDecimal, second: CanonicalBlsDecimal): BlsApiCompatibilityResult {
  const period = `${blsApiCompatibilityDescriptorPolicy.responseYear}-${blsApiCompatibilityDescriptorPolicy.responsePeriod}` as const
  const observations = Object.freeze([
    Object.freeze({ seriesId: blsApiCompatibilityDescriptorPolicy.requestedSeries[0], period, value: first }),
    Object.freeze({ seriesId: blsApiCompatibilityDescriptorPolicy.requestedSeries[1], period, value: second })
  ]) as unknown as BlsApiCompatibilitySuccess['observations']
  return Object.freeze({ state: 'api-compatible' as const, observations })
}

function unavailable(): BlsApiCompatibilityResult { return Object.freeze({ state: 'access-denied-or-unavailable' as const }) }
function invalidResponse(): BlsApiCompatibilityResult { return Object.freeze({ state: 'invalid-response' as const }) }
function indeterminate(): BlsApiCompatibilityResult { return Object.freeze({ state: 'indeterminate' as const }) }
