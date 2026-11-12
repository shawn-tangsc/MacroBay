import type { CredentialProbeFailureCode, CredentialProbeOutcome } from './credentialedProviderProbes'
import { createCryptoEtfFlowClient, type CryptoEtfFlowFailureCode } from './cryptoEtfFlowClient'

/**
 * The one request the settings page's test button makes for this source.
 *
 * It calls the collector's own client instead of repeating an HTTP call: the shape judgement lives
 * in the parser that phase two reads with, so a green test proves "this chain can parse" rather than
 * "the host answered". A second copy of that judgement would drift the first time someone edits the
 * parser, and the button would go back to proving nothing.
 */
export function probeCryptoEtfConnection(
  apiKey: string,
  deps: Readonly<{ platformFetch?: typeof fetch }> = {}
): Promise<CredentialProbeOutcome> {
  const client = createCryptoEtfFlowClient({ ...(deps.platformFetch ? { platformFetch: deps.platformFetch } : {}) })
  return client.testConnection(apiKey).then((result) => result.state === 'succeeded'
    ? { state: 'succeeded' as const }
    : { state: 'failed' as const, failureCode: probeFailureOf(result.failureCode) })
}

/**
 * Exhaustive on purpose: a code the client starts answering with but this table does not know is a
 * compile error, not a silent fall-through to "no content". The client's own `no-settled-rows`
 * diagnostic is answered as a shape refusal — the button has four groups, not five.
 */
const probeFailureByFlowFailure: Readonly<Record<CryptoEtfFlowFailureCode, CredentialProbeFailureCode>> = Object.freeze({
  'credential-invalid': 'credential-invalid',
  'plan-restricted': 'plan-restricted',
  'rate-limited': 'rate-limited',
  'request-timeout': 'request-timeout',
  'transport-unavailable': 'transport-unavailable',
  'response-unavailable': 'response-unavailable',
  'response-shape-invalid': 'response-shape-invalid',
  /* internal diagnostic, never a fifth group on screen */
  'no-settled-rows': 'response-shape-invalid'
})

function probeFailureOf(code: CryptoEtfFlowFailureCode): CredentialProbeFailureCode {
  return probeFailureByFlowFailure[code]
}
