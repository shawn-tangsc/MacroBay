import { getPlatformFetch } from '@platform/network/platformFetch'

import type { CredentialProbeFailureCode, CredentialProbeOutcome } from './credentialedProviderProbes'

/**
 * The FRED connection probe: one observation of one series is the whole receipt, so it never depends
 * on a data window, a holiday or a store.
 *
 * FRED answers an unregistered `api_key` with **400**, not 401, so the mapping below reads the
 * provider's own message before it blames the credential: a 400 that never mentioned the key is this
 * product's malformed request and is reported as an unavailable response, not as a bad key.
 */
export const fredRatesConnectionProbePolicy = Object.freeze({
  sourceId: 'fred-rates-liquidity',
  endpointUrl: 'https://api.stlouisfed.org/fred/series/observations',
  /** One series, one row: the probe asks "is this key good", not "what are rates today". */
  probeSeriesId: 'DGS10',
  probeLimit: 1,
  requestTimeoutMs: 15_000,
  /** FRED's own wording when the key is the problem. */
  credentialErrorPattern: /api[_\s-]?key/i
} as const)

/** FRED issues a 32-character hexadecimal key; anything else is refused before any request. */
const FRED_API_KEY_PATTERN = /^[0-9a-f]{32}$/i

export function isSafeFredRatesApiKey(credentialDraft: string): boolean {
  return FRED_API_KEY_PATTERN.test(credentialDraft)
}

/** The probe URL carries the key, so it is built in one place and never logged. */
export function fredRatesProbeUrl(apiKey: string): string {
  const policy = fredRatesConnectionProbePolicy
  const params = new URLSearchParams({
    series_id: policy.probeSeriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: String(policy.probeLimit)
  })
  return `${policy.endpointUrl}?${params.toString()}`
}

export type FredRatesProbeDeps = Readonly<{
  platformFetch?: typeof fetch
  /**
   * The probe's own response budget, supplied by the registry. A health answer is a few hundred
   * bytes; sharing the collector's ceiling would let a megabyte through a door that expects a
   * receipt.
   */
  maxBodyBytes: number
}>

export async function probeFredRatesConnection(
  apiKey: string,
  deps: FredRatesProbeDeps
): Promise<CredentialProbeOutcome> {
  const platformFetch = deps.platformFetch ?? resolvePlatformFetch()
  if (!platformFetch) return failure('transport-unavailable')
  let response: Response
  let contentLength: number
  try {
    response = await platformFetch(fredRatesProbeUrl(apiKey), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(fredRatesConnectionProbePolicy.requestTimeoutMs)
    })
    contentLength = Number(response.headers.get('content-length') ?? 0)
  } catch {
    // Offline, blocked or timed out: never report a verification we did not observe.
    return failure('transport-unavailable')
  }
  if (Number.isFinite(contentLength) && contentLength > deps.maxBodyBytes) return failure('response-unavailable')
  let bodyText: string
  try {
    bodyText = await response.text()
  } catch {
    return failure('transport-unavailable')
  }
  if (bodyText.length > deps.maxBodyBytes) return failure('response-unavailable')
  return fredRatesProbeOutcome(response.status, parseJson(bodyText)) ?? { state: 'succeeded' }
}

/**
 * Maps the provider's answer onto the shared vocabulary. A 403 is the plan and a 429 the rate limit,
 * so a throttled reader is never told their key is wrong.
 */
export function fredRatesProbeOutcome(httpStatus: number, body: unknown): CredentialProbeOutcome | undefined {
  if (!Number.isFinite(httpStatus) || httpStatus < 400) return undefined
  if (httpStatus === 403) return failure('plan-restricted')
  if (httpStatus === 429) return failure('rate-limited')
  if (httpStatus === 400) return failure(namesTheCredential(body) ? 'credential-invalid' : 'response-unavailable')
  if (httpStatus === 401) return failure('credential-invalid')
  return failure('response-unavailable')
}

function namesTheCredential(body: unknown): boolean {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined
  const message = typeof record?.error_message === 'string' ? record.error_message : ''
  return fredRatesConnectionProbePolicy.credentialErrorPattern.test(message)
}

function failure(failureCode: CredentialProbeFailureCode): CredentialProbeOutcome {
  return Object.freeze({ state: 'failed' as const, failureCode })
}

function resolvePlatformFetch(): typeof fetch | undefined {
  try {
    return getPlatformFetch()
  } catch {
    return undefined
  }
}

function parseJson(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText) as unknown
  } catch {
    return undefined
  }
}
