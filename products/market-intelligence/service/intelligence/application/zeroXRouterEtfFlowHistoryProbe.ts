import { SourceRequestGovernanceError, type createSourceRequestGovernanceQueue } from './sourceRequestGovernance'
import { requestZeroXRouterEtfFlowHistoryJson, type ZeroXRouterTransportFailureCode } from './zeroXRouterHttpTransport'
import { isSafeZeroXRouterApiKey, zeroXRouterSourcePolicy } from './zeroXRouterSourcePolicy'
import { hasObservedEtfFlowHistoryShape } from '../etf/etfFlowHistoryParser'

type EtfFlowHistoryAsset = keyof typeof zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.urls

export type SafeZeroXRouterEtfFlowHistoryProbeResult =
  | Readonly<{ asset: EtfFlowHistoryAsset; state: 'succeeded' }>
  | Readonly<{ asset: EtfFlowHistoryAsset; state: 'failed'; failureCode: ZeroXRouterTransportFailureCode }>

/**
 * Reads only the known success envelope to diagnose transport availability.
 * It never exposes, persists, or admits ETF rows as product facts.
 */
export async function probeZeroXRouterEtfFlowHistory(input: Readonly<{
  asset: EtfFlowHistoryAsset
  apiKey: string
  requestGovernanceQueue: ReturnType<typeof createSourceRequestGovernanceQueue>
}>): Promise<SafeZeroXRouterEtfFlowHistoryProbeResult> {
  if (!isSafeZeroXRouterApiKey(input.apiKey)) return unavailable(input.asset)

  try {
    const result = await input.requestGovernanceQueue.enqueue({
      sourceId: zeroXRouterSourcePolicy.sourceId,
      policy: zeroXRouterSourcePolicy.requestGovernance,
      apiKey: input.apiKey,
      intent: zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.intent,
      run: () => requestZeroXRouterEtfFlowHistoryJson({
        url: zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.urls[input.asset],
        apiKey: input.apiKey,
        accepts: isFlowHistoryEnvelope
      })
    })
    return result.state === 'succeeded'
      ? { asset: input.asset, state: 'succeeded' }
      : { asset: input.asset, state: 'failed', failureCode: result.failureCode }
  } catch (error) {
    if (error instanceof SourceRequestGovernanceError) return unavailable(input.asset)
    return unavailable(input.asset)
  }
}

function isFlowHistoryEnvelope(body: string): boolean {
  return hasObservedEtfFlowHistoryShape(body)
}

function unavailable(asset: EtfFlowHistoryAsset): SafeZeroXRouterEtfFlowHistoryProbeResult {
  return { asset, state: 'failed', failureCode: 'response-unavailable' }
}
