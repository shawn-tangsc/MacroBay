import { getPlatformFetch } from '@platform/network/platformFetch'

import { calendarMonthResponseBudgetPolicy, etfFlowHistoryResponseBudgetPolicy, isSafeZeroXRouterApiKey, zeroXRouterHttpTransportPolicy } from './zeroXRouterSourcePolicy'

export type ZeroXRouterTransportFailureCode = 'request-timeout' | 'transport-unavailable' | 'response-unavailable'
export type ZeroXRouterTransportRejectionStage =
  | 'response-status' | 'response-mime' | 'response-content-length' | 'body-read'
  | 'body-size' | 'empty-body' | 'response-envelope' | 'request-timeout' | 'transport-error'
export type ZeroXRouterTransportStatusClass = '4xx' | '5xx' | 'other'

export type ZeroXRouterTransportResult =
  | Readonly<{ state: 'succeeded' }>
  | Readonly<{ state: 'failed'; failureCode: ZeroXRouterTransportFailureCode }>

export type ZeroXRouterBodyTransportResult =
  | Readonly<{ state: 'succeeded'; body: string; acceptedBytes: number; status: number; contentType: string }>
  | Readonly<{ state: 'failed'; failureCode: ZeroXRouterTransportFailureCode }>

type ZeroXRouterBodyBudget = Readonly<{
  maximumBodyBytes: number
  trustContentLength: boolean
}>

const genericZeroXRouterBodyBudget: ZeroXRouterBodyBudget = Object.freeze({
  maximumBodyBytes: zeroXRouterHttpTransportPolicy.responseAcceptedMaxBytes,
  trustContentLength: true
})

export function requestZeroXRouterEtfFlowHistoryJson(input: Readonly<{
  url: string
  apiKey: string
  accepts: (body: string) => boolean
  onRejectionStage?: (stage: ZeroXRouterTransportRejectionStage, statusClass?: ZeroXRouterTransportStatusClass) => void
}>): Promise<ZeroXRouterTransportResult> {
  return requestZeroXRouterJsonWithBodyBudget(input, etfFlowHistoryResponseBudgetPolicy)
}

type ZeroXRouterJsonRequest = Readonly<{
  url: string
  apiKey: string
  accepts: (body: string) => boolean
  onRejectionStage?: (stage: ZeroXRouterTransportRejectionStage, statusClass?: ZeroXRouterTransportStatusClass) => void
}>

export function requestZeroXRouterJson(input: ZeroXRouterJsonRequest): Promise<ZeroXRouterTransportResult> {
  return requestZeroXRouterJsonWithBodyBudget(input, genericZeroXRouterBodyBudget)
}

/** Main-process-only bounded body transport. Callers must not expose its body outside product services. */
export function requestZeroXRouterJsonBody(input: Readonly<{ url: string; apiKey: string }>): Promise<ZeroXRouterBodyTransportResult> {
  return requestZeroXRouterJsonBodyWithBudget(input, genericZeroXRouterBodyBudget)
}

/** Calendar main-process entry only; all other consumers retain their own budgets. */
export function requestZeroXRouterCalendarJsonBody(input: Readonly<{ url: string; apiKey: string }>): Promise<ZeroXRouterBodyTransportResult> {
  return requestZeroXRouterJsonBodyWithBudget(input, calendarMonthResponseBudgetPolicy)
}

async function requestZeroXRouterJsonWithBodyBudget(input: ZeroXRouterJsonRequest, bodyBudget: ZeroXRouterBodyBudget): Promise<ZeroXRouterTransportResult> {
  const result = await requestZeroXRouterJsonBodyWithBudget(input, bodyBudget)
  if (result.state === 'failed') return result
  if (!input.accepts(result.body)) {
    input.onRejectionStage?.('response-envelope')
    return unavailable()
  }
  return succeeded()
}

async function requestZeroXRouterJsonBodyWithBudget(input: Readonly<{
  url: string
  apiKey: string
  onRejectionStage?: (stage: ZeroXRouterTransportRejectionStage, statusClass?: ZeroXRouterTransportStatusClass) => void
}>, bodyBudget: ZeroXRouterBodyBudget): Promise<ZeroXRouterBodyTransportResult> {
  if (!isSafeZeroXRouterApiKey(input.apiKey)) return bodyUnavailable()

  const controller = new AbortController()
  const deadline = createRequestDeadline(controller)
  const request = Promise.resolve().then(() => getPlatformFetch()(input.url, {
    method: zeroXRouterHttpTransportPolicy.method,
    headers: { [zeroXRouterHttpTransportPolicy.requestHeader]: input.apiKey },
    signal: controller.signal,
    redirect: zeroXRouterHttpTransportPolicy.redirectMode
  }))
  try {
    const response = await Promise.race([
      request,
      deadline.expired.then(() => undefined)
    ])
    if (!response) {
      void request.then(discardResponse, discardLateFailure)
      input.onRejectionStage?.('request-timeout')
      return bodyTimeout()
    }
    if (!isSuccessStatus(response)) {
      input.onRejectionStage?.('response-status', statusClass(response.status))
      discardResponse(response)
      return bodyUnavailable()
    }
    if (!hasAcceptedMime(response)) {
      input.onRejectionStage?.('response-mime')
      discardResponse(response)
      return bodyUnavailable()
    }
    if (bodyBudget.trustContentLength && !hasAcceptedContentLength(response.headers, bodyBudget.maximumBodyBytes)) {
      input.onRejectionStage?.('response-content-length')
      discardResponse(response)
      return bodyUnavailable()
    }
    const body = await Promise.race([
      readBoundedBody(response.body, controller.signal, bodyBudget.maximumBodyBytes),
      deadline.expired.then(() => ({ state: 'aborted' as const }))
    ])
    if (body.state === 'aborted') {
      input.onRejectionStage?.('request-timeout')
      return bodyTimeout()
    }
    if (body.reason) {
      input.onRejectionStage?.(body.reason)
      return bodyUnavailable()
    }
    if (body.value === undefined || body.value.length === 0) {
      input.onRejectionStage?.('empty-body')
      return bodyUnavailable()
    }
    return { state: 'succeeded', body: body.value, acceptedBytes: Buffer.byteLength(body.value, 'utf8'), status: response.status, contentType: response.headers.get('content-type') ?? '' }
  } catch {
    if (controller.signal.aborted) {
      input.onRejectionStage?.('request-timeout')
      return bodyTimeout()
    }
    input.onRejectionStage?.('transport-error')
    return bodyTransportUnavailable()
  } finally {
    deadline.dispose()
  }
}

type RequestDeadline = Readonly<{ expired: Promise<void>; dispose: () => void }>
type BoundedBody = Readonly<{ state: 'body'; value: string | undefined; reason?: Extract<ZeroXRouterTransportRejectionStage, 'body-read' | 'body-size'> }> | Readonly<{ state: 'aborted' }>
type BodyReadOutcome = BoundedBody | Readonly<{ state: 'read'; next: ReadableStreamReadResult<Uint8Array> }>

function createRequestDeadline(controller: AbortController): RequestDeadline {
  let expire!: () => void
  const expired = new Promise<void>((resolve) => { expire = resolve })
  const timeout = setTimeout(() => {
    controller.abort()
    expire()
  }, zeroXRouterHttpTransportPolicy.requestTimeoutMs)
  return Object.freeze({ expired, dispose: () => clearTimeout(timeout) })
}

function isSuccessStatus(response: Response): boolean {
  return response.status >= zeroXRouterHttpTransportPolicy.successStatus.minimum &&
    response.status < zeroXRouterHttpTransportPolicy.successStatus.maximumExclusive
}

function statusClass(status: number): ZeroXRouterTransportStatusClass {
  if (status >= 400 && status < 500) return '4xx'
  if (status >= 500 && status < 600) return '5xx'
  return 'other'
}

function hasAcceptedMime(response: Response): boolean {
  return mimeEssence(response.headers.get('content-type') ?? '') === zeroXRouterHttpTransportPolicy.responseMimeEssence
}

function hasAcceptedContentLength(headers: Headers, maximumBodyBytes: number): boolean {
  const contentLength = headers.get('content-length')
  return contentLength === null ||
    (/^(?:0|[1-9][0-9]*)$/.test(contentLength) && Number(contentLength) <= maximumBodyBytes)
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null, signal: AbortSignal, maximumBodyBytes: number): Promise<BoundedBody> {
  if (!body) return { state: 'body', value: undefined }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined
  let cancelled = false
  let abort!: () => void
  const aborted = new Promise<BoundedBody>((resolve) => { abort = () => resolve({ state: 'aborted' }) })
  const cancelReader = () => {
    if (cancelled) return
    cancelled = true
    void reader.cancel().catch(discardLateFailure)
  }
  const onAbort = () => {
    cancelReader()
    abort()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      pendingRead = reader.read()
      const outcome: BodyReadOutcome = await Promise.race([
        pendingRead.then((next) => ({ state: 'read' as const, next })),
        aborted
      ])
      if (outcome.state !== 'read') return outcome
      pendingRead = undefined
      if (outcome.next.done) break
      if (!outcome.next.value) continue
      length += outcome.next.value.byteLength
      if (length > maximumBodyBytes) {
        cancelReader()
        return { state: 'body', value: undefined, reason: 'body-size' }
      }
      chunks.push(outcome.next.value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { state: 'body', value: new TextDecoder().decode(bytes) }
  } catch {
    cancelReader()
    return { state: 'body', value: undefined, reason: 'body-read' }
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (pendingRead) void pendingRead.then(() => releaseReader(reader), () => releaseReader(reader))
    else releaseReader(reader)
  }
}

function discardResponse(response: Response): void {
  const body = response.body
  if (body) void body.cancel().catch(discardLateFailure)
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock()
  } catch {
    // Native reads that ignore cancellation can keep their lock until settlement.
  }
}

function mimeEssence(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function succeeded(): ZeroXRouterTransportResult { return { state: 'succeeded' } }
function timeout(): ZeroXRouterTransportResult { return { state: 'failed', failureCode: 'request-timeout' } }
function transportUnavailable(): ZeroXRouterTransportResult { return { state: 'failed', failureCode: 'transport-unavailable' } }
function unavailable(): ZeroXRouterTransportResult { return { state: 'failed', failureCode: 'response-unavailable' } }
function bodyTimeout(): ZeroXRouterBodyTransportResult { return { state: 'failed', failureCode: 'request-timeout' } }
function bodyTransportUnavailable(): ZeroXRouterBodyTransportResult { return { state: 'failed', failureCode: 'transport-unavailable' } }
function bodyUnavailable(): ZeroXRouterBodyTransportResult { return { state: 'failed', failureCode: 'response-unavailable' } }

function discardLateFailure(): void {
  // Late native transport cleanup failures must not become unhandled rejections.
}
