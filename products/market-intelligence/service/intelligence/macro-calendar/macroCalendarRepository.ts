import { createPolicyPathFactStore, type PolicyPathFactStore } from '../policy-path/policyPathFactStore'
import { createPolicyPathObservationStore, type PolicyPathObservationStore } from '../policy-path/policyPathObservationStore'
import { createPolicyPathMarketLinkStore, type PolicyPathMarketLinkStore } from '../policy-path/policyPathMarketLinkStore'
import { statSync } from 'node:fs'

import { MACRO_CALENDAR_SCHEMA_VERSION, type MacroCalendarRevision, type MacroCalendarValue } from './macroCalendarContracts'
import { timePrecisionOf, type NarwhalFirstPublished, type NarwhalReleaseRow, type NarwhalReleaseValue } from './narwhalReleaseContracts'
import { isMacroCalendarVisibleAsOf, macroCalendarStoragePolicy } from './macroCalendarPolicy'
import { createMacroCalendarSqlite, type MacroCalendarSqlite } from './macroCalendarSqlite'
import { isValidIsoTime } from '../public-query/asOfVisibility'
import { migrateMacroCalendarSchema } from './macroCalendarSchema'
import {
  currentRecordPriority, effective, epochTime, fedOfficialContentHash, fromRow, isAutomaticBlsRecord,
  isFedOfficialRecord, isFedSchedule, isManualBlsSchedule, macroCalendarCurrentHash,
  macroCalendarCurrentStatePolicy, macroCalendarEffectiveOrderSql, persistedEpochTime, prepareRevision,
  toReleaseRow, valueOf, values, type Row, type StoredRow
} from './macroCalendarRevisionRows'
export { macroCalendarSnapshotHash } from './macroCalendarRevisionRows'

export type MacroCalendarRepository = {
  appendIfNew: (revision: MacroCalendarRevision) => { inserted: boolean; revision: MacroCalendarRevision }
  appendManyIfNew: (revisions: readonly MacroCalendarRevision[]) => { insertedCount: number; dedupedCount: number }
  listEffectiveMonthAsOf: (input: { monthStart: string; monthEndExclusive: string; asOf: string; limit: number }) => MacroCalendarRevision[]
  /** 幂等写入一行发布；同一 `release_id` 再次写入是更新，不是新增一行。 */
  upsertReleaseRow: (row: NarwhalReleaseRow) => void
  /** 读某天某国的发布行（双写对账用）。 */
  listReleaseRows: (input: { countryCode: string; scheduledDate: string }) => NarwhalReleaseRow[]
  /**
   * 只读：一个指标身份「**最新一次已发布**」的那一次发布。
   *
   * 只取原始行、**不做口径判断**：「哪一行算这个指标」由调用方按身份表判，这里不按名字猜。
   * - `narwhal`：`status='published'` 且 `values_json` 里带这个 `measure` 的最近一条发布行；
   * - `legacy`：旧源同名观测行——有新源行时只取**同一天**的（同期），否则取最近一次已到时刻的。
   *   跨天的一律不返回：拿上一个月的那一行当本期，比没有值更糟。
   */
  readLatestReleaseForMetric: (input: {
    /** 源内 measure 名（发布行里 `values[].measure`）。 */
    narwhalMeasure: string
    /** 旧源的 `indicator_id`；没有旧源映射的指标传空数组。 */
    legacyIndicatorIds: readonly string[]
    asOf: string
  }) => Readonly<{ narwhal?: NarwhalReleaseRow; legacy: readonly MacroCalendarLegacyMetricRow[] }>
  /** 首发布快照：只在第一次写入，之后的修订不覆盖。返回是否真的写进去了。 */
  recordFirstPublished: (snapshot: NarwhalFirstPublished) => boolean
  /** 读首发布快照；没有就是「无法确认首发布值」，不返回 0、不返回修订值。 */
  readFirstPublished: (releaseKey: string) => NarwhalFirstPublished | undefined
  getEffectiveEventAsOf: (input: { eventKey: string; asOf: string }) => MacroCalendarRevision | undefined
  /**
   * 只读的两个时刻，按 `asOf` 的可见性聚合：
   * - `createdAt` = `min(recorded_at)`：这条事件第一次落库，后续修订不改变它；
   * - `actualDetectedAt` = 第一次 `actual` 非空那行的 `detected_at`：拿到值那一刻的**来源观测时刻**。
   * 都不是"最新修订时刻"，所以不能用有效行的 `recorded_at`/`detected_at` 代替。
   */
  getEventTimesAsOf: (input: { eventKey: string; asOf: string }) => Readonly<{ createdAt?: string; actualDetectedAt?: string }>
  listVisibleProviderFactsAsOf: (input: { providerIds: string[]; asOf: string }) => MacroCalendarRevision[]
  getBeaObservation: (releaseGroupKey: string) => { scheduleFingerprint: string; lastAttemptAt: string } | undefined
  recordBeaObservationAttemptIfDue: (input: { releaseGroupKey: string; scheduleFingerprint: string; now: string; minimumIntervalMs: number }) => boolean
  clearBeaObservation: (releaseGroupKey: string) => boolean
  clearExpiredBeaObservations: (input: { before: string }) => number
  inspectStorage: () => { rowCount: number; databaseBytes: number; oldestDetectedAt?: string; newestDetectedAt?: string }
  /** Official policy readings; same database, outside the revision chain. */
  policyFacts: PolicyPathFactStore
  /** Market-implied odds per meeting, kept as a series. */
  policyObservations: PolicyPathObservationStore
  policyMarketLinks: PolicyPathMarketLinkStore
  close: () => void
}

/**
 * 旧源一行观测的原始值，只为「按指标身份取最新已发布」而出。
 *
 * `previousDisplay` 是**发布当时**来源给的上期值：非农那次是 29，来源之后修订成 60 也不覆盖它。
 * 「较上期（未修正）」只认这个数——拿修订值算会把 +136K 写成 +105K。
 */
export type MacroCalendarLegacyMetricRow = Readonly<{
  indicatorId: string
  countryCode: string
  scheduledAt: string
  /** 本期实际值原文（没发布时为空）。 */
  actualDisplay?: string
  /** 上期实际值原文。 */
  previousDisplay?: string
}>

export const macroCalendarAtomicWritePolicy = {
  beginStatement: 'begin immediate',
  commitStatement: 'commit',
  rollbackStatement: 'rollback'
} as const

type RepositoryInput = ({ filePath: string; storage?: never } | { storage: MacroCalendarSqlite; filePath?: never }) & {
  migrationExecutor?: (sql: string) => void
}

export function createMacroCalendarRepository(input: RepositoryInput): MacroCalendarRepository {
  const owned = input.storage === undefined
  const sqlite = input.storage ?? createMacroCalendarSqlite(input.filePath!)
  try {
    return initializeRepository(sqlite, input.migrationExecutor, owned)
  } catch (error) {
    if (owned) sqlite.close()
    throw error
  }
}

function initializeRepository(sqlite: MacroCalendarSqlite, migrationExecutor: RepositoryInput['migrationExecutor'], owned: boolean): MacroCalendarRepository {
  migrateMacroCalendarSchema(sqlite.database, migrationExecutor)
  const insert = sqlite.database.prepare('insert into mi_macro_calendar_revisions (revision_id,event_key,release_group_key,event_family,event_name_key,country_code,importance,period_key,lifecycle_state,revision_kind,scheduled_date,scheduled_at,published_at,detected_at,detected_at_ms,recorded_at,actual_json,previous_json,consensus_json,provider_id,descriptor_id,source_url,raw_record_id,evidence_hash,evidence_refs_json,snapshot_hash,replaces_revision_id,parser_version,caveats_json,schema_version) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  const currentByEvent = sqlite.database.prepare(`select * from mi_macro_calendar_revisions where event_key = ? order by ${macroCalendarEffectiveOrderSql} limit 1`)
  const fedSnapshot = sqlite.database.prepare('select * from mi_macro_calendar_revisions where event_key = ? and snapshot_hash = ? limit 1')
  const revisionById = sqlite.database.prepare('select * from mi_macro_calendar_revisions where revision_id = ? limit 1')
  const visibleByEvent = sqlite.database.prepare(`select * from mi_macro_calendar_revisions where event_key = ? and detected_at_ms <= ? order by ${macroCalendarEffectiveOrderSql} limit 1`)
  const automaticBlsMetricExists = sqlite.database.prepare('select 1 from mi_macro_calendar_revisions where provider_id = ? and event_family = ? and event_name_key = ? and scheduled_date = ? and descriptor_id in (?,?) limit 1')
  const firstSeenInsert = sqlite.database.prepare('insert into mi_macro_calendar_event_first_seen (event_key, first_recorded_at) values (?, ?) on conflict(event_key) do nothing')
  const firstSeenActual = sqlite.database.prepare('update mi_macro_calendar_event_first_seen set first_actual_detected_at = ? where event_key = ? and first_actual_detected_at is null')
  const firstSeenRead = sqlite.database.prepare('select first_recorded_at, first_actual_detected_at from mi_macro_calendar_event_first_seen where event_key = ?')
  const deleteByEvent = sqlite.database.prepare('delete from mi_macro_calendar_revisions where event_key = ?')
  const deleteManualBlsMetric = sqlite.database.prepare('delete from mi_macro_calendar_revisions where provider_id = ? and descriptor_id = ? and event_family = ? and event_name_key = ? and scheduled_date = ?')
  const visibleByMonth = sqlite.database.prepare(`select * from mi_macro_calendar_revisions where scheduled_date >= ? and scheduled_date < ? and detected_at_ms <= ? order by event_key, ${macroCalendarEffectiveOrderSql}`)
  const beaObservation = sqlite.database.prepare('select schedule_fingerprint, last_attempt_at from mi_bea_release_observation_state where release_group_key = ?')
  const beaObservationUpsert = sqlite.database.prepare('insert into mi_bea_release_observation_state (release_group_key,schedule_fingerprint,last_attempt_at) values (?,?,?) on conflict(release_group_key) do update set schedule_fingerprint=excluded.schedule_fingerprint,last_attempt_at=excluded.last_attempt_at')
  const deleteBeaObservation = sqlite.database.prepare('delete from mi_bea_release_observation_state where release_group_key = ?')
  const deleteExpiredBeaObservations = sqlite.database.prepare('delete from mi_bea_release_observation_state where last_attempt_at < ?')

  const releaseStatements = {
    upsert: sqlite.database.prepare(`insert into mi_macro_calendar_release_rows
      (release_id, provider_id, country_code, scheduled_date, scheduled_at, date_basis, time_precision, status, values_json, detected_at, recorded_at, schema_version)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(release_id) do update set
        provider_id = excluded.provider_id, country_code = excluded.country_code,
        scheduled_date = excluded.scheduled_date, scheduled_at = excluded.scheduled_at,
        date_basis = excluded.date_basis, time_precision = excluded.time_precision,
        status = excluded.status, values_json = excluded.values_json,
        detected_at = excluded.detected_at, recorded_at = excluded.recorded_at,
        schema_version = excluded.schema_version`),
    listDay: sqlite.database.prepare(`select * from mi_macro_calendar_release_rows
      where country_code = ? and scheduled_date = ? order by release_id`),
    insertSnapshot: sqlite.database.prepare(`insert or ignore into mi_macro_calendar_first_published
      (release_key, provider_id, first_previous_json, first_actual_json, captured_at) values (?, ?, ?, ?, ?)`),
    readSnapshot: sqlite.database.prepare('select * from mi_macro_calendar_first_published where release_key = ?')
  }

  return {
    upsertReleaseRow(row) {
      releaseStatements.upsert.run(row.releaseId, row.providerId, row.countryCode, row.scheduledDate,
        row.scheduledAt ?? null, row.dateBasis, timePrecisionOf(row.dateBasis), row.status ?? null,
        JSON.stringify(row.values), row.detectedAt, row.recordedAt, MACRO_CALENDAR_SCHEMA_VERSION)
    },
    listReleaseRows(input) {
      return (releaseStatements.listDay.all(input.countryCode, input.scheduledDate) as unknown as StoredRow[])
        .map(toReleaseRow)
    },
    readLatestReleaseForMetric({ narwhalMeasure, legacyIndicatorIds, asOf }) {
      if (epochTime(asOf) === undefined) return { legacy: [] }
      const narwhal = narwhalMeasure === '' ? undefined : (sqlite.database.prepare(
        // `instr` 而不是 `like`：measure 里带下划线，`like` 会把 `_` 当成通配符，`cpi_yoy` 就能匹配到别的 measure。
        `select * from mi_macro_calendar_release_rows where status = 'published' and instr(values_json, ?) > 0
         order by scheduled_date desc, coalesce(scheduled_at, '') desc, release_id limit 1`
      ).get(`"measure":"${narwhalMeasure}"`) as StoredRow | undefined)
      const legacy = readLegacyRows(legacyIndicatorIds, narwhal
        // 同一期才有比较意义：有新源发布行时只认同一天那几行。
        ? { scheduledDate: String(narwhal.scheduled_date) }
        : { notAfter: asOf })
      return {
        ...(narwhal === undefined ? {} : { narwhal: toReleaseRow(narwhal) }),
        legacy
      }
    },
    recordFirstPublished(snapshot) {
      // `insert or ignore`：第一次写的那个数就是当时看到的数，之后来源修订**不覆盖**。
      // 注意它**不是**无条件可信的权威：事后回填写进来的就是修订值，所以回填不许走这里。
      const result = releaseStatements.insertSnapshot.run(snapshot.releaseKey, snapshot.providerId,
        snapshot.firstPrevious === undefined ? null : JSON.stringify({ displayValue: snapshot.firstPrevious }),
        snapshot.firstActual === undefined ? null : JSON.stringify({ displayValue: snapshot.firstActual }),
        snapshot.capturedAt)
      return Number(result.changes) === 1
    },
    readFirstPublished(releaseKey) {
      const row = releaseStatements.readSnapshot.get(releaseKey) as StoredRow | undefined
      if (row === undefined) return undefined
      return {
        releaseKey: String(row.release_key), providerId: String(row.provider_id),
        ...(valueOf(row.first_previous_json) === undefined ? {} : { firstPrevious: valueOf(row.first_previous_json) }),
        ...(valueOf(row.first_actual_json) === undefined ? {} : { firstActual: valueOf(row.first_actual_json) }),
        capturedAt: String(row.captured_at)
      }
    },
    appendIfNew(revision) {
      const stored = prepareRevision(revision)
      // 与批量写入同一条规矩：修订行与首次落库的侧表行同生共死，崩溃窗口里不许只落一半。
      sqlite.database.exec(macroCalendarAtomicWritePolicy.beginStatement)
      try {
        const result = replaceCurrent(stored)
        sqlite.database.exec(macroCalendarAtomicWritePolicy.commitStatement)
        return result
      } catch (error) {
        try { sqlite.database.exec(macroCalendarAtomicWritePolicy.rollbackStatement) } catch { /* Preserve the write failure. */ }
        throw error
      }
    },
    appendManyIfNew(revisions) {
      const prepared = revisions.map(prepareRevision)
      let insertedCount = 0
      sqlite.database.exec(macroCalendarAtomicWritePolicy.beginStatement)
      try {
        for (const revision of prepared) insertedCount += replaceCurrent(revision).inserted ? 1 : 0
        sqlite.database.exec(macroCalendarAtomicWritePolicy.commitStatement)
        return { insertedCount, dedupedCount: prepared.length - insertedCount }
      } catch (error) {
        try { sqlite.database.exec(macroCalendarAtomicWritePolicy.rollbackStatement) } catch { /* Preserve the write failure. */ }
        throw error
      }
    },
    listEffectiveMonthAsOf({ monthStart, monthEndExclusive, asOf, limit }) {
      const asOfMs = epochTime(asOf)
      if (asOfMs === undefined) return []
      return effective(visibleByMonth.all(monthStart, monthEndExclusive, asOfMs) as Row[])
        .slice(0, Math.min(limit, macroCalendarStoragePolicy.monthQueryMaxEvents))
    },
    getEffectiveEventAsOf({ eventKey, asOf }) {
      const asOfMs = epochTime(asOf)
      if (asOfMs === undefined) return undefined
      const row = visibleByEvent.get(eventKey, asOfMs) as Row | undefined
      return row ? fromRow(row) : undefined
    },
    getEventTimesAsOf({ eventKey, asOf }) {
      if (epochTime(asOf) === undefined) return Object.freeze({})
      const row = firstSeenRead.get(eventKey) as { first_recorded_at?: string | null; first_actual_detected_at?: string | null } | undefined
      const firstRecorded = typeof row?.first_recorded_at === 'string' && isValidIsoTime(row.first_recorded_at) ? row.first_recorded_at : undefined
      const firstActual = typeof row?.first_actual_detected_at === 'string' && isValidIsoTime(row.first_actual_detected_at) ? row.first_actual_detected_at : undefined
      return Object.freeze({
        // 本机写入时刻，**不受 as-of 约束**：它是"这条记录何时存在"，不是某次读取看到的事实。
        ...(firstRecorded === undefined ? {} : { createdAt: firstRecorded }),
        // 来源观测时刻，按 as-of 收窄：那一刻还没观测到值，就不该在回放里显示"已拿到"。
        ...(firstActual === undefined || (epochTime(firstActual) ?? 0) > (epochTime(asOf) ?? 0) ? {} : { actualDetectedAt: firstActual })
      })
    },
    listVisibleProviderFactsAsOf({ providerIds, asOf }) {
      const asOfMs = epochTime(asOf)
      if (asOfMs === undefined || providerIds.length === 0) return []
      const placeholders = providerIds.map(() => '?').join(',')
      const rows = sqlite.database.prepare(`select * from mi_macro_calendar_revisions where provider_id in (${placeholders}) and detected_at_ms <= ? order by event_key, ${macroCalendarEffectiveOrderSql}`).all(...providerIds, asOfMs) as Row[]
      return effective(rows)
    },
    getBeaObservation(releaseGroupKey) {
      const row = beaObservation.get(releaseGroupKey) as Row | undefined
      return row?.schedule_fingerprint && row.last_attempt_at ? { scheduleFingerprint: row.schedule_fingerprint, lastAttemptAt: row.last_attempt_at } : undefined
    },
    recordBeaObservationAttemptIfDue({ releaseGroupKey, scheduleFingerprint, now, minimumIntervalMs }) {
      if (!releaseGroupKey || !scheduleFingerprint || persistedEpochTime(now) === undefined || !Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 0) return false
      sqlite.database.exec(macroCalendarAtomicWritePolicy.beginStatement)
      try {
        const current = beaObservation.get(releaseGroupKey) as Row | undefined
        const repeated = current?.schedule_fingerprint === scheduleFingerprint && current.last_attempt_at && Date.parse(now) - Date.parse(current.last_attempt_at) < minimumIntervalMs
        if (repeated) { sqlite.database.exec(macroCalendarAtomicWritePolicy.rollbackStatement); return false }
        beaObservationUpsert.run(releaseGroupKey, scheduleFingerprint, now)
        sqlite.database.exec(macroCalendarAtomicWritePolicy.commitStatement)
        return true
      } catch (error) {
        try { sqlite.database.exec(macroCalendarAtomicWritePolicy.rollbackStatement) } catch { /* Preserve write failure. */ }
        return false
      }
    },
    clearBeaObservation(releaseGroupKey) { return deleteBeaObservation.run(releaseGroupKey).changes > 0 },
    clearExpiredBeaObservations({ before }) {
      if (persistedEpochTime(before) === undefined) return 0
      return Number(deleteExpiredBeaObservations.run(before).changes)
    },
    policyFacts: createPolicyPathFactStore(sqlite.database),
    policyObservations: createPolicyPathObservationStore(sqlite.database),
    policyMarketLinks: createPolicyPathMarketLinkStore(sqlite.database),
    inspectStorage() {
      const aggregate = sqlite.database.prepare('select count(*) as count, min(detected_at) as oldest, max(detected_at) as newest from mi_macro_calendar_revisions').get() as Row
      return { rowCount: Number(aggregate.count), databaseBytes: sqlite.filePath === ':memory:' ? 0 : statSync(sqlite.filePath).size, oldestDetectedAt: aggregate.oldest ?? undefined, newestDetectedAt: aggregate.newest ?? undefined }
    },
    close() {
      if (owned) sqlite.close()
    }
  }

  /**
   * 旧源同名行：同一个 `indicator_id` 只留一行（同一时刻有 zh/en 两条，值相同）。
   *
   * `scheduledDate` 分支取同一天（有新源发布行时用）；`notAfter` 分支取最近一次已到时刻的
   * （旧源独家指标用）——两种都只返回原始值，不判断它是不是「这个指标本期」。
   */
  function readLegacyRows(
    indicatorIds: readonly string[],
    scope: Readonly<{ scheduledDate: string }> | Readonly<{ notAfter: string }>
  ): MacroCalendarLegacyMetricRow[] {
    if (indicatorIds.length === 0) return []
    // 观测表由旧源采集端建：没配那个源时这张表根本不存在，读它不该让整次读数失败。
    if (sqlite.database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_market_event_observations'").get() === undefined) return []
    const placeholders = indicatorIds.map(() => '?').join(',')
    const columns = 'indicator_id, country_code, scheduled_at, provider_actual_json, provider_previous_json'
    const rows = ('scheduledDate' in scope
      ? sqlite.database.prepare(`select ${columns} from mi_macro_calendar_market_event_observations
          where indicator_id in (${placeholders}) and scheduled_date = ? order by scheduled_at desc, indicator_id`).all(...indicatorIds, scope.scheduledDate)
      : sqlite.database.prepare(`select ${columns} from mi_macro_calendar_market_event_observations
          where indicator_id in (${placeholders}) and scheduled_at <= ? order by scheduled_date desc, scheduled_at desc, indicator_id limit 8`)
        .all(...indicatorIds, scope.notAfter)) as StoredRow[]
    const seen = new Set<string>()
    return rows.flatMap((row) => {
      const indicatorId = String(row.indicator_id)
      if (seen.has(indicatorId)) return []
      seen.add(indicatorId)
      const actualDisplay = valueOf(row.provider_actual_json)
      const previousDisplay = valueOf(row.provider_previous_json)
      return [{
        indicatorId,
        countryCode: typeof row.country_code === 'string' ? row.country_code : '',
        scheduledAt: String(row.scheduled_at),
        ...(actualDisplay === undefined ? {} : { actualDisplay }),
        ...(previousDisplay === undefined ? {} : { previousDisplay })
      }]
    })
  }

  function replaceCurrent(stored: MacroCalendarRevision): { inserted: boolean; revision: MacroCalendarRevision } {
    const current = currentByEvent.get(stored.eventKey) as Row | undefined
    if (isFedOfficialRecord(stored)) {
      const sameRevision = revisionById.get(stored.revisionId) as Row | undefined
      if (sameRevision) return { inserted: false, revision: fromRow(sameRevision) }
      const sameSnapshot = fedSnapshot.get(stored.eventKey, stored.snapshotHash) as Row | undefined
      if (sameSnapshot) return { inserted: false, revision: fromRow(sameSnapshot) }
      if (current && isFedOfficialRecord(fromRow(current)) && fedOfficialContentHash(fromRow(current)) === fedOfficialContentHash(stored)) {
        return { inserted: false, revision: fromRow(current) }
      }
      insert.run(...values(stored))
      recordFirstSeen(stored)
      return { inserted: true, revision: stored }
    }
    if (current && isFedOfficialRecord(fromRow(current)) && isFedSchedule(stored)) return { inserted: false, revision: fromRow(current) }
    if (current && macroCalendarCurrentHash(fromRow(current)) === macroCalendarCurrentHash(stored)) return { inserted: false, revision: fromRow(current) }
    if (current && currentRecordPriority(fromRow(current)) > currentRecordPriority(stored)) return { inserted: false, revision: fromRow(current) }
    if (isManualBlsSchedule(stored) && automaticBlsMetricExists.get(
      stored.providerId, stored.eventFamily, stored.eventNameKey, stored.scheduledDate,
      ...macroCalendarCurrentStatePolicy.automaticBlsDescriptorIds
    )) return { inserted: false, revision: stored }
    deleteByEvent.run(stored.eventKey)
    if (isAutomaticBlsRecord(stored)) deleteManualBlsMetric.run(
      stored.providerId, macroCalendarCurrentStatePolicy.manualBlsDescriptorId,
      stored.eventFamily, stored.eventNameKey, stored.scheduledDate
    )
    insert.run(...values(stored))
    recordFirstSeen(stored)
    return { inserted: true, revision: stored }
  }

  /**
   * 首次写入记一次（替换时 `on conflict do nothing` 保留旧值）；第一次带非空实际值的修订补上
   * 观测时刻。两个写入都在调用方的事务里，跟修订行同生共死。
   */
  function recordFirstSeen(stored: MacroCalendarRevision): void {
    firstSeenInsert.run(stored.eventKey, stored.recordedAt)
    if (stored.actual !== undefined) firstSeenActual.run(stored.detectedAt, stored.eventKey)
  }
}
