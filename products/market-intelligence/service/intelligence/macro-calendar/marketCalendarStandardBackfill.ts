import type { DatabaseSync } from 'node:sqlite'

import { MACRO_INDICATOR_RETIRED_METRIC_KEYS } from './macroIndicatorCardGroups'
import { displayValueFromJson } from './marketCalendarValueEncoding'
import { narwhalSourcePolicy } from '../application/narwhalSourcePolicy'
import { narwhalCanonicalIdentityKey, toAlpha2Country, zeroXRouterCanonicalIdentity } from './marketCalendarMetricIdentity'
import { periodFromSourceTitle } from './marketCalendarSourcePeriodFromTitle'
import { dualWriteMeasureRows } from './marketCalendarStandardDualWrite'
import type { CalendarStandardWriteLayer, CalendarStandardWriterId } from './calendarStandardWriteLayer'
import type { MacroCalendarProviderId } from './macroCalendarContracts'
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
const currentMetricKeyByRetiredKey: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(MACRO_INDICATOR_RETIRED_METRIC_KEYS.map((row) => [row.retiredMetricKey, row.currentMetricKey]))
)

export type StandardBackfillReport = Readonly<{
  observations: number
  /** 去重后的发布数：同一个发布可能有多条观测（每个 measure 一条、按批次重复）。 */
  releases: number
  indicator: number
  event: number
  source: number
  unmapped: Readonly<{ 'bad-identity': number; 'unknown-measure': number; 'period-unresolved': number }>
  skipped: number
  /** 同一个身份已经由**别的来源**写过（新源优先）：这些行不覆盖、不新增。 */
  skippedExisting: number
  /**
   * 旧源里**没有国家码**的行（各国央行讲话等，实测 1484 条）：没有国家就没有身份，
   * 也不许给它编一个（编一个就把它们挂到美国日历上）。它们不是坏数据，只是这条重放装不下。
   */
  /** 缺国家、已落进未映射表的行（原因 `missing-country`）：它们不进日历，但**不再消失**。 */
  unmappedMissingCountry: number
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
  last_seen_at: string | null
}>

// 值编码的解释只有一处（`marketCalendarValueEncoding`）：这里不再各写一份。
const displayOf = (json: string | null): string | undefined => displayValueFromJson(json)

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

/**
 * 已退役的码：有码名、有组，但没有源、不进格子；重放不许再制造它们。
 *
 * **从退役表派生**（2026-11-14）：原来这里手抄两条，和 `currentMetricKeyByRetiredKey` 各抄一份，
 * 加一个退役码要改两处——正是今晚「换码漏一处」那个形状。
 */
const retiredMetricKeys: readonly string[] = Object.freeze(
  MACRO_INDICATOR_RETIRED_METRIC_KEYS.map((row) => row.retiredMetricKey)
)
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
  // 旧源：身份在 `indicator_id` 那张表里；多数行本来就没有共同身份
  // （讲话、会议、没登记过的小指标），那是「走源内身份」，不是坏数据。
  [legacyObservationProviderId]: {
    /**
     * **期次在写入时就归一**（用户 2026-11-17 定；Chief 2026-11-17 落在这一层）。
     *
     * 这里原来直接把 `zeroXRouterCanonicalIdentity` 算出的 `periodKey` 当身份的一部分，而那个值
     * 是**发布时刻**（`2026-11-16T13:30`）或「发布日的上一月」——都不是期次。真期次只隐含在源标题里
     * （`… (Sep)`、`11月纽约联储制造业指数`）。不在这里改，每个采集周期都会重新写进一批假期次，
     * 启动时那两条按缺口扫的迁移只能一直跟在后面擦。
     *
     * 三条规则：
     * - 标题解得出 → 用解析值（`periodFromSourceTitle` 认英文月份/季度，也认 `11月` / `第三季度`）；
     * - 解不出 → `unknown:<国家>~<指标码>~<发布日>`：语义是**明确缺失**，同一发布的所有行共用一个值
     *   （中英两条、初值/终值两条本来就是一回事），因此仍会合并成一行；分隔符不用 `|`，
     *   那个是身份串的分隔符，混进去会把身份拆错；
     * - 事件码（`evt.*`）不解析标题：期次就是活动当天，由下游 `routeStandardRelease` 按
     *   `scheduledAt` 取到分钟。
     *
     * 国家码同一处归一到 alpha-2：身份串是这个值的第一处落地，留着三位写法会与写库后的两位
     * 对不上，认回身份时又认不回来。
     */
    readIdentity: (row) => {
      const identity = zeroXRouterCanonicalIdentity({ countryCode: row.country_code, indicatorId: row.indicator_id,
        scheduledAt: String(row.scheduled_at ?? '') })
      if (identity === undefined) return undefined
      const countryCode = toAlpha2Country(identity.countryCode)
      const scheduledDate = String(row.scheduled_date ?? '')
      const periodKey = identity.metricKey.startsWith('evt.')
        ? String(row.scheduled_at ?? '').slice(0, 10)
        : periodFromSourceTitle(String(row.display_name ?? ''), scheduledDate)?.periodKey
          ?? periodFromRuleKey(identity.periodKey) ?? ''
      return `${countryCode}|${identity.metricKey}|${periodKey}`
    },
    identityRequired: false,
    hasValues: (row) => [row.consensus_json, row.provider_previous_json, row.provider_actual_json]
      .some((value) => value !== null && value !== ''),
    // 新口径：**来源同权**。这里原来是「新源写过的不覆盖」——那是来源优先级的旧实现，
    // 与用户定的「谁拿到非空值谁写、后到的覆盖」直接冲突，所以对所有来源一律 false。
    skipIdentitiesOwnedByOthers: false,
    importanceIsFact: true
  }
}

/**
 * 身份规则算出来的期次里，哪些**可以直接当真期次**：
 * - 日期（周度 `week_end` 推出的周六、事件日期）→ 可以；
 * - 季度（`previousQuarterKey`）→ 可以；
 * - 月度 **不可以**：那是「发布日的上一月」，真期次在源标题里（`(Sep)`），这条 2026-11-17 判过。
 */
const periodFromRuleKey = (periodKey: string): string | undefined =>
  /^\d{4}-\d{2}-\d{2}$/.test(periodKey) || /^\d{4}-Q[1-4]$/.test(periodKey) ? periodKey : undefined

/**
 * 写库失败 → 健康记录 + 一行日志（用户 2026-11-19）。**两个写入点都走这一处**：
 * 逐字复制到第二个调用点，迟早出现「一处漏码、一处漏 streak」。
 */
export function reportWriteFailure(
  writeLayer: Pick<CalendarStandardWriteLayer, 'recordAttempt'> | undefined,
  log: ((level: 'warn', event: string, fields?: Record<string, unknown>) => void) | undefined,
  providerId: string,
  counts: Readonly<{ failed: number; firstErrorCode?: 'standard-write-failed' | 'value-shape-rejected' }>,
  at: string
): boolean {
  /**
   * **成功也记一笔**（用户 2026-11-19）：写入成功本身就是「这个写入方存在」的证据，
   * 而且保证将来失败时有地方落——今天 3222/3321 行失败只打日志，根因就是只在失败时找记录。
   */
  const writerId = isCalendarHealthProviderId(providerId) ? providerId : undefined
  if (writerId === undefined) return false
  const failed = counts.failed > 0 && counts.firstErrorCode !== undefined
  writeLayer?.recordAttempt({ writerId, at,
    outcome: failed
      ? { state: 'failed', failedRows: counts.failed, firstErrorCode: counts.firstErrorCode! }
      : { state: 'succeeded' } })
  if (failed) {
    log?.('warn', 'macro-calendar.standard.write-failed',
      { providerId, failedRows: counts.failed, firstErrorCode: counts.firstErrorCode, recorded: writeLayer !== undefined })
  }
  return failed
}

const isCalendarHealthProviderId = (value: string): value is MacroCalendarProviderId =>
  value === 'macro-calendar-fed' || value === 'macro-calendar-bls'
  || value === 'macro-calendar-bea' || value === '0xrouter'

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
  /**
   * 来源健康记录（用户 2026-11-19）：**只用来记「写库失败」**，不改 `status`。
   * 不传就不记（离线脚本、用例不需要）。
   */
  /** 写入层（用户 2026-11-19）：成功与失败都记一笔，与采集健康正交。 */
  writeLayer?: Pick<CalendarStandardWriteLayer, 'recordAttempt'>
  log?: (level: 'warn', event: string, fields?: Record<string, unknown>) => void
}>): StandardBackfillReport {
  const providerId = input?.providerId ?? narwhalSourcePolicy.providerId
  const profile = backfillSourceProfiles[providerId]
  const write = input?.write ?? true
  if (write) ensureCalendarStandardTables(database)
  const exists = database.prepare("select 1 from sqlite_master where type = 'table' and name = 'mi_macro_calendar_market_event_observations'").get()
  if (exists === undefined) {
    return { observations: 0, releases: 0, indicator: 0, event: 0, source: 0,
      unmapped: { 'bad-identity': 0, 'unknown-measure': 0, 'period-unresolved': 0 }, skipped: 0, skippedExisting: 0,
      unmappedMissingCountry: 0, written: 0 }
  }
  // 同一个发布可能有多条观测（每个 measure 一条，按采集批次重复出现）：按**最新一条**取，
  // 再用发布 id 去重——回填只关心「这次发布最后是什么样」。
  const rows = database.prepare(`select source_event_id, market_fact_key, display_name, country_code,
    indicator_id, event_kind,
    scheduled_date, scheduled_at, consensus_json, provider_previous_json, provider_actual_json, importance,
    measure_keys_json, last_seen_at
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
  let unmappedMissingCountry = 0
  let unmappedMissingPeriod = 0
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
      // 没有国家码：没有身份可言，也不编一个——但**不许静默跳过**（用户 2026-11-16）：
      // 落进未映射表，原因 `missing-country`。它是「筛掉了」，不是「没有这次发布」。
      unmappedMissingCountry += 1
      if (write) {
        recordUnmappedOnce(database, { providerId, sourceKey: String(row.source_event_id),
          detectedAt: observedAt, reason: 'missing-country' as CalendarUnmappedReason,
          rawJson: JSON.stringify({
            name: row.display_name ?? '', eventKind: row.event_kind ?? '',
            scheduledDate: row.scheduled_date ?? '', scheduledAt: row.scheduled_at ?? '',
            indicatorId: row.indicator_id ?? ''
          }) })
      }
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
    /**
     * **fail-closed：有码、但没有期次，不写 `unknown:` 空壳行**（用户 2026-11-19）。
     *
     * 写进去的每一轮都会被启动规范化当成「期次没解开」再清一次，而读者看到的是「有这一期，
     * 却不知道是哪一期」。改成落未映射、原因 `period-unresolved`（闭集里已有：已映射、
     * 源未给统计期），下次采集就有据可查，也不会再长。
     */
    if (identity !== undefined && metricKey !== '' && periodKey === '') {
      unmappedMissingPeriod += 1
      if (write) {
        recordUnmappedOnce(database, {
          providerId, sourceKey: String(row.source_event_id), detectedAt: observedAt,
          reason: 'period-unresolved',
          rawJson: JSON.stringify({ metricKey, name: sourceName, scheduledDate })
        })
      }
      continue
    }
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
      // 观测表里本来就知道「这是什么」：原样写进标准表（类型闭集之外的写法就不写，读完退前缀）。
      ...(['economic-indicator', 'financial-event', 'central-bank-activity'].includes(String(row.event_kind))
        ? { eventType: String(row.event_kind) as 'economic-indicator' | 'financial-event' | 'central-bank-activity' }
        : {}),
      // **数据自身的观测时刻**＝来源最后一次说它是什么时候的（`last_seen_at`），不是我们写入的时刻。
      // 覆盖判定按它比，否则三天前的数据在今天写入会赢，把官方刚写的值盖回旧的。
      ...(row.last_seen_at === null || row.last_seen_at === '' ? {} : { dataObservedAt: row.last_seen_at }),
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
      /**
       * 算不出标准码的那一档**也没有期次**，于是这里原来拿发布时刻顶（`2026-11-16T13:30`）。
       * 那是同一类错，只是换了个分支：读者看到的「期次」是那一刻几点发的，不是这一期是什么。
       * 现在与有码那一档同一条规则——标题解得出来就用，解不出就记明确缺失
       * （`unknown:<source_event_id>`，每行唯一，不会与他行同期）。
       */
      const sourcePeriod = identity === undefined
        ? (periodFromSourceTitle(String(row.display_name ?? ''), scheduledDate)?.periodKey
          ?? `unknown:${String(row.source_event_id)}`)
        : periodKey
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
    const counts = dualWriteMeasureRows(database, { providerId, parserVersion: 'backfill-from-observations-v1',
      observedAt, rows: standardRows as never })
    written = counts.written
    reportWriteFailure(input?.writeLayer, input?.log, providerId, counts, observedAt)
  }
  return { observations: rows.length, releases: latest.size, indicator, event, source,
    unmapped: { 'bad-identity': badIdentity, 'unknown-measure': unmappedNoCurrentKey,
      'period-unresolved': unmappedMissingPeriod },
    skipped, skippedExisting, unmappedMissingCountry, written }
}
