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
  // 尝试台账里合法的来源标识：当前三条事件身份，加上切换前写入的历史标识。
  // 台账是 append-only 的事实记录，切换来源不等于那些尝试没发生过——读回时要认得它们。
  descriptors: [...marketCalendarPublicPolicy.feedByKind, ...marketCalendarPublicPolicy.descriptors],
  locales: ['zh', 'en'] as const,
  states: ['succeeded', 'failed'] as const,
  triggers: marketCalendarPublicPolicy.attemptTriggers,
  failureCodes: marketCalendarPublicPolicy.attemptFailures
})

export type MarketCalendarRefreshAttemptRow = Readonly<{
  /** 追加顺序（自增）：同一时刻的两笔尝试也有确定先后，展示取「最后写的那条」。 */
  attemptId: number
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

/**
 * 台账是**只追加**的事实记录（0.4.5 #16，Chief 2026-11-21）：
 *
 * 旧表主键是 `(descriptor, locale, month)`——同一月后一次成功会把之前那次失败**覆盖掉**，
 * 出了采集问题只能靠推测。现在每行有自增 `attempt_id`，每次尝试各写一行；
 * 「最新一次是哪条」由读口按 `attempted_at` 挑（`latestAttemptFor`），不再靠覆盖。
 *
 * 老库升级：建新表 → 逐行抄 → 旧表改名留回滚点（不 drop）→ 新表改名成正名，单事务。
 */
const ATTEMPTS_TABLE = 'mi_macro_calendar_market_refresh_attempts'
const ATTEMPTS_BACKUP_TABLE = `${ATTEMPTS_TABLE}__pre_append_v1`

function ensureAttemptTable(database: DatabaseSync): void {
  const current = database.prepare(`select sql from sqlite_master where type='table' and name = ?`)
    .get(ATTEMPTS_TABLE) as { sql: string } | undefined
  const isOldShape = current !== undefined && current.sql.includes('primary key(descriptor_id, locale, month)')
  if (isOldShape) {
    const rebuilt = `${ATTEMPTS_TABLE}__append_v1`
    database.exec('begin')
    try {
      const before = Number((database.prepare(`select count(*) as n from ${ATTEMPTS_TABLE}`)
        .get() as { n: number }).n)
      database.exec(createAttemptTableSql(rebuilt))
      database.exec(`insert into ${rebuilt}
        (descriptor_id, locale, month, attempted_at, state, trigger, failure_code)
        select descriptor_id, locale, month, attempted_at, state, trigger, failure_code from ${ATTEMPTS_TABLE}`)
      const copied = Number((database.prepare(`select count(*) as n from ${rebuilt}`).get() as { n: number }).n)
      if (before !== copied) throw new Error(`attempt history row count changed: ${before} -> ${copied}`)
      database.exec(`alter table ${ATTEMPTS_TABLE} rename to ${ATTEMPTS_BACKUP_TABLE}`)
      database.exec(`alter table ${rebuilt} rename to ${ATTEMPTS_TABLE}`)
      database.exec('commit')
    } catch (error) {
      try { database.exec('rollback') } catch { /* 保留原始错误 */ }
      throw error
    }
  }
  database.exec(createAttemptTableSql(ATTEMPTS_TABLE))
  database.exec(`create index if not exists idx_mi_calendar_market_attempt_at on ${ATTEMPTS_TABLE}(attempted_at desc)`)
}

function createAttemptTableSql(table: string): string {
  return `create table if not exists ${table} (
    attempt_id integer primary key autoincrement,
    descriptor_id text not null,
    locale text not null,
    month text not null,
    attempted_at text not null,
    state text not null check(state in ('succeeded', 'failed')),
    trigger text not null check(trigger in ('manual', 'automatic')),
    failure_code text
  )`
}

export function createMarketCalendarRefreshAttemptStore(database: DatabaseSync) {
  ensureAttemptTable(database)
  const insert = database.prepare(`
    insert into ${ATTEMPTS_TABLE}
      (descriptor_id, locale, month, attempted_at, state, trigger, failure_code)
    values (?, ?, ?, ?, ?, ?, ?)
  `)
  const list = database.prepare(`
    select attempt_id, descriptor_id, locale, month, attempted_at, state, trigger, failure_code
    from ${ATTEMPTS_TABLE} order by attempt_id asc
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
        insert.run(value.descriptorId, value.locale, value.month, value.attemptedAt, String(value.state), String(value.trigger),
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
        if (typeof value.attempt_id !== 'number' || !Number.isSafeInteger(value.attempt_id) || value.attempt_id <= 0 ||
          !isDescriptor(value.descriptor_id) || !isLocale(value.locale) || typeof value.month !== 'string' || !instant(value.attempted_at) ||
          !(marketCalendarRefreshAttemptPolicy.states as readonly unknown[]).includes(value.state) ||
          !(marketCalendarRefreshAttemptPolicy.triggers as readonly unknown[]).includes(value.trigger)) return []
        return [{
          attemptId: value.attempt_id, descriptorId: value.descriptor_id, locale: value.locale,
          month: value.month, attemptedAt: value.attempted_at,
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
    // 同一时刻（测试里时钟被冻住是真实现象）按**写入顺序**定先后：后写的那条才是最新一次。
    if (!newest || row.attemptedAt > newest.attemptedAt ||
      (row.attemptedAt === newest.attemptedAt && row.attemptId > newest.attemptId)) newest = row
  }
  if (!newest) return undefined
  return { state: newest.state, attemptedAt: newest.attemptedAt, trigger: newest.trigger,
    ...(newest.failureCode ? { failureCode: newest.failureCode as never } : {}) }
}
