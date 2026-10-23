import { SourceRequestGovernanceError, type createSourceRequestGovernanceQueue } from './sourceRequestGovernance'
import { requestZeroXRouterEtfFlowHistoryJson, type ZeroXRouterTransportRejectionStage } from './zeroXRouterHttpTransport'
import { isSafeZeroXRouterApiKey, zeroXRouterSourcePolicy } from './zeroXRouterSourcePolicy'
import { parseEtfFlowHistoryResponse, type EtfFlowHistoryRow } from '../etf/etfFlowHistoryParser'

export type ZeroXRouterEtfFlowHistoryWindow =
  | Readonly<{ state: 'available'; btc: readonly EtfFlowHistoryRow[]; eth: readonly EtfFlowHistoryRow[] }>
  | Readonly<{ state: 'partial'; btc?: readonly EtfFlowHistoryRow[]; eth?: readonly EtfFlowHistoryRow[] }>
  | Readonly<{ state: 'unavailable' }>

type ZeroXRouterEtfFlowHistoryAsset = keyof typeof zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.urls
type ZeroXRouterEtfFlowHistoryParserTerminal = 'not-invoked' | 'available' | 'unavailable'

export type ZeroXRouterEtfFlowHistoryDiagnostic = Readonly<{
  asset: ZeroXRouterEtfFlowHistoryAsset
  transportStage: ZeroXRouterTransportRejectionStage | 'transport-succeeded'
  parser: ZeroXRouterEtfFlowHistoryParserTerminal
}>

export function createZeroXRouterEtfFlowHistoryClient(deps: {
  requestGovernanceQueue: ReturnType<typeof createSourceRequestGovernanceQueue>
}) {
  return {
    async requestWindow(apiKey: string, onDiagnostic?: (diagnostic: ZeroXRouterEtfFlowHistoryDiagnostic) => void): Promise<ZeroXRouterEtfFlowHistoryWindow> {
      if (!isSafeZeroXRouterApiKey(apiKey)) return unavailable()
      const [btc, eth] = await Promise.all([
        requestAsset('bitcoin', apiKey, deps.requestGovernanceQueue, onDiagnostic),
        requestAsset('ethereum', apiKey, deps.requestGovernanceQueue, onDiagnostic)
      ])
      if (btc && eth) return Object.freeze({ state: 'available' as const, btc, eth })
      if (btc || eth) return Object.freeze({ state: 'partial' as const, ...(btc ? { btc } : {}), ...(eth ? { eth } : {}) })
      return unavailable()
    }
  }
}

async function requestAsset(asset: ZeroXRouterEtfFlowHistoryAsset, apiKey: string, requestGovernanceQueue: ReturnType<typeof createSourceRequestGovernanceQueue>, onDiagnostic?: (diagnostic: ZeroXRouterEtfFlowHistoryDiagnostic) => void): Promise<readonly EtfFlowHistoryRow[] | undefined> {
  let parsed: ReturnType<typeof parseEtfFlowHistoryResponse> | undefined
  let transportStage: ZeroXRouterTransportRejectionStage | undefined
  try {
    const result = await requestGovernanceQueue.enqueue({
      sourceId: zeroXRouterSourcePolicy.sourceId,
      policy: zeroXRouterSourcePolicy.requestGovernance,
      apiKey,
      intent: 'automatic',
      run: () => requestZeroXRouterEtfFlowHistoryJson({
        url: zeroXRouterSourcePolicy.etfFlowHistoryDiagnostic.urls[asset], apiKey,
        accepts: (body) => {
          parsed = parseEtfFlowHistoryResponse(body)
          return parsed.state === 'available'
        },
        onRejectionStage: (stage) => { transportStage = stage }
      })
    })
    reportDiagnostic(onDiagnostic, { asset, transportStage: result.state === 'succeeded' ? 'transport-succeeded' : transportStage ?? 'transport-error', parser: parsed?.state ?? 'not-invoked' })
    return result.state === 'succeeded' && parsed?.state === 'available' ? parsed.rows : undefined
  } catch (error) {
    reportDiagnostic(onDiagnostic, { asset, transportStage: 'transport-error', parser: parsed?.state ?? 'not-invoked' })
    if (error instanceof SourceRequestGovernanceError) return undefined
    return undefined
  }
}

function reportDiagnostic(callback: ((diagnostic: ZeroXRouterEtfFlowHistoryDiagnostic) => void) | undefined, diagnostic: ZeroXRouterEtfFlowHistoryDiagnostic): void {
  try { callback?.(Object.freeze({ ...diagnostic })) } catch { /* Diagnostic observers cannot affect refresh. */ }
}

function unavailable(): Extract<ZeroXRouterEtfFlowHistoryWindow, { state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable' as const })
}
