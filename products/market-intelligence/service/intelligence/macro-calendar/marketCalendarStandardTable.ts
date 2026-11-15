import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import { toAlpha2Country } from './marketCalendarMetricIdentity'
import { sourceIdOverwriteOnWrite } from './marketCalendarSourceIdAudit'

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
   * 「源内发布 id ↔ 标准行」的映射。**一行只能存一个 `source_event_id`**：源把同一身份同一天
   * 重发两次时，后写的会把前一个 id 覆盖掉，按 id 溯源的清单就会凭空少一条（实测 257 → 252）。
   * 这张表把每次发布都记下来，于是「清单里有、表里没有」能真的为 0，而不是靠一句解释。
   */
  sourceIdsTable: 'mi_calendar_event_source_ids',
  /**
   * 发布状态闭集，**从源拿**：读侧要分「已发布/排期/取消」不许按日期推——
   * 日期比会在发布当天中午前后判错（源还是 scheduled，日期已过）。
   */
  /**
   * 五态闭集（产品口径 2026-11-16）：`scheduled` 只用于「还没到发布日」；过期无值在 24h 窗口内是
   * `backfilling`（界面「待补值」），窗口外是 `missing`（「未提供」）。旧行的 `unknown` 保留读兼容，
   * 读侧按 `missing` 处理，不单开第六态。
   */
  /** 闭集**引用契约那一份**，这里不写字面量（守卫见 `marketCalendarReleaseStatusUnionGuard`）。 */
  releaseStatuses: marketCalendarPublicPolicy.releaseStatuses,
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
    'no-values',
    /**
     * **身份缺国家**（2026-11-16 用户口径）：观测本身没带国家码，算不出「哪个国家的这次发布」。
     * 它和 `bad-identity` 是两件事：那个是「身份本身坏了」（拼不出三段），这个是「少了其中一段」。
     * 以前这类行**静默跳过**（既不进表、也不进未映射），1484 条就这么消失了——用户一句话点出：
     * 不落表可以，但**必须落在未映射的库里**，否则「筛掉了」被读成「没有」。
     */
    'missing-country'] as const)
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
  /**
   * 重要性，**从源带过来**（观测表本来就有这一列；官方 revision 也带）。标准表原本缺这一列，
   * 读侧只好拿三档里的一个去顶，那等于编数据——筛选会失效，而没人看得出是假的。
   * 缺省不填；读侧拿不到就是「未分级」，不许拿 `medium` 顶。
   */
  importance?: 'high' | 'medium' | 'low'
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
  /**
   * **数据自身的观测时刻**（源说这条值是什么时候的；例如观测行的 `last_seen_at`）。
   *
   * 覆盖判定按它比，不按 `observedAt`：`observedAt` 是「我们写入的时刻」，用它比会让
   * 「拿三天前的数据在今天写入」永远赢，把官方刚写的值盖成旧的。缺省时退化为 `observedAt`
   * （没有数据时刻的来源不因此失去覆盖能力）。
   */
  dataObservedAt?: string
  firstSeenAt: string
  /**
   * 行类型：`release` 是一次发布，`estimate` 是**随时更新的估算**（GDP 即时预测那类）。
   * 日历只取 `release`；分析与卡片按身份可读全部——同一个数在日历里错（三次估算像三次发布）、
   * 在卡片里对（最新值就是估算）。**不记 `unmapped`**：它不是映射不上，是本来就不是发布。
   */
  rowKind?: 'release' | 'estimate'
  /**
   * **这一行是什么**（经济数据 / 财经事件 / 央行活动），写入侧的已知事实。
   * 不传就不写（历史行由迁移 16 回填），读侧在空值时才退回 `metric_key` 前缀规则。
   */
  eventType?: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
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
      status text not null default 'unknown' check(status in (${marketCalendarPublicPolicy.releaseStatuses.map((status) => `'${status}'`).join(', ')})),
      identity_kind text not null default 'code' check(identity_kind in ('code', 'source')),
      source_label text,
      series_id text,
      importance text check(importance in ('high', 'medium', 'low')),
      value_state text check(value_state in ('present', 'missing')),
      row_kind text not null default 'release' check(row_kind in ('release', 'estimate')),
      -- **这一行是什么**（经济数据 / 财经事件 / 央行活动）。写入时知道，以前没存，读侧只能靠
      -- metric_key 前缀猜——423 行上游 ID 数组因此全被猜成「经济指标」（2026-11-16 查实）。
      -- 空值＝还没回填（迁移 16 会补），读侧此时退回前缀规则。
      event_type text check(event_type in ('economic-indicator', 'financial-event', 'central-bank-activity')),
      values_json text not null,
      source_provider_id text not null,
      source_event_id text not null,
      parser_version text not null,
      observed_at text not null,
      first_seen_at text not null,
      -- **数据自身的观测时刻**（源说这条值是什么时候的）与 observed_at（我们写入的时刻）分开：
      -- 覆盖判定按这一列比。混用会让「用 11-12 的数据、在 11-16 写入」按写入时刻赢，
      -- 把官方刚写的值盖成三天前的旧值。
      data_observed_at text,
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
    create table if not exists ${calendarStandardTablePolicy.sourceIdsTable} (
      provider_id text not null,
      source_event_id text not null,
      country_code text not null,
      metric_key text not null,
      period_key text not null,
      first_scheduled_date text not null,
      observed_at text not null,
      primary key(provider_id, source_event_id)
    );
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
  if (!columns.some((column) => column.name === 'importance')) {
    database.exec(`alter table ${eventsTable} add column importance text`)
  }
  if (!columns.some((column) => column.name === 'series_id')) {
    database.exec(`alter table ${eventsTable} add column series_id text`)
  }
  if (!columns.some((column) => column.name === 'value_state')) {
    database.exec(`alter table ${eventsTable} add column value_state text`)
  }
  if (!columns.some((column) => column.name === 'event_type')) {
    database.exec(`alter table ${eventsTable} add column event_type text`)
  }
  if (!columns.some((column) => column.name === 'data_observed_at')) {
    // 老行没有这一列：按写入时刻回填（它是我们唯一有的事实），之后的写入按真值比。
    database.exec(`alter table ${eventsTable} add column data_observed_at text`)
    database.exec(`update ${eventsTable} set data_observed_at = observed_at where data_observed_at is null`)
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
  /**
   * **国家码在写入端归一到 alpha-2**（2026-11-16，Chief 拍板）。
   *
   * 这条表里两种写法曾并存：`US` 522 行、`USA` 329 行（narwhal/官方回放/BLS/BEA/Fed 写的是 alpha-3）。
   * 不归一到写入端，每个消费者都得自己反向归一，第三个写法出现时又要改一轮，而「哪一处漏了归一」
   * 会以「某个界面没国家」的形式散布各处。展示侧的 `toAlpha2Country` 从此只服务**历史行**的兼容，
   * 不再是常态路径。
   */
  const countryCode = toAlpha2Country(row.countryCode)
  // 先量一眼「同身份换 id」：只打日志、不改数据；旧 id 不在台账里会单独记真红标记。
  sourceIdOverwriteOnWrite(database, {
    eventsTable, sourceIdsTable: calendarStandardTablePolicy.sourceIdsTable
  }, {
    countryCode, metricKey: row.metricKey, periodKey: row.periodKey,
    firstScheduledDate: row.firstScheduledDate ?? row.scheduledDate, sourceEventId: row.sourceEventId
  })
  database.prepare(`insert into ${eventsTable}
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, scheduled_at, time_precision, row_kind,
     status, identity_kind, source_label, series_id, importance, value_state, values_json, source_provider_id, source_event_id, parser_version, observed_at, first_seen_at,
     first_published_actual, first_published_previous, data_observed_at, event_type)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(country_code, metric_key, period_key, first_scheduled_date) do update set
      scheduled_date = excluded.scheduled_date,
      -- 时刻取精度是 minute 的那一方：官方只有日期（scheduled_at 为空），若它后写就把市场那条
      -- 13:30 抹掉了——读者会看到「只有日期」，而事实是有人给了时刻。
      -- 精度只从 date 升到 minute，不反向降；新值为空时不覆盖已有值。
      scheduled_at = coalesce(excluded.scheduled_at, scheduled_at),
      time_precision = case when excluded.time_precision = 'minute' then 'minute' else time_precision end,
      -- 值要**逐字段**合并，不是整块替换：先写 actual+previous，后到的源只带 previous 时，
      -- 整块替换会把 actual 抹掉（实测能复现；真库今天 0 条命中，是因为每个写入方都三字段齐给，
      -- 0xrouter 一恢复就会发作）。缺席的字段保留旧值，带了的字段覆盖——json_patch 正是这个语义。
      -- **旧数据不许盖新数据**（Chief 2026-11-16）：按「数据自身的观测时刻」比，不按写入时刻。
      -- 三种放行：这条还没值（空值可以被填）、来的是同一时刻或更新的、来的是空 JSON。
      values_json = case
        when excluded.values_json = '{}' then values_json
        when json_extract(values_json, '$.actual') is null
          or trim(cast(json_extract(values_json, '$.actual') as text)) = ''
          then json_patch(values_json, excluded.values_json)
        when excluded.data_observed_at >= coalesce(data_observed_at, observed_at)
          then json_patch(values_json, excluded.values_json)
        else values_json end,
      data_observed_at = case
        when excluded.data_observed_at >= coalesce(data_observed_at, observed_at) then excluded.data_observed_at
        else data_observed_at end,
      -- 同一件事的第二半：**present 不可被 missing 覆盖**。只改 values_json 不改这一列的话，
      -- 先写空、后到值的行会永远记着 missing，视图按它一折就把有值的行折掉。
      value_state = case when excluded.value_state = 'present' then 'present'
        else coalesce(value_state, excluded.value_state) end,
      event_type = coalesce(excluded.event_type, event_type),
      source_provider_id = excluded.source_provider_id,
      source_event_id = excluded.source_event_id,
      parser_version = excluded.parser_version,
      observed_at = excluded.observed_at`)
    .run(countryCode, row.metricKey, row.periodKey, row.scheduledDate,
      row.firstScheduledDate ?? row.scheduledDate, row.scheduledAt ?? null, row.timePrecision,
      row.rowKind ?? 'release',
      row.status ?? 'unknown',
      row.identityKind ?? 'code',
      row.sourceLabel ?? null,
      row.seriesId ?? null,
      row.importance ?? null,
      // 没传就**从值本身推**：物化列不允许留空——空着会被视图当「没值」折掉。
      row.valueState ?? (row.valuesJson === '{}' ? 'missing' : 'present'),
      row.valuesJson, row.sourceProviderId, row.sourceEventId, row.parserVersion, row.observedAt, row.firstSeenAt,
      row.firstPublishedActual ?? null, row.firstPublishedPrevious ?? null,
      // 数据时刻不传就按写入时刻算：没有这一级的来源不许因为「不知道数据时刻」而永远覆盖不了。
      row.dataObservedAt ?? row.observedAt,
      // 写入侧知道「这是什么」就存下来；不知道（历史/旧调用方）留空，读侧才退前缀规则。
      row.eventType ?? null)
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

/** 记下「这次发布落到了哪一行」（幂等）：一行可以对应多次发布，溯源时不会缺。 */
export function recordCalendarSourceId(database: DatabaseSync, input: Readonly<{
  providerId: string; sourceEventId: string; countryCode: string; metricKey: string
  periodKey: string; firstScheduledDate: string; observedAt: string
}>): void {
  database.prepare(`insert or replace into ${calendarStandardTablePolicy.sourceIdsTable}
    (provider_id, source_event_id, country_code, metric_key, period_key, first_scheduled_date, observed_at)
    values (?, ?, ?, ?, ?, ?, ?)`)
    // 台账的身份列与标准行同一口径（alpha-2）：不一致会让「按身份匹配」的孤儿判据把正常台账判成孤儿。
    .run(input.providerId, input.sourceEventId, toAlpha2Country(input.countryCode), input.metricKey,
      input.periodKey, input.firstScheduledDate, input.observedAt)
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

/**
 * **台账零孤儿**：`mi_calendar_event_source_ids` 里指向已不存在标准行的行，删掉并返回条数（幂等）。
 *
 * 这张表存在的意义只有一个：**「清单里有、表里没有」必须能查出来、且必须为 0**。11-14 撤掉
 * 0xrouter 那 659 行时没撤台账，留下 916 条孤儿——一次 `/tmp` 脚本清掉了，但那不是判据。
 * 所以判定与修复都放在这里，配一条能跑红的用例（造一条孤儿 → 能查出来 → 清掉 → 再清返回 0）。
 *
 * 判定用「`source_event_id` 匹配 **或** 身份（国家+码+期间+首发布日）匹配」：源重发会覆盖
 * `source_event_id`，只按 id 比会把合法台账误判成孤儿。
 */
export function countOrphanSourceIds(database: DatabaseSync): number {
  const row = database.prepare(`select count(*) as c from ${calendarStandardTablePolicy.sourceIdsTable} s
    where not exists (select 1 from ${calendarStandardTablePolicy.eventsTable} e
      where e.source_event_id = s.source_event_id
        or (e.country_code = s.country_code and e.metric_key = s.metric_key
            and e.period_key = s.period_key and e.first_scheduled_date = s.first_scheduled_date))`).get() as
    { c: number } | undefined
  return row?.c ?? 0
}

export function pruneOrphanSourceIds(database: DatabaseSync): number {
  const result = database.prepare(`delete from ${calendarStandardTablePolicy.sourceIdsTable} as s
    where not exists (select 1 from ${calendarStandardTablePolicy.eventsTable} e
      where e.source_event_id = s.source_event_id
        or (e.country_code = s.country_code and e.metric_key = s.metric_key
            and e.period_key = s.period_key and e.first_scheduled_date = s.first_scheduled_date))`).run()
  return Number(result.changes)
}
