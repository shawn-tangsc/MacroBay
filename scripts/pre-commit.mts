/**
 * 提交前预检：**只拦自己这一笔**（Chief 2026-11-03 批，六条约束见 AGENTS.md「提交前的预检钩子」）。
 *
 * 为什么不是普通钩子：这个仓库是**多人共用同一个工作区**。把全仓 `tsc` 直接做成「红就拦」，
 * 别人的在途文件会把所有人的提交卡死——今晚那两条 `Element.click` 里就有一半是别人手上没写完的。
 * 所以这里的判据是「**报错文件属于本次提交**」，不是「全仓有没有错」。
 *
 * 它补的是「单跑定向用例抓不到」的那一半（类型错、按目录扫的守卫）；**不替代** `pnpm typecheck`，
 * 也不替代 Chief 跑的全量。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const BUDGET_MS = Number(process.env.PRE_COMMIT_BUDGET_MS ?? 58_000)
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/
/** 四条按目录扫的守卫：各自只扫自己那一块，不扫别人的业务代码。 */
const GUARDS = [
  'platform/ui/components/icon-button/iconButtonKeyGuard.test.ts',
  'platform/ui/components/modal/modalCallSiteGuard.test.ts',
  'platform/ui/components/state/stateViewCallSiteGuard.test.ts',
  'platform/ui/components/state/textResolverGuard.test.ts'
]

const started = performance.now()
// spawnSync 的 timeout 必须是整数，且不能为负：超预算时只给一个最小的整数窗口。
const remaining = (floor = 5_000): number => Math.max(floor, Math.round(BUDGET_MS - (performance.now() - started)))
const elapsed = (): string => `${Math.round(performance.now() - started)}ms`
const say = (message: string): void => console.log(`[pre-commit] ${message}`)

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

/** 跳过一次：钩子只补漏洞，不该在紧急回滚时挡路。跳过后必须自己补跑 `pnpm typecheck`。 */
if (process.env.SKIP_PRE_COMMIT === '1') {
  say('SKIP_PRE_COMMIT=1，已跳过预检。跳过的提交要自己补跑 pnpm typecheck。')
  process.exit(0)
}

let root: string
try {
  root = git(['rev-parse', '--show-toplevel'])
} catch {
  process.exit(0)
}

/**
 * 本次提交涉及哪些路径。`git commit -- <path>` 会用一个**临时索引**，`--cached` 读到的就是那一份；
 * 所以这里不用 `git status`（它会混进别人未暂存的改动）。
 */
let staged: string[]
try {
  staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: root,
    encoding: 'utf8'
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
} catch {
  process.exit(0)
}

const codeStaged = staged.filter((path) => CODE_FILE.test(path))
if (codeStaged.length === 0) {
  say(staged.length === 0 ? '没有暂存内容，跳过预检。' : '本次没有代码文件，跳过预检。')
  process.exit(0)
}

const owns = (path: string): boolean => codeStaged.includes(path)
const normalize = (path: string): string => path.replace(/^\.\//, '')

say(`预检 ${codeStaged.length} 个代码文件（预算 ${Math.round(BUDGET_MS / 1000)}s）`)

// ── 1. 四条按目录扫的守卫（很便宜，先跑）：红了也要看是谁的文件 ──────────────────────
const guard = spawnSync('node_modules/.bin/vitest', ['run', ...GUARDS], {
  cwd: root,
  encoding: 'utf8',
  timeout: remaining()
})
if (guard.error !== undefined && guard.error !== null && (guard.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
  say('预检超时（守卫未跑完），**未拦截**，请手动跑这四条守卫。')
  process.exit(0)
}

if (guard.status !== 0) {
  const guardOutput = `${guard.stdout ?? ''}${guard.stderr ?? ''}`
  // 守卫红在别人的文件上时同样不拦：它扫的是目录，不是「这一笔」。
  const blamesStaged = codeStaged.some((path) => guardOutput.includes(path))
  if (blamesStaged) {
    console.error('[pre-commit] ✗ 四条守卫有红，且命中了本次提交的文件：')
    console.error(guardOutput.split('\n').filter((line) => line.includes('FAIL') || line.includes('×')).slice(0, 20).join('\n'))
    console.error('[pre-commit] 紧急回滚可跳过：SKIP_PRE_COMMIT=1 git commit …')
    process.exit(1)
  }
  say('四条守卫有红，但都不在本次提交的文件里（别人的在途改动），本次不拦截。')
}

// ── 2. 全仓 typecheck，只有「报错文件属于本次提交」才判失败 ──────────────────────────────
const tsc = spawnSync('node_modules/.bin/tsc', ['--noEmit', '-p', 'tsconfig.json'], {
  cwd: root,
  encoding: 'utf8',
  timeout: remaining()
})
if (tsc.error !== undefined && tsc.error !== null && (tsc.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
  say(`预检超时（typecheck 超过 ${Math.round(BUDGET_MS / 1000)}s），**未拦截**，请手动跑 pnpm typecheck。`)
  process.exit(0)
}

const tscOutput = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`
const ownErrors: string[] = []
const foreignErrors: string[] = []
for (const line of tscOutput.split('\n')) {
  if (!line.includes('error TS')) continue
  const located = /^(.+?)\(\d+,\d+\): error TS\d+/.exec(line.trim())
  if (located === null) continue
  const file = normalize(located[1] ?? '')
  if (owns(file)) ownErrors.push(line.trim())
  else foreignErrors.push(line.trim())
}

if (foreignErrors.length > 0) {
  // 别人的在途文件：只提示，不拦。共用工作区里拦它们等于替别人背锅。
  say(`另有 ${foreignErrors.length} 条类型错在**别人的在途文件**里，本次不拦截（预览一条）：`)
  say(`  ${foreignErrors[0]}`)
}

if (ownErrors.length > 0) {
  console.error(`[pre-commit] ✗ 本次提交的文件里有 ${ownErrors.length} 条类型错，先修再提交：`)
  for (const line of ownErrors) console.error(`  ${line}`)
  console.error('[pre-commit] 紧急回滚可跳过：SKIP_PRE_COMMIT=1 git commit …（跳过后要补跑 pnpm typecheck）')
  process.exit(1)
}

say(`✓ 预检通过（${elapsed()}）`)
