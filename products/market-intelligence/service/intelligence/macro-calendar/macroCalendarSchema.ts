import type { createMacroCalendarSqlite } from './macroCalendarSqlite'

/**
 * 建表与迁移（DDL + 版本号）：从仓库里拆出来**原样搬过来**，语句与执行顺序一个字没改。
 *
 * 顺序本身就是契约：每条 `execute` 末尾的 `insert or ignore into mi_macro_calendar_migrations`
 * 是该版本的「已执行」标记，改顺序会让老库重放错版本。所以这里只搬文件，不改内容。
 */
export function migrateMacroCalendarSchema(database: ReturnType<typeof createMacroCalendarSqlite>['database'], migrationExecutor?: (sql: string) => void): void {
  const execute = migrationExecutor ?? ((sql: string) => database.exec(sql))
  execute('begin')
  try {
    execute('create table if not exists mi_macro_calendar_migrations (version integer primary key); create table if not exists mi_macro_calendar_revisions (revision_id text primary key, event_key text not null, release_group_key text not null, event_family text not null, event_name_key text not null, country_code text not null, importance text not null, period_key text not null, lifecycle_state text not null, revision_kind text not null, scheduled_date text not null, scheduled_at text, published_at text, detected_at text not null, detected_at_ms integer not null, recorded_at text not null, actual_json text, previous_json text, consensus_json text, provider_id text not null, descriptor_id text not null, source_url text not null, raw_record_id text, evidence_hash text not null, evidence_refs_json text not null, snapshot_hash text not null, replaces_revision_id text, parser_version text not null, caveats_json text not null, schema_version integer not null, unique(event_key, snapshot_hash)); create index if not exists idx_mi_calendar_event_visible on mi_macro_calendar_revisions(event_key, detected_at_ms desc, recorded_at desc); create index if not exists idx_mi_calendar_month on mi_macro_calendar_revisions(scheduled_date, detected_at_ms desc); insert or ignore into mi_macro_calendar_migrations(version) values (1)')
    execute(`delete from mi_macro_calendar_revisions as old where old.provider_id != 'macro-calendar-fed' and exists (select 1 from mi_macro_calendar_revisions as current where current.event_key = old.event_key and ((case when current.provider_id = 'macro-calendar-bls' and current.descriptor_id = 'macro-calendar-bls-calendar-family-refresh-api-v2' and current.revision_kind in ('official-release','official-revision') then 3 when current.provider_id = 'macro-calendar-bls' and current.descriptor_id in ('macro-calendar-bls-python-schedule','macro-calendar-bls-calendar-family-refresh-api-v2') then 2 else 1 end) > (case when old.provider_id = 'macro-calendar-bls' and old.descriptor_id = 'macro-calendar-bls-calendar-family-refresh-api-v2' and old.revision_kind in ('official-release','official-revision') then 3 when old.provider_id = 'macro-calendar-bls' and old.descriptor_id in ('macro-calendar-bls-python-schedule','macro-calendar-bls-calendar-family-refresh-api-v2') then 2 else 1 end) or ((case when current.provider_id = 'macro-calendar-bls' and current.descriptor_id = 'macro-calendar-bls-calendar-family-refresh-api-v2' and current.revision_kind in ('official-release','official-revision') then 3 when current.provider_id = 'macro-calendar-bls' and current.descriptor_id in ('macro-calendar-bls-python-schedule','macro-calendar-bls-calendar-family-refresh-api-v2') then 2 else 1 end) = (case when old.provider_id = 'macro-calendar-bls' and old.descriptor_id = 'macro-calendar-bls-calendar-family-refresh-api-v2' and old.revision_kind in ('official-release','official-revision') then 3 when old.provider_id = 'macro-calendar-bls' and old.descriptor_id in ('macro-calendar-bls-python-schedule','macro-calendar-bls-calendar-family-refresh-api-v2') then 2 else 1 end) and (current.detected_at_ms > old.detected_at_ms or (current.detected_at_ms = old.detected_at_ms and (current.recorded_at > old.recorded_at or (current.recorded_at = old.recorded_at and current.revision_id > old.revision_id))))))); delete from mi_macro_calendar_revisions where provider_id = 'macro-calendar-bls' and (descriptor_id = 'macro-calendar-bls-employment-refresh-api' or (descriptor_id = 'macro-calendar-bls-ics-manual' and event_family in ('cpi','core-cpi'))); delete from mi_macro_calendar_revisions as manual where manual.provider_id = 'macro-calendar-bls' and manual.descriptor_id = 'macro-calendar-bls-ics-manual' and exists (select 1 from mi_macro_calendar_revisions as automatic where automatic.provider_id = 'macro-calendar-bls' and automatic.event_family = manual.event_family and automatic.event_name_key = manual.event_name_key and automatic.scheduled_date = manual.scheduled_date and automatic.descriptor_id in ('macro-calendar-bls-python-schedule','macro-calendar-bls-calendar-family-refresh-api-v2')); insert or ignore into mi_macro_calendar_migrations(version) values (2)`)
    execute("create table if not exists mi_bea_release_observation_state (release_group_key text primary key, schedule_fingerprint text not null, last_attempt_at text not null); create index if not exists idx_mi_bea_release_observation_attempt on mi_bea_release_observation_state(last_attempt_at); insert or ignore into mi_macro_calendar_migrations(version) values (3)")
    execute("create table if not exists mi_policy_path_facts (meeting_date text primary key, has_projection_materials integer not null default 0, target_lower real, target_upper real, vote_for integer, vote_against integer, dissents_json text, statement_url text, detected_at text not null, constraint mi_policy_path_facts_meeting_date check (meeting_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')); insert or ignore into mi_macro_calendar_migrations(version) values (4)")
    execute("create table if not exists mi_policy_path_observations (meeting_date text not null, at text not null, values_json text not null, quote_json text, primary key (meeting_date, at), constraint mi_policy_path_observations_meeting_date check (meeting_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')); create index if not exists idx_mi_policy_path_observations_at on mi_policy_path_observations(meeting_date, at desc); insert or ignore into mi_macro_calendar_migrations(version) values (5)")
    execute("create table if not exists mi_policy_path_sep (meeting_date text primary key, sep_json text not null, detected_at text not null, constraint mi_policy_path_sep_meeting_date check (meeting_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')); insert or ignore into mi_macro_calendar_migrations(version) values (6)")
    // The venue page the odds came from, so the number can be opened instead of trusted.
    execute("create table if not exists mi_policy_path_market (meeting_date text primary key, slug text not null, detected_at text not null, constraint mi_policy_path_market_meeting_date check (meeting_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')); insert or ignore into mi_macro_calendar_migrations(version) values (7)")
    /**
     * 首次落库 / 首次拿到实际值：**必须持久化**，不能事后从修订表聚合。
     *
     * `replaceCurrent` 对 BLS/BEA/0xRouter 是"删旧行再插入"：替换之后表里只剩最新一行，所以
     * `min(recorded_at)` 得到的是**这次替换的写入时刻**，`min(detected_at) where actual` 同理——
     * 第一次带值那行已经不存在了。侧表在首次插入时写一次，替换时保留，读取改查它。
     *
     * **旧事件不回填＝未知，从本笔起准确。** 不回填是刻意的：`replaces_revision_id` 从没被写入，
     * 凭现有行分不出"第一次插入"和"替换后仅存"，任何回填值都是推测；而迁移每次启动都会重跑，
     * 回填一次就会把推测**常态化**成"事实"。界面按"缺值不画那一行"，旧事件少一行是诚实的。
     *
     * **回收策略**：仓库里没有"彻底删除一个事件"的路径（`deleteByEvent` 只服务于替换，替换后
     * 同名事件仍在）。因此侧表行随事件长期保留。将来若新增真删除路径，必须在同一事务里按
     * `event_key` 删掉侧表行——否则同名事件重建会继承上一世的"创建时间"。
     */
    execute("create table if not exists mi_macro_calendar_event_first_seen (event_key text primary key, first_recorded_at text not null, first_actual_detected_at text); insert or ignore into mi_macro_calendar_migrations(version) values (8)")
    /**
     * 换源第一笔（双写）：Narwhal 的发布行先写自己的表，不动 0xRouter 的可见性。
     *
     * `release_id` 是主键——来源自己给的发布标识就是分组键，不再靠「国家+时刻+名称同族」的近似合并。
     * `date_basis` / `time_precision` 原样落库：`indicative` 的行到渲染层只显示日期。
     */
    execute("create table if not exists mi_macro_calendar_release_rows (release_id text primary key, provider_id text not null, country_code text not null, scheduled_date text not null, scheduled_at text, date_basis text not null check(date_basis in ('exact','indicative')), time_precision text not null check(time_precision in ('minute','date')), status text, values_json text not null, detected_at text not null, recorded_at text not null, schema_version integer not null); create index if not exists idx_mi_release_rows_day on mi_macro_calendar_release_rows(country_code, scheduled_date, release_id); insert or ignore into mi_macro_calendar_migrations(version) values (9)")
    /**
     * 首发布快照：**第一次**看到某期时写下当时的 `previous`，之后来源修订不覆盖。
     * 没有这一行＝「无法确认首发布值」，界面照实说，不回填 0、不拿修订值顶。
     */
    execute("create table if not exists mi_macro_calendar_first_published (release_key text primary key, provider_id text not null, first_previous_json text, first_actual_json text, captured_at text not null); insert or ignore into mi_macro_calendar_migrations(version) values (10)")
    /**
     * 收窄 `date_basis` 的取值：源里只有 `indicative` 与缺省（实测 1,987 条），`date-only` 没有出处。
     * SQLite 改不了 CHECK，只能重建表；**行原样搬过去**（没有 `date-only` 行可丢），索引重建。
     */
    execute("create table if not exists mi_macro_calendar_release_rows_v11 (release_id text primary key, provider_id text not null, country_code text not null, scheduled_date text not null, scheduled_at text, date_basis text not null check(date_basis in ('exact','indicative')), time_precision text not null check(time_precision in ('minute','date')), status text, values_json text not null, detected_at text not null, recorded_at text not null, schema_version integer not null); insert or ignore into mi_macro_calendar_release_rows_v11 select release_id, provider_id, country_code, scheduled_date, scheduled_at, date_basis, time_precision, status, values_json, detected_at, recorded_at, schema_version from mi_macro_calendar_release_rows where date_basis in ('exact','indicative'); drop table if exists mi_macro_calendar_release_rows; alter table mi_macro_calendar_release_rows_v11 rename to mi_macro_calendar_release_rows; create index if not exists idx_mi_release_rows_day on mi_macro_calendar_release_rows(country_code, scheduled_date, release_id); insert or ignore into mi_macro_calendar_migrations(version) values (11)")
    execute('commit')
  } catch (error) {
    try { execute('rollback') } catch { /* Preserve the migration failure. */ }
    throw error
  }
}
