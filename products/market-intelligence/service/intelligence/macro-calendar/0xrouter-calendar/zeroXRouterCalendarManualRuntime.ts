import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import { createZeroXRouterCalendarCollectionService } from './zeroXRouterCalendarCollectionService'
import { createZeroXRouterCalendarRefreshService } from './zeroXRouterCalendarRefreshService'
import { calendarRecord } from './zeroXRouterCalendarContracts'
import { randomBytes, randomUUID } from 'node:crypto'
import { statfsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { zeroXRouterCalendarTransportPolicy } from '../../application/zeroXRouterSourcePolicy'
import { createMacroCalendarEvidenceStore } from '../macroCalendarEvidenceStore'
import { macroCalendarEvidenceArchivePolicy, type MacroCalendarEvidenceArchive } from '../macroCalendarEvidenceArchive'
import type { MacroCalendarSqlite } from '../macroCalendarSqlite'
import { createMarketCalendarPublicQueryService } from './marketCalendarPublicQueryService'
import { createMarketCalendarRefreshAttemptStore, latestAttemptFor, readWorstEnabledCollection } from './marketCalendarRefreshAttemptStore'
import { notifyMacroEventLandings, selectLandedReleases, type MacroEventLandedSubmit } from '../../signals/macroEventLandedNotifier'
import { marketCalendarPublicPolicy, type MarketCalendarFreshness, type MarketCalendarRefreshNowResult,
  type MarketCalendarRefreshResult, type MarketCalendarSource, type MarketCalendarRefreshAttempt, type MarketCalendarScope,
  isMarketCalendarScope } from '../../../../contracts/macro/marketCalendarQueryContracts'

type CollectionDependencies = Parameters<typeof createZeroXRouterCalendarCollectionService>[0]
type RepositoryDependencies = Parameters<typeof createMarketCalendarEventRepository>[0]
type RefreshDependencies = Parameters<typeof createZeroXRouterCalendarRefreshService>[0]
type RefreshResult = Awaited<ReturnType<ReturnType<typeof createZeroXRouterCalendarRefreshService>['refreshManual']>>
type AttemptTrigger = typeof marketCalendarPublicPolicy.attemptTriggers[number]
// Incident 133: transient outcomes for the three allowed months x two locales.
// Eviction/restart means not refreshed this session, never inferred success.
export const CalendarEndpointRefreshOutcomePolicy = Object.freeze({ maximumScopes: 6 })

// MC-V1 owns one manual batch and no scheduler. The shared DB/queue remain caller-owned.
export function createZeroXRouterCalendarManualRuntime(deps: Omit<CollectionDependencies, 'createRepository'> & {
  database: RepositoryDependencies['database']
  readCapacity: NonNullable<RepositoryDependencies['readCapacity']>
  cursorKey: Uint8Array
  evidenceReady: boolean
  readReadiness: RefreshDependencies['readReadiness']
  readEnabledFeeds?: RefreshDependencies['readEnabledFeeds']
  /**
   * Clock the storage deadline is measured on. Production passes nothing and gets `performance.now`,
   * so the one-second budget still governs real writes; passing a clock lets a case decide the budget
   * itself instead of letting the machine's load decide whether the case passes.
   */
  monotonicNow?: () => number
}) {
  let repository!: ReturnType<typeof createMarketCalendarEventRepository>
  const collection = createZeroXRouterCalendarCollectionService({ ...deps,
    createRepository: resolveCollectionContext => {
      repository = createMarketCalendarEventRepository({ database: deps.database, resolveCollectionContext,
        readCapacity: deps.readCapacity, cursorKey: deps.cursorKey, now: () => deps.now().toISOString(),
        monotonicNow: deps.monotonicNow, manualCapacityAdmission: true })
      return repository
    }
  })
  const refresh = createZeroXRouterCalendarRefreshService({ collection, now: deps.now, readReadiness: deps.readReadiness, readEnabledFeeds: deps.readEnabledFeeds })
  let active: { key: string; promise: Promise<RefreshResult> } | undefined
  let stopped = false
  let disposal: Promise<void> | undefined
  // Durable, so a failed tick survives the restart that used to erase it. One row per
  // `(descriptor, locale)`, written by this runtime only; the row carries `trigger`, so an
  // automatic tick is still not readable as "a manual refresh finished" (design 133).
  const attempts = createMarketCalendarRefreshAttemptStore(deps.database)
  const unavailable = (failureCode: NonNullable<RefreshResult['failureCode']>): Promise<RefreshResult> =>
    Promise.resolve({ state: 'unavailable', failureCode, items: [] })
  /**
   * Record one settled verdict per source this batch actually asked.
   *
   * `attemptedAt` is the local clock at completion, and a failure keeps the code that ended it,
   * so a reader can see *why* a source has no fresh data instead of only that its timestamp is
   * old. A source this batch never asked keeps whatever its last attempt said.
   */
  function recordBatchAttempts(result: RefreshResult, trigger: AttemptTrigger): void {
    const attemptedAt = deps.now().toISOString()
    for (const item of result.items) {
      if (!item.descriptorId || !item.locale || !item.month) continue
      // A tick can cover the current month and the prefetched next one; the same source is
      // recorded once per locale, and the newest attempt wins inside the store.
      attempts.record(item.state === 'succeeded'
        ? { descriptorId: item.descriptorId, locale: item.locale, month: item.month, attemptedAt, state: 'succeeded', trigger }
        : { descriptorId: item.descriptorId, locale: item.locale, month: item.month, attemptedAt, state: 'failed', trigger,
          ...(item.failureCode ? { failureCode: item.failureCode } : {}) })
    }
  }
  // The automatic path stays separate from the manual one on purpose: it must not write a
  // manual refresh-attempt outcome, and it derives the months it covers itself (design
  // 118:206, 164 §5.1). Its own record is what makes a refused automatic tick visible at all.
  async function refreshAutomatic(enabledFeeds?: readonly string[]): Promise<RefreshResult> {
    const result = await refresh.refreshAutomatic(enabledFeeds)
    if (result.items.length) recordBatchAttempts(result, 'automatic')
    return result
  }
  return Object.freeze({
    repository,
    refreshAutomatic,
    /**
     * Bounded catch-up for the daily briefing: the three feeds ask in parallel and share
     * **one** deadline, so the worst case is the budget rather than three budgets in a row.
     *
     * Four outcomes, and `timeout` is its own: "we did not finish in time" and "the collection
     * failed" lead to different sentences downstream. A `collected` batch has already been
     * stored by the code the page reads, so the caller may read the page right after it returns.
     */
    async refreshNow(input: unknown): Promise<MarketCalendarRefreshNowResult> {
      const parsed = parseRefreshNowInput(input)
      if (!parsed) return { state: 'failed', failureCode: 'input-invalid' }
      if (stopped || !deps.evidenceReady) return { state: 'failed', failureCode: 'readiness-unavailable' }
      const timedOut = Symbol('timeout')
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), parsed.timeoutMs)
        timer.unref?.()
      })
      try {
        const outcome = await Promise.race([refreshAutomatic(parsed.sourceIds), deadline])
        if (outcome === timedOut) return { state: 'timeout', timeoutMs: parsed.timeoutMs }
        return refreshNowOutcome(outcome)
      } catch {
        return { state: 'failed', failureCode: 'response-unavailable' }
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
    /**
     * One durability read for the briefing: how old the calendar is, and why the last try
     * ended. The age is per source `max(recorded_at)`, then the *oldest* across the enabled
     * sources — the other order lets a live source hide a stopped one.
     */
    readCollectionFreshness(enabledSourceIds?: readonly string[]): MarketCalendarFreshness {
      try {
        const enabled = enabledSourceIds ?? marketCalendarPublicPolicy.descriptors
        const sources = marketCalendarPublicPolicy.descriptors.map((descriptorId) => {
          const lastCollectedAt = readWorstEnabledCollection(
            attempts.listCollectionHighWater().filter((row) => row.descriptorId === descriptorId), [descriptorId])
          const latestAttempt = latestAttemptFor(attempts.listAttempts(), descriptorId)
          return { descriptorId, lastCollectedAt, ...(latestAttempt ? { latestAttempt } : {}) }
        })
        return { state: 'available', asOf: deps.now().toISOString(), lastCollectedAt: readWorstEnabledCollection(attempts.listCollectionHighWater(), enabled),
          sources }
      } catch {
        return { state: 'unavailable', failureCode: 'query-unavailable' }
      }
    },
    readRefreshAttempt(scope: MarketCalendarScope, eventType: MarketCalendarSource['eventType']): MarketCalendarRefreshAttempt | undefined {
      const index = marketCalendarPublicPolicy.kinds.indexOf(eventType)
      const descriptorId = marketCalendarPublicPolicy.descriptors[index]
      if (!descriptorId) return undefined
      return latestAttemptFor(attempts.listAttempts().filter((row) => row.locale === scope.locale), descriptorId, scope.month)
    },
    refreshManual(input: unknown): Promise<RefreshResult> {
      if (stopped || !deps.evidenceReady) return unavailable('readiness-unavailable')
      const scope = calendarRecord(input)
      if (!scope || Object.keys(scope).length !== 2 || typeof scope.month !== 'string' ||
        (scope.locale !== 'zh' && scope.locale !== 'en')) return unavailable('input-invalid')
      const month = scope.month
      const locale = scope.locale
      const key = JSON.stringify([month, locale])
      if (active) return active.key === key ? active.promise : unavailable('busy')
      const promise = refresh.refreshManual({ month, locale }).then(result => {
        if (result.failureCode !== 'input-invalid' && result.failureCode !== 'busy') recordBatchAttempts(result, 'manual')
        return result
      }).finally(() => { active = undefined })
      active = { key, promise }
      return promise
    },
    dispose(): Promise<void> {
      stopped = true
      disposal ??= (active?.promise ?? Promise.resolve()).then(() => undefined, () => undefined)
      return disposal
    }
  })
}

/**
 * `sourceIds` defaults to the three 0xRouter feeds (fed/bea have their own 6-hour official
 * schedule and are never caught up here). Only those three are accepted: a caller cannot
 * widen the set, and a bad shape fails closed.
 */
function parseRefreshNowInput(input: unknown): { sourceIds: readonly string[]; timeoutMs: number } | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  if (Object.keys(value).some((key) => key !== 'sourceIds' && key !== 'timeoutMs')) return undefined
  const timeoutMs = value.timeoutMs ?? marketCalendarPublicPolicy.refreshNow.defaultTimeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < marketCalendarPublicPolicy.refreshNow.minimumTimeoutMs ||
    timeoutMs > marketCalendarPublicPolicy.refreshNow.maximumTimeoutMs) return undefined
  const sourceIds = value.sourceIds ?? marketCalendarPublicPolicy.descriptors
  if (!Array.isArray(sourceIds) || sourceIds.length === 0 || sourceIds.length > marketCalendarPublicPolicy.descriptors.length) return undefined
  const seen = new Set<string>()
  for (const sourceId of sourceIds) {
    if (typeof sourceId !== 'string' || !(marketCalendarPublicPolicy.descriptors as readonly string[]).includes(sourceId)) return undefined
    if (seen.has(sourceId)) return undefined
    seen.add(sourceId)
  }
  return { sourceIds: [...seen], timeoutMs }
}

/** A batch that stored anything is `collected`; nothing stored is `unchanged`; a refusal keeps its code. */
function refreshNowOutcome(result: RefreshResult): MarketCalendarRefreshNowResult {
  if (result.failureCode) return { state: 'failed', failureCode: result.failureCode }
  if (result.state === 'unavailable') {
    const refusal = result.items.find((item) => item.state === 'unavailable' && item.failureCode !== undefined)
    const failureCode = refusal?.state === 'unavailable' && refusal.failureCode ? refusal.failureCode : 'unavailable'
    return { state: 'failed', failureCode }
  }
  const stored = result.items.filter((item) => item.state === 'succeeded')
  return stored.length > 0
    ? { state: 'collected', sources: [...new Set(stored.map((item) => item.descriptorId))] }
    : { state: 'unchanged' }
}

// Main composition only. Conservative total logical allocation is charged as an
// upper bound through the existing market capacity seam, never called attribution.
export function createStoredManualCalendar(deps: {
  storage: MacroCalendarSqlite; archive: MacroCalendarEvidenceArchive; evidenceReady: boolean
  requestGovernanceQueue: CollectionDependencies['requestGovernanceQueue']
  getApiKey: CollectionDependencies['getApiKey']; requestJsonBody: CollectionDependencies['requestJsonBody']
  readReadiness: RefreshDependencies['readReadiness']
  readEnabledFeeds?: RefreshDependencies['readEnabledFeeds']
  /**
   * 这条腿的通知出口。**挂在采集侧**：一件事发生了就说一次，分析跑不跑是读者的选择，不决定
   * 「发生了」要不要被说出来。缺省时采集行为与从前一字不差。
   */
  submitNotification?: MacroEventLandedSubmit
  /**
   * 「事件发生后也告诉我」那一行的选择（配置页「日历事件 → 发生后」）。缺省＝只推出乎意料的，
   * 与既有 N5 行为一字不差；读者选了「符合预期也推」才放宽，且仍受重要性勾选约束。
   */
  readLandedFilter?: () => Readonly<{ includeMatched?: boolean; importance?: readonly ('high' | 'medium' | 'low')[] }>
  /** Clock of the composed calendar; production passes nothing and gets the wall clock. */
  now?: () => Date
}) {
  const { database, filePath } = deps.storage
  const runtime = createZeroXRouterCalendarManualRuntime({ ...deps, database, evidence: createMacroCalendarEvidenceStore(deps.archive),
    now: deps.now ?? (() => new Date()), createCollectionId: randomUUID, cursorKey: randomBytes(32),
    readCapacity: () => {
      const volume = statfsSync(dirname(filePath))
      let walBytes = 0
      try { walBytes = statSync(filePath + '-wal').size } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const archive = deps.archive.inspect()
      return { marketBytes: Number(database.prepare('pragma page_count').get()?.page_count) * Number(database.prepare('pragma page_size').get()?.page_size),
        walBytes, freeBytes: volume.bavail * volume.bsize,
        archiveAvailable: deps.evidenceReady && archive.committedBytes + archive.reservedBytes <= macroCalendarEvidenceArchivePolicy.maximumArchiveBytes }
    }
  })
  const query = createMarketCalendarPublicQueryService({ repository: runtime.repository, readRefreshAttempt: runtime.readRefreshAttempt })
  // One memory for the lifetime of this calendar: a release already spoken about in this process is
  // not spoken about again, even though the platform's key would merge it anyway.
  const announced = new Map<string, number>()
  function forgetAnnounced(asOf: string): void {
    const asOfMs = Date.parse(asOf)
    if (!Number.isFinite(asOfMs)) return
    for (const [key, expiresAt] of announced) if (expiresAt <= asOfMs) announced.delete(key)
  }
  async function announce(page: ReturnType<typeof query.queryMonth>, asOf: string): Promise<void> {
    if (page.state !== 'available') return
    forgetAnnounced(asOf)
    const selection = selectLandedReleases(page.events, asOf, new Set(announced.keys()), deps.readLandedFilter?.())
    const { notComparable, belowThreshold, missingTitle } = selection.suppressed
    if (notComparable > 0 || belowThreshold > 0 || missingTitle > 0) {
      // 筛掉的也要数得出来：否则「筛得对」和「读漏了」在日志里长得一模一样。
      console.warn(
        `[macro-calendar] 本次没有通知的发布：算不出偏差 ${notComparable} 条、未过阈值 ${belowThreshold} 条、缺指标名 ${missingTitle} 条`
      )
    }
    await notifyMacroEventLandings(deps.submitNotification, selection.landings, announced)
  }
  return Object.freeze({
    queryMonth: query.queryMonth,
    /** Bounded catch-up, forwarded unchanged: the runtime already owns the verdicts. */
    refreshNow: runtime.refreshNow,
    /**
     * Read-only freshness for consumers that must tell "nothing happened" from "we could not
     * see anything". The enabled set is resolved here because only the composition knows it;
     * a failure to read it is `unavailable`, never "no source has ever collected".
     */
    async readCollectionFreshness(): Promise<MarketCalendarFreshness> {
      try {
        const enabled = deps.readEnabledFeeds ? await deps.readEnabledFeeds() : undefined
        return runtime.readCollectionFreshness(enabled)
      } catch {
        return { state: 'unavailable', failureCode: 'query-unavailable' }
      }
    },
    /** Readiness-gated automatic refresh for the interval scheduler. */
    async refreshAutomatic(enabledFeeds?: readonly string[]): Promise<RefreshResult> {
      if (!deps.evidenceReady) return { state: 'unavailable', failureCode: 'readiness-unavailable', items: [] }
      const result = await runtime.refreshAutomatic(enabledFeeds)
      if (deps.submitNotification === undefined || result.items.length === 0) return result
      // One read per month the batch touched, in one locale: the event identity is the same in both,
      // and submitting twice would only depend on the platform to merge it back into one.
      const asOf = (deps.now ?? (() => new Date()))().toISOString()
      for (const month of new Set(result.items.map(item => item.month))) {
        try {
          await announce(query.queryMonth({ month, locale: 'zh', asOf }), asOf)
        } catch {
          // 一条通知说不上话，不改变这次采集的结论。
        }
      }
      return result
    },
    async refresh(input: unknown): Promise<MarketCalendarRefreshResult> {
      if (!isMarketCalendarScope(input)) return { state: 'unavailable', failureCode: 'input-invalid', sources: [] }
      const result = await runtime.refreshManual(input)
      if (!result.items.length) return { state: 'unavailable', sources: [], ...(result.failureCode ? { failureCode: result.failureCode } : {}) }
      const asOf = (deps.now ?? (() => new Date()))().toISOString()
      const page = query.queryMonth({ ...input, asOf })
      // Same page the panel is built from: what the reader can see is exactly what may be announced.
      try {
        await announce(page, asOf)
      } catch {
        // 通知失败不改变刷新结果。
      }
      const sources = marketCalendarPublicPolicy.kinds.map((eventType, index): MarketCalendarSource =>
        page.state === 'available' ? page.sources[index]! :
          { eventType, status: 'unavailable', sourceObservedAt: null })
      return { state: page.state === 'available' ? result.state : 'unavailable', sources,
        ...(result.failureCode ? { failureCode: result.failureCode } : {}) }
    },
    async dispose() { await runtime.dispose(); query.dispose() }
  })
}
