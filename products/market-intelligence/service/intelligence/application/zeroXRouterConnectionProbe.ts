import type { SafeZeroXRouterConnectionResult } from '../schema/intelligenceSourcesContracts'

import { requestZeroXRouterJson } from './zeroXRouterHttpTransport'
import { isSafeZeroXRouterApiKey, zeroXRouterSourcePolicy } from './zeroXRouterSourcePolicy'

/** Owns the one-shot, non-persistent 0xRouter account connection probe. */
export async function probeZeroXRouterConnection(apiKey: string): Promise<SafeZeroXRouterConnectionResult> {
  const sourceId = zeroXRouterSourcePolicy.sourceId
  if (!isSafeZeroXRouterApiKey(apiKey)) return failure('credential-not-configured')

  const result = await requestZeroXRouterJson({
    url: zeroXRouterSourcePolicy.connectionProbe.url,
    apiKey,
    accepts: isProbeEnvelope
  })
  return result.state === 'succeeded' ? { sourceId, state: 'succeeded' } : failure(result.failureCode)

  function failure(failureCode: Extract<SafeZeroXRouterConnectionResult, { state: 'failed' }>['failureCode']): SafeZeroXRouterConnectionResult {
    return { sourceId, state: 'failed', failureCode }
  }
}

function isProbeEnvelope(body: string): boolean {
  try {
    const value = JSON.parse(body) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const policy = zeroXRouterSourcePolicy.connectionProbe
    return Object.keys(value).length >= policy.minimumObjectFields && !hasExplicitErrorEnvelope(value as Record<string, unknown>)
  } catch {
    return false
  }
}

function hasExplicitErrorEnvelope(value: Record<string, unknown>): boolean {
  const signals = zeroXRouterSourcePolicy.connectionProbe.explicitFailureSignals
  return (('code' in value) && value.code !== signals.nonSuccessCode) ||
    (typeof value.success === 'boolean' && value.success === signals.unsuccessfulBoolean) ||
    (typeof value.status === 'string' && value.status.toLowerCase() === signals.errorStatus)
}
