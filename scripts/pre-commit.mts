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
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  // 纯文档/配置的提交没有类型可查，但**文档有自己的门禁**：这句话必须在跳过的同一行说出来，
  // 否则「要不要自己跑 docs:check」就只靠记性——2026-11-06 刚把它定成规矩，规矩不该依赖记忆。
  say(
    staged.length === 0
      ? '没有暂存内容，跳过预检。'
      : `本次没有代码文件，跳过预检——文档改动请自己跑 pnpm docs:check（它检查 docs/ 与 docs-private/）。`
  )
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
/**
 * 临时树放在**系统临时目录**、每次一个新目录。两条理由都不是洁癖：
 *  - 原来的固定路径 `node_modules/.cache/pre-commit-tree` 在**共用 checkout** 里，两个会话同时提交会互相
 *    删对方的树（`rmSync` 在前面），症状是偶发的「文件不存在」；
 *  - `tsx` 在树内跑生成器时，路径别名解析在「树嵌在仓库自己的 node_modules 底下」这个位置会失灵
 *    （`@platform/*` 找不到，而在 /tmp 下同一棵树正常），2026-11-06 实测复现。
 */
const treeRoot = mkdtempSync(join(tmpdir(), 'macrobay-precommit-'))
execFileSync('git', ['checkout-index', '-a', `--prefix=${treeRoot}/`], { cwd: root })
/** 临时树用完就删（报错信息里已经把路径剥成仓库相对形式，作者不需要它留在磁盘上）。 */
const dropTree = (): void => { rmSync(treeRoot, { recursive: true, force: true }) }
for (const modules of ['node_modules', join('apps', 'desktop-shell', 'node_modules')]) {
  const real = join(root, modules)
  if (!existsSync(real)) continue
  mkdirSync(dirname(join(treeRoot, modules)), { recursive: true })
  symlinkSync(real, join(treeRoot, modules), 'dir')
}

/** `spawnSync` 的超时判定：`error.code === 'ETIMEDOUT'`（超时不是「跑完但红」）。 */
const timedOut = (result: ReturnType<typeof spawnSync>): boolean =>
  result.error !== undefined && result.error !== null && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'

/**
 * 生成物必须在**这棵树里**先生成一遍，再查类型。
 *
 * `products/generated/*` 是构建期生成的、不入库（`.gitignore`），所以 `git checkout-index` 落出来的树里
 * 天然没有它们。而外壳有十几个文件 static import `@products/generated/shellRegistry`，于是**任何碰到这些
 * 文件的提交都会吃一片 `TS2307: Cannot find module` 假红** —— 只能靠 `SKIP_PRE_COMMIT=1` 绕过去。
 * 2026-11-06 一天之内绕了三次：一条检查一旦大家都习惯绕过，它等于不存在。
 *
 * 两条边界，写清楚是为了下次别再想歪：
 *  - 生成器跑在**树内**（cwd = treeRoot，脚本自己也从 `import.meta.url` 推出 workspaceRoot = 树根），
 *    所以产物落在树里，不会污染工作区，也不会把工作区那份旧产物拿来充数；
 *  - 生成失败/超时**不静默放行**：报明「这次没检查」并让作者自己跑 `pnpm typecheck`，
 *    与下面的 tsc 超时同一姿态。绝不改成「忽略生成物相关文件」——那是把检查改宽，比假红更糟。
 */
const generateStart = performance.now()
const generation = spawnSync(join(root, 'node_modules', '.bin', 'tsx'), ['scripts/generate-product-registry.mts'], {
  cwd: treeRoot,
  encoding: 'utf8',
  timeout: remaining(15_000)
})
if (timedOut(generation) || generation.status !== 0) {
  // 生成不出来 ⇒ 这棵树缺了「入库文件之外的一半」，此时 tsc 的报错全是假的，跑了也只会骗人。
  say(`生成物没能在提交树里生成（${Math.round(performance.now() - generateStart)}ms），**这一次没有检查**；请自己跑 pnpm typecheck。`)
  const detail = `${generation.stdout ?? ''}${generation.stderr ?? ''}`.trim()
  if (detail !== '') console.error(detail.split('\n').slice(-5).join('\n'))
  dropTree()
  process.exit(0)
}
if (!existsSync(join(treeRoot, 'products', 'generated', 'shellRegistry.ts'))) {
  say('生成器跑完了但树里仍没有 products/generated/shellRegistry.ts，**这一次没有检查**；请自己跑 pnpm typecheck。')
  dropTree()
  process.exit(0)
}
/**
 * 环境声明（`*.d.ts`）必须一起进这棵树。
 *
 * 它们不是被 import 的，是靠「在 include 覆盖的目录里」才生效的全局声明；`files: [本次几个文件]`
 * 只要没把它们列成根，就会凭空长出 `Property 'platform' does not exist on type 'Window'` 这类假红——
 * 2026-11-05 真实发生过：产品线的一笔提交被这种假红拦下，只能用 `SKIP_PRE_COMMIT=1` 绕过，而那条
 * 应急通道一旦变成常规，检查就形同虚设。全仓只有个位数的 `.d.ts`，列成根几乎不花时间。
 * （`tsconfig.products.json` 撞的是同一个根因，那处也是漏了同一个文件。）
 */
const ambientDeclarations = execFileSync('git', ['ls-files', '*.d.ts'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((path) => path !== '' && !path.includes('node_modules') && existsSync(join(treeRoot, path)))

const treeConfig = join(treeRoot, 'tsconfig.pre-commit.json')
writeFileSync(
  treeConfig,
  JSON.stringify({
    extends: './tsconfig.json',
    include: [],
    files: [...codeStaged, ...ambientDeclarations].map((path) => `./${path}`)
  })
)

// 树里只有这一笔会进库的文件，所以**任何**报错都是这棵快照的问题，不必再区分「自己的 / 别人的」。
const check = spawnSync(join(root, 'node_modules', '.bin', 'tsc'), ['--noEmit', '-p', treeConfig], {
  cwd: treeRoot,
  encoding: 'utf8',
  timeout: remaining(10_000)
})

if (timedOut(check)) {
  say(`预检超时（提交树的 typecheck 超过 ${Math.round(BUDGET_MS / 1000)}s），**未拦截**，请手动跑 pnpm typecheck。`)
  dropTree()
  process.exit(0)
}

const tscOutput = `${check.stdout ?? ''}${check.stderr ?? ''}`
const allErrors = tscOutput
  .split('\n')
  .filter((line) => line.includes('error TS'))
  .map((line) => line.trim())

/**
 * tsc 是从临时树里报错的：路径有时是 `../../var/folders/…/macrobay-precommit-xxx/…`，有时是绝对路径。
 * 剥成仓库相对形式，既能给读者看，也是「这条错落在谁的文件上」的判据。
 */
const repoPathOf = (line: string): string | undefined =>
  /^(.+?)\(\d+,\d+\): error TS\d+/u
    .exec(line)?.[1]
    ?.replace(/^(?:\.\.\/)+/, '')
    .replace(treeRoot + '/', '')
    .replace(/^var\/folders\/.*?\/macrobay-precommit-[^/]+\//, '')
    .replace(/^private\/var\/folders\/.*?\/macrobay-precommit-[^/]+\//, '')
    .replace(/^\.\//, '')

/**
 * **只有落在本笔文件上的错才拦**（用户 2026-11-07 拍板）。
 *
 * 钩子查的是「这一笔的树」，但作用域工程（按文件列出的临时 tsconfig）复现不出**整棵项目**才有的
 * 环境类型：本地那份 `import.meta.glob` 声明比真实用法窄，于是会报「'query' 不存在」这类项目里
 * 并不存在的错。按目录铺 `include` 又会把整目录的兄弟文件拉进来 —— 那正是 `products/**` 的 708 条
 * 既有债，等于让每次提交替别人的历史错背锅。
 *
 * 所以判据落在归属上：报错在**本笔文件**里 → 拦（改 import/export 只带调用方的半条链就报在调用方上，
 * 照旧红）；报错在别的文件里 → 只报数量、不拦。残留风险：把本笔之外的文件改坏不会被这道门拦住，
 * 用户已知并接受（`products/**` 全量本来也看不到）。
 */
const located = allErrors.map((line) => ({ line, file: repoPathOf(line) }))
const ownErrors = located.filter((entry) => entry.file !== undefined && codeStaged.includes(entry.file))
const foreignErrors = located.filter((entry) => !ownErrors.includes(entry))

if (foreignErrors.length > 0) {
  say(`另有 ${foreignErrors.length} 条类型错在**本笔没动的文件**里（含作用域工程复现不出的环境类型差异），本次不拦截。`)
}

if (ownErrors.length > 0) {
  console.error(`[pre-commit] ✗ 这一笔提交的树里，有 ${ownErrors.length} 条类型错落在本次提交的文件上：`)
  for (const entry of ownErrors.slice(0, 20)) console.error(`  ${entry.file ?? entry.line}`)
  console.error('[pre-commit] 常见原因：改 import/export 的那一笔只带了调用方，被调模块还在工作区。两侧同笔带上。')
  console.error('[pre-commit] 紧急回滚可跳过：SKIP_PRE_COMMIT=1 git commit …（跳过后要补跑 pnpm typecheck）')
  dropTree()
  process.exit(1)
}

dropTree()
say(`✓ 预检通过（${elapsed()}）`)
