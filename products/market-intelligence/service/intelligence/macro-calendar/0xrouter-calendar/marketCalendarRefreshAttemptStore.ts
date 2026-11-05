import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarPublicPolicy, type MarketCalendarRefreshAttempt } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { exact, instant } from './marketCalendarStorageValidation'

/**
 * Durable "what did the last refresh try do" record for the market calendar.
 *
 * The refresh attempts used to live in two in-memory maps inside the calendar runtime, so a
 * restart erased them: during the 39-hour outage every failed tick left nothing behind and
 * "why is the calendar old" had no answer at all. They are written here instead, on the same
 * `macro-calendar.sqlite` the collections live in and by the same runtime that computed them —
 * one writer, no second source of truth.
 *
 * Two questions need two answers and must not be merged into one field:
 * - "when did we last *successfully* read a source" is derived from the collections rows
 *   (`max(recorded_at)`); a failure never writes that table, so it cannot move the value forward.
 * - "what did the last *attempt* do" is this table's row, which is written on success and on
 *   failure alike.
 */
export const marketCalendarRefreshAttemptPolicy = Object.freeze({
  descriptors: marketCalendarPublicPolicy.descriptors,
  locales: ['zh', 'en'] as const,
  states: ['succeeded', 'failed'] as const,
  triggers: marketCalendarPublicPolicy.attemptTriggers,
  failureCodes: marketCalendarPublicPolicy.attemptFailures
})

export type MarketCalendarRefreshAttemptRow = Readonly<{
  descriptorId: string
  locale: 'zh' | 'en'
  /** The month the attempt was about; the calendar page shows its own month's verdict. */
  month: string
  attemptedAt: string
  state: 'succeeded' | 'failed'
  trigger: 'manual' | 'automatic'
  failureCode?: string
}>

export type MarketCalendarCollectionHighWater = Readonly<{
  descriptorId: string
  locale: 'zh' | 'en'
  lastCollectedAt: string
}>

export function createMarketCalendarRefreshAttemptStore(database: DatabaseSync) {
  // Append-only DDL: a new table and its index, added beside the existing statements. No
  // earlier table is rewritten, and an old library gets it on the next open.
  database.exec(`
    create table if not exists mi_macro_calendar_market_refresh_attempts (
      descriptor_id text not null,
      locale text not null,
      month text not null,
      attempted_at text not null,
      state text not null check(state in ('succeeded', 'failed')),
      trigger text not null check(trigger in ('manual', 'automatic')),
      failure_code text,
      primary key(descriptor_id, locale, month)
    );
    create index if not exists idx_mi_calendar_market_attempt_at
      on mi_macro_calendar_market_refresh_attempts(attempted_at desc);
  `)
  const upsert = database.prepare(`
    insert into mi_macro_calendar_market_refresh_attempts
      (descriptor_id, locale, month, attempted_at, state, trigger, failure_code)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(descriptor_id, locale, month) do update set
      attempted_at = excluded.attempted_at, state = excluded.state,
      trigger = excluded.trigger, failure_code = excluded.failure_code
    where excluded.attempted_at >= mi_macro_calendar_market_refresh_attempts.attempted_at
  `)
  const list = database.prepare(`
    select descriptor_id, locale, month, attempted_at, state, trigger, failure_code
    from mi_macro_calendar_market_refresh_attempts
  `)
  const highWater = database.prepare(`
    select descriptor_id, locale, max(recorded_at) as last_collected_at
    from mi_macro_calendar_market_event_collections
    group by descriptor_id, locale
  `)

  function isDescriptor(value: unknown): value is string {
    return typeof value === 'string' && (marketCalendarRefreshAttemptPolicy.descriptors as readonly string[]).includes(value)
  }
  function isLocale(value: unknown): value is 'zh' | 'en' {
    return typeof value === 'string' && (marketCalendarRefreshAttemptPolicy.locales as readonly string[]).includes(value)
  }

  return Object.freeze({
    /** Write one settled verdict. A stale write never overwrites a newer one. */
    record(input: unknown): boolean {
      try {
        if (!input || typeof input !== 'object' || Array.isArray(input)) return false
        const value = input as Record<string, unknown>
        if (!exact(value, ['descriptorId', 'locale', 'month', 'attemptedAt', 'state', 'trigger', 'failureCode'])) return false
        if (!isDescriptor(value.descriptorId) || !isLocale(value.locale) || typeof value.month !== 'string' ||
          !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value.month) || !instant(value.attemptedAt)) return false
        if (!(marketCalendarRefreshAttemptPolicy.states as readonly unknown[]).includes(value.state)) return false
        if (!(marketCalendarRefreshAttemptPolicy.triggers as readonly unknown[]).includes(value.trigger)) return false
        if (value.failureCode !== undefined &&
          !(marketCalendarRefreshAttemptPolicy.failureCodes as readonly unknown[]).includes(value.failureCode)) return false
        upsert.run(value.descriptorId, value.locale, value.month, value.attemptedAt, String(value.state), String(value.trigger),
          value.failureCode === undefined ? null : String(value.failureCode))
        return true
      } catch {
        return false
      }
    },
    /** The last verdict per `(descriptor, locale)`. Empty means nothing has run yet. */
    /** Throws when the table cannot be read: "unreadable" must not be answered as "nothing yet". */
    listAttempts(): readonly MarketCalendarRefreshAttemptRow[] {
      return list.all().flatMap((row): MarketCalendarRefreshAttemptRow[] => {
        const value = row as Record<string, unknown>
        if (!isDescriptor(value.descriptor_id) || !isLocale(value.locale) || typeof value.month !== 'string' || !instant(value.attempted_at) ||
          !(marketCalendarRefreshAttemptPolicy.states as readonly unknown[]).includes(value.state) ||
          !(marketCalendarRefreshAttemptPolicy.triggers as readonly unknown[]).includes(value.trigger)) return []
        return [{
          descriptorId: value.descriptor_id, locale: value.locale, month: value.month, attemptedAt: value.attempted_at,
          state: value.state as 'succeeded' | 'failed', trigger: value.trigger as 'manual' | 'automatic',
          ...(typeof value.failure_code === 'string' ? { failureCode: value.failure_code } : {})
        }]
      })
    },
    /** `max(recorded_at)` per `(descriptor, locale)`; only successful collections have a row. */
    /** Throws when the collections table cannot be read, for the same reason as above. */
    listCollectionHighWater(): readonly MarketCalendarCollectionHighWater[] {
      return highWater.all().flatMap((row): MarketCalendarCollectionHighWater[] => {
        const value = row as Record<string, unknown>
        if (!isDescriptor(value.descriptor_id) || !isLocale(value.locale) || !instant(value.last_collected_at)) return []
        return [{ descriptorId: value.descriptor_id, locale: value.locale, lastCollectedAt: value.last_collected_at }]
      })
    }
  })
}

export type MarketCalendarRefreshAttemptStore = ReturnType<typeof createMarketCalendarRefreshAttemptStore>

/**
 * The calendar's age is the age of its *worst* enabled source.
 *
 * 每个源各自取 `max(recorded_at)`（它自己最近一次成功）；跨源取这些值里最小的那个（最坏的那条）。
 *
 * Per source the answer is its own latest success (`max`); across the enabled sources it is
 * the oldest of those (`min`). Doing it the other way round — or taking one global `max` —
 * lets a source that is still collecting hide the one that stopped, which is exactly the
 * failure this readout exists to make visible.
 */
export function readWorstEnabledCollection(highWater: readonly MarketCalendarCollectionHighWater[],
  enabled: readonly string[]): string | null {
  const enabledSet = new Set(enabled)
  const perSource = new Map<string, string>()
  for (const row of highWater) {
    if (!enabledSet.has(row.descriptorId)) continue
    const current = perSource.get(row.descriptorId)
    if (current === undefined || row.lastCollectedAt > current) perSource.set(row.descriptorId, row.lastCollectedAt)
  }
  let worst: string | null = null
  for (const value of perSource.values()) if (worst === null || value < worst) worst = value
  return worst
}

/** The attempt a reader should be shown for one source: the newest of its locales. */
export function latestAttemptFor(attempts: readonly MarketCalendarRefreshAttemptRow[],
  descriptorId: string, month?: string): MarketCalendarRefreshAttempt | undefined {
  let newest: MarketCalendarRefreshAttemptRow | undefined
  for (const row of attempts) {
    if (row.descriptorId !== descriptorId) continue
    if (month !== undefined && row.month !== month) continue
    if (!newest || row.attemptedAt > newest.attemptedAt) newest = row
  }
  if (!newest) return undefined
  return { state: newest.state, attemptedAt: newest.attemptedAt, trigger: newest.trigger,
    ...(newest.failureCode ? { failureCode: newest.failureCode as never } : {}) }
}
