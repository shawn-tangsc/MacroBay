import type { FundingRateHistoryStore, FundingRateHistoryPoint } from '../store/fundingRateHistoryStore'

export const fundingRateCollectionWindowPolicy = Object.freeze({
  sourceId: 'binance-futures-positioning',
  endpoint: 'https://fapi.binance.com/fapi/v1/fundingRate',
  method: 'GET' as const,
  limit: 22,
  assets: Object.freeze({ btc: Object.freeze({ asset: 'btc' as const, symbol: 'BTCUSDT' }), eth: Object.freeze({ asset: 'eth' as const, symbol: 'ETHUSDT' }) }),
  timeoutMs: 15_000,
  maximumResponseBytes: 256 * 1024
})

type FundingRateHistoryRequest = Readonly<{ state: 'available'; btc: readonly FundingRateHistoryPoint[]; eth: readonly FundingRateHistoryPoint[] } | { state: 'unavailable' }>

export function createFundingRateHistoryRefreshService(deps: {
  isEnabled: () => Promise<boolean>
  requestHistory: (input: { btc: typeof fundingRateCollectionWindowPolicy.assets.btc; eth: typeof fundingRateCollectionWindowPolicy.assets.eth }) => Promise<FundingRateHistoryRequest>
  store: Pick<FundingRateHistoryStore, 'upsert'>
  now: () => string
}) {
  return {
    async refresh(): Promise<Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>> {
      try {
        if (!await deps.isEnabled()) return unavailable()
        const collectedAt = deps.now()
        if (!isCanonicalUtc(collectedAt)) return unavailable()
        const requested = await deps.requestHistory({ btc: fundingRateCollectionWindowPolicy.assets.btc, eth: fundingRateCollectionWindowPolicy.assets.eth })
        if (requested.state !== 'available') return unavailable()
        return await deps.store.upsert({ btc: requested.btc, eth: requested.eth, collectedAt })
      } catch {
        return unavailable()
      }
    }
  }
}

function isCanonicalUtc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function unavailable(): Readonly<{ state: 'unavailable' }> { return { state: 'unavailable' } }
