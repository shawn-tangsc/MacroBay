import { redactSecretsInValue } from '../runtime/logRedaction'

export type HttpClientRetryPolicy = {
  maxAttempts: number
  retryableStatuses?: number[]
  retryableErrors?: string[]
}

export type HttpClientRequest = {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  conditionalHeaders?: Record<string, string>
  /** Passed to fetch; article fetches use no-store to bypass the Electron HTTP cache. */
  cache?: RequestCache
  /** Passed to fetch; article reads omit cookies so a metered session cannot hide the body. */
  credentials?: RequestCredentials
}

export type HttpClientResponse = {
  status: number
  headers: Record<string, string>
  bodyText: string
  byteSize: number
}

export type HttpClientLogEntry = {
  phase: 'request' | 'response' | 'retry'
  message: string
  metadata?: Record<string, unknown>
}

export type HttpClientOptions = {
  fetchImpl?: typeof fetch
  retryPolicy?: HttpClientRetryPolicy
  redactHeaders?: string[]
  onLog?: (entry: HttpClientLogEntry) => void
}

export class HttpRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HttpRetryableError'
  }
}

const DEFAULT_RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504]

export async function httpRequest(
  request: HttpClientRequest,
  options: HttpClientOptions = {}
): Promise<HttpClientResponse> {
  const fetchImpl = options.fetchImpl ?? fetch
  const retryPolicy = options.retryPolicy ?? { maxAttempts: 1 }
  const redactHeaders = normalizeHeaderNames(options.redactHeaders ?? ['authorization', 'x-api-key'])
  const maxAttempts = Math.max(1, retryPolicy.maxAttempts)
  const retryableStatuses = retryPolicy.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES

  let attempt = 1

  while (attempt <= maxAttempts) {
    const controller = new AbortController()
    const timeoutMs = request.timeoutMs ?? 30_000
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const headers = {
      ...request.headers,
      ...request.conditionalHeaders
    }

    options.onLog?.({
      phase: 'request',
      message: `${request.method ?? 'GET'} ${request.url}`,
      metadata: redactRequestMetadata(headers, redactHeaders, request.body)
    })

    try {
      const response = await fetchImpl(request.url, {
        method: request.method ?? 'GET',
        headers,
        body: request.body,
        signal: controller.signal,
        ...(request.cache ? { cache: request.cache } : {}),
        ...(request.credentials ? { credentials: request.credentials } : {})
      })

      clearTimeout(timeoutId)

      const bodyText = await response.text()
      const responseHeaders = headersToRecord(response.headers)

      options.onLog?.({
        phase: 'response',
        message: `Response ${response.status}`,
        metadata: redactResponseMetadata(responseHeaders, redactHeaders, bodyText.length)
      })

      if (retryableStatuses.includes(response.status) && attempt < maxAttempts) {
        options.onLog?.({
          phase: 'retry',
          message: `Retrying after status ${response.status}`,
          metadata: { attempt: attempt + 1 }
        })
        attempt += 1
        continue
      }

      return {
        status: response.status,
        headers: responseHeaders,
        bodyText,
        byteSize: byteLength(bodyText)
      }
    } catch (error) {
      clearTimeout(timeoutId)
      const message = error instanceof Error ? error.message : 'Request failed.'
      const retryable =
        controller.signal.aborted && message.includes('abort')
          ? false
          : isRetryableError(message, retryPolicy.retryableErrors)

      if (retryable && attempt < maxAttempts) {
        options.onLog?.({
          phase: 'retry',
          message: `Retrying after error: ${message}`,
          metadata: { attempt: attempt + 1 }
        })
        attempt += 1
        continue
      }

      if (controller.signal.aborted) {
        throw new Error(`Request timed out after ${timeoutMs}ms.`)
      }

      throw error instanceof Error ? error : new Error(message)
    }
  }

  throw new Error('Request failed after maximum retry attempts.')
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

function normalizeHeaderNames(names: string[]): Set<string> {
  return new Set(names.map((name) => name.toLowerCase()))
}

function redactRequestMetadata(
  headers: Record<string, string>,
  redactHeaders: Set<string>,
  body?: string
): Record<string, unknown> {
  return {
    headers: redactHeaderRecord(headers, redactHeaders),
    bodyPreview: body ? truncate(body, 120) : undefined
  }
}

function redactResponseMetadata(
  headers: Record<string, string>,
  redactHeaders: Set<string>,
  byteSize: number
): Record<string, unknown> {
  return redactSecretsInValue({
    headers: redactHeaderRecord(headers, redactHeaders),
    byteSize
  }) as Record<string, unknown>
}

function redactHeaderRecord(headers: Record<string, string>, redactHeaders: Set<string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = redactHeaders.has(key.toLowerCase()) ? '[REDACTED]' : value
  }
  return result
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isRetryableError(message: string, retryableErrors?: string[]): boolean {
  if (!retryableErrors?.length) return message.includes('fetch failed') || message.includes('network')
  return retryableErrors.some((pattern) => message.includes(pattern))
}
