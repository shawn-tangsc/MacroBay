/**
 * The capital-conditions DTO shapes, kept apart from the query contracts they belong to.
 *
 * They were extracted only to keep the contract file under its size baseline; nothing here
 * imports the contract module, so the direction stays one-way.
 *
 * `capitalConditionsSnapshotResult` is re-exported from `intelligenceQueryContracts`, which is
 * still the module consumers import from.
 */

export type CapitalConditionsSnapshotQueryInput = {
  asOf: string
  /** Daily briefing may read a stale snapshot with its observedAt; normal queries stay strict. */
  allowStale?: boolean
}

export type EtfPublicFlow = Readonly<{
  tradingDate: string
  netFlowUsd: number
  observedAt: string
}>

export type EtfPublicAssetSnapshot = Readonly<{
  asset: 'BTC' | 'ETH'
  rows: readonly EtfPublicFlow[]
}>

export type EtfPublicSnapshot = Readonly<{
  state: 'available'
  schemaVersion: 1
  sourceId: '0xrouter'
  windowEnd: string
  verifiedAt: string
  btc: EtfPublicAssetSnapshot
  eth: EtfPublicAssetSnapshot
}>

export type CapitalConditionsSnapshotResult =
  | {
      state: 'available'
      asOf: string
      etf: EtfPublicSnapshot | { state: 'unavailable' }
      coreStablecoins: {
        observedAt: string
        verifiedAt: string
        currentUsd: number
        change1dUsd: number
        change1dPercent: number
        change7dUsd: number
        change7dPercent: number
        change30dUsd: number
        change30dPercent: number
        dailyFlows?: readonly { tradingDate: string; netFlowUsd: number }[]
      }
      conclusion: 'partial' | 'unavailable'
    }
  | { state: 'empty'; asOf: string }
  | { state: 'unavailable'; failureCode: 'capital-conditions-query-unavailable' }
