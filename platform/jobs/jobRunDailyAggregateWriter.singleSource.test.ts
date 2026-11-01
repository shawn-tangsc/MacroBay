import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Owner: platform/jobs（**每日汇总只由平台写，产品只读**）。
 *
 * 产品要求（本文件即是这条要求的护栏）：运行记录的每日汇总表 `job_run_daily_aggregates`
 * 只有平台一处写入，产品侧只能通过 `JobRuntime.listRunAggregates` 读。落地方式：
 *  - 唯一写入点：`platform/jobs/runtime/jobRunSqliteRepository.ts` 的清理事务（先汇总、后删明细，同事务）；
 *  - 产品侧不得出现该表名，也不得自己写 `job_runs`（自己补一张聚合表、或自己 upsert 明细，
 *    都会让「30 天前的历史」出现第二份互相不一致的账）。
 *
 * 因此本文件断言：写入语句与表名只出现在平台那一个文件；产品与应用壳里一个都不许有。
 * 故意在 `products/**` 里写一句 `insert into job_run_daily_aggregates` 必须让本文件变红。
 */

const ROOT = process.cwd()
const PLATFORM_ROOTS = ['platform']
const PRODUCT_ROOTS = ['products', 'apps/desktop-shell/src']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage'])
const AGGREGATE_TABLE = 'job_run_daily_aggregates'
const AGGREGATE_WRITER = 'platform/jobs/runtime/jobRunSqliteRepository.ts'
/** 任何写这张表的语句（含建表）：出现即意味着有了第二份账。 */
const AGGREGATE_WRITE_STATEMENT =
  /\b(insert\s+(or\s+\w+\s+)?into|update|delete\s+from|create\s+table\s+(if\s+not\s+exists\s+)?)\s*job_run_daily_aggregates\b/i
const RUN_WRITE_STATEMENT = /\b(insert\s+(or\s+\w+\s+)?into|update|delete\s+from)\s+job_runs\b/i

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) {
      collectSourceFiles(absolute, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    // 断言文件自己会包含这些字面量，不参与扫描
    if (/\.(test|spec)\.tsx?$/.test(name)) continue
    out.push(relative(ROOT, absolute).replace(/\\/g, '/'))
  }
  return out
}

const platformSources = PLATFORM_ROOTS.flatMap((root) => collectSourceFiles(resolve(ROOT, root)))
const productSources = PRODUCT_ROOTS.flatMap((root) => collectSourceFiles(resolve(ROOT, root)))
const read = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8')

describe('每日汇总只由平台写，产品只读', () => {
  it('汇总表只有平台一处写入，平台没有第二处也不另建第二张账', () => {
    const writers = platformSources.filter((file) => AGGREGATE_WRITE_STATEMENT.test(read(file)))
    expect(writers).toEqual([AGGREGATE_WRITER])
    // 唯一写入点的顺序仍在：同一事务里先 upsert 汇总、再删明细
    const writer = read(AGGREGATE_WRITER)
    expect(writer.indexOf('delete from job_runs')).toBeGreaterThan(writer.indexOf(AGGREGATE_TABLE))
    expect(writer).toContain('begin immediate')
  })

  it('产品侧一个都碰不到这张表', () => {
    const offenders = productSources.filter((file) => read(file).includes(AGGREGATE_TABLE))
    expect(offenders).toEqual([])
  })

  it('产品侧也不自己写运行明细', () => {
    const offenders = productSources.filter((file) => RUN_WRITE_STATEMENT.test(read(file)))
    expect(offenders).toEqual([])
  })
})
