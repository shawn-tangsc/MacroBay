import { getPlatformFetch } from '@platform/network/platformFetch'

import { realMarketApiPolicy } from '../macro-market/realMarketApiPolicy'
import type { CredentialProbeFailureCode, CredentialProbeOutcome } from './credentialedProviderProbes'

/**
 * The RealMarketAPI connection probe: one price for one symbol is the whole receipt, so it never
 * depends on the collection cadence, a data window or a store.
 *
 * The key rides in the **query string**, so the probe URL is credential material: it is built here and
 * never logged, never thrown and never stored. A rejection is reported in the provider's own terms —
 * a 403 is the plan and a 429 the rate limit, so a throttled reader is never told their key is wrong —
 * and a 400 is only blamed on the credential when the provider's message names it, exactly as the
 * FRED probe reads its own 400.
 */
export const realMarketApiConnectionProbePolicy = Object.freeze({
  sourceId: realMarketApiPolicy.sourceId,
  endpointUrl: `${realMarketApiPolicy.baseUrl}/api/v1/price`,
  symbolCode: realMarketApiPolicy.symbolCode,
  /**
   * Every instrument the collector reads, so the probe answers the question the source asks.
   *
   * A key that works for the dollar and not for gold is not a working source: the tick would fill one
   * series and quietly never fill the other. So the probe asks for each of them and reports the first
   * refusal in the provider's own terms.
   */
  symbols: realMarketApiPolicy.symbols,
  /** The probe's own bar. It asks "is this key good", not "what is the dollar today". */
  timeFrame: 'H1' as const,
  requestTimeoutMs: 15_000,
  /**
   * The probe's own response budget, deliberately not shared with the collector's ceiling: it expects
   * a receipt of a few hundred bytes, and a door that only ever expects a receipt should not be able
   * to admit a megabyte of candles.
   */
  maxBodyBytes: 32 * 1024,
  /** The provider's own wording when the key is the problem. */
  credentialErrorPattern: /api[\s_-]?key|unauthori[sz]ed|invalid[\s_-]?(api[\s_-]?)?(key|token)|credential/i
} as const)

export function isSafeRealMarketApiKey(credentialDraft: string): boolean {
  return realMarketApiPolicy.apiKeyPattern.test(credentialDraft)
}

/** The key is a query parameter, so this is the only place the probe URL exists. Never log it. */
export function realMarketApiProbeUrl(apiKey: string, symbolCode: string = realMarketApiConnectionProbePolicy.symbolCode): string {
  const policy = realMarketApiConnectionProbePolicy
  const query = new URLSearchParams({ symbolCode, timeFrame: policy.timeFrame, apiKey })
  return `${policy.endpointUrl}?${query.toString()}`
}

export type RealMarketApiProbeDeps = Readonly<{ platformFetch?: typeof fetch }>

/**
 * One request per admitted instrument, and the key is only good when all of them answer.
 *
 * The first refusal is the answer: it is the one the reader has to act on, and continuing would only
 * spend requests to confirm it.
 */
export async function probeRealMarketApiConnection(
  apiKey: string,
  deps: RealMarketApiProbeDeps = {}
): Promise<CredentialProbeOutcome> {
  for (const instrument of realMarketApiConnectionProbePolicy.symbols) {
    const outcome = await probeSymbol(apiKey, instrument.symbolCode, deps)
    if (outcome.state === 'failed') return outcome
  }
  return { state: 'succeeded' }
}

async function probeSymbol(
  apiKey: string,
  symbolCode: string,
  deps: RealMarketApiProbeDeps
): Promise<CredentialProbeOutcome> {
  const platformFetch = deps.platformFetch ?? resolvePlatformFetch()
  if (!platformFetch) return failure('transport-unavailable')
  const policy = realMarketApiConnectionProbePolicy
  let response: Response
  let contentLength: number
  try {
    response = await platformFetch(realMarketApiProbeUrl(apiKey, symbolCode), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(policy.requestTimeoutMs)
    })
    contentLength = Number(response.headers.get('content-length') ?? 0)
  } catch {
    // Offline, blocked or timed out. The thrown error may quote the URL, so it is discarded here and
    // never travels any further: the caller only ever receives a code.
    return failure('transport-unavailable')
  }
  if (Number.isFinite(contentLength) && contentLength > policy.maxBodyBytes) return failure('response-unavailable')
  let bodyText: string
  try {
    bodyText = await response.text()
  } catch {
    return failure('transport-unavailable')
  }
  if (bodyText.length > policy.maxBodyBytes) return failure('response-unavailable')
  const body = parseJson(bodyText)
  return realMarketApiProbeOutcome(response.status, body) ?? (isPriceAnswer(body, symbolCode) ? { state: 'succeeded' } : failure('response-unavailable'))
}

/**
 * Maps the provider's answer onto the shared vocabulary. A 401 is the key itself; a 403 is the plan
 * and a 429 is the rate limit.
 */
export function realMarketApiProbeOutcome(httpStatus: number, body: unknown): CredentialProbeOutcome | undefined {
  if (!Number.isFinite(httpStatus) || httpStatus < 400) return undefined
  if (httpStatus === 403) return failure('plan-restricted')
  if (httpStatus === 429) return failure('rate-limited')
  if (httpStatus === 400) return failure(namesTheCredential(body) ? 'credential-invalid' : 'response-unavailable')
  if (httpStatus === 401) return failure('credential-invalid')
  return failure('response-unavailable')
}

/** A 2xx is only a pass when it actually carries the price the probe asked **that instrument** for. */
function isPriceAnswer(body: unknown, symbolCode: string): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const record = body as Record<string, unknown>
  return record.symbolCode === symbolCode &&
    typeof record.closePrice === 'number' && Number.isFinite(record.closePrice) && record.closePrice > 0
}

function namesTheCredential(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const record = body as Record<string, unknown>
  const message = [record.message, record.error, record.errorMessage].find(value => typeof value === 'string') as string | undefined
  return message !== undefined && realMarketApiConnectionProbePolicy.credentialErrorPattern.test(message)
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
