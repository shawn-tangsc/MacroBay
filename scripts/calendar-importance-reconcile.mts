#!/usr/bin/env tsx
/**
 * **旧档去向的只读核对**（R44 技术方案 §3.1 / §9 S4）。
 *
 * 用法：
 *   pnpm tsx scripts/calendar-importance-reconcile.mts <库路径> [--limit <每桶样本数>]
 *
 * 三张单子：
 *   1. 旧列有档 → 我们按表**新判**为未分级（降级；每一族要么补一行表、要么留一条批准记录）
 *   2. 旧列有档 → 新判**不同档**（高→中、中→低…）
 *   3. 旧列 `high` → 新判也是 `high`（对照：表不是随便写的）
 *
 * 三条硬约束：
 * - **只读打开**：`readOnly: true`，不建表、不迁移、不回填。真库直接跑也不会改它一个字节。
 * - **新判是现算的**：历史行的 `importance_grade` 是 `NULL`，拿它比等于什么都没比；
 *   判据仍是写入口用的那一个纯函数。
 * - **逐族计数 + 样本身份**：只有总数没法收口，「哪一族降了」才是工作队列。
 *
 * 退出码：0 正常；1 参数不对或库打不开。
 */

import { writeFileSync } from 'node:fs'

import { markTempDirectoryVerified } from '../platform/storage/sqlite/tempDirectoryReadiness'
import { openSqliteDatabase } from '../platform/storage/sqlite/openSqliteDatabase'
import {
  reconcileCalendarImportance, type CalendarImportanceReconciliation, type ReconcileSample
} from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarImportanceReconciliation'

const [databasePath, ...flags] = process.argv.slice(2)
if (databasePath === undefined) {
  console.error('用法：calendar-importance-reconcile.mts <库路径> [--limit <每桶样本数>] [--csv <输出路径>]')
  process.exit(1)
}
const csvIndex = flags.indexOf('--csv')
const csvPath = csvIndex === -1 ? undefined : flags[csvIndex + 1]
if (csvIndex !== -1 && csvPath === undefined) {
  console.error('--csv 后面要跟输出路径')
  process.exit(1)
}
const limitIndex = flags.indexOf('--limit')
const limit = limitIndex === -1 ? 20 : Number(flags[limitIndex + 1])
if (!Number.isInteger(limit) || limit <= 0) {
  console.error('--limit 后面要跟一个正整数')
  process.exit(1)
}

markTempDirectoryVerified()
const database = openSqliteDatabase(databasePath, { readOnly: true })
let report: CalendarImportanceReconciliation
try {
  report = reconcileCalendarImportance(database)
} finally {
  database.close()
}

const formatSample = (sample: ReconcileSample): string =>
  `  ${sample.table === 'standard' ? '标准行' : '修订行'} ${sample.identity}`
  + `（旧 ${sample.legacyTier} → ${sample.newTier ?? '未分级'}${sample.basis === undefined ? '' : `；${sample.basis}`}）`

function bucket(title: string, bucketValue: CalendarImportanceReconciliation['gradedNowUngraded']): void {
  console.log(`\n${title}：${bucketValue.rows.length} 行`)
  for (const entry of bucketValue.byFamily) {
    console.log(`  族 ${entry.family}（旧档 ${entry.legacyTier}）：${entry.count} 行`)
  }
  for (const sample of bucketValue.rows.slice(0, limit)) console.log(formatSample(sample))
  if (bucketValue.rows.length > limit) console.log(`  ……另有 ${bucketValue.rows.length - limit} 行（--limit 调大可见）`)
}

console.log(`库：${databasePath}（只读）`)
console.log(`旧列有档：标准行 ${report.totals.standardRows} / 修订行 ${report.totals.revisionRows} / 合计 ${report.totals.legacyGraded}`)
bucket('1) 新判为未分级（降级，逐族要账）', report.gradedNowUngraded)
bucket('2) 新判为不同档', report.gradedDifferentTier)
bucket('3) 旧 high → 新 high（对照）', report.highNowHigh)
console.log(`\n合计：未分级 ${report.totals.gradedNowUngraded} / 不同档 ${report.totals.gradedDifferentTier}`
  + ` / 旧高新高 ${report.totals.highNowHigh}`)

/**
 * 可标注的工作清单：一行一个身份，带桶名与新旧档。
 * 报告里贴摘要，清单本身留在文件里让人逐行写归属（补表行 / 批准未分级）。
 */
if (csvPath !== undefined) {
  const escape = (value: string): string => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  const lines = ['bucket,table,country,family,legacy_tier,new_tier,identity']
  const add = (bucketName: string, rows: CalendarImportanceReconciliation['gradedNowUngraded']['rows']): void => {
    for (const row of rows) {
      lines.push([bucketName, row.table, row.countryCode, row.family, row.legacyTier,
        row.newTier ?? '', row.identity].map(escape).join(','))
    }
  }
  add('graded-now-ungraded', report.gradedNowUngraded.rows)
  add('graded-different-tier', report.gradedDifferentTier.rows)
  add('high-now-high', report.highNowHigh.rows)
  writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8')
  console.log(`工作清单：${csvPath}（${lines.length - 1} 行）`)
}