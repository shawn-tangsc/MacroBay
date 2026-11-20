import type { DatabaseSync } from 'node:sqlite'

import { calendarStandardTablePolicy } from './marketCalendarStandardTable'
import { displayValueFromJson } from './marketCalendarValueEncoding'

/**
 * **一次性收敛：把 `materialize-mapped-v1` 那批双重编码的值还原成裸字符串**（用户 2026-11-18）。
 *
 * 事故：`scripts/calendar-materialize-mapped-identities.mts` 把观测表三列的 JSON 文本当字符串塞进
 * `values_json`，外层又序列化一次 → `previous: "{\"displayValue\":\"4.7%\"}"`。日报读出来就是一条 JSON。
 *
 * 三条边界：
 * 1. **只动这批行**（`parser_version = 'materialize-mapped-v1'`）：运行时的写入路径本来就是对的，
 *    不拿它去重写别人的行；
 * 2. 每字段 `JSON.parse` → 取 `displayValue`：非空字符串才替换，否则**删该字段**
 *    （不填空串、不猜）——空串会被读成「确实没有」，而事实是「这条值没编码对」；
 * 3. 整表在**同一事务**里备份到 `mi_calendar_events__value_encoding_v19`，单事务、行数对账、
 *    幂等（第二遍 0 变更）。回滚＝恢复备份表，值只动过 `values_json` 一列。
 *
 * **归属记录（2026-11-18；Chief 更正过一次，以本段为准）**：
 * - 08:46 真库量到 605 行双重编码；08:52 再量已是 0 行。
 * - **动手的人先备份再改，回滚材料在**：改前副本 `/tmp/mc-pre-wash.sqlite`（实测 605 行含
 *   `displayValue`）与 `/tmp/brief-pre-wash.sqlite`（1 行）；另有 `/tmp/mc-wash.sqlite`、
 *   `/tmp/mc-wash2.sqlite`、`/tmp/brief-verify.sqlite` 是演练与核对副本。
 *   库里没有备份**表**，是因为备份做成了**文件**——「没有备份」这个说法不成立。
 * - **改动来源仍未认领**：不是本脚本（从未 `--apply`）；也不是启动迁移链（08:54 那轮里每个
 *   运行时写入端都会改写 `parser_version`/`observed_at`，而那 635 行的两个字段没变，
 *   说明是只改 `values_json` 的定向 UPDATE）。可归因的只有 36 行：`observed_at=08:54:28`
 *   且 `parser_version='materialize-mapped-v1'`，即有人先修好补库脚本、在 08:54 重跑了一次。
 * - **措辞纪律**：不许把「不知道谁改的」写成「已修复」。数据现在是对的、回滚材料在，
 *   但这次批量改写没有执行者、没有迁移标记。
 *
 * 结论：**数据现在是对的，回滚材料在（`/tmp/mc-pre-wash.sqlite` 等），但改动来源仍未认领**——
 * 36 行可归因（脚本重跑），其余约 569 行没有执行者、没有迁移标记。本脚本保留为**幂等安全网**
 * （dry-run 默认、`--apply` 才写、同事务备份可回滚）；以后再出现这类脏数据，跑它即可，
 * 但**执行者必须写一行迁移标记并认领**，别再出现一次无人认领的批量改写。
 */
export const calendarValueEncodingRepairPolicy = Object.freeze({
  migrationVersion: 19,
  backupTable: 'mi_calendar_events__value_encoding_v19',
  /** 只收敛这一个写入端产出的行。 */
  parserVersion: 'materialize-mapped-v1'
})

const VALUE_FIELDS = ['actual', 'previous', 'consensus'] as const

const looksStringified = (value: unknown): value is string =>
  typeof value === 'string' && value.trimStart().startsWith('{"displayValue"')

export type ValueEncodingRepairReport = Readonly<{
  /** 扫到的行数（按 `parser_version` 筛）。 */
  scanned: number
  /** 实际改写了 `values_json` 的行数。 */
  updated: number
  /** 收完之后「还有字段是双重编码」的行数：必须是 0。 */
  remaining: number
  /** 表行数（改前 / 改后），对账用：这两个数必须相等。 */
  before: number
  after: number
}>

export function repairMaterializedValueEncoding(
  database: DatabaseSync,
  options: Readonly<{ apply?: boolean }> = {}
): ValueEncodingRepairReport {
  const { eventsTable } = calendarStandardTablePolicy
  const apply = options.apply === true
  const count = (sql: string, ...args: readonly unknown[]): number =>
    Number((database.prepare(sql).get(...(args as never[])) as { n: number }).n)
  const badRowCondition = `parser_version = ?
    and (json_type(values_json, '$.actual') = 'text' and trim(json_extract(values_json, '$.actual')) like '{"displayValue"%'
      or json_type(values_json, '$.previous') = 'text' and trim(json_extract(values_json, '$.previous')) like '{"displayValue"%'
      or json_type(values_json, '$.consensus') = 'text' and trim(json_extract(values_json, '$.consensus')) like '{"displayValue"%')`
  const before = count(`select count(*) as n from ${eventsTable}`)
  const rows = database.prepare(`select rowid as rowId, values_json as valuesJson from ${eventsTable}
    where parser_version = ?`).all(calendarValueEncodingRepairPolicy.parserVersion) as
    unknown as readonly { rowId: number; valuesJson: string }[]

  const repairs: { rowId: number; valuesJson: string }[] = []
  for (const row of rows) {
    let parsed: Record<string, unknown>
    try {
      const value: unknown = JSON.parse(row.valuesJson)
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
      parsed = { ...(value as Record<string, unknown>) }
    } catch { continue }
    let changed = false
    for (const field of VALUE_FIELDS) {
      const value = parsed[field]
      if (!looksStringified(value)) continue
      const decoded = displayValueFromJson(value)
      if (decoded === undefined) delete parsed[field]
      else parsed[field] = decoded
      changed = true
    }
    if (changed) repairs.push({ rowId: row.rowId, valuesJson: JSON.stringify(parsed) })
  }

  if (!apply || repairs.length === 0) {
    return { scanned: rows.length, updated: apply ? 0 : repairs.length, remaining: repairs.length, before, after: before }
  }

  database.exec('begin')
  try {
    // 整表备份**在同一事务里**：回滚时备份一起消失，不会留下半张快照。
    database.exec(`create table if not exists ${calendarValueEncodingRepairPolicy.backupTable} as
      select * from ${eventsTable}`)
    const update = database.prepare(`update ${eventsTable} set values_json = ? where rowid = ?`)
    for (const repair of repairs) update.run(repair.valuesJson, repair.rowId)
    const after = count(`select count(*) as n from ${eventsTable}`)
    if (after !== before) throw new Error(`value encoding repair row count mismatch: before=${before} after=${after}`)
    database.exec('commit')
  } catch (error) {
    try { database.exec('rollback') } catch { /* 保留原始错误 */ }
    throw error
  }
  const remaining = count(`select count(*) as n from ${eventsTable} where ${badRowCondition}`,
    calendarValueEncodingRepairPolicy.parserVersion)
  return { scanned: rows.length, updated: repairs.length, remaining, before, after: before }
}

/** 当前库里还剩多少行是双重编码（只读，给脚本与用例的真值判据）。 */
export function countDoubleEncodedValueRows(database: DatabaseSync): number {
  const { eventsTable } = calendarStandardTablePolicy
  return Number((database.prepare(`select count(*) as n from ${eventsTable}
    where json_type(values_json, '$.actual') = 'text' and trim(json_extract(values_json, '$.actual')) like '{"displayValue"%'
       or json_type(values_json, '$.previous') = 'text' and trim(json_extract(values_json, '$.previous')) like '{"displayValue"%'
       or json_type(values_json, '$.consensus') = 'text' and trim(json_extract(values_json, '$.consensus')) like '{"displayValue"%'`)
    .get() as { n: number }).n)
}
