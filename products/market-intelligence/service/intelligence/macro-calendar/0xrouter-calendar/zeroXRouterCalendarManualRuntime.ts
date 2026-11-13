import { createHash } from 'node:crypto'
import { collectingCalendarFeedIds } from '../calendarFeedRegistry'
import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import type { MarketCollectionContext } from './marketCalendarStorageValidation'
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
import { notifyMacroEventLandings, selectLandedReleases, type LandedReleaseFilter, type MacroEventLandedSubmit } from '../../signals/macroEventLandedNotifier'
import { notifyCalendarRefreshFailed, readerCalendarDay, MARKET_CALENDAR_REFRESH_SOURCE_LABEL } from './marketCalendarRefreshNotifier'
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
  /**
   * 通知端口（2026-11-11 用户「失败了，要通知」）：刷新失败时发一条。不传＝不发（测试与未装配通知
   * 运行时的宿主）；自动与手动都走这里，读者看到的是「这次没刷新成功」同一件事。
   */
  notificationSubmit?: (request: import('@platform/notifications/contracts/notificationSubmitContracts').NotificationSubmitRequest) => Promise<import('@platform/notifications/contracts/notificationSubmitContracts').NotificationSubmitOutcome>
  /**
   * 「立刻跑一次日历采集」的实现：**由装配处注入**（今天就是排一次 tick 作业）。
   *
   * 这个运行时只表达「跑一次」这件事，不认识作业定义、不认识源 id：
   * - `triggered` 必须在**真的排上之后**才返回（先拿句柄再返回，否则就是「点了没反应」还回成功）；
   * - `running` 表示已有一轮在跑；`failed` 表示排不上（抛错也算 failed，不许吞）。
   */
  triggerCollection?: () => Promise<'triggered' | 'running' | 'failed'>
  /** 读者设置时区：去重键里的 `{date}` 按它算（读者看得见的日期跟他的日历走）。 */
  readerTimeZone?: () => string
}) {
  let repository!: ReturnType<typeof createMarketCalendarEventRepository>
  /**
   * 不是这条采集路径产出的批次（今天只有 Narwhal）先把自己的上下文放这里，仓库照同一套
   * 校验读它——写入口径只有一份，不因为换了来源就绕过身份/容量/证据校验。
   */
  const pendingContexts = new Map<string, MarketCollectionContext>()
  const collection = createZeroXRouterCalendarCollectionService({ ...deps,
    createRepository: resolveCollectionContext => {
      repository = createMarketCalendarEventRepository({ database: deps.database,
        resolveCollectionContext: (collectionId: string) => pendingContexts.get(collectionId) ?? resolveCollectionContext(collectionId),
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
    const day = readerCalendarDay(attemptedAt, deps.readerTimeZone?.() ?? 'UTC')
    if (result.items.some(item => item.state === 'succeeded')) markSuccess(day)
    notifyFailures(result, attemptedAt, day)
  }
  /**
   * 刷新失败的通知：**一个来源一条**，去重代次按「这条源在这个读者日里成功过几次」算——
   * 连续失败落在同一代（合并不刷屏），失败 → 成功 → 又失败是新一代（能再报一次）。
   * 只活在本进程内：重启后代次归零，最坏情况是同一天的第二条被并进第一条，不会多报。
   */
  const refreshGenerations = new Map<string, { day: string; generation: number }>()
  function notifyFailures(result: RefreshResult, attemptedAt: string, day: string): void {
    const submit = deps.notificationSubmit
    const failed = result.items.filter(item => item.state !== 'succeeded')
    if (submit === undefined || failed.length === 0) return
    const current = refreshGenerations.get(MARKET_CALENDAR_REFRESH_SOURCE_LABEL)
    const generation = current?.day === day ? current.generation : 0
    // 一次批次里同一来源只报一条：三个 feed 同时失败是同一个状况。
    const worst = failed.find(item => item.failureCode !== undefined) ?? failed[0]
    void notifyCalendarRefreshFailed(submit, {
      providerId: MARKET_CALENDAR_REFRESH_SOURCE_LABEL,
      ...(worst?.failureCode === undefined ? {} : { failureCode: worst.failureCode }),
      date: day,
      generation
    }, attemptedAt)
  }
  /** 一次成功就是这个状况的结束：下一代从这里开始计数。 */
  function markSuccess(day: string): void {
    const current = refreshGenerations.get(MARKET_CALENDAR_REFRESH_SOURCE_LABEL)
    refreshGenerations.set(MARKET_CALENDAR_REFRESH_SOURCE_LABEL,
      current?.day === day ? { day, generation: current.generation + 1 } : { day, generation: 1 })
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
    /**
     * 「立刻跑一次日历采集」：**不接收源 id**，触发一次采集即可。
     *
     * 收窄的理由：按源点名与「只有一个日历采集域、源在适配器后面」这个模型冲突——
     * 换了白名单只是把「被拒绝」变成「接受后下游失败」，而日报本不该关心谁在采。
     * 传 `sourceIds` 一律 `input-invalid`（**拒绝，不是忽略**）。
     */
    async refreshNow(input: unknown): Promise<MarketCalendarRefreshNowResult> {
      const parsed = parseRefreshNowInput(input)
      if (!parsed) return { state: 'failed', failureCode: 'input-invalid' }
      if (stopped || !deps.evidenceReady) return { state: 'failed', failureCode: 'readiness-unavailable' }
      if (deps.triggerCollection === undefined) return { state: 'failed', failureCode: 'readiness-unavailable' }
      try {
        const outcome = await deps.triggerCollection()
        if (outcome === 'failed') return { state: 'failed', failureCode: 'response-unavailable' }
        return { state: 'collected', sources: [...collectingCalendarFeedIds()] }
      } catch {
        return { state: 'failed', failureCode: 'response-unavailable' }
      }
    },
    /**
     * One durability read for the briefing: how old the calendar is, and why the last try
     * ended. The age is per source `max(recorded_at)`, then the *oldest* across the enabled
     * sources — the other order lets a live source hide a stopped one.
     */
    readCollectionFreshness(enabledSourceIds?: readonly string[]): MarketCalendarFreshness {
      try {
        const enabled = enabledSourceIds ?? marketCalendarPublicPolicy.feedByKind
        const highWater = attempts.listCollectionHighWater()
        const allAttempts = attempts.listAttempts()
        const sources = marketCalendarPublicPolicy.kinds.map((_, index) => {
          // 一类事件只报一个来源：新来源有采集记录就报它，否则报切换前那个——
          // 与读取侧同一条规则，否则「数据来自谁」和「新鲜度说的是谁」会各说各话。
          const descriptorId = sourceFor(index, highWater) ?? marketCalendarPublicPolicy.feedByKind[index]!
          const lastCollectedAt = readWorstEnabledCollection(
            highWater.filter((row) => row.descriptorId === descriptorId), [descriptorId])
          const latestAttempt = latestAttemptFor(allAttempts, descriptorId)
          return { descriptorId, lastCollectedAt, ...(latestAttempt ? { latestAttempt } : {}) }
        })
        return { state: 'available', asOf: deps.now().toISOString(), lastCollectedAt: readWorstEnabledCollection(highWater, enabled),
          sources }
      } catch {
        return { state: 'unavailable', failureCode: 'query-unavailable' }
      }
    },
    readRefreshAttempt(scope: MarketCalendarScope, eventType: MarketCalendarSource['eventType']): MarketCalendarRefreshAttempt | undefined {
      const index = marketCalendarPublicPolicy.kinds.indexOf(eventType)
      if (index < 0) return undefined
      const attemptsOfLocale = attempts.listAttempts().filter((row) => row.locale === scope.locale)
      // 同一类事件先认新来源的尝试，没有再认切换前的：两个来源都可能有失败记录，先说的算。
      for (const descriptorId of [marketCalendarPublicPolicy.feedByKind[index]!, marketCalendarPublicPolicy.descriptors[index]!]) {
        const attempt = latestAttemptFor(attemptsOfLocale, descriptorId, scope.month)
        if (attempt) return attempt
      }
      return undefined
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
    /**
     * 外部采集（Narwhal）把一页发布写进同一张观测表。
     *
     * 上下文在这里现造：来源、身份、月份都来自批次本身，`evidenceHash` 取批次内容的 sha256，
     * `rawRecordId` 由集合 id 派生（可追到是哪一次采集写的）。
     */
    appendObservationBatch(batch: Readonly<{ collectionId: string; providerId: string; descriptorId: string
      locale: string; month: string; parseResult: unknown }>): { state: string; failureCode?: string } {
      const evidenceHash = createHash('sha256').update(JSON.stringify(batch.parseResult)).digest('hex')
      pendingContexts.set(batch.collectionId, {
        providerId: batch.providerId, descriptorId: batch.descriptorId, locale: batch.locale, month: batch.month,
        detectedAt: deps.now().toISOString(),
        evidence: { providerId: batch.providerId, descriptorId: batch.descriptorId,
          rawRecordId: `batch-${batch.collectionId}`.slice(0, 120), evidenceHash }
      })
      try { return repository.appendCollection(batch) } finally { pendingContexts.delete(batch.collectionId) }
    },
    dispose(): Promise<void> {
      stopped = true
      disposal ??= (active?.promise ?? Promise.resolve()).then(() => undefined, () => undefined)
      return disposal
    }
  })
}

/**
 * `sourceIds` 是**这台运行时实际能采的那几条**，也就是 0xRouter 的三个端点——按需补跑
 * 直接喂给它的采集器，所以标识必须与采集器一致，不能拿新的 feed 身份去点名它。
 *
 * 采集端换到 Narwhal 之后（一次调用写三类），这份清单收成 `collectionFeeds` 那一条；
 * 在那之前用新身份点名，只会得到 `input-invalid`。
 */
/** 这一类事件这一期真正有采集记录的那个来源；两个都没有时返回 undefined。 */
function sourceFor(index: number, highWater: readonly { descriptorId: string }[]): string | undefined {
  for (const descriptorId of [marketCalendarPublicPolicy.feedByKind[index]!, marketCalendarPublicPolicy.descriptors[index]!]) {
    if (highWater.some((row) => row.descriptorId === descriptorId)) return descriptorId
  }
  return undefined
}

/**
 * 入参只接受 `{ timeoutMs? }`。**任何源 id 一律拒绝**——不是忽略：
 * 静默忽略会让调用方以为「点名的源跑过了」，而实际跑的是整个采集域。
 */
function parseRefreshNowInput(input: unknown): { timeoutMs: number } | undefined {
  if (input === undefined) return { timeoutMs: marketCalendarPublicPolicy.refreshNow.defaultTimeoutMs }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  if (Object.keys(value).some((key) => key !== 'timeoutMs')) return undefined
  const timeoutMs = value.timeoutMs ?? marketCalendarPublicPolicy.refreshNow.defaultTimeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < marketCalendarPublicPolicy.refreshNow.minimumTimeoutMs ||
    timeoutMs > marketCalendarPublicPolicy.refreshNow.maximumTimeoutMs) return undefined
  return { timeoutMs }
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
  readLandedFilter?: () => LandedReleaseFilter
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
    /** 外部采集（Narwhal）的观测写入，原样转给同一个仓库。 */
    appendObservationBatch: runtime.appendObservationBatch,
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
