#!/usr/bin/env tsx
/**
 * 转正入口的**手动那一个**（另外两个：采集写一行前、启动时，都在运行时里）。
 *
 * 用法：
 *   pnpm tsx scripts/calendar-promote-source-identities.mts <库路径> [--dry-run] [--provider narwhal]
 *
 * 补完映射表之后先 `--dry-run` 看「会转正几条」，再不带它真跑。**dryRun 绝不写库**：
 * 它只把 `promoted` 算出来给你看，`unmapped` 工作清单也不会被动。
 *
 * 为什么不给界面按钮：转正是数据修复动作，一年也用不了几次；放界面上反而给了「随手点一下」的机会。
 *
 * 退出码：0 正常（含「一条都不用转正」）；1 参数不对或库打不开。
 */

import { markTempDirectoryVerified } from '../platform/storage/sqlite/tempDirectoryReadiness'
import { openSqliteDatabase } from '../platform/storage/sqlite/openSqliteDatabase'
import { ensureCalendarStandardTables } from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarStandardTable'
import { promoteSourceIdentities } from '../products/market-intelligence/service/intelligence/macro-calendar/marketCalendarSourcePromotion'

const [databasePath, ...flags] = process.argv.slice(2)
if (databasePath === undefined) {
  console.error('用法：calendar-promote-source-identities.mts <库路径> [--dry-run] [--provider <id>]')
  process.exit(1)
}
const dryRun = flags.includes('--dry-run')
const providerIndex = flags.indexOf('--provider')
const provider = providerIndex === -1 ? undefined : flags[providerIndex + 1]
if (providerIndex !== -1 && provider === undefined) {
  console.error('--provider 后面要跟源 id')
  process.exit(1)
}

markTempDirectoryVerified()
const database = openSqliteDatabase(databasePath)
ensureCalendarStandardTables(database)
const counts = promoteSourceIdentities(database, { ...(provider === undefined ? {} : { provider }), dryRun })
database.close()
console.log(`${dryRun ? '（dry-run，未写库）' : ''}扫描 ${counts.scanned} / 转正 ${counts.promoted} / 仍无身份 ${counts.stillSource}`)
