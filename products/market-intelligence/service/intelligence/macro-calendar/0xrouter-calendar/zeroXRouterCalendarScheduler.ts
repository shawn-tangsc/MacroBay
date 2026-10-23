import type { JobDefinition, JobRuntime } from '@platform/jobs'
import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'

/**
 * Automatic refresh policy for the 0xRouter market calendar.
 *
 * Each calendar feed owns its own job definition: enabling a feed registers a job,
 * disabling it removes that job, and the platform runtime only executes what is in
 * its schedule registry.
 */
export const zeroXRouterCalendarSchedulerPolicy = Object.freeze({
  definitionId: 'market-intelligence.refreshMarketCalendar.automatic',
  handlerId: 'market-intelligence.refreshMarketCalendar',
  title: 'Refresh 0xRouter market calendar',
  intervalMs: 30 * 60 * 1_000,
  /** One automatic batch is six serial transport requests; this must outlast them. */
  jobTimeoutMs: 4 * 60 * 1_000,
  jobRetryPolicy: { maxAttempts: 1, backoff: 'none' as const, baseDelayMs: 0, maxDelayMs: 0 },
  /** Result states that mean the batch produced nothing usable. */
  unsuccessfulStates: ['unavailable'] as const
})

export const zeroXRouterCalendarSchedulerFeeds = Object.freeze([
  { key: 'economic-data', sourceId: 'macro-calendar-0xrouter-economic-data' },
  { key: 'financial-events', sourceId: 'macro-calendar-0xrouter-financial-events' },
  { key: 'central-bank-activities', sourceId: 'macro-calendar-0xrouter-central-bank-activities' }
] as const)

type CalendarFeed = typeof zeroXRouterCalendarSchedulerFeeds[number]

export type ZeroXRouterCalendarAutomaticRefresh = Readonly<{
  refreshAutomatic: (enabledFeeds?: readonly string[]) => Promise<{ state: string; failureCode?: string; items: readonly unknown[] }>
}>

export type ZeroXRouterCalendarScheduler = Readonly<{
  initialize: () => Promise<void>
  /** Reconcile the job registry with the enabled feed list. */
  syncSchedule: () => Promise<void>
  dispose: () => void
}>

function definitionFor(feed: CalendarFeed): JobDefinition {
  const policy = zeroXRouterCalendarSchedulerPolicy
  return {
    id: `${policy.definitionId}.${feed.key}`,
    owner: 'product',
    productId: 'market-intelligence',
    handlerId: `${policy.handlerId}.${feed.key}`,
    title: `${policy.title}: ${feed.key}`,
    trigger: { kind: 'interval', intervalMs: policy.intervalMs, anchor: 'lastStart' },
    payload: { sourceId: feed.sourceId },
    concurrencyKey: `${policy.handlerId}.${feed.key}`,
    timeoutMs: policy.jobTimeoutMs,
    retryPolicy: policy.jobRetryPolicy
  }
}

/**
 * Registers one interval job per enabled feed.
 *
 * The readiness gate is still the shared 0xRouter provider gate: a disabled source
 * or a missing credential short-circuits before any request. Jobs that are not
 * enabled are removed from the schedule registry, so the runtime cannot run them.
 */
export function createZeroXRouterCalendarScheduler(deps: Readonly<{
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition'>
  readReadiness: () => { enabled: boolean; hasCredential: boolean } | Promise<{ enabled: boolean; hasCredential: boolean }>
  refreshAutomatic: ZeroXRouterCalendarAutomaticRefresh['refreshAutomatic']
  /** Feeds that currently have a registered job; defaults to all feeds. */
  readEnabledFeeds?: () => readonly string[] | Promise<readonly string[]>
  onRefreshCompleted?: (items: readonly { state: string; storedRows?: number }[]) => void | Promise<void>
}>): ZeroXRouterCalendarScheduler {
  const policy = zeroXRouterCalendarSchedulerPolicy
  const started = new Set<string>()
  let disposed = false

  async function enabledFeeds(): Promise<readonly string[]> {
    if (!deps.readEnabledFeeds) return zeroXRouterCalendarSchedulerFeeds.map((feed) => feed.sourceId)
    try {
      const value = await deps.readEnabledFeeds()
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  function register(feed: CalendarFeed, enabled: Set<string>): void {
    if (!enabled.has(feed.sourceId)) return
    const definition = definitionFor(feed)
    deps.jobRuntime.registerHandler(definition.handlerId, async () => {
      if (disposed) return
      if (!(await enabledFeeds()).includes(feed.sourceId)) return
      const readiness = await readSafe(deps.readReadiness)
      if (!readiness || readiness.enabled !== true || readiness.hasCredential !== true) return
      const result = await deps.refreshAutomatic([feed.sourceId])
      if (result.failureCode === 'disabled') return
      if (policy.unsuccessfulStates.includes(result.state as typeof policy.unsuccessfulStates[number])) {
        throw new Error(`Market calendar automatic refresh did not complete for ${feed.sourceId}.`)
      }
      try {
        await deps.onRefreshCompleted?.(result.items as readonly { state: string; storedRows?: number }[])
      } catch { /* the calendar tick succeeded; the analysis decides for itself */ }
    })
  }

  async function syncSchedule(): Promise<void> {
    if (disposed) return
    const enabled = new Set(await enabledFeeds())
    for (const feed of zeroXRouterCalendarSchedulerFeeds) {
      const definition = definitionFor(feed)
      if (!enabled.has(feed.sourceId)) {
        deps.jobRuntime.removeSchedule(definition.id)
        started.delete(feed.key)
        continue
      }
      deps.jobRuntime.setSchedule(definition)
      if (started.has(feed.key)) continue
      started.add(feed.key)
      void deps.jobRuntime.enqueueDefinition({ ...definition, trigger: { kind: 'startup' } }).catch(() => undefined)
    }
  }

  async function initialize(): Promise<void> {
    if (disposed) return
    for (const feed of zeroXRouterCalendarSchedulerFeeds) register(feed, new Set(zeroXRouterCalendarSchedulerFeeds.map((item) => item.sourceId)))
    await syncSchedule()
  }

  function dispose(): void {
    disposed = true
    for (const feed of zeroXRouterCalendarSchedulerFeeds) deps.jobRuntime.removeSchedule(definitionFor(feed).id)
    started.clear()
  }

  return Object.freeze({ initialize, syncSchedule, dispose })
}

async function readSafe(read: () => { enabled: boolean; hasCredential: boolean } | Promise<{ enabled: boolean; hasCredential: boolean }>): Promise<{ enabled: boolean; hasCredential: boolean } | undefined> {
  try {
    const value = await read()
    return value && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

/** The three descriptors an automatic tick covers; exported for the acceptance marker. */
export const zeroXRouterCalendarSchedulerScope: readonly MarketCalendarSource['eventType'][] = ['economic-indicator', 'financial-event', 'central-bank-activity']
