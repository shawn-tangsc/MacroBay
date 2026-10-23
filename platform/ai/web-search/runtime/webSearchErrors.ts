import type { WebSearchErrorCode } from '../contracts/webSearchContracts'

export class WebSearchError extends Error {
  readonly code: WebSearchErrorCode
  readonly status?: number

  constructor(code: WebSearchErrorCode, message: string, options?: ErrorOptions, status?: number) {
    super(message, options)
    this.name = 'WebSearchError'
    this.code = code
    this.status = status
  }
}

export function createWebSearchError(
  code: WebSearchErrorCode,
  message: string,
  cause?: unknown,
  status?: number
): WebSearchError {
  return new WebSearchError(code, message, cause === undefined ? undefined : { cause }, status)
}

/** 上游 401/403 ⇒ provider_unauthorized（可读、保留 status）；其它非 2xx ⇒ provider_http_error。 */
export function createProviderHttpStatusError(source: string, status: number): WebSearchError {
  if (status === 401 || status === 403) {
    return createWebSearchError('provider_unauthorized', `${source} API key is invalid or expired (${status}).`, undefined, status)
  }
  return createWebSearchError('provider_http_error', `${source} request failed with ${status}.`, undefined, status)
}

export function getWebSearchErrorStatus(error: unknown): number | undefined {
  return isWebSearchError(error) ? error.status : undefined
}

export function isWebSearchError(error: unknown): error is WebSearchError {
  return error instanceof WebSearchError
}

export function getWebSearchErrorCode(error: unknown): WebSearchErrorCode {
  if (isWebSearchError(error)) return error.code
  if (error instanceof DOMException && error.name === 'AbortError') return 'abort'
  return 'unknown'
}
