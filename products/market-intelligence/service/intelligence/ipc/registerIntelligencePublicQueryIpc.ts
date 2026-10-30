import type { JobRuntime } from '@platform/jobs'
import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import type {
  EvidenceExcerptQueryInput,
  FundingRateHistoryQueryInput,
  FundingRateHistoryResult,
  CapitalConditionsSnapshotQueryInput,
  CapitalConditionsSnapshotResult,
  FearGreedSnapshotQueryInput,
  FearGreedSnapshotResult,
  MarketIntelligenceTimeBoundQueryInput
} from '../../../contracts/intelligenceQueryContracts'
import {
  fearGreedSnapshotPolicy as snapshotPolicy,
  fundingRateHistoryPolicy,
  isFundingRateHistoryRate,
  isCanonicalFundingRateHistoryTime,
  capitalConditionsSnapshotPolicy,
  isCanonicalCapitalConditionsSnapshotTime,
  isValidCapitalConditionsDailyFlows,
  isCanonicalFearGreedSnapshotTime,
  isFearGreedSnapshotScore,
  resolveFearGreedSnapshotBucket,
  isVisibleEtfPublicSnapshot,
  isWithinCapitalConditionsSnapshotDtoBudget,
  toEtfPublicSnapshot
} from '../../../contracts/intelligenceQueryContracts'
import {
  isCanonicalOpenInterestTime,
  isOpenInterestHistoryResult,
  isOpenInterestWindow,
  openInterestHistoryPolicy,
  type OpenInterestHistoryResult,
  type OpenInterestWindow
} from '../../../contracts/openInterestHistory'
import { getIntelligenceModule } from '../intelligenceModule'

const PRODUCT_ID = 'market-intelligence'

function asTimeBoundInput(input: unknown): MarketIntelligenceTimeBoundQueryInput {
  const value = (input ?? {}) as MarketIntelligenceTimeBoundQueryInput
  if (!value.asOf?.trim()) {
    throw new Error('asOf is required.')
  }
  return value
}

function asEvidenceInput(input: unknown): EvidenceExcerptQueryInput {
  const value = (input ?? {}) as EvidenceExcerptQueryInput
  if (!value.asOf?.trim()) {
    throw new Error('asOf is required.')
  }
  if (!value.evidenceRefId?.trim() && !value.itemId?.trim() && !value.impactId?.trim() && !value.clusterId?.trim()) {
    throw new Error('evidenceRefId, itemId, impactId, or clusterId is required.')
  }
  return value
}

export function registerIntelligencePublicQueryIpc(
  register: ProductIpcRegistrar,
  jobRuntime: JobRuntime
): void {
  const publicQueryService = () => getIntelligenceModule(jobRuntime).publicQueryService

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.querySentimentSnapshot, async (payload) =>
    publicQueryService().querySentimentSnapshot(asTimeBoundInput(payload))
  )

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.querySentimentSeries, async (payload) =>
    publicQueryService().querySentimentSeries(asTimeBoundInput(payload))
  )

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.queryRelatedEvents, async (payload) =>
    publicQueryService().queryRelatedEvents(asTimeBoundInput(payload))
  )

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.queryImpactTimeline, async (payload) =>
    publicQueryService().queryImpactTimeline(asTimeBoundInput(payload))
  )

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.getSourceHealth, async (payload) =>
    publicQueryService().getSourceHealth(asTimeBoundInput(payload))
  )

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.getEvidenceExcerpt, async (payload) =>
    publicQueryService().getEvidenceExcerpt(asEvidenceInput(payload))
  )

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFearGreedSnapshot, async (payload) => {
    try {
      const input = asFearGreedSnapshotInput(payload)
      if (!input) return snapshotUnavailable()
      return snapshotResult(await publicQueryService().queryFearGreedSnapshot(input), input)
    } catch {
      return snapshotUnavailable()
    }
  })

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.queryFundingRateHistory, async (payload) => {
    try {
      const input = asFundingRateHistoryInput(payload)
      if (!input) return fundingRateHistoryUnavailable()
      return fundingRateHistoryResult(await publicQueryService().queryFundingRateHistory(input), input)
    } catch { return fundingRateHistoryUnavailable() }
  })

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.queryOpenInterestHistory, async (payload) => {
    try {
      const input = asOpenInterestHistoryInput(payload)
      if (!input) return openInterestUnavailable()
      const value = await publicQueryService().queryOpenInterestHistory(input)
      return isOpenInterestHistoryResult(value, input.asOf, input.window) ? value : openInterestUnavailable()
    } catch { return openInterestUnavailable() }
  })

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot, async (payload) => {
    try {
      const input = asCapitalConditionsSnapshotInput(payload)
      if (!input) return capitalConditionsUnavailable()
      return capitalConditionsResult(await publicQueryService().queryCapitalConditionsSnapshot(input), input)
    } catch {
      return capitalConditionsUnavailable()
    }
  })
}

function asFearGreedSnapshotInput(value: unknown): FearGreedSnapshotQueryInput | undefined {
  return isExactDataRecord(value, ['asOf']) && isCanonicalFearGreedSnapshotTime(value.asOf) ? { asOf: value.asOf } : undefined
}

function snapshotResult(value: unknown, input: FearGreedSnapshotQueryInput): FearGreedSnapshotResult {
  if (isExactDataRecord(value, ['state', 'asOf', 'score', 'bucket', 'observedAt']) && value.state === 'available' &&
    value.asOf === input.asOf && isFearGreedSnapshotScore(value.score) &&
    isCanonicalFearGreedSnapshotTime(value.observedAt) && value.observedAt <= input.asOf) {
    const bucket = resolveFearGreedSnapshotBucket(value.score)
    if (bucket && value.bucket === bucket) return { state: 'available', asOf: value.asOf, score: value.score, bucket, observedAt: value.observedAt }
  }
  if (isExactDataRecord(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === input.asOf) return { state: 'empty', asOf: value.asOf }
  if (isExactDataRecord(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === snapshotPolicy.unavailableFailureCode) return snapshotUnavailable()
  return snapshotUnavailable()
}

function asOpenInterestHistoryInput(value: unknown): { asOf: string; window: OpenInterestWindow } | undefined {
  if (!isExactDataRecord(value, ['asOf', 'window'])) return undefined
  return isCanonicalOpenInterestTime(value.asOf) && isOpenInterestWindow(value.window) ? { asOf: value.asOf, window: value.window } : undefined
}

function asFundingRateHistoryInput(value: unknown): FundingRateHistoryQueryInput | undefined {
  return isExactDataRecord(value, ['asOf']) && isCanonicalFundingRateHistoryTime(value.asOf) ? { asOf: value.asOf } : undefined
}

function fundingRateHistoryResult(value: unknown, input: FundingRateHistoryQueryInput): FundingRateHistoryResult {
  if (isExactDataRecord(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === input.asOf) return { state: 'empty', asOf: input.asOf }
  if (isExactDataRecord(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === fundingRateHistoryPolicy.unavailableFailureCode) return fundingRateHistoryUnavailable()
  if (!isExactDataRecord(value, ['state', 'asOf', 'btc', 'eth']) || value.state !== 'available' || value.asOf !== input.asOf) return fundingRateHistoryUnavailable()
  const btc = fundingHistoryRows(value.btc, input.asOf)
  const eth = fundingHistoryRows(value.eth, input.asOf)
  if (!btc || !eth) return fundingRateHistoryUnavailable()
  const result = { state: 'available' as const, asOf: input.asOf, btc, eth }
  try { return new TextEncoder().encode(JSON.stringify(result)).byteLength <= fundingRateHistoryPolicy.maximumDtoBytes ? result : fundingRateHistoryUnavailable() } catch { return fundingRateHistoryUnavailable() }
}

function fundingHistoryRows(value: unknown, asOf: string): readonly { observedAt: string; ratePercent: number }[] | undefined {
  if (!Array.isArray(value) || value.length > fundingRateHistoryPolicy.maximumPointsPerAsset) return undefined
  let previous = ''
  return value.every((row) => isExactDataRecord(row, ['observedAt', 'ratePercent']) && isCanonicalFundingRateHistoryTime(row.observedAt) && row.observedAt <= asOf && row.observedAt > previous && isFundingRateHistoryRate(row.ratePercent) && (previous = row.observedAt) === row.observedAt)
    ? value.map((row) => ({ observedAt: row.observedAt as string, ratePercent: row.ratePercent as number })) : undefined
}

function asCapitalConditionsSnapshotInput(value: unknown): CapitalConditionsSnapshotQueryInput | undefined {
  return isExactDataRecord(value, ['asOf']) && isCanonicalCapitalConditionsSnapshotTime(value.asOf) ? { asOf: value.asOf } : undefined
}

function capitalConditionsResult(value: unknown, input: CapitalConditionsSnapshotQueryInput): CapitalConditionsSnapshotResult {
  if (isExactDataRecord(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === input.asOf) return { state: 'empty', asOf: input.asOf }
  if (isExactDataRecord(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === capitalConditionsSnapshotPolicy.unavailableFailureCode) return capitalConditionsUnavailable()
  if (isCapitalAvailableRecord(value) && value.state === 'available' && value.asOf === input.asOf &&
    (isExactDataRecord(value.etf, ['state']) && value.etf.state === 'unavailable' || isVisibleEtfPublicSnapshot(value.etf, input.asOf)) &&
    isStablecoinCoreRecord(value.coreStablecoins, input.asOf) &&
    isCapitalNumberSet(value.coreStablecoins) && value.conclusion === 'partial') {
    const result: CapitalConditionsSnapshotResult = {
      state: 'available', asOf: input.asOf, etf: isVisibleEtfPublicSnapshot(value.etf, input.asOf) ? toEtfPublicSnapshot(value.etf)! : { state: 'unavailable' },
      coreStablecoins: {
        observedAt: value.coreStablecoins.observedAt as string, verifiedAt: value.coreStablecoins.verifiedAt as string,
        currentUsd: value.coreStablecoins.currentUsd as number, change1dUsd: value.coreStablecoins.change1dUsd as number,
        change1dPercent: value.coreStablecoins.change1dPercent as number, change7dUsd: value.coreStablecoins.change7dUsd as number,
        change7dPercent: value.coreStablecoins.change7dPercent as number, change30dUsd: value.coreStablecoins.change30dUsd as number,
        change30dPercent: value.coreStablecoins.change30dPercent as number,
        ...(value.coreStablecoins.dailyFlows ? { dailyFlows: value.coreStablecoins.dailyFlows as readonly { tradingDate: string; netFlowUsd: number }[] } : {})
      }, ...(typeof value.usdStablecoinSupplyUsd === 'number' && Number.isFinite(value.usdStablecoinSupplyUsd) && !Object.is(value.usdStablecoinSupplyUsd, -0)
        ? { usdStablecoinSupplyUsd: value.usdStablecoinSupplyUsd } : {}), conclusion: 'partial'
    }
    return isWithinCapitalConditionsSnapshotDtoBudget(result) ? result : capitalConditionsUnavailable()
  }
  return capitalConditionsUnavailable()
}

function isCapitalAvailableRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const fields = Object.getOwnPropertyNames(value)
  const expected = ['state', 'asOf', 'etf', 'coreStablecoins', 'conclusion']
  return fields.length === expected.length || fields.length === expected.length + 1
    ? isExactDataRecord(value, fields) && expected.every((field) => fields.includes(field)) && fields.every((field) => expected.includes(field) || field === 'usdStablecoinSupplyUsd')
    : false
}

function isCapitalNumberSet(value: Record<string, unknown>): boolean {
  return isCanonicalCapitalConditionsSnapshotTime(value.observedAt) && isCanonicalCapitalConditionsSnapshotTime(value.verifiedAt) &&
    value.observedAt <= value.verifiedAt && ['currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent']
      .every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && !Object.is(value[key], -0))
}

function isStablecoinCoreRecord(value: unknown, asOf: string): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const fields = Object.getOwnPropertyNames(value)
  const required = ['observedAt', 'verifiedAt', 'currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent']
  if (!(fields.length === required.length || fields.length === required.length + 1) || !isExactDataRecord(value, fields) || !required.every((field) => fields.includes(field))) return false
  if (fields.includes('dailyFlows') && !isValidCapitalConditionsDailyFlows(value.dailyFlows, asOf)) return false
  return fields.every((field) => required.includes(field) || field === 'dailyFlows')
}

function isExactDataRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return descriptor?.enumerable === true && 'value' in descriptor
    })
  } catch {
    return false
  }
}

function snapshotUnavailable(): Extract<FearGreedSnapshotResult, { state: 'unavailable' }> {
  return { state: 'unavailable', failureCode: snapshotPolicy.unavailableFailureCode }
}

function openInterestUnavailable(): Extract<OpenInterestHistoryResult, { state: 'unavailable' }> {
  return { state: 'unavailable', failureCode: openInterestHistoryPolicy.unavailableFailureCode }
}

function fundingRateHistoryUnavailable(): Extract<FundingRateHistoryResult, { state: 'unavailable' }> {
  return { state: 'unavailable', failureCode: fundingRateHistoryPolicy.unavailableFailureCode }
}

function capitalConditionsUnavailable(): Extract<CapitalConditionsSnapshotResult, { state: 'unavailable' }> {
  return { state: 'unavailable', failureCode: capitalConditionsSnapshotPolicy.unavailableFailureCode }
}
