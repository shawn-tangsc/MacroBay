import { getPlatformFetch } from '@platform/network/platformFetch'

import { macroMarketPolicy } from '../macro-market/macroMarketPolicy'
import {
  fredRatesConnectionProbePolicy,
  isSafeFredRatesApiKey,
  probeFredRatesConnection
} from './fredRatesConnectionProbe'
import {
  isSafeRealMarketApiKey,
  probeRealMarketApiConnection,
  realMarketApiConnectionProbePolicy
} from './realMarketApiConnectionProbe'
import { probeZeroXRouterConnection } from './zeroXRouterConnectionProbe'
import { createSourceRequestGovernanceQueue } from './sourceRequestGovernance'
import { isSafeZeroXRouterApiKey, zeroXRouterSourcePolicy } from './zeroXRouterSourcePolicy'

/**
 * The failure vocabulary shared by every credentialed provider result. It carries no provider
 * detail and no credential material, so it is safe to hand to the renderer as-is.
 */
export type CredentialProbeFailureCode =
  | 'credential-invalid'
  | 'credential-not-configured'
  | 'authentication-failed'
  | 'plan-restricted'
  | 'rate-limited'
  | 'transport-unavailable'
  | 'request-timeout'
  | 'response-unavailable'

export type CredentialProbeOutcome =
  | Readonly<{ state: 'succeeded' }>
  | Readonly<{ state: 'failed'; failureCode: CredentialProbeFailureCode }>

/**
 * One entry per provider that owns a credential. A provider registers here instead of growing the
 * service with another `sourceId === ...` branch: `isValidCredentialShape` rejects a malformed key
 * before any request is made, and `probe` is the one real request the provider accepts as proof.
 */
export type CredentialedProviderProbe = Readonly<{
  isValidCredentialShape: (credentialDraft: string) => boolean
  probe: (apiKey: string) => Promise<CredentialProbeOutcome>
}>

export type CredentialedProviderProbeDeps = Readonly<{
  requestGovernanceQueue?: ReturnType<typeof createSourceRequestGovernanceQueue>
  platformFetch?: typeof fetch
}>

/** A credential probe answers with a receipt, not a dataset; anything larger is not an answer. */
export const CREDENTIAL_PROBE_MAX_BODY_BYTES = 512 * 1024

/** Twelve Data issues a 32-character hexadecimal key; anything else is refused without a request. */
const TWELVE_DATA_API_KEY = /^[0-9a-f]{32}$/i

export function createCredentialedProviderProbes(
  deps: CredentialedProviderProbeDeps
): ReadonlyMap<string, CredentialedProviderProbe> {
  return new Map<string, CredentialedProviderProbe>([
    [zeroXRouterSourcePolicy.sourceId, zeroXRouterProbe(deps)],
    [macroMarketPolicy.sourceId, twelveDataMarketProbe(deps)],
    [realMarketApiConnectionProbePolicy.sourceId, realMarketApiProbe(deps)],
    [fredRatesConnectionProbePolicy.sourceId, fredRatesProbe(deps)]
  ])
}

/**
 * The real dollar index's own price endpoint. The key is checked for shape first, so a malformed draft
 * costs no request, and the probe's response budget is its own — never the collector's.
 */
function realMarketApiProbe(deps: CredentialedProviderProbeDeps): CredentialedProviderProbe {
  return {
    isValidCredentialShape: isSafeRealMarketApiKey,
    probe: (apiKey) => probeRealMarketApiConnection(apiKey, {
      ...(deps.platformFetch ? { platformFetch: deps.platformFetch } : {})
    })
  }
}

/**
 * FRED's own observations endpoint. The key is checked for shape first, so a malformed draft costs no
 * request, and a rejected key is reported in FRED's own terms — an unregistered `api_key` comes back
 * as 400, not 401.
 */
function fredRatesProbe(deps: CredentialedProviderProbeDeps): CredentialedProviderProbe {
  return {
    isValidCredentialShape: isSafeFredRatesApiKey,
    probe: (apiKey) => probeFredRatesConnection(apiKey, {
      ...(deps.platformFetch ? { platformFetch: deps.platformFetch } : {}),
      maxBodyBytes: CREDENTIAL_PROBE_MAX_BODY_BYTES
    })
  }
}

function zeroXRouterProbe(deps: CredentialedProviderProbeDeps): CredentialedProviderProbe {
  return {
    isValidCredentialShape: isSafeZeroXRouterApiKey,
    async probe(apiKey) {
      if (!deps.requestGovernanceQueue) return safeProbeFailure('response-unavailable')
      try {
        const result = await deps.requestGovernanceQueue.enqueue({
          sourceId: zeroXRouterSourcePolicy.sourceId,
          policy: zeroXRouterSourcePolicy.requestGovernance,
          apiKey,
          intent: 'user',
          run: () => probeZeroXRouterConnection(apiKey)
        })
        return result.state === 'succeeded' ? { state: 'succeeded' } : safeProbeFailure(result.failureCode)
      } catch {
        // A governance refusal and a transport refusal are the same safe answer to the reader.
        return safeProbeFailure('response-unavailable')
      }
    }
  }
}

/**
 * The macro-market provider's own usage endpoint. It answers for the key rather than for a
 * market-data window, so a credential check never depends on market hours or symbol coverage.
 * **It spends one credit**: the free tier is 8 credits/minute and 800/day, and the shared
 * The probe carries its own, much smaller response budget: it asks a provider "is this key good",
 * and a health answer is a few hundred bytes. Sharing the collector's ceiling would let a megabyte
 * through a door that only ever expects a receipt.
 */
function twelveDataMarketProbe(deps: CredentialedProviderProbeDeps): CredentialedProviderProbe {
  return {
    isValidCredentialShape: (credentialDraft) => TWELVE_DATA_API_KEY.test(credentialDraft),
    async probe(apiKey) {
      const platformFetch = deps.platformFetch ?? resolvePlatformFetch()
      if (!platformFetch) return safeProbeFailure('transport-unavailable')
      let response: Response
      let contentLength: number
      try {
        response = await platformFetch(twelveDataUsageUrl(apiKey), {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(macroMarketPolicy.timeoutMs)
        })
        contentLength = Number(response.headers.get('content-length') ?? 0)
      } catch {
        // Offline, blocked or timed out: never report a verification we did not observe.
        return safeProbeFailure('transport-unavailable')
      }
      if (Number.isFinite(contentLength) && contentLength > CREDENTIAL_PROBE_MAX_BODY_BYTES) {
        return safeProbeFailure('response-unavailable')
      }
      let bodyText: string
      try {
        bodyText = await response.text()
      } catch {
        return safeProbeFailure('transport-unavailable')
      }
      if (bodyText.length > CREDENTIAL_PROBE_MAX_BODY_BYTES) return safeProbeFailure('response-unavailable')
      const body = parseJson(bodyText)
      if (!body || typeof body !== 'object' || Array.isArray(body)) return safeProbeFailure('response-unavailable')
      return twelveDataOutcome(response.status, body) ?? { state: 'succeeded' }
    }
  }
}

export function twelveDataUsageUrl(apiKey: string): string {
  return `${macroMarketPolicy.baseUrl}/api_usage?${new URLSearchParams({ apikey: apiKey }).toString()}`
}

/**
 * Maps the provider's own error answer onto the shared vocabulary. A 401 is the key itself; a 403
 * is the plan and a 429 is the rate limit, so a throttled reader is never told their key is wrong.
 */
export function twelveDataOutcome(httpStatus: number, body: unknown): CredentialProbeOutcome | undefined {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined
  const bodyCode = typeof record?.code === 'number' ? record.code : undefined
  const providerError = Boolean(record && (record.status === 'error' || typeof record.code === 'number'))
  if (!providerError && httpStatus < 400) return undefined
  const status = bodyCode ?? httpStatus
  if (status === 401) return safeProbeFailure('credential-invalid')
  if (status === 403) return safeProbeFailure('plan-restricted')
  if (status === 429) return safeProbeFailure('rate-limited')
  return safeProbeFailure('response-unavailable')
}

function safeProbeFailure(failureCode: CredentialProbeFailureCode): CredentialProbeOutcome {
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
