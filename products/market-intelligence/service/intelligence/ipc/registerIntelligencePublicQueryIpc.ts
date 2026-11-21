import type { JobRuntime } from '@platform/jobs'

import type { IntelligenceModule } from '../intelligenceModule'
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
  FearGreedCardSection,
  OptionSkewCardSection,
  OptionSkewDirection,
  SentimentOptionsCardQueryInput,
  SentimentOptionsCardResult,
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
import { divergenceUnavailable, isCanonicalDivergenceTime, isMarketDivergenceResult } from '../../../contracts/marketDivergence'
import { isValidTimeZone } from '../public-query/sentimentOptionsCardPolicy'
import { isCanonicalSignalTime } from '../../../contracts/moduleSignal'
import type { ModuleSignalRead } from '../../../contracts/moduleSignalRead'
import {
  isCanonicalOpenInterestTime,
  isOpenInterestHistoryResult,
  isOpenInterestWindow,
  openInterestHistoryPolicy,
  type OpenInterestHistoryResult,
  type OpenInterestWindow
} from '../../../contracts/openInterestHistory'

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
  jobRuntime: JobRuntime,
  intelligenceModule: IntelligenceModule
): void {
  const publicQueryService = () => intelligenceModule.publicQueryService

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

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.querySentimentOptionsCard, async (payload) => {
    try {
      const input = asSentimentOptionsCardInput(payload)
      if (!input) return sentimentOptionsCardUnavailable(payload)
      return sentimentOptionsCardResult(await publicQueryService().querySentimentOptionsCard(input), input)
    } catch {
      return sentimentOptionsCardUnavailable(payload)
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

  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.queryMarketDivergence, async (payload) => {
    try {
      const input = asMarketDivergenceInput(payload)
      // The three faults are kept apart so a reader (and a developer) can tell which layer refused.
      if (!input) return divergenceUnavailable('bad-payload')
      const value = await publicQueryService().queryMarketDivergence(input)
      return isMarketDivergenceResult(value, input.asOf) ? value : divergenceUnavailable('bad-answer')
    } catch { return divergenceUnavailable('query-failed') }
  })

  /**
   * The signals with each one's analysis state beside them — the one read the two cards use.
   *
   * It was a separate method while the callers switched over; the old plain-signal method is gone
   * now, so there is exactly one door and no second shape to keep in step. Registered here means it
   * must also be in the startup baseline in the same change — a registered method missing from that
   * list is an app that refuses to start.
   */
  register(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.queryModuleSignalRead, async (payload) => {
    // 牌子的判定**固定 24 小时**（用户 2026-11-08 10:4x 定）：那颗牌子是「现在怎么样」的
    // 状态指示，三天前的命中挂到标题边，读者会当成刚发生。历史归图，现状归标题。
    if (!isExactDataRecord(payload, ['asOf']) || !isCanonicalSignalTime(payload.asOf)) {
      return { state: 'unavailable', failureCode: 'invalid-as-of' } satisfies ModuleSignalRead
    }
    try {
      return await publicQueryService().queryModuleSignalRead({ asOf: payload.asOf })
    } catch {
      return { state: 'unavailable', failureCode: 'query-failed' } satisfies ModuleSignalRead
    }
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

/** Exported for its guard test: the payload shape is what broke the two-pass read once. */
export function asMarketDivergenceInput(value: unknown): { asOf: string } | undefined {
  if (!isExactDataRecord(value, ['asOf'])) return undefined
  return isCanonicalDivergenceTime(value.asOf) ? { asOf: value.asOf } : undefined
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
      }, conclusion: 'partial'
    }
    return isWithinCapitalConditionsSnapshotDtoBudget(result) ? result : capitalConditionsUnavailable()
  }
  return capitalConditionsUnavailable()
}

function isCapitalAvailableRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const fields = Object.getOwnPropertyNames(value)
  const expected = ['state', 'asOf', 'etf', 'coreStablecoins', 'conclusion']
  return fields.length === expected.length &&
    isExactDataRecord(value, fields) && expected.every((field) => fields.includes(field))
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

const DAY_LABEL_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function asSentimentOptionsCardInput(value: unknown): SentimentOptionsCardQueryInput | undefined {
  if (!isExactDataRecord(value, ['asOf', 'timeZone', 'windowDays'])) return undefined
  if (!isCanonicalFearGreedSnapshotTime(value.asOf)) return undefined
  if (!isValidTimeZone(value.timeZone)) return undefined
  if (value.windowDays !== 30 && value.windowDays !== 90) return undefined
  return { asOf: value.asOf, timeZone: value.timeZone, windowDays: value.windowDays }
}

/**
 * Rebuilds the composite answer from an untrusted service result: unknown keys, getters, wrong
 * day labels and a section that does not match the requested input all fail closed to two
 * `unavailable` sections. Nothing from the payload is forwarded by reference.
 */
function sentimentOptionsCardResult(value: unknown, input: SentimentOptionsCardQueryInput): SentimentOptionsCardResult {
  const fallback = sentimentOptionsCardUnavailable(input)
  if (!isExactDataRecord(value, ['asOf', 'windowDays', 'timeZone', 'fearGreed', 'optionSkew'])) return fallback
  if (value.asOf !== input.asOf || value.timeZone !== input.timeZone || value.windowDays !== input.windowDays) return fallback
  const fearGreed = fearGreedSection(value.fearGreed, input)
  const optionSkew = optionSkewSection(value.optionSkew, input)
  if (!fearGreed || !optionSkew) return fallback
  return { asOf: input.asOf, windowDays: input.windowDays, timeZone: input.timeZone, fearGreed, optionSkew }
}

function fearGreedSection(value: unknown, input: SentimentOptionsCardQueryInput): FearGreedCardSection | undefined {
  if (isExactDataRecord(value, ['state', 'failureCode'])) {
    return value.state === 'unavailable' && value.failureCode === snapshotPolicy.unavailableFailureCode
      ? { state: 'unavailable', failureCode: snapshotPolicy.unavailableFailureCode }
      : undefined
  }
  if (isExactDataRecord(value, ['state']) && value.state === 'empty') return { state: 'empty' }
  const required = ['state', 'score', 'bucket', 'observedAt', 'latestDay', 'daysAgo', 'stale', 'seriesStart', 'points']
  const withPercentile = isExactDataRecord(value, [...required, 'percentile'])
  if (!withPercentile && !isExactDataRecord(value, required)) return undefined
  if (value.state !== 'available' || !isFearGreedSnapshotScore(value.score)) return undefined
  const bucket = resolveFearGreedSnapshotBucket(value.score)
  if (!bucket || value.bucket !== bucket) return undefined
  if (!isCanonicalFearGreedSnapshotTime(value.observedAt) || value.observedAt > input.asOf) return undefined
  if (typeof value.latestDay !== 'string' || !DAY_LABEL_PATTERN.test(value.latestDay)) return undefined
  if (!Number.isSafeInteger(value.daysAgo) || (value.daysAgo as number) < 0) return undefined
  if (typeof value.stale !== 'boolean') return undefined
  if (typeof value.seriesStart !== 'string' || !DAY_LABEL_PATTERN.test(value.seriesStart)) return undefined
  if (!Array.isArray(value.points)) return undefined
  const points: Array<{ day: string; observedAt: string; score: number; bucket: typeof bucket }> = []
  for (const point of value.points) {
    if (!isExactDataRecord(point, ['day', 'observedAt', 'score', 'bucket'])) return undefined
    if (typeof point.day !== 'string' || !DAY_LABEL_PATTERN.test(point.day)) return undefined
    if (!isCanonicalFearGreedSnapshotTime(point.observedAt) || point.observedAt > input.asOf) return undefined
    if (!isFearGreedSnapshotScore(point.score)) return undefined
    const pointBucket = resolveFearGreedSnapshotBucket(point.score)
    if (!pointBucket || point.bucket !== pointBucket) return undefined
    points.push({ day: point.day, observedAt: point.observedAt, score: point.score, bucket: pointBucket })
  }
  let percentile: { value: number; basisDays: number; from: string; to: string } | undefined
  if (withPercentile) {
    const candidate = value.percentile
    if (!isExactDataRecord(candidate, ['value', 'basisDays', 'from', 'to'])) return undefined
    if (!Number.isSafeInteger(candidate.value) || (candidate.value as number) < 0 || (candidate.value as number) > 100) return undefined
    if (!Number.isSafeInteger(candidate.basisDays) || (candidate.basisDays as number) < 300) return undefined
    if (typeof candidate.from !== 'string' || !DAY_LABEL_PATTERN.test(candidate.from)) return undefined
    if (typeof candidate.to !== 'string' || !DAY_LABEL_PATTERN.test(candidate.to)) return undefined
    percentile = { value: candidate.value as number, basisDays: candidate.basisDays as number, from: candidate.from, to: candidate.to }
  }
  return {
    state: 'available', score: value.score, bucket, observedAt: value.observedAt,
    latestDay: value.latestDay, daysAgo: value.daysAgo as number, stale: value.stale,
    seriesStart: value.seriesStart, points, ...(percentile === undefined ? {} : { percentile })
  }
}

function optionSkewSection(value: unknown, input: SentimentOptionsCardQueryInput): OptionSkewCardSection | undefined {
  if (isExactDataRecord(value, ['state', 'failureCode', 'cause'])) {
    if (value.state !== 'unavailable') return undefined
    if (value.failureCode !== 'option-skew-collect-unavailable') return undefined
    if (value.cause !== 'connection-unavailable' && value.cause !== 'upstream-http-error') return undefined
    return { state: 'unavailable', failureCode: 'option-skew-collect-unavailable', cause: value.cause }
  }
  if (isExactDataRecord(value, ['state', 'failureCode'])) {
    return value.state === 'unavailable' && value.failureCode === 'option-skew-query-unavailable'
      ? { state: 'unavailable', failureCode: 'option-skew-query-unavailable' }
      : undefined
  }
  if (isExactDataRecord(value, ['state']) && value.state === 'empty') return { state: 'empty' }
  // 源还没接入（readiness planned/pending）是第三种「没有读数」，不是坏数据：漏了这一支，
  // 整卡会被判成回退两段 unavailable，读者看到的是「读取失败」。
  if (isExactDataRecord(value, ['state']) && value.state === 'not-connected') return { state: 'not-connected' }
  if (!isExactDataRecord(value, ['state', 'latest', 'direction', 'observedAt', 'latestDay', 'daysAgo', 'stale', 'seriesStart', 'points'])) return undefined
  if (value.state !== 'available') return undefined
  if (!isExactDataRecord(value.latest, ['riskReversal', 'observedAt', 'tenorDays', 'putIv25', 'callIv25', 'expiries'])) return undefined
  const latest = value.latest
  if (typeof latest.riskReversal !== 'number' || !Number.isFinite(latest.riskReversal)) return undefined
  if (typeof latest.putIv25 !== 'number' || !Number.isFinite(latest.putIv25)) return undefined
  if (typeof latest.callIv25 !== 'number' || !Number.isFinite(latest.callIv25)) return undefined
  if (latest.tenorDays !== 30) return undefined
  if (!Array.isArray(latest.expiries) || latest.expiries.length !== 2 || !latest.expiries.every((entry) => typeof entry === 'string')) return undefined
  if (!isCanonicalFearGreedSnapshotTime(latest.observedAt) || latest.observedAt > input.asOf) return undefined
  const direction = skewDirection(value.direction)
  if (!direction) return undefined
  if (!isCanonicalFearGreedSnapshotTime(value.observedAt) || value.observedAt > input.asOf) return undefined
  if (typeof value.latestDay !== 'string' || !DAY_LABEL_PATTERN.test(value.latestDay)) return undefined
  if (!Number.isSafeInteger(value.daysAgo) || (value.daysAgo as number) < 0) return undefined
  if (typeof value.stale !== 'boolean') return undefined
  if (typeof value.seriesStart !== 'string' || !DAY_LABEL_PATTERN.test(value.seriesStart)) return undefined
  if (!Array.isArray(value.points)) return undefined
  const points: Array<{ day: string; observedAt: string; riskReversal: number }> = []
  for (const point of value.points) {
    if (!isExactDataRecord(point, ['day', 'observedAt', 'riskReversal'])) return undefined
    if (typeof point.day !== 'string' || !DAY_LABEL_PATTERN.test(point.day)) return undefined
    if (!isCanonicalFearGreedSnapshotTime(point.observedAt) || point.observedAt > input.asOf) return undefined
    if (typeof point.riskReversal !== 'number' || !Number.isFinite(point.riskReversal)) return undefined
    points.push({ day: point.day, observedAt: point.observedAt, riskReversal: point.riskReversal })
  }
  return {
    state: 'available',
    latest: {
      riskReversal: latest.riskReversal, observedAt: latest.observedAt, tenorDays: 30,
      putIv25: latest.putIv25, callIv25: latest.callIv25, expiries: [latest.expiries[0] as string, latest.expiries[1] as string]
    },
    direction, observedAt: value.observedAt, latestDay: value.latestDay, daysAgo: value.daysAgo as number,
    stale: value.stale, seriesStart: value.seriesStart, points
  }
}

function skewDirection(value: unknown): OptionSkewDirection | undefined {
  if (isExactDataRecord(value, ['kind'])) {
    return value.kind === 'steeper' || value.kind === 'flatter' || value.kind === 'flat' ? { kind: value.kind } : undefined
  }
  if (isExactDataRecord(value, ['kind', 'reason'])) {
    if (value.kind !== 'unknown') return undefined
    return value.reason === 'insufficient' || value.reason === 'stale' || value.reason === 'discontinuous'
      ? { kind: 'unknown', reason: value.reason }
      : undefined
  }
  return undefined
}

function sentimentOptionsCardUnavailable(input: unknown): SentimentOptionsCardResult {
  const record = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const windowDays = record.windowDays === 90 ? 90 : 30
  return {
    asOf: typeof record.asOf === 'string' ? record.asOf : '1970-01-01T00:00:00.000Z',
    windowDays,
    timeZone: typeof record.timeZone === 'string' ? record.timeZone : 'UTC',
    fearGreed: { state: 'unavailable', failureCode: snapshotPolicy.unavailableFailureCode },
    optionSkew: { state: 'unavailable', failureCode: 'option-skew-query-unavailable' }
  }
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
