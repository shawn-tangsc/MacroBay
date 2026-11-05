/**
 * 提交前预检：**只拦自己这一笔**（Chief 2026-11-03 批，六条约束见 AGENTS.md「提交前的预检钩子」）。
 *
 * 为什么不是普通钩子：这个仓库是**多人共用同一个工作区**。把全仓 `tsc` 直接做成「红就拦」，
 * 别人的在途文件会把所有人的提交卡死——那两条 `Element.click` 里就有一半是别人手上没写完的。
 *
 * 但「只查工作区里的本笔文件」又漏了另一半（2026-11-05 补）：`git commit -- <路径>` 提交的是一棵
 * **与当时工作区不同的树**，编译器读工作区会看到还没进库的新模块，于是「调用方进这一笔、被调模块
 * 留在工作区」这种半条链全绿进库。现在改成：**把这一笔的树落出来（`git checkout-index`）再查**，
 * 报错一律拦——树里只有会进库的文件，不存在「别人的在途文件」这一说。
 *
 * 它补的是「单跑定向用例抓不到」的那一半（类型错、按目录扫的守卫）；**不替代** `pnpm typecheck`，
 * 也不替代 Chief 跑的全量。成本实测：5 个真实文件 6.3s（原来全仓 tsc 是 42–60s）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

// ── 2. 查「将要提交的那棵树」，不查工作区 ────────────────────────────────────────────────
//
// `git commit -- <路径>` 提交的是一棵**和当时工作区不同的树**：临时索引里只有具名路径。原来的做法是在
// 工作区里跑 tsc，于是「调用方进了这一笔、被调模块还留在工作区」这种半条链会全绿进库——编译器读到的是
// 工作区那份新模块，而进库的是旧版本（或者根本没有）。2026-11-05 就出过：抽离时把别人的半成品带上，
// 还丢了筛选条件。
//
// 改法：用 `git checkout-index -a --prefix=<tmp>/` 把**这一笔的完整树**落出来（临时索引由 git 通过
// `GIT_INDEX_FILE` 交给钩子，这里直接继承），对它跑 tsc。`tsconfig.json` 里的 `baseUrl` 与 `paths`
// 是相对声明它的配置解析的，所以把 tsc 指到树里的那份配置，`@platform/*` 等别名也一律落在树内，
// 不会漏回工作区。node_modules 软链过去：依赖不在提交范围内，但类型定义要从那儿拿。
const treeRoot = join(root, 'node_modules', '.cache', 'pre-commit-tree')
rmSync(treeRoot, { recursive: true, force: true })
mkdirSync(treeRoot, { recursive: true })
execFileSync('git', ['checkout-index', '-a', `--prefix=${treeRoot}/`], { cwd: root })
for (const modules of ['node_modules', join('apps', 'desktop-shell', 'node_modules')]) {
  const real = join(root, modules)
  if (!existsSync(real)) continue
  mkdirSync(dirname(join(treeRoot, modules)), { recursive: true })
  symlinkSync(real, join(treeRoot, modules), 'dir')
}
const treeConfig = join(treeRoot, 'tsconfig.pre-commit.json')
writeFileSync(
  treeConfig,
  JSON.stringify({ extends: './tsconfig.json', include: [], files: codeStaged.map((path) => `./${path}`) })
)
const timedOut = (result: ReturnType<typeof spawnSync>): boolean =>
  result.error !== undefined && result.error !== null && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'

// 树里只有这一笔会进库的文件，所以**任何**报错都是这棵快照的问题，不必再区分「自己的 / 别人的」。
const check = spawnSync(join(root, 'node_modules', '.bin', 'tsc'), ['--noEmit', '-p', treeConfig], {
  cwd: treeRoot,
  encoding: 'utf8',
  timeout: remaining(10_000)
})

if (timedOut(check)) {
  say(`预检超时（提交树的 typecheck 超过 ${Math.round(BUDGET_MS / 1000)}s），**未拦截**，请手动跑 pnpm typecheck。`)
  process.exit(0)
}

const tscOutput = `${check.stdout ?? ''}${check.stderr ?? ''}`
const errors = tscOutput
  .split('\n')
  .filter((line) => line.includes('error TS'))
  .map((line) => line.trim())

if (errors.length > 0) {
  console.error(`[pre-commit] ✗ 这一笔提交的树里有 ${errors.length} 条类型错（含它依赖的、已进库的那一版）：`)
  for (const line of errors.slice(0, 20)) console.error(`  ${line.replace(treeRoot + '/', '')}`)
  console.error('[pre-commit] 常见原因：改 import/export 的那一笔只带了调用方，被调模块还在工作区。两侧同笔带上。')
  console.error('[pre-commit] 紧急回滚可跳过：SKIP_PRE_COMMIT=1 git commit …（跳过后要补跑 pnpm typecheck）')
  process.exit(1)
}

say(`✓ 预检通过（${elapsed()}）`)
