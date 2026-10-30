import {
  capitalConditionsSnapshotPolicy,
  etfPublicSnapshotPolicy,
  isValidEtfPublicSnapshot,
  isWithinCapitalConditionsSnapshotDtoBudget,
  type EtfPublicSnapshot,
  isCanonicalCapitalConditionsSnapshotTime,
  type CapitalConditionsSnapshotQueryInput,
  type CapitalConditionsSnapshotResult
} from '../../../contracts/intelligenceQueryContracts'

import type { CapitalConditionsCurrentStateStore, CapitalConditionsSnapshotState } from './stablecoinCapitalCurrentStateStore'
import type { EtfCurrentStateStore } from '../store/etfCurrentStateStore'

export const capitalConditionsSafeQueryPolicy = Object.freeze({
  ...capitalConditionsSnapshotPolicy,
  exactInputFields: ['asOf', 'allowStale']
})

export type CapitalConditionsSnapshotQueryResult = CapitalConditionsSnapshotResult

export function createCapitalConditionsSnapshotQueryService(deps: {
  store: CapitalConditionsCurrentStateStore
  etfStore?: EtfCurrentStateStore
  isEnabled?: () => Promise<boolean>
}) {
  return {
    async query(input: CapitalConditionsSnapshotQueryInput): Promise<CapitalConditionsSnapshotQueryResult> {
      if (!isExactInput(input)) return unavailable()
      try {
        if (deps.isEnabled && !await deps.isEnabled()) return unavailable()
        const state = await deps.store.read()
        const snapshot = state?.snapshot
        const lastSuccessAt = state?.health.lastSuccessAt
        if (!snapshot || !lastSuccessAt || !isCanonicalCapitalConditionsSnapshotTime(snapshot.observedAt) || !isCanonicalCapitalConditionsSnapshotTime(snapshot.verifiedAt) || !isCanonicalCapitalConditionsSnapshotTime(lastSuccessAt) || snapshot.observedAt > snapshot.verifiedAt || snapshot.verifiedAt !== lastSuccessAt) {
          return state ? unavailable() : Object.freeze({ state: 'empty' as const, asOf: input.asOf })
        }
        if (input.asOf < snapshot.verifiedAt) return Object.freeze({ state: 'empty' as const, asOf: input.asOf })
        if (snapshot.dailyFlows && snapshot.dailyFlows.length > 0 && input.asOf.slice(0, 10) < snapshot.dailyFlows[0]!.tradingDate) {
          return Object.freeze({ state: 'empty' as const, asOf: input.asOf })
        }
        const ageMs = Date.parse(input.asOf) - Date.parse(lastSuccessAt)
        if (!Number.isFinite(ageMs) || ageMs < 0) return unavailable()
        if (!input.allowStale && ageMs > capitalConditionsSafeQueryPolicy.maximumAgeMs) return unavailable()
        if (!isValidSnapshot(snapshot)) return unavailable()

        const etf = deps.etfStore ? await projectEtf(deps.etfStore, input.asOf, input.allowStale === true) : Object.freeze({ state: 'unavailable' as const })
        const result = Object.freeze({
          state: 'available' as const,
          asOf: input.asOf,
          etf,
          coreStablecoins: Object.freeze({
            observedAt: snapshot.observedAt,
            verifiedAt: snapshot.verifiedAt,
            currentUsd: snapshot.coreCurrentUsd,
            change1dUsd: snapshot.change1dUsd,
            change1dPercent: snapshot.change1dPercent,
            change7dUsd: snapshot.change7dUsd,
            change7dPercent: snapshot.change7dPercent,
            change30dUsd: snapshot.change30dUsd,
            change30dPercent: snapshot.change30dPercent,
            ...(snapshot.dailyFlows ? { dailyFlows: snapshot.dailyFlows.filter((row) => row.tradingDate <= input.asOf.slice(0, 10)) } : {})
          }),
          ...(snapshot.usdStablecoinSupplyUsd === undefined ? {} : { usdStablecoinSupplyUsd: snapshot.usdStablecoinSupplyUsd }),
          conclusion: snapshot.change30dUsd === 0 ? 'unavailable' as const : 'partial' as const
        })
        return isWithinCapitalConditionsSnapshotDtoBudget(result) ? result : unavailable()
      } catch {
        return unavailable()
      }
    }
  }
}

async function projectEtf(store: EtfCurrentStateStore, asOf: string, allowStale = false): Promise<EtfPublicSnapshot | { state: 'unavailable' }> {
  const available = await store.readAvailable({ asOf, allowStale })
  if (available.state !== 'available') return Object.freeze({ state: 'unavailable' as const })
  const { window, verifiedAt } = available
  const dto: EtfPublicSnapshot = Object.freeze({
    state: 'available', schemaVersion: etfPublicSnapshotPolicy.schemaVersion, sourceId: etfPublicSnapshotPolicy.sourceId,
    windowEnd: window.windowEnd, verifiedAt,
    btc: Object.freeze({ asset: 'BTC', rows: Object.freeze(window.btc.map(({ tradingDate, netFlowUsd, observedAt }) => Object.freeze({ tradingDate, netFlowUsd, observedAt }))) }),
    eth: Object.freeze({ asset: 'ETH', rows: Object.freeze(window.eth.map(({ tradingDate, netFlowUsd, observedAt }) => Object.freeze({ tradingDate, netFlowUsd, observedAt }))) })
  })
  return isValidEtfPublicSnapshot(dto) ? dto : Object.freeze({ state: 'unavailable' as const })
}

function isExactInput(value: unknown): value is CapitalConditionsSnapshotQueryInput {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) return false
    const names = Object.getOwnPropertyNames(value)
    if (!names.every((name) => capitalConditionsSafeQueryPolicy.exactInputFields.includes(name))) return false
    const descriptor = Object.getOwnPropertyDescriptor(value, 'asOf')
    const stale = Object.getOwnPropertyDescriptor(value, 'allowStale')
    return Boolean(descriptor?.enumerable && 'value' in descriptor && isCanonicalCapitalConditionsSnapshotTime(descriptor.value) && (!stale || (stale.enumerable && 'value' in stale && typeof stale.value === 'boolean')))
  } catch {
    return false
  }
}

export function isCanonicalCapitalConditionsTime(value: unknown): value is string {
  return isCanonicalCapitalConditionsSnapshotTime(value)
}

function isValidSnapshot(snapshot: CapitalConditionsSnapshotState): boolean {
  return [
    snapshot.coreCurrentUsd,
    snapshot.change1dUsd,
    snapshot.change1dPercent,
    snapshot.change7dUsd,
    snapshot.change7dPercent,
    snapshot.change30dUsd,
    snapshot.change30dPercent,
    snapshot.usdStablecoinSupplyUsd
  ].every((value) => value === undefined || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER))
}

function unavailable(): Extract<CapitalConditionsSnapshotQueryResult, { state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable', failureCode: capitalConditionsSafeQueryPolicy.unavailableFailureCode })
}
