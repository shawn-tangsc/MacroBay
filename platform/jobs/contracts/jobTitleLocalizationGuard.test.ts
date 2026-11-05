import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 作业名本地化的**按文件分账守卫**（契约 `job-title-localization-contract.md` 阶段 1）。
 *
 * 为什么不是「一个全局数字」：阶段 2 有四条线并行把自己的作业名改成双语，每一方都要把基线
 * 减掉自己那几条。四个人改同一行——不是冲突，就是**丢更新**；而丢更新会让守卫静默放宽，
 * 比冲突更糟。按文件分账之后，每方只改自己那一格，互不重叠。
 *
 * 三条判据：
 * 1. **每个文件的实际条数不得超过它自己那一格**（谁新增一条未本地化的作业，那格红）；
 * 2. **出现表里没有的文件就是红**（防止把条目挪到别的文件里绕过）；
 * 3. **总和不许超过前一版**（有人拆文件、合并文件时，总数不能涨）。
 *
 * 某个文件全部改完之后**把那一格删掉**，不要改成 0——空对象 = 全部迁移完，阶段 3 直接断言它为空。
 *
 * 刻意**不把 `product.manifest.ts` 算进来**：那里的 `title` 是导航名/工具名，不是 `JobDefinition`。
 */
const REMAINING_BY_FILE: Record<string, number> = {
  'platform/ai/agent-platform/channels/channelMaintenanceJobs.ts': 4,
  'platform/ai/assistant-platform/retention/registerAssistantSessionRetentionJob.ts': 1,
  'platform/ai/providers/registerInUseModelPatrolJob.ts': 1,
  'platform/notifications/jobs/notificationRetentionJob.ts': 1,
  'platform/storage/cache-governance/cacheAuditRetentionJob.ts': 1,
  'products/market-intelligence/service/intelligence/application/sourceRuntimeOrchestrator.ts': 1,
  'products/market-intelligence/service/intelligence/cross-asset/crossAssetIndexJob.ts': 1,
  'products/market-intelligence/service/intelligence/jobs/dailyBriefingSchedules.ts': 1,
  'products/market-intelligence/service/intelligence/jobs/registerDailyBriefSessionRetentionJob.ts': 1,
  'products/market-intelligence/service/intelligence/jobs/registerMarketAnalysisJobs.ts': 3,
  'products/market-intelligence/service/intelligence/macro-calendar/0xrouter-calendar/zeroXRouterCalendarScheduler.ts': 2,
  'products/market-intelligence/service/intelligence/macro-calendar/bea-official-release/beaOfficialReleaseJobRuntime.ts': 1,
  'products/market-intelligence/service/intelligence/macro-calendar/bls-schedule-catch-up/blsScheduleAndValuesScheduler.ts': 1,
  'products/market-intelligence/service/intelligence/macro-calendar/macroCalendarScheduleJobRuntime.ts': 1,
  'products/market-intelligence/service/intelligence/macro-market/macroMarketJob.ts': 1,
  'products/market-intelligence/service/intelligence/macro-market/realMarketApiDxyJob.ts': 1,
  'products/market-intelligence/service/intelligence/policy-path/policyPathRuntime.ts': 1,
  'products/market-intelligence/service/intelligence/retention/marketHistoryRetentionJob.ts': 1
}

/** 前一版的总数（`b230cca` 的全局基线）：只用于「总和只许减」这一条，不参与逐文件判定。 */
const PREVIOUS_TOTAL = 24

const ROOTS = ['platform', 'products']

/** 作业定义文件：内容里出现 `audience: '` 才算（manifest 与普通模块因此被排除）。 */
function jobDefinitionFiles(): string[] {
  const out: string[] = []
  for (const root of ROOTS) {
    for (const file of walk(resolve(root))) {
      if (file.endsWith('.test.ts') || file.includes(`${sep}node_modules${sep}`)) continue
      if (readFileSync(file, 'utf8').includes("audience: '")) out.push(file)
    }
  }
  return out
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

/** 未迁移的写法：`title: '…'` 与 `title: \`…\`` 都算；双语对象不算。 */
function literalTitles(source: string): number {
  const quoted = source.match(/title:\s*'(?:[^'\\]|\\.)*'/g) ?? []
  const templated = source.match(/title:\s*`[^`]*`/g) ?? []
  return quoted.length + templated.length
}

function relative(file: string): string {
  return file.slice(resolve('.').length + 1).split(sep).join('/')
}

describe('job title localization', () => {
  const counts = new Map<string, number>()
  for (const file of jobDefinitionFiles()) {
    const count = literalTitles(readFileSync(file, 'utf8'))
    if (count > 0) counts.set(relative(file), count)
  }

  it('never lets one file grow past its own share', () => {
    const grown = [...counts]
      .filter(([file, count]) => count > (REMAINING_BY_FILE[file] ?? 0))
      .map(([file, count]) => ({ file, count, allowed: REMAINING_BY_FILE[file] ?? 0 }))
    expect(grown, `un-localized job titles grew: ${JSON.stringify(grown, null, 2)}`).toEqual([])
  })

  it('does not let a title move to a file this table does not know about', () => {
    // 表里没有的文件出现未本地化标题 = 有人新增了一处注册点，或者把条目挪走了。
    const unknown = [...counts.keys()].filter((file) => REMAINING_BY_FILE[file] === undefined)
    expect(unknown, `un-localized job titles in unlisted files: ${JSON.stringify(unknown, null, 2)}`).toEqual([])
  })

  it('never lets the total grow, however the entries are regrouped', () => {
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
    expect(total, `total un-localized job titles (was ${PREVIOUS_TOTAL})`).toBeLessThanOrEqual(PREVIOUS_TOTAL)
  })
})
