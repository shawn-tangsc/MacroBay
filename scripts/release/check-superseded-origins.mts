#!/usr/bin/env tsx
/**
 * 发布自检（F3）：这台机器上**没有**任何会话被标成 `superseded` 却没有身份链接。
 *
 * 0.4.1 发过一条问题构建：它给「没有身份链接的历史会话」打上 `origin_state = 'superseded'`，
 * 而 `origin_ref` 是空的。跑过那条构建的机器，库里会留下这种行；读者看到的是「某些会话不该隐藏
 * 却被隐藏」。这条检查就是为此存在的：**跑一次，计数必须为 0**，不靠人记。
 *
 * 用法（在装好这个包的机器上跑，指向**安装版**的数据目录，不是源码窗口的 profile）：
 *
 *   pnpm exec tsx scripts/release/check-superseded-origins.mts --user-data "$HOME/Library/Application Support/MacroBay"
 *   pnpm exec tsx scripts/release/check-superseded-origins.mts --db /path/to/platform/agents.sqlite
 *
 * 退出码：
 * - **0** 通过。包括「库不存在」「表不存在」「列不存在」三种不适用：那是迁移或那段代码从没在这个
 *   机器上跑过，按用户定的口径报通过并说明原因，**不以报错形式出现**；
 * - **1** 查到坏行（逐条打印，供人判断是删是修）；
 * - **2** 打不开或结构看不懂（只读打开失败、有 origin_state 却没有 origin_ref）：这是「拿不到」，
 *   不是「没有」，绝不混成通过。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'
import { markTempDirectoryVerified } from '@platform/storage/sqlite/tempDirectoryReadiness'

const APP_DIR = 'MacroBay'
const SESSION_TABLE = 'agent_sessions'
const ORIGIN_STATE_COLUMN = 'origin_state'
const ORIGIN_REF_COLUMN = 'origin_ref'
/** 迁移建列的那一笔，报「列不存在」时把来由写在人眼前。 */
const ORIGIN_STATE_MIGRATION = '0050_agent_session_origin_state'

function defaultUserData(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', APP_DIR)
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP_DIR)
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), APP_DIR)
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

function databasePath(): { path: string; from: string } {
  const explicitDatabase = argument('--db')
  if (explicitDatabase !== null) return { path: resolve(explicitDatabase), from: '--db' }
  const userData = argument('--user-data')
  if (userData !== null) {
    return { path: resolve(userData, 'platform', 'agents.sqlite'), from: '--user-data' }
  }
  return { path: join(defaultUserData(), 'platform', 'agents.sqlite'), from: 'default userData' }
}

interface SessionOriginStateRow {
  readonly id: string
  readonly agent_id: string
  readonly name: string | null
  readonly origin: string | null
  readonly origin_ref: string | null
  readonly created_at: string
  readonly updated_at: string
}

function pass(lines: readonly string[]): void {
  for (const line of lines) console.log(line)
  console.log('PASS')
}

function main(): number {
  const { path: dbPath, from } = databasePath()
  console.log('superseded-origin self-check')
  console.log(`database: ${dbPath} (${from})`)

  // 「没有库」= 那段代码没跑过：报通过并说明，不当错误。
  if (!existsSync(dbPath)) {
    pass([
      'schema: no session database at that path — this machine never created one,',
      '        so no session could have been marked superseded here'
    ])
    return 0
  }

  // 只读打开：这条检查不写任何东西。临时目录闸门是给应用启动用的，脚本在入口处自证（同 seed 脚本）。
  let database: ReturnType<typeof openSqliteDatabase>
  try {
    database = openSqliteDatabase(dbPath, { readOnly: true })
  } catch (error) {
    console.error(`FAIL (cannot inspect): ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  try {
    const table = database
      .prepare("select name from sqlite_master where type = 'table' and name = ?")
      .get(SESSION_TABLE)
    if (table === undefined) {
      pass([`schema: no \`${SESSION_TABLE}\` table — the session store never ran here`])
      return 0
    }

    const columns = database
      .prepare(`pragma table_info(${SESSION_TABLE})`)
      .all()
      .map((column) => String((column as { name: unknown }).name))
    if (!columns.includes(ORIGIN_STATE_COLUMN)) {
      pass([
        `schema: \`${SESSION_TABLE}\` has no \`${ORIGIN_STATE_COLUMN}\` column —`,
        `        migration ${ORIGIN_STATE_MIGRATION} never ran here, so nothing could be marked superseded`
      ])
      return 0
    }
    if (!columns.includes(ORIGIN_REF_COLUMN)) {
      console.error(
        `FAIL (cannot inspect): \`${SESSION_TABLE}\` has \`${ORIGIN_STATE_COLUMN}\` but no ` +
          `\`${ORIGIN_REF_COLUMN}\` — this schema is not one this check knows; refusing to guess`
      )
      return 2
    }

    // 判据：被标成 superseded，却没有任何身份链接（null 或空白字符串都算空）。
    const offenders = database
      .prepare(
        `select id, agent_id, name, origin, origin_ref, created_at, updated_at
           from ${SESSION_TABLE}
          where ${ORIGIN_STATE_COLUMN} = 'superseded'
            and (${ORIGIN_REF_COLUMN} is null or trim(${ORIGIN_REF_COLUMN}) = '')
          order by created_at, id`
      )
      .all() as unknown as SessionOriginStateRow[]

    console.log(`schema: \`${SESSION_TABLE}.${ORIGIN_STATE_COLUMN}\` present (migration ${ORIGIN_STATE_MIGRATION})`)
    console.log(`rows marked superseded without an origin reference: ${offenders.length}`)
    if (offenders.length === 0) {
      pass(['no session on this machine was superseded without an origin reference'])
      return 0
    }

    // 不只报数字：哪几条、什么时候写入的，都要能直接拿去判断。
    for (const row of offenders) {
      const name = row.name === null ? '' : ` name=${JSON.stringify(row.name)}`
      console.log(
        `  - id=${row.id} agent=${row.agent_id}${name} origin=${row.origin ?? 'null'} ` +
          `origin_ref=${row.origin_ref === null ? 'null' : JSON.stringify(row.origin_ref)} ` +
          `created_at=${row.created_at} updated_at=${row.updated_at}`
      )
    }
    console.log(`FAIL: ${offenders.length} session(s) were superseded without an origin reference`)
    return 1
  } finally {
    database.close()
  }
}

markTempDirectoryVerified()
try {
  process.exitCode = main()
} catch (error) {
  console.error(`FAIL (cannot inspect): ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
}
