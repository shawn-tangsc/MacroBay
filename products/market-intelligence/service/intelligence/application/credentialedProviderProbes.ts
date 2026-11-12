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
import { cryptoEtfSourcePolicy } from './cryptoEtfSourcePolicy'
import { probeCryptoEtfConnection } from './cryptoEtfConnectionProbe'
import { narwhalCalendarProbeUrl, narwhalSourcePolicy } from './narwhalSourcePolicy'
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
  /* 额度用尽：这个月没了、下个月会回来。与 `plan-restricted`（这条路走不通）不是一回事，
     折进去就等于对读者说「套餐不含」，而实际是「这个月用完了」。 */
  | 'credits-exhausted'
  | 'rate-limited'
  | 'transport-unavailable'
  | 'request-timeout'
  | 'response-unavailable'
  /* The answer arrived but not in the shape we parse (HTTP 200 included): a distinct refusal,
     because "no content" is a different fact from "content we cannot read". */
  | 'response-shape-invalid'

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
    [fredRatesConnectionProbePolicy.sourceId, fredRatesProbe(deps)],
    [cryptoEtfSourcePolicy.sourceId, cryptoEtfProbe(deps)],
    [narwhalSourcePolicy.sourceId, narwhalProbe(deps)]
  ])
}

/**
 * Narwhal：一次日历请求回答三件事——key 有效、日历权限在、返回是 JSON。
 *
 * 结构判定只到「是 JSON 对象或数组」为止：更细的字段形状归采集器的解析器，探针不做第二套解析
 * （两套解析迟早对不上，而探针只需要一张收据）。`402` 有自己的码：额度用尽不是套餐不含。
 */
function narwhalProbe(deps: CredentialedProviderProbeDeps): CredentialedProviderProbe {
  return {
    isValidCredentialShape: (credentialDraft) => {
      const trimmed = credentialDraft.trim()
      return trimmed.length > 0 && trimmed.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(trimmed)
    },
    async probe(apiKey) {
      const platformFetch = deps.platformFetch ?? resolvePlatformFetch()
      if (!platformFetch) return safeProbeFailure('transport-unavailable')
      let response: Response
      try {
        response = await platformFetch(narwhalCalendarProbeUrl(), {
          method: 'GET',
          headers: {
            accept: 'application/json',
            [narwhalSourcePolicy.authHeader]: `${narwhalSourcePolicy.authScheme} ${apiKey.trim()}`
          },
          signal: AbortSignal.timeout(narwhalSourcePolicy.timeoutMs)
        })
      } catch {
        return safeProbeFailure('transport-unavailable')
      }
      const refusal = narwhalOutcome(response.status)
      if (refusal) return refusal
      let bodyText: string
      try {
        bodyText = await response.text()
      } catch {
        return safeProbeFailure('transport-unavailable')
      }
      if (bodyText.length > CREDENTIAL_PROBE_MAX_BODY_BYTES) return safeProbeFailure('response-unavailable')
      const body = parseJson(bodyText)
      if (body === undefined) return safeProbeFailure('response-unavailable')
      if (typeof body !== 'object' || body === null) return safeProbeFailure('response-shape-invalid')
      return { state: 'succeeded' }
    }
  }
}

/**
 * 状态码 → 失败码。三档必须分开：`401` 是 key 填错或失效，`402` 是**额度用尽**（这个月没了），
 * `429` 是限速（等一会儿再来）。都报「连接失败」的话，读者和我们都不知道该改哪儿。
 *
 * `403` 留 `plan-restricted`：key 是好的，但这个端点不在当前订阅里。
 */
export function narwhalOutcome(httpStatus: number): CredentialProbeOutcome | undefined {
  if (httpStatus === 401) return safeProbeFailure('credential-invalid')
  if (httpStatus === 402) return safeProbeFailure('credits-exhausted')
  if (httpStatus === 403) return safeProbeFailure('plan-restricted')
  if (httpStatus === 429) return safeProbeFailure('rate-limited')
  if (httpStatus >= 200 && httpStatus < 300) return undefined
  return safeProbeFailure('response-unavailable')
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

/**
 * CryptoETF: the collector's own client is the probe, so the answer the reader sees is the answer the
 * chain will get. Shape judgement stays in one place (the funds parser); this only carries the key,
 * the shared governance queue and the platform fetch.
 */
function cryptoEtfProbe(deps: CredentialedProviderProbeDeps): CredentialedProviderProbe {
  return {
    isValidCredentialShape: (credentialDraft) => {
      const trimmed = credentialDraft.trim()
      return trimmed.length > 0 && trimmed.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(trimmed)
    },
    async probe(apiKey) {
      const run = () => probeCryptoEtfConnection(apiKey, {
        ...(deps.platformFetch ? { platformFetch: deps.platformFetch } : {})
      })
      if (!deps.requestGovernanceQueue) return run()
      try {
        return await deps.requestGovernanceQueue.enqueue({
          sourceId: cryptoEtfSourcePolicy.sourceId,
          policy: cryptoEtfSourcePolicy.requestGovernance,
          apiKey,
          intent: 'user',
          run
        })
      } catch {
        // A governance refusal and a transport refusal are the same safe answer to the reader.
        return { state: 'failed' as const, failureCode: 'response-unavailable' as const }
      }
    }
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
