import type { DatabaseSync } from 'node:sqlite'

/**
 * 标准日历表：**一行 = 一次发布**。主键 = 身份 `(country_code, metric_key, period_key)` +
 * **首次发布日** `first_scheduled_date`（UTC 日期，冻结）。
 *
 * 为什么第 4 列是**日期**而不是时刻：官方源（BLS 日程等）只给日期、不给时刻，市场行有 13:30。
 * 用分钟做键，同一次发布就成了两行；而**日期是两边都拿得到的粒度**。日期已足够区分「哪一次发布」
 * （初值 11-06 / 终值 11-20 是两天），不需要分钟。
 *
 * **绝不推算时刻**：源没给就留空、`time_precision = 'date'`。推一个「惯例的 8:30」会把编造的时间
 * 印给读者，而且推出来的时刻一旦进键和界面，就再也分不清哪条是源说的、哪条是我们猜的。
 *
 * 显示用两列：`scheduled_date`（可变，跨日改期就改它）与 `scheduled_at`（可空，源给到分钟才有）。
 * 合并时取精度是 `minute` 的那一方——官方没有时刻，优先它就是拿空值盖掉 13:30。
 *
 * 两列拆开才有「改期仍是一行」：`first_scheduled_date` 冻结且在主键里；`scheduled_date`/`scheduled_at`
 * 只做显示，源改期就跟着变。**认回「同一次发布」先按源内 id**（`source_provider_id` + `source_event_id`）：
 * 命中就是同一次发布，只更新显示时刻/值/观测时间；找不到才按主键插入。**不写「差几小时内算同一次」
 * 这种容差**——那是替源做判断，判错就把两次发布并成一次，正是要防的事。
 *
 * 与观测表的区别（观测表是**采集日志**，别混）：这里没有 `collection_id`/`descriptor_id`
 * ——那两个回答的是「哪一次采集、哪个端点」，属于采集层。读取层只读这张表，因此「不感知源」。
 *
 * **`first_published_*` 两列冻结**：身份一次发布的值会被来源修订，而卡片上「较上期（未修正）」
 * 必须永远用**第一次看到时的 previous**（非农首次 29、修订后 60，用 60 会算出 +105K 而不是
 * +136K）。所以这两列 `insert` 时写、`update` 时**不碰**——修订覆盖 `values_json`，冻结首发布值。
 * 不另开一张快照表：同一行能回答的问题，不该跨表 join，更不该再养一张「语义脆」的表。
 */
export const calendarStandardTablePolicy = Object.freeze({
  eventsTable: 'mi_calendar_events',
  /** 日历的唯一读入口（只含 `row_kind = 'release'`）。 */
  releasesView: 'mi_calendar_releases',
  unmappedTable: 'mi_calendar_unmapped',
  /**
   * 发布状态闭集，**从源拿**：读侧要分「已发布/排期/取消」不许按日期推——
   * 日期比会在发布当天中午前后判错（源还是 scheduled，日期已过）。
   */
  releaseStatuses: Object.freeze(['scheduled', 'published', 'cancelled', 'unknown'] as const),
  /**
   * 身份种类。`code` = 标准码（可跨源合并）；`source` = **源内标识**（映射不上时用它，
   * 日历照常显示、但**不参与跨源合并**——没有共同身份，硬合就是猜）。
   *
   * 不进主键：两种身份的命名空间天然不重叠（标准码是 `US.*`/`evt.*`，源内标识是源的
   * `release_id`），所以主键 `(国家, metric_key, period, 首发布日)` 已经唯一。**不为它重建表**——
   * 重建要动主键和已有行，正是最容易藏数据的一步。
   */
  identityKinds: Object.freeze(['code', 'source'] as const),
  /** 没映射上的原因闭集。新增值要同时更新这里的注释与用例。 */
  unmappedReasons: Object.freeze(['unknown-measure', 'unknown-event-type', 'bad-period', 'bad-identity',
    'unknown-release-group', 'ambiguous-same-day',
    /**
     * 有期间、但这次发布**一个 measure 都没有**（实测 11+12 月美国 21 条）。它写不出指标行
     * （没有 measure 就没有 `metric_key`），也不属于「映射不上」——所以要单独一个原因：
     * 前者要问源为什么发空发布，后者要补映射，修法不同。这条路径以前三无（表里没有、
     * `unmapped` 没有、日志也不说），发布层守恒式一上线就把它量出来了。
     */
    'no-values'] as const)
})
export type CalendarUnmappedReason = typeof calendarStandardTablePolicy.unmappedReasons[number]
export type CalendarReleaseStatus = typeof calendarStandardTablePolicy.releaseStatuses[number]
export type CalendarIdentityKind = typeof calendarStandardTablePolicy.identityKinds[number]

export type CalendarStandardRow = Readonly<{
  countryCode: string
  metricKey: string
  periodKey: string
  /** 显示用的发布日：跨日改期就变，**不在主键里**。 */
  scheduledDate: string
  /** 显示用的发布时刻：源给到分钟才有，没有就**留空**（不推）。 */
  scheduledAt?: string
  /** 首次看到的发布日（UTC）：冻结，**在主键里**。不传时取 `scheduledDate`。 */
  firstScheduledDate?: string
  timePrecision: 'minute' | 'date'
  /** 源给的发布状态（闭集）。缺省 `unknown`——不猜，也不按日期推。 */
  status?: CalendarReleaseStatus
  /** 映射得上＝`code`（缺省）；映射不上＝`source`，`metricKey` 存源内标识。 */
  identityKind?: CalendarIdentityKind
  /**
   * 源给的原名。**只有 `source` 身份的行需要**：标准码的显示名去名表查，源内 id 查不到，
   * 所以把源原文名随行存下来——否则日历只能拿一个 uuid 当标题。
   */
  sourceLabel?: string
  /**
   * 源的 `series_id`。转正时要靠它重算身份（`series → 组主测度`）：只凭源内 id 和名字，
   * 算不出「这条属于哪个发布组」。写成列而不是塞进 raw_json：转正是 SQL 层的扫描。
   */
  seriesId?: string
  /**
   * 值区状态（**物化列**）：`present` ＝ 有值；`missing` ＝ 没有值。
   * 单独一列、不塞进 `values_json`：视图靠它判「这行有没有值」，而拿 JSON 字符串比较
   * （`values_json <> '{}'`）把正确性绑在序列化格式上，写成 `{ }` 或字段顺序变就错。
   *
   * 物化列的唯一风险是**会漂**：所以有两条配套——upsert 里「present 不可被 missing 覆盖」，
   * 以及一致性守卫 `calendarValueStateMismatches()`（和 `values_json` 对不上就报）。
   */
  valueState?: 'present' | 'missing'
  valuesJson: string
  sourceProviderId: string
  sourceEventId: string
  parserVersion: string
  observedAt: string
  firstSeenAt: string
  /**
   * 行类型：`release` 是一次发布，`estimate` 是**随时更新的估算**（GDP 即时预测那类）。
   * 日历只取 `release`；分析与卡片按身份可读全部——同一个数在日历里错（三次估算像三次发布）、
   * 在卡片里对（最新值就是估算）。**不记 `unmapped`**：它不是映射不上，是本来就不是发布。
   */
  rowKind?: 'release' | 'estimate'
  /** 第一次看到这一期时来源给的 actual / previous；之后修订**不覆盖**，没有就不写。 */
  firstPublishedActual?: string
  firstPublishedPrevious?: string
}>

export function ensureCalendarStandardTables(database: DatabaseSync): void {
  const { eventsTable, unmappedTable } = calendarStandardTablePolicy
  database.exec(`
    create table if not exists ${eventsTable} (
      country_code text not null,
      metric_key text not null,
      period_key text not null,
      scheduled_date text not null,
      first_scheduled_date text not null,
      scheduled_at text,
      time_precision text not null check(time_precision in ('minute', 'date')),
      status text not null default 'unknown' check(status in ('scheduled', 'published', 'cancelled', 'unknown')),
      identity_kind text not null default 'code' check(identity_kind in ('code', 'source')),
      source_label text,
      series_id text,
      value_state text check(value_state in ('present', 'missing')),
      row_kind text not null default 'release' check(row_kind in ('release', 'estimate')),
      values_json text not null,
      source_provider_id text not null,
      source_event_id text not null,
      parser_version text not null,
      observed_at text not null,
      first_seen_at text not null,
      first_published_actual text,
      first_published_previous text,
      primary key(country_code, metric_key, period_key, first_scheduled_date)
    );
    -- **日历只读视图**：一个入口，条件写在这里，不靠每个调用点记得加。
    -- 同表两种行时，「每处都记得 where」是不可靠的：漏一处，估算就混进日历，而且图上看不出来。
    drop view if exists ${calendarStandardTablePolicy.releasesView};
    -- **视图不是修数据的地方**：它只回答「哪些行是发布」，不做身份去重、不做折叠。
    -- 曾经加过一条「同一期有值时折掉空行」的规则，结果藏掉了真实的行：密歇根 12-18 的终值
    -- （与 12-04 初值同期、各自都是真发布）、官方时薪 11-06（日期冲突的一方，折掉等于把冲突
    -- 藏起来）、消费者信贷的未来发布（日报「接下来」直接看不见）。今天藏空行，明天就会藏
    -- 有值的第二次发布——所以规则撤掉，收口交给写入端（同一 provider + 同一 source_event_id）。
    create view ${calendarStandardTablePolicy.releasesView} as
      select * from ${eventsTable} where row_kind = 'release';
    create index if not exists idx_calendar_events_month
      on ${eventsTable}(country_code, scheduled_at);
    create table if not exists ${unmappedTable} (
      provider_id text not null,
      source_key text not null,
      detected_at text not null,
      raw_json text not null,
      reason text not null,
      primary key(provider_id, source_key, detected_at)
    );
  `)
  // 老副本是在 status 列之前建的：`create table if not exists` 不会补列，得显式迁移一次，
  // 缺列时按 `unknown` 回填（**不按日期猜**：日期推状态正是这条要防的）。
  const columns = database.prepare(`pragma table_info(${eventsTable})`).all() as { name: string }[]
  if (!columns.some((column) => column.name === 'status')) {
    database.exec(`alter table ${eventsTable} add column status text not null default 'unknown'`)
  }
  if (!columns.some((column) => column.name === 'identity_kind')) {
    database.exec(`alter table ${eventsTable} add column identity_kind text not null default 'code'`)
  }
  if (!columns.some((column) => column.name === 'source_label')) {
    database.exec(`alter table ${eventsTable} add column source_label text`)
  }
  if (!columns.some((column) => column.name === 'series_id')) {
    database.exec(`alter table ${eventsTable} add column series_id text`)
  }
  if (!columns.some((column) => column.name === 'value_state')) {
    database.exec(`alter table ${eventsTable} add column value_state text`)
  }
  // 存量回填一次：老行的 value_state 是空的，空着会让视图把它们当「没值」折掉。
  database.exec(`update ${eventsTable}
    set value_state = case when values_json = '{}' then 'missing' else 'present' end
    where value_state is null`)
}

/**
 * 写一行标准事件。**修订覆盖值，但冻结首发布两列**——`on conflict` 的 `do update` 里
 * 刻意不出现 `first_published_*`，也不写 `first_seen_at`。
 */
export function upsertCalendarStandardRow(database: DatabaseSync, row: CalendarStandardRow): void {
  const { eventsTable } = calendarStandardTablePolicy
  database.prepare(`insert into ${eventsTable}
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, scheduled_at, time_precision, row_kind,
     status, identity_kind, source_label, series_id, value_state, values_json, source_provider_id, source_event_id, parser_version, observed_at, first_seen_at,
     first_published_actual, first_published_previous)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(country_code, metric_key, period_key, first_scheduled_date) do update set
      scheduled_date = excluded.scheduled_date,
      -- 时刻取精度是 minute 的那一方：官方只有日期（scheduled_at 为空），若它后写就把市场那条
      -- 13:30 抹掉了——读者会看到「只有日期」，而事实是有人给了时刻。
      -- 精度只从 date 升到 minute，不反向降；新值为空时不覆盖已有值。
      scheduled_at = coalesce(excluded.scheduled_at, scheduled_at),
      time_precision = case when excluded.time_precision = 'minute' then 'minute' else time_precision end,
      -- 值也一样：**空值不覆盖有值**。同一次发布后写的往往是「还没有值」那一版
      -- （来源标了已发布却没给值，或两边同一天各说一半），拿 {} 盖掉已有的值等于退回空白。
      values_json = case when excluded.values_json = '{}' then values_json else excluded.values_json end,
      -- 同一件事的第二半：**present 不可被 missing 覆盖**。只改 values_json 不改这一列的话，
      -- 先写空、后到值的行会永远记着 missing，视图按它一折就把有值的行折掉。
      value_state = case when excluded.value_state = 'present' then 'present'
        else coalesce(value_state, excluded.value_state) end,
      source_provider_id = excluded.source_provider_id,
      source_event_id = excluded.source_event_id,
      parser_version = excluded.parser_version,
      observed_at = excluded.observed_at`)
    .run(row.countryCode, row.metricKey, row.periodKey, row.scheduledDate,
      row.firstScheduledDate ?? row.scheduledDate, row.scheduledAt ?? null, row.timePrecision,
      row.rowKind ?? 'release',
      row.status ?? 'unknown',
      row.identityKind ?? 'code',
      row.sourceLabel ?? null,
      row.seriesId ?? null,
      // 没传就**从值本身推**：物化列不允许留空——空着会被视图当「没值」折掉。
      row.valueState ?? (row.valuesJson === '{}' ? 'missing' : 'present'),
      row.valuesJson, row.sourceProviderId, row.sourceEventId, row.parserVersion, row.observedAt, row.firstSeenAt,
      row.firstPublishedActual ?? null, row.firstPublishedPrevious ?? null)
}

/**
 * **一致性守卫**：`value_state='present'` 当且仅当 `values_json` 里真有值。
 *
 * 物化列唯一的问题是会漂，而漂了之后它**看起来永远是对的**——这条是它唯一能自证的地方。
 * 返回不一致的行数；调用方（采集批次日志、对账脚本）必须把它当红看，不能只打印。
 */
export function calendarValueStateMismatches(database: DatabaseSync): number {
  const { eventsTable, } = calendarStandardTablePolicy
  const row = database.prepare(`select count(*) n from ${eventsTable}
    where (value_state = 'present' and values_json = '{}')
       or (value_state = 'missing' and values_json <> '{}')
       or value_state is null`).get() as { n: number }
  return row.n
}

/** 没映射上的行：进 `unmapped`，**不进日历**；补上映射后按 `raw_json` 重放。 */
export function recordCalendarUnmapped(database: DatabaseSync, input: Readonly<{
  providerId: string; sourceKey: string; detectedAt: string; rawJson: string; reason: CalendarUnmappedReason
}>): void {
  const { unmappedTable } = calendarStandardTablePolicy
  database.prepare(`insert or ignore into ${unmappedTable}
    (provider_id, source_key, detected_at, raw_json, reason) values (?, ?, ?, ?, ?)`)
    .run(input.providerId, input.sourceKey, input.detectedAt, input.rawJson, input.reason)
}

/**
 * 按**源内 id** 找回同一次发布（`source_provider_id` + `source_event_id`）。
 *
 * 这是「改期仍是一行」的唯一判据：先按源内 id 找，命中的就是同一次发布，更新显示时刻/值即可；
 * 找不到才按主键插入。**不用时间容差**——那等于替源判断「差几小时算同一次」，判错就把两次
 * 真实发布并成一次。
 */
/**
 * **原地转正**：这个源内 id 原来是 `source` 身份，现在补上映射了，就把同一行的 `metric_key`
 * 换成标准码、`identity_kind` 改成 `code`。**不新增行**——否则每补一次映射，历史里就多一条
 * 重复，而重复比缺一行更难发现（日历上同一天两个一样的名字）。
 */
export function promoteCalendarStandardRowToCode(database: DatabaseSync, input: Readonly<{
  sourceProviderId: string; sourceEventId: string; metricKey: string
}>): void {
  const { eventsTable } = calendarStandardTablePolicy
  database.prepare(`update ${eventsTable} set metric_key = ?, identity_kind = 'code'
    where source_provider_id = ? and source_event_id = ? and identity_kind = 'source'`)
    .run(input.metricKey, input.sourceProviderId, input.sourceEventId)
}

export function findCalendarStandardRowBySource(database: DatabaseSync, input: Readonly<{
  sourceProviderId: string; sourceEventId: string
}>): Readonly<{ countryCode: string; metricKey: string; periodKey: string
  firstScheduledDate: string; sourceEventId: string; identityKind: CalendarIdentityKind }> | undefined {
  const { eventsTable } = calendarStandardTablePolicy
  const row = database.prepare(`select country_code, metric_key, period_key, first_scheduled_date, source_event_id,
    identity_kind from ${eventsTable} where source_provider_id = ? and source_event_id = ? limit 1`)
    .get(input.sourceProviderId, input.sourceEventId) as Record<string, unknown> | undefined
  return row === undefined ? undefined : {
    countryCode: String(row.country_code), metricKey: String(row.metric_key),
    periodKey: String(row.period_key), firstScheduledDate: String(row.first_scheduled_date),
    sourceEventId: String(row.source_event_id),
    identityKind: (String(row.identity_kind) === 'source' ? 'source' : 'code') as CalendarIdentityKind
  }
}
