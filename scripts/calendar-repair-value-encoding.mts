#!/usr/bin/env tsx
/**
 * **一次性收敛：把 `materialize-mapped-v1` 那批双重编码的值还原成裸字符串**（用户 2026-11-18）。
 *
 * 事故：补库脚本把观测表三列（`{"displayValue":"4.7%"}` 的 JSON 文本）当字符串塞进 `values_json`，
 * 外层又序列化一次 → 日报读到的 `previous` 是一条 JSON 串。运行时写入路径本来是对的，只有这批要收。
 *
 * 用法：`pnpm tsx scripts/calendar-repair-value-encoding.mts <库路径> [--apply]`
 * - 默认 **dry-run**：只报「会改几行、还剩几行坏」，不动库；
 * - `--apply`：整表在同一事务里备份到 `mi_calendar_events__value_encoding_v19`，单事务、行数对账、
 *   幂等（第二遍 0 变更）。回滚＝恢复备份表（值只动过 `values_json` 一列）。
 * - `parser_version` 是「一次性补库」的标记：**不许重跑那个补库脚本**，它会拿观测表旧值
 *   覆盖运行时已经写好的行。
 */

import { openSqliteDatabase } from '../platform/storage/sqlite/openSqliteDatabase'
import { markTempDirectoryVerified } from '../platform/storage/sqlite/tempDirectoryReadiness'
import {
  countDoubleEncodedValueRows, repairMaterializedValueEncoding
} from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarValueEncodingRepair'

const [dbPath, ...flags] = process.argv.slice(2)
if (dbPath === undefined) {
  console.error('用法：calendar-repair-value-encoding.mts <库路径> [--apply]')
  process.exit(1)
}
markTempDirectoryVerified()
const apply = flags.includes('--apply')
const database = openSqliteDatabase(dbPath)
try {
  const report = repairMaterializedValueEncoding(database, { apply })
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    ...report,
    doubleEncodedAfter: countDoubleEncodedValueRows(database)
  }))
} finally {
  database.close()
}
