import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { DailyBriefBackfillExecutor, DailyBriefDataGap } from './dailyBriefAgentTurn'
import { collectDataGaps } from './dailyBriefAgentTurn'
import { DAILY_BRIEFING_SOURCE_IDS } from './dailyBriefingReadingSources'
import {
  isCanonicalDailyBriefBackfillTime,
  isDailyBriefBackfillResult,
  type DailyBriefBackfillGapCode
} from '../public-query/dailyBriefBackfill'
import {
  dailyBriefFactEnsureKey,
  type DailyBriefFactEnsureCache,
  type DailyBriefFactEnsureEntry
} from './dailyBriefFactEnsureCache'
import {
  dailyBriefCoreFactEnsurePolicy,
  isDailyBriefCoreFactMetric,
  type DailyBriefCoreFactMetric
} from './dailyBriefCoreFactPolicy'
import { applyCoreFacts, withCoreFactSupplements } from './dailyBriefCoreFactPatch'

export { dailyBriefCoreFactEnsurePolicy, isDailyBriefCoreFactMetric }
export type { DailyBriefCoreFactMetric }

/**
 * The deterministic core-fact backfill.
 *
 * The daily brief is frozen at its cutoff but may be generated hours later, and the app may start
 * long after that cutoff. The Agent's backfill protocol is a request the model may or may not make;
 * this service is the guarantee: it reads the document's own core gaps, asks the existing backfill
 * executor (never a second fetch path), and patches only those numbered rows. It is pure with
 * respect to the document: the caller decides whether to persist the returned document, and there is
 * no write to an official calendar actual, news text or prose.
 *
 * Only the seven numeric core rows are in scope. Funding, open interest, news and calendar
 * consensus stay with the Agent protocol. A row that already carries a value (`stale`) is not
 * touched: the backfill answers "newest at or before the cutoff", which can be older than the point
 * the row already holds.
 */

export type DailyBriefCoreFactEnsureResult = Readonly<{
  document: DailyBriefingDocument
  changed: boolean
  filled: readonly DailyBriefCoreFactMetric[]
  statuses: readonly DailyBriefFactEnsureEntry[]
}>

export type DailyBriefFactEnsure = Readonly<{
  ensure: (input: Readonly<{
    document: DailyBriefingDocument
    cutoff: string
    trigger?: 'startup' | 'generation'
  }>) => Promise<DailyBriefCoreFactEnsureResult>
}>

export type DailyBriefFactEnsureDeps = Readonly<{
  /** The existing executor factory. It binds the cutoff and shares its readers within that cutoff. */
  backfillFor: (cutoff: string) => DailyBriefBackfillExecutor
  cache: DailyBriefFactEnsureCache
  /** `undefined` is "the profile store could not answer", which is not the same as disabled. */
  isSourceEnabled: (sourceId: string) => Promise<boolean | undefined>
  now?: () => string
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
}>

const METRIC_SOURCES: Readonly<Record<DailyBriefCoreFactMetric, readonly string[]>> = Object.freeze({
  'core-stablecoin-supply-usd': Object.freeze([DAILY_BRIEFING_SOURCE_IDS.stablecoin]),
  'etf-net-flow-btc': Object.freeze([DAILY_BRIEFING_SOURCE_IDS.etf]),
  'etf-net-flow-eth': Object.freeze([DAILY_BRIEFING_SOURCE_IDS.etf]),
  // The dollar has two writers; the projection prefers the licensed series and falls back to the
  // product's own basket, so either switch makes the metric readable.
  'dxy-level': Object.freeze([DAILY_BRIEFING_SOURCE_IDS.dxyReal, DAILY_BRIEFING_SOURCE_IDS.dxySynthetic]),
  'gold-level-usd': Object.freeze([DAILY_BRIEFING_SOURCE_IDS.gold]),
  'us10y-yield-percent': Object.freeze([DAILY_BRIEFING_SOURCE_IDS.rates]),
  'us10y-real-yield-percent': Object.freeze([DAILY_BRIEFING_SOURCE_IDS.rates])
})

export function createDailyBriefFactEnsure(deps: DailyBriefFactEnsureDeps): DailyBriefFactEnsure {
  const now = deps.now ?? (() => new Date().toISOString())
  const inFlight = new Map<string, Promise<DailyBriefFactEnsureEntry>>()

  async function safeGet(key: string): Promise<DailyBriefFactEnsureEntry | undefined> {
    try {
      return await deps.cache.get(key)
    } catch {
      return undefined
    }
  }

  async function safePut(entry: DailyBriefFactEnsureEntry): Promise<void> {
    try {
      await deps.cache.put(entry)
    } catch {
      deps.onEvent?.({ event: 'cache-write-failed', metric: entry.metric })
    }
  }

  async function gate(metric: DailyBriefCoreFactMetric): Promise<'enabled' | 'disabled' | 'unknown'> {
    let unknown = false
    for (const sourceId of METRIC_SOURCES[metric]) {
      let enabled: boolean | undefined
      try {
        enabled = await deps.isSourceEnabled(sourceId)
      } catch {
        enabled = undefined
      }
      if (enabled === true) return 'enabled'
      if (enabled === undefined) unknown = true
    }
    return unknown ? 'unknown' : 'disabled'
  }

  async function readOnce(input: Readonly<{
    key: string
    gap: DailyBriefDataGap
    metric: DailyBriefCoreFactMetric
    editionDate: string
    executor: DailyBriefBackfillExecutor
    prior: DailyBriefFactEnsureEntry | undefined
    nowIso: string
  }>): Promise<DailyBriefFactEnsureEntry> {
    const running = inFlight.get(input.key)
    if (running) return running
    const pending = (async (): Promise<DailyBriefFactEnsureEntry> => {
      let result: unknown
      try {
        result = await input.executor({ source: input.gap.source, metric: input.gap.metric, asOf: input.gap.asOf })
      } catch {
        result = undefined
      }
      const entry = toEntry(result, input)
      await safePut(entry)
      return entry
    })().finally(() => inFlight.delete(input.key))
    inFlight.set(input.key, pending)
    return pending
  }

  return {
    async ensure(input) {
      const original = input.document
      const editionDate = original.edition.date
      const asOf = original.edition.windowEnd
      const nowIso = readNow(now)
      const statuses: DailyBriefFactEnsureEntry[] = []
      const empty: DailyBriefCoreFactEnsureResult = { document: original, changed: false, filled: [], statuses }
      try {
        // Keep the cache's retention in step with the brief's; a failure here is not a reason to
        // skip the read, only to leave old rows behind.
        try {
          await deps.cache.prune(addDays(editionDate, -dailyBriefCoreFactEnsurePolicy.retentionDays))
        } catch {
          deps.onEvent?.({ event: 'cache-prune-failed' })
        }
        if (!isCanonicalDailyBriefBackfillTime(asOf) || !isCanonicalDailyBriefBackfillTime(input.cutoff)) {
          for (const gap of coreGaps(original)) statuses.push(gapEntry(gap, editionDate, 'invalid-as-of', nowIso, 'the edition cutoff is not a canonical UTC instant.'))
          return { ...empty, statuses }
        }
        const gaps = coreGaps(original)
        if (gaps.length === 0) return empty
        if (asOf > input.cutoff || asOf > nowIso) {
          for (const gap of gaps) {
            statuses.push(gapEntry(gap, editionDate, 'future-as-of', nowIso, 'the edition cutoff is after the current time or the requested cutoff.'))
          }
          return { ...empty, statuses }
        }

        const facts = new Map<DailyBriefCoreFactMetric, DailyBriefFactEnsureEntry>()
        let executor: DailyBriefBackfillExecutor | undefined
        for (const gap of gaps) {
          const metric = gap.metric as DailyBriefCoreFactMetric
          const gateResult = await gate(metric)
          if (gateResult === 'disabled') {
            statuses.push(gapEntry(gap, editionDate, 'source-disabled', nowIso, 'the source is switched off; the gap stays.'))
            continue
          }
          if (gateResult === 'unknown') {
            statuses.push(gapEntry(gap, editionDate, 'query-unavailable', nowIso, 'the source switch could not be read.'))
            continue
          }
          const key = dailyBriefFactEnsureKey({ editionDate, metric, asOf: gap.asOf })
          const cached = await safeGet(key)
          if (cached && isExhausted(cached)) {
            statuses.push(cached)
            continue
          }
          if (cached && isUsable(cached, nowIso)) {
            statuses.push(cached)
            if (cached.state === 'available') facts.set(metric, cached)
            continue
          }
          executor ??= deps.backfillFor(input.cutoff)
          const entry = await readOnce({ key, gap, metric, editionDate, executor, prior: cached, nowIso })
          statuses.push(entry)
          if (entry.state === 'available') facts.set(metric, entry)
        }

        const applied = applyCoreFacts(original, facts)
        const document = applied.filled.length > 0
          ? withCoreFactSupplements(applied.document, applied.filled, nowIso, dailyBriefCoreFactEnsurePolicy.method)
          : original
        deps.onEvent?.({
          ...(input.trigger ? { trigger: input.trigger } : {}),
          editionDate,
          coreGaps: gaps.length,
          filled: applied.filled.length,
          failed: statuses.filter((entry) => entry.state === 'unavailable' &&
            entry.gapCode !== 'source-disabled' && entry.gapCode !== 'future-as-of').length,
          disabled: statuses.filter((entry) => entry.gapCode === 'source-disabled').length
        })
        return { document, changed: applied.filled.length > 0, filled: applied.filled, statuses }
      } catch {
        deps.onEvent?.({ event: 'ensure-failed', editionDate, ...(input.trigger ? { trigger: input.trigger } : {}) })
        return empty
      }
    }
  }
}

function coreGaps(document: DailyBriefingDocument): readonly DailyBriefDataGap[] {
  return collectDataGaps(document).filter((gap) =>
    gap.requestable && gap.state === 'unavailable' && isDailyBriefCoreFactMetric(gap.metric))
}

function isUsable(entry: DailyBriefFactEnsureEntry, nowIso: string): boolean {
  const nowMs = Date.parse(nowIso)
  const attemptedMs = Date.parse(entry.lastAttemptAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(attemptedMs)) return false
  if (entry.state === 'available') {
    const successMs = entry.lastSuccessAt ? Date.parse(entry.lastSuccessAt) : attemptedMs
    return Number.isFinite(successMs) && nowMs - successMs < dailyBriefCoreFactEnsurePolicy.successTtlMs
  }
  return entry.attempts < dailyBriefCoreFactEnsurePolicy.maximumAttempts &&
    nowMs - attemptedMs < dailyBriefCoreFactEnsurePolicy.failureRetryMs
}

/** A failed key that has spent its attempts is a stated gap, not a reason to ask again. */
function isExhausted(entry: DailyBriefFactEnsureEntry): boolean {
  return entry.state === 'unavailable' && entry.attempts >= dailyBriefCoreFactEnsurePolicy.maximumAttempts
}

function toEntry(
  result: unknown,
  input: Readonly<{
    gap: DailyBriefDataGap
    metric: DailyBriefCoreFactMetric
    editionDate: string
    prior: DailyBriefFactEnsureEntry | undefined
    nowIso: string
  }>
): DailyBriefFactEnsureEntry {
  const attempts = (input.prior?.attempts ?? 0)
  if (!isDailyBriefBackfillResult(result) ||
    result.source !== input.gap.source || result.metric !== input.gap.metric || result.asOf !== input.gap.asOf) {
    return gapEntry(input.gap, input.editionDate, 'query-unavailable', input.nowIso, 'the reader returned an unrecognised answer.', attempts + 1)
  }
  if (result.state === 'available') {
    return Object.freeze({
      editionDate: input.editionDate,
      metric: input.metric,
      asOf: input.gap.asOf,
      state: 'available' as const,
      source: result.source,
      lastAttemptAt: input.nowIso,
      lastSuccessAt: input.nowIso,
      attempts: 0,
      value: result.value,
      unit: result.unit,
      observedAt: result.observedAt,
      sourceUrl: result.sourceUrl,
      method: result.method
    })
  }
  return Object.freeze({
    editionDate: input.editionDate,
    metric: input.metric,
    asOf: input.gap.asOf,
    state: 'unavailable' as const,
    source: result.source,
    lastAttemptAt: input.nowIso,
    attempts: attempts + 1,
    gapCode: result.gapCode,
    detail: result.detail
  })
}

function gapEntry(
  gap: DailyBriefDataGap,
  editionDate: string,
  gapCode: DailyBriefBackfillGapCode | 'source-disabled',
  nowIso: string,
  detail: string,
  attempts = 0
): DailyBriefFactEnsureEntry {
  return Object.freeze({
    editionDate,
    metric: gap.metric as DailyBriefCoreFactMetric,
    asOf: gap.asOf,
    state: 'unavailable' as const,
    source: gap.source,
    lastAttemptAt: nowIso,
    attempts,
    gapCode,
    detail
  })
}

function readNow(now: () => string): string {
  try {
    const value = now()
    return isCanonicalDailyBriefBackfillTime(value) ? value : new Date().toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function addDays(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  return Number.isFinite(parsed)
    ? new Date(parsed + days * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
    : date
}
