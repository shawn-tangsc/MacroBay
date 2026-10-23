import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import { createZeroXRouterCalendarCollectionService } from './zeroXRouterCalendarCollectionService'
import { createZeroXRouterCalendarRefreshService } from './zeroXRouterCalendarRefreshService'
import { zeroXRouterCalendarAutomaticMonth } from './zeroXRouterCalendarTransport'
import { calendarRecord } from './zeroXRouterCalendarContracts'
import { randomBytes, randomUUID } from 'node:crypto'
import { statfsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { zeroXRouterCalendarTransportPolicy } from '../../application/zeroXRouterSourcePolicy'
import { createMacroCalendarEvidenceStore } from '../macroCalendarEvidenceStore'
import { macroCalendarEvidenceArchivePolicy, type MacroCalendarEvidenceArchive } from '../macroCalendarEvidenceArchive'
import type { MacroCalendarSqlite } from '../macroCalendarSqlite'
import { createMarketCalendarPublicQueryService } from './marketCalendarPublicQueryService'
import { marketCalendarPublicPolicy, type MarketCalendarRefreshResult, type MarketCalendarSource, type MarketCalendarRefreshAttempt, type MarketCalendarScope,
  isMarketCalendarScope } from '../../../../contracts/macro/marketCalendarQueryContracts'

type CollectionDependencies = Parameters<typeof createZeroXRouterCalendarCollectionService>[0]
type RepositoryDependencies = Parameters<typeof createMarketCalendarEventRepository>[0]
type RefreshDependencies = Parameters<typeof createZeroXRouterCalendarRefreshService>[0]
type RefreshResult = Awaited<ReturnType<ReturnType<typeof createZeroXRouterCalendarRefreshService>['refreshManual']>>
type AttemptTrigger = typeof marketCalendarPublicPolicy.attemptTriggers[number]
type AttemptRecords = Map<string, readonly MarketCalendarRefreshAttempt[]>

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
}) {
  let repository!: ReturnType<typeof createMarketCalendarEventRepository>
  const collection = createZeroXRouterCalendarCollectionService({ ...deps,
    createRepository: resolveCollectionContext => {
      repository = createMarketCalendarEventRepository({ database: deps.database, resolveCollectionContext,
        readCapacity: deps.readCapacity, cursorKey: deps.cursorKey, now: () => deps.now().toISOString(), manualCapacityAdmission: true })
      return repository
    }
  })
  const refresh = createZeroXRouterCalendarRefreshService({ collection, now: deps.now, readReadiness: deps.readReadiness, readEnabledFeeds: deps.readEnabledFeeds })
  let active: { key: string; promise: Promise<RefreshResult> } | undefined
  let stopped = false
  let disposal: Promise<void> | undefined
  const attempts: AttemptRecords = new Map()
  // The automatic outcomes live in their own map: design 133 keeps them out of the manual
  // refresh-attempt record, and a failed automatic tick must not be readable as "a manual
  // refresh finished". `readRefreshAttempt` merges the two for display only.
  const automaticAttempts: AttemptRecords = new Map()
  const unavailable = (failureCode: NonNullable<RefreshResult['failureCode']>): Promise<RefreshResult> =>
    Promise.resolve({ state: 'unavailable', failureCode, items: [] })
  /**
   * Record one batch outcome per source for `month`/`locale`.
   *
   * `attemptedAt` is the local clock at completion, and a failed entry also carries the
   * verdict that ended it, so a reader can see *why* a source has no fresh data instead of
   * only that its timestamp is old. The old record for the scope is dropped, not merged:
   * a success clears the previous failure.
   */
  function recordBatchAttempts(records: AttemptRecords, month: string, locale: MarketCalendarScope['locale'],
    result: RefreshResult, trigger: AttemptTrigger): void {
    const key = JSON.stringify([month, locale])
    const attemptedAt = deps.now().toISOString()
    records.delete(key)
    while (records.size >= CalendarEndpointRefreshOutcomePolicy.maximumScopes) records.delete(records.keys().next().value!)
    records.set(key, marketCalendarPublicPolicy.descriptors.map(descriptorId => {
      const item = result.items.find(candidate => candidate.descriptorId === descriptorId && candidate.locale === locale)
      if (item?.state === 'succeeded') return { state: 'succeeded' as const, attemptedAt, trigger }
      const failureCode = item?.state === 'unavailable' ? item.failureCode : undefined
      return { state: 'failed' as const, attemptedAt, trigger, ...(failureCode ? { failureCode } : {}) }
    }))
  }
  return Object.freeze({
    repository,
    // The automatic path stays separate from the manual one on purpose: it must
    // not write a manual refresh-attempt outcome, and it derives the current UTC
    // month itself (design 118:206). Its own record is what makes a refused
    // automatic tick visible at all.
    refreshAutomatic: async (enabledFeeds?: readonly string[]): Promise<RefreshResult> => {
      const month = zeroXRouterCalendarAutomaticMonth(deps.now())
      const result = await refresh.refreshAutomatic(enabledFeeds)
      if (result.items.length) {
        for (const locale of zeroXRouterCalendarTransportPolicy.locales) recordBatchAttempts(automaticAttempts, month, locale, result, 'automatic')
      }
      return result
    },
    readRefreshAttempt(scope: MarketCalendarScope, eventType: MarketCalendarSource['eventType']): MarketCalendarRefreshAttempt | undefined {
      const key = JSON.stringify([scope.month, scope.locale])
      const index = marketCalendarPublicPolicy.kinds.indexOf(eventType)
      const manual = attempts.get(key)?.[index]
      const automatic = automaticAttempts.get(key)?.[index]
      if (!manual) return automatic
      if (!automatic) return manual
      // The most recent attempt is the honest answer; a tie keeps the one the reader asked for.
      return automatic.attemptedAt > manual.attemptedAt ? automatic : manual
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
        if (result.failureCode !== 'input-invalid' && result.failureCode !== 'busy') {
          recordBatchAttempts(attempts, month, locale, result, 'manual')
        }
        return result
      }).finally(() => { active = undefined })
      active = { key, promise }
      return promise
    },
    dispose(): Promise<void> {
      stopped = true
      disposal ??= (active?.promise ?? Promise.resolve()).then(() => { attempts.clear() }, () => { attempts.clear() })
      return disposal
    }
  })
}

// Main composition only. Conservative total logical allocation is charged as an
// upper bound through the existing market capacity seam, never called attribution.
export function createStoredManualCalendar(deps: {
  storage: MacroCalendarSqlite; archive: MacroCalendarEvidenceArchive; evidenceReady: boolean
  requestGovernanceQueue: CollectionDependencies['requestGovernanceQueue']
  getApiKey: CollectionDependencies['getApiKey']; requestJsonBody: CollectionDependencies['requestJsonBody']
  readReadiness: RefreshDependencies['readReadiness']
  readEnabledFeeds?: RefreshDependencies['readEnabledFeeds']
}) {
  const { database, filePath } = deps.storage
  const runtime = createZeroXRouterCalendarManualRuntime({ ...deps, database, evidence: createMacroCalendarEvidenceStore(deps.archive),
    now: () => new Date(), createCollectionId: randomUUID, cursorKey: randomBytes(32),
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
  return Object.freeze({
    queryMonth: query.queryMonth,
    /** Readiness-gated automatic refresh for the interval scheduler. */
    async refreshAutomatic(enabledFeeds?: readonly string[]): Promise<RefreshResult> {
      if (!deps.evidenceReady) return { state: 'unavailable', failureCode: 'readiness-unavailable', items: [] }
      return runtime.refreshAutomatic(enabledFeeds)
    },
    async refresh(input: unknown): Promise<MarketCalendarRefreshResult> {
      if (!isMarketCalendarScope(input)) return { state: 'unavailable', failureCode: 'input-invalid', sources: [] }
      const result = await runtime.refreshManual(input)
      if (!result.items.length) return { state: 'unavailable', sources: [], ...(result.failureCode ? { failureCode: result.failureCode } : {}) }
      const page = query.queryMonth({ ...input, asOf: new Date().toISOString() })
      const sources = marketCalendarPublicPolicy.kinds.map((eventType, index): MarketCalendarSource =>
        page.state === 'available' ? page.sources[index]! :
          { eventType, status: 'unavailable', sourceObservedAt: null })
      return { state: page.state === 'available' ? result.state : 'unavailable', sources,
        ...(result.failureCode ? { failureCode: result.failureCode } : {}) }
    },
    async dispose() { await runtime.dispose(); query.dispose() }
  })
}
