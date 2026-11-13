#!/usr/bin/env tsx
/**
 * 从观测表回填标准表：默认 dry-run 只报数，`--apply` 才写库。
 *
 * 这个脚本**只做三件事**：打开库、调 `backfillStandardRowsFromObservations`、打印报告。
 * 「一条发布怎么落」不在这里判断——分流在 `marketCalendarStandardRowRouting`，回填与实时写入
 * 问的是同一个函数（第一版在这里各写一套，事件型整类静默消失）。
 */
import { DatabaseSync } from 'node:sqlite'

import { markTempDirectoryVerified } from '../platform/storage/sqlite/tempDirectoryReadiness'
import { backfillStandardRowsFromObservations }
  from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarStandardBackfill'

const [dbPath, ...flags] = process.argv.slice(2)
if (dbPath === undefined) {
  console.error('用法：calendar-backfill-standard.mts <库路径> [--provider narwhal|0xrouter] [--apply]')
  process.exit(1)
}
const apply = flags.includes('--apply')
const providerFlag = flags[flags.indexOf('--provider') + 1]
const providerId = providerFlag === '0xrouter' ? '0xrouter' as const : 'narwhal' as const
markTempDirectoryVerified()
const db = new DatabaseSync(dbPath, apply ? {} : { readOnly: true })
try {
  const report = backfillStandardRowsFromObservations(db, { providerId, write: apply })
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 0))
} finally {
  db.close()
}
