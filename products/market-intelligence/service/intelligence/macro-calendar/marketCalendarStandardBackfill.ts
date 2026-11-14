import type { DatabaseSync } from 'node:sqlite'

import { narwhalSourcePolicy } from '../application/narwhalSourcePolicy'
import { narwhalCanonicalIdentityKey, zeroXRouterCanonicalIdentity } from './marketCalendarMetricIdentity'
import { dualWriteMeasureRows } from './marketCalendarStandardDualWrite'
import { routeStandardRelease } from './marketCalendarStandardRowRouting'
import { ensureCalendarStandardTables, recordCalendarUnmapped, type CalendarUnmappedReason }
  from './marketCalendarStandardTable'

/**
 * **从观测表回填标准表**（一次性，可重复跑）。
 *
 * 为什么需要：标准表只靠采集过程双写填进去，而 sweep 是**前向 30 天**、tick 只覆盖今天——
 * 过去的日期跑多少轮都不会进表，读者往前翻会看到一片空白，而且**分不清「那天没有发布」
 * 和「我们没回填」**。数据源就是已有观测表（narwhal 那一批），不重新采集、不重新解析。
 *
 * 四条边界：
 * 1. **分流只有一处**：每条发布都问 `routeStandardRelease`——指标行 / 事件码行 / 源内身份行 /
 *    算不出身份。回填自己**不许再判一遍「这类怎么落」**：第一版只写了指标行，事件型 79 条
 *    静默消失，读者看到的是一段空日历。
 * 2. **幂等**：三类都走同一个写入端（按身份 upsert + 发布 id 台账），跑两次不新增。
 * 3. **算不出身份的不吞**：落 `unmapped` 并带原因，和采集时的规矩一致。
 * 4. **dry-run 只读**：`write: false` 时一个字节都不写，连建表都不做（库以只读方式打开）。
 */
/**
 * 回填能读的两种观测表。**旧源的 provider id 只在这里出现一次**：它是那张表里的真值，
 * 用来选身份解码器，不参与读侧的任何分支。
 */
const legacyObservationProviderId = '0xrouter' as const
export type StandardBackfillProviderId = typeof narwhalSourcePolicy.providerId | typeof legacyObservationProviderId

/**
 * **重放用「当前」映射，不用观测行当年的口径**（架构师 2026-11-14）。
 *
 * 观测行是旧码时代的产物：PCE 两个未季调变体（`US.PCE.NSA.YOY`、`US.CORE_PCE.NSA.YOY`）
 * 已经降级、没有源；按当年口径重放会再造一批 NSA 行，跟刚降级的码打对台。所以落表前过这一步：
 * 有当前对应码就换成它，没有就不写、记 `unmapped`（不顺手把旧码写回去）。
 */
const currentMetricKeyByRetiredKey: Readonly<Record<string, string>> = Object.freeze({
  'US.PCE.NSA.YOY': 'US.PCE.SA.YOY',
  'US.CORE_PCE.NSA.YOY': 'US.CORE_PCE.SA.YOY'
})

export type StandardBackfillReport = Readonly<{
  observations: number
  /** 去重后的发布数：同一个发布可能有多条观测（每个 measure 一条、按批次重复）。 */
  releases: number
  indicator: number
  event: number
  source: number
  unmapped: Readonly<{ 'bad-identity': number; 'unknown-measure': number }>
  skipped: number
  /** 同一个身份已经由**别的来源**写过（新源优先）：这些行不覆盖、不新增。 */
  skippedExisting: number
  /**
   * 旧源里**没有国家码**的行（各国央行讲话等，实测 1484 条）：没有国家就没有身份，
   * 也不许给它编一个（编一个就把它们挂到美国日历上）。它们不是坏数据，只是这条重放装不下。
   */
  skippedNoCountry: number
  /** 真正交给写入端的行数；dry-run 时恒为 0（没有写）。 */
  written: number
}>

type ObservationRow = Readonly<{
  source_event_id: string
  market_fact_key: string | null
  display_name: string | null
  country_code: string | null
  indicator_id: string | null
  event_kind: string | null
  scheduled_date: string | null
  scheduled_at: string | null
  consensus_json: string | null
  provider_previous_json: string | null
  provider_actual_json: string | null
  importance: string | null
  measure_keys_json: string | null
}>

const displayOf = (json: string | null): string | undefined => {
  if (json === null || json === '') return undefined
  try {
    const parsed = JSON.parse(json) as { displayValue?: unknown }
    return typeof parsed.displayValue === 'string' ? parsed.displayValue : undefined
  } catch { return undefined }
}

/**
 * 工作清单按「同一发布、同一原因」只记一次。
 *
 * `unmapped` 表的主键带 `detected_at`（采集日志：每次看到都该留一行），而回填是**重放**——
 * 每跑一次就用新时间戳再记一遍，跑两次就是两份，`跑两次一致` 这句话就不成立。判据不靠时间戳兜，
 * 而是先问「这条发布这个原因记过没有」：记过就不写，第一次照常留当初的时刻。
 */
function recordUnmappedOnce(database: DatabaseSync, input: Readonly<{ providerId: string
  sourceKey: string; detectedAt: string; rawJson: string; reason: CalendarUnmappedReason }>): void {
  const existing = database.prepare('select 1 from mi_calendar_unmapped where provider_id = ? and source_key = ? and reason = ? limit 1')
    .get(input.providerId, input.sourceKey, input.reason)
  if (existing !== undefined) return
  recordCalendarUnmapped(database, input)
}

/** 已退役的码：有码名、有组，但没有源、不进格子；重放不许再制造它们。 */
const retiredMetricKeys: readonly string[] = Object.freeze([
  'US.PCE.NSA.YOY',
  'US.CORE_PCE.NSA.YOY'
])
const isRetiredMetricKey = (metricKey: string): boolean => retiredMetricKeys.includes(metricKey)

/**
 * 每个来源**怎么读它自己的东西**：身份从哪解、有没有值、解不出身份算不算坏数据。
 *
 * 这是一张按来源填的表，不是散在各处的 `if (来源 === …)`：加一个来源＝加一行，判据不会长到
 * 循环里，也不会出现「这条来自谁都走不同逻辑」的分支。分流仍然只有 `routeStandardRelease`。
 */
type BackfillSourceProfile = Readonly<{
  readIdentity: (row: ObservationRow) => string | undefined
  /** 身份解不出＝这条发布算不出身份（新源把身份写进了 `market_fact_key`）。 */
  identityRequired: boolean
  hasValues: (row: ObservationRow) => boolean
  /** 旧源只补历史：同一身份已经被别的来源写过就不覆盖。 */
  skipIdentitiesOwnedByOthers: boolean
  /**
   * 观测表里那一列 `importance` 是不是**事实**。
   *
   * 观测表的这一列是 `not null`，Narwhal 那侧没有重要性字段，写入时只能填一个占位值——
   * 它不是源说的，复制进标准表就等于把我们自己编的 `medium` 当成来源判断，读者会以为
   * 「这条不重要」。所以 Narwhal 造假的那一份不复制（保持 NULL＝未提供），官方源那份照抄。
   */
  importanceIsFact: boolean
}>

const backfillSourceProfiles: Readonly<Record<StandardBackfillProviderId, BackfillSourceProfile>> = {
  [narwhalSourcePolicy.providerId]: {
    readIdentity: (row) => row.market_fact_key === null ? undefined : narwhalCanonicalIdentityKey(String(row.market_fact_key)),
    identityRequired: true,
    hasValues: (row) => hasMeasures(row.measure_keys_json),
    skipIdentitiesOwnedByOthers: false,
    importanceIsFact: false
  },
  // 旧源：身份在 `indicator_id` 那张表里，期间由发布时刻倒推；多数行本来就没有共同身份
  // （讲话、会议、没登记过的小指标），那是「走源内身份」，不是坏数据。
  [legacyObservationProviderId]: {
    readIdentity: (row) => {
      const identity = zeroXRouterCanonicalIdentity({ countryCode: row.country_code, indicatorId: row.indicator_id,
        scheduledAt: String(row.scheduled_at ?? '') })
      return identity === undefined ? undefined
        : `${identity.countryCode}|${identity.metricKey}|${identity.periodKey}`
    },
    identityRequired: false,
    hasValues: (row) => [row.consensus_json, row.provider_previous_json, row.provider_actual_json]
      .some((value) => value !== null && value !== ''),
    skipIdentitiesOwnedByOthers: true,
    importanceIsFact: true
  }
}

const hasMeasures = (json: string | null): boolean =>
  json !== null && json !== '' && json !== '[]' && json !== 'null'

/**
 * 旧源重放的三条规矩（Chief 2026-11-14）：来源照实写旧源的 provider id（界面显示「未标来源」，
 * 不出现品牌名）、**新源写过的身份不覆盖**、备份后跑两遍必须一致。
 */
export function backfillStandardRowsFromObservations(database: DatabaseSync, input?: Readonly<{
  providerId?: StandardBackfillProviderId
  observedAt?: string
  /** `false` = dry-run：只报数，不写库（也不建表）。 */
  write?: boolean
}>): StandardBackfillReport {
  const providerId = input?.providerId ?? narwhalSourcePolicy.providerId
  const profile = backfillSourceProfiles[providerId]
  const write = input?.write ?? true
  if (write) ensureCalendarStandardTables(database)
  const exists = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_market_event_observations'").get()
  if (exists === undefined) {
    return { observations: 0, releases: 0, indicator: 0, event: 0, source: 0,
      unmapped: { 'bad-identity': 0, 'unknown-measure': 0 }, skipped: 0, skippedExisting: 0,
      skippedNoCountry: 0, written: 0 }
  }
  // 同一个发布可能有多条观测（每个 measure 一条，按采集批次重复出现）：按**最新一条**取，
  // 再用发布 id 去重——回填只关心「这次发布最后是什么样」。
  const rows = database.prepare(`select source_event_id, market_fact_key, display_name, country_code,
    indicator_id, event_kind,
    scheduled_date, scheduled_at, consensus_json, provider_previous_json, provider_actual_json, importance,
    measure_keys_json
    from mi_macro_calendar_market_event_observations
    where provider_id = ?
    order by source_event_id, coalesce(last_seen_at, '') asc`).all(providerId) as unknown as ObservationRow[]
  const latest = new Map<string, ObservationRow>()
  for (const row of rows) latest.set(String(row.source_event_id), row)
  const observedAt = input?.observedAt ?? new Date().toISOString()
  let indicator = 0
  let event = 0
  let source = 0
  let badIdentity = 0
  let unmappedNoCurrentKey = 0
  let skipped = 0
  let skippedExisting = 0
  let skippedNoCountry = 0
  const standardRows: Record<string, unknown>[] = []
  for (const row of latest.values()) {
    // 身份解码按来源：新源从 `market_fact_key` 里解，旧源从 `indicator_id` 查身份表再算期间。
    // 这是「怎么读这个来源的身份」，不是「这类怎么落」——分流仍然只有 `routeStandardRelease` 一处。
    const identity = profile.readIdentity(row)
    const parts = identity?.split('|') ?? []
    /**
     * 新源的身份就在 `market_fact_key` 里：解不出＝这条发布算不出身份，记工作清单。
     * 旧源不同：**多数行本来就没有可映射的指标**（讲话、会议、没登记过的小指标），那不是坏数据，
     * 走源内身份照样显示——`indicator_id` 解不出只说明「没有共同身份」，不是「身份坏了」。
     */
    if (identity === undefined && profile.identityRequired) {
      badIdentity += 1
      if (write) {
        recordUnmappedOnce(database, { providerId, sourceKey: String(row.source_event_id),
          detectedAt: observedAt, rawJson: JSON.stringify({ name: row.display_name ?? '' }), reason: 'bad-identity' })
      }
      continue
    }
    const [countryCode, decodedMetricKey, periodKey] = (identity === undefined
      ? [String(row.country_code ?? ''), '', ''] : parts) as [string, string, string]
    // 当前映射：已退役的码换到它现在的对应码；没有对应码就不写（绝不把旧码写回去）。
    const metricKey = decodedMetricKey === '' ? ''
      : currentMetricKeyByRetiredKey[decodedMetricKey] ?? decodedMetricKey
    const retiredWithoutCurrentKey = decodedMetricKey !== ''
      && currentMetricKeyByRetiredKey[decodedMetricKey] === undefined
      && isRetiredMetricKey(decodedMetricKey)
    if (retiredWithoutCurrentKey) {
      unmappedNoCurrentKey += 1
      if (write) {
        recordUnmappedOnce(database, { providerId, sourceKey: String(row.source_event_id),
          detectedAt: observedAt, rawJson: JSON.stringify({ metricKey: decodedMetricKey }), reason: 'unknown-measure' })
      }
      continue
    }
    if (countryCode === '') {
      // 没有国家码：没有身份可言，也不编一个。它不是坏数据，只是这条重放装不下。
      skippedNoCountry += 1
      continue
    }
    if (identity !== undefined && parts.length !== 3) {
      badIdentity += 1
      if (write) {
        recordUnmappedOnce(database, { providerId, sourceKey: String(row.source_event_id),
          detectedAt: observedAt, rawJson: JSON.stringify({ name: row.display_name ?? '' }), reason: 'bad-identity' })
      }
      continue
    }
    const scheduledDate = String(row.scheduled_date ?? '')
    const scheduledAt = row.scheduled_at === null ? undefined : String(row.scheduled_at)
    const sourceName = String(row.display_name ?? '')
    // **分流只有这一处**：实时写入与回填问同一个函数。
    const route = routeStandardRelease({ hasPeriod: periodKey.length > 0,
      hasValues: profile.hasValues(row), sourceName })
    if (route.kind === 'unmapped') {
      badIdentity += 1
      if (write) {
        recordUnmappedOnce(database, { providerId, sourceKey: String(row.source_event_id),
          detectedAt: observedAt, rawJson: JSON.stringify({ name: sourceName }), reason: route.reason })
      }
      continue
    }
    // 事件型身份到分钟，没有时刻就落不了；其余两类至少要有日期。
    if (scheduledDate === '' || (route.kind !== 'indicator' && scheduledAt === undefined)) {
      skipped += 1
      continue
    }
    // 同一个身份已经由**别的来源**写过（新源自带值）：旧源只补历史，不许覆盖。
    if (profile.skipIdentitiesOwnedByOthers) {
      const existing = database.prepare(`select source_provider_id as p from mi_calendar_events
        where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ? limit 1`)
        .get(countryCode, route.kind === 'event' ? route.metricKey : metricKey, route.kind === 'event' ? scheduledAt!.slice(0, 16) : periodKey, scheduledDate) as
        { p: string } | undefined
      if (existing !== undefined && existing.p !== providerId) { skippedExisting += 1; continue }
    }
    const shared = {
      countryCode,
      scheduledDate,
      sourceEventId: String(row.source_event_id),
      ...(scheduledAt === undefined ? {} : { scheduledAt }),
      timePrecision: scheduledAt === undefined || scheduledAt.endsWith('T00:00:00.000Z') ? 'date' as const : 'minute' as const,
      ...(displayOf(row.provider_previous_json) === undefined
        ? {} : { previous: displayOf(row.provider_previous_json)! }),
      ...(displayOf(row.consensus_json) === undefined ? {} : { consensus: displayOf(row.consensus_json)! }),
      ...(displayOf(row.provider_actual_json) === undefined ? {} : { actual: displayOf(row.provider_actual_json)! }),
      // 观测表那列是 `not null`：Narwhal 没有重要性字段，填的是占位值，不当事实复制。
      ...(row.importance === null || !profile.importanceIsFact ? {}
        : { importance: row.importance as 'high' | 'medium' | 'low' })
    }
    if (route.kind === 'event') {
      // 事件型身份是（国家, `evt.*` 码, 到分钟）：period 用时刻本身，不借用指标期间。
      standardRows.push({ ...shared, metricKey: route.metricKey, periodKey: scheduledAt!.slice(0, 16) })
      event += 1
      continue
    }
    if (route.kind === 'source') {
      // 源内身份：源里确实有这次发布，只是还没有标准码——照样进日历，不跨源合并。
      // 身份用**源自己的发布 id**；解出了标准码的那一档保留码（它确实指向某个指标）。
      const sourceIdentity = identity === undefined ? String(row.source_event_id) : metricKey
      // 没有期间可借时，身份落在**发布时刻**上（到分钟）——与实时写入的「源内身份」同一条规则。
      const sourcePeriod = identity === undefined ? scheduledAt!.slice(0, 16) : periodKey
      standardRows.push({ ...shared, metricKey: sourceIdentity, periodKey: sourcePeriod,
        identityKind: 'source' as const, ...(sourceName === '' ? {} : { sourceLabel: sourceName }) })
      source += 1
      continue
    }
    standardRows.push({ ...shared, metricKey, periodKey })
    indicator += 1
  }
  let written = 0
  if (write && standardRows.length > 0) {
    written = dualWriteMeasureRows(database, { providerId, parserVersion: 'backfill-from-observations-v1',
      observedAt, rows: standardRows as never }).written
  }
  return { observations: rows.length, releases: latest.size, indicator, event, source,
    unmapped: { 'bad-identity': badIdentity, 'unknown-measure': unmappedNoCurrentKey },
    skipped, skippedExisting, skippedNoCountry, written }
}
