import type { DatabaseSync } from 'node:sqlite'

import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import { calendarStandardTablePolicy } from './marketCalendarStandardTable'

/**
 * **建表与迁移**（从 `marketCalendarStandardTable` 抽出，2026-11-18 体积门禁）。
 *
 * 为什么要抽：那个文件过了 500 行硬线。但**写入那条语句与它的守卫不抽**——`upsertCalendarStandardRow`
 * 是唯一写入口，单一写入口是**不变量**，体积是另一回事，不能为了行数把它切开。
 */
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
      status text not null default 'unknown' check(status in (${marketCalendarPublicPolicy.releaseStatuses.map((status: string) => `'${status}'`).join(', ')})),
      identity_kind text not null default 'code' check(identity_kind in ('code', 'source')),
      source_label text,
      -- **源给的英文原文名**（迁移 18）：源对同一件事发了中文名、英文名两条，库里合并成一行后
      -- 中文那条做显示名，英文那条不能丢——英文读者搜 New York Fed 还得命中。这一列只进
      -- 搜索命中列，不覆盖显示名（与读取层英文全称槽位同一语义）。
      source_label_en text,
      series_id text,
      importance text check(importance in ('high', 'medium', 'low')),
      value_state text check(value_state in ('present', 'missing')),
      row_kind text not null default 'release' check(row_kind in ('release', 'estimate')),
      -- **这一行是什么**（经济数据 / 财经事件 / 央行活动）。写入时知道，以前没存，读侧只能靠
      -- metric_key 前缀猜——423 行上游 ID 数组因此全被猜成「经济指标」（2026-11-16 查实）。
      -- 空值＝还没回填（迁移 16 会补），读侧此时退回前缀规则。
      event_type text check(event_type in ('economic-indicator', 'financial-event', 'central-bank-activity')),
      -- **这一期发布过几次**（同身份跨来源合并后仍要保留这个数）：二读被当成初值是另一类错，
      -- 合并了却不显示次数＝把「改过数据」藏起来。默认 1，合并迁移会按组写入真实次数。
      release_count integer not null default 1,
      -- **这一期的每一次排期**（JSON 数组，ISO 日期/时刻）：二读/三读被合并成一行后，
      -- 读者仍要能点开看到「第 1 次 11-25、第 2 次 12-23」——只给次数等于把细节藏了。
      release_dates_json text,
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
  // 迁移 18 的列：老副本没有它，`create table if not exists` 不会补。缺列就补，不猜内容。
  if (!columns.some((column) => column.name === 'source_label_en')) {
    database.exec(`alter table ${eventsTable} add column source_label_en text`)
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
  if (!columns.some((column) => column.name === 'release_dates_json')) {
    database.exec(`alter table ${eventsTable} add column release_dates_json text`)
  }
  if (!columns.some((column) => column.name === 'release_count')) {
    database.exec(`alter table ${eventsTable} add column release_count integer not null default 1`)
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
