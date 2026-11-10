/**
 * 反向依赖：谁在引用这一笔提交的文件（`pre-commit.mts` 的第 2 步之后的「补一刀」，抽出来是为了能测）。
 *
 * 为什么需要：`tsconfig.pre-commit.json` 的 `files` 只放本次提交的文件，tsc 从这些根**沿 import 方向**
 * 展开。坏掉的文件如果是**调用方**（反向依赖），它根本不在程序里——2026-11-10 的 B4 事故就是这样：
 * `ProviderDetail` 的 props 加了必填 `health`，设置页改了、看板抽屉（`DashboardPanelDrawer.tsx`）没改，
 * `TS2741` 进了链，用户点开抽屉整块详情读不出来。钩子当时 9.7 秒、预算 58 秒，不是超时，是**范围比名字小**。
 *
 * 做法（只用 git grep，够快、也不引新依赖）：
 *  1. 每个提交文件取「不带扩展名的名字」，按 import 里会出现的形式匹配：
 *     `'/ProviderDetail'`、`'/ProviderDetail.tsx'`（相对路径与 `@platform/…` 这类别名都以 `/` 收尾）；
 *  2. 命中的文件就是引用者；**不在本次提交里**的才算调用方（提交里的本来就是根）；
 *  3. 只看一层：调用方自己的调用方不再展开——一层就够把 props 改动的第一个受害者拉进来。
 *
 * 已知边界，写在这里免得下一个人以为漏了：
 * - `index.ts(x)` 不参与匹配：`./dir` 这种目录 import 无法从文件名反推，而 index 通常只做 re-export；
 * - `export * from` 的中间层不算「谁在用」：它自己会作为调用方被拉进来，但它的使用者不会——一层口径。
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

export type CallerSearchInput = {
  /** 仓库根。 */
  cwd: string
  /** 本次提交的代码文件（相对仓库根）。 */
  staged: readonly string[]
  /** 最多纳入多少个调用方；超出的部分不纳入，由调用方报告。默认 60。 */
  limit?: number
}

export type CallerSearchResult = {
  /** 程序之外、引用了本次提交文件的文件（已排序）。 */
  callers: readonly string[]
  /** 因为超过 `limit` 没有纳入的数量。 */
  skipped: number
}

/** 代码文件：只有它们会进 `files`，也只有它们需要反向依赖。 */
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/u
/** `index` 是目录入口的约定名，用它反查调用方会把整仓都算进来。 */
const NOT_A_STEM = new Set(['index', 'index.d'])

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function stemOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!CODE_FILE.test(name)) return null
  if (name.endsWith('.d.ts')) return null
  const stem = name.replace(CODE_FILE, '')
  return NOT_A_STEM.has(stem) ? null : stem
}

/**
 * 引用了 `stems` 里任一名字的文件。一次 `git grep` 查完所有名字：单独查每个文件会把次数乘上提交文件数。
 * 匹配的是「`/名字` 后跟引号或可选扩展名」——import 说明符永远带 `/`（相对路径或别名），裸名字没有。
 */
/** 带 `-n` 的 `git grep` 输出：`<path>:<line>:<text>`。文本里可能还有冒号，只切前两段。 */
const GREP_LINE = /^(.+?):(\d+):(.*)$/u

/**
 * 一行是不是**真的在引用**（import / export … from / require / 动态 import）。
 *
 * 为什么要这一步：注释里也会出现 `scripts/pre-commit.mts` 这样的路径。2026-11-10 实测就撞过一次——
 * `mergeShellNavigation.test.ts` 的注释提到钩子脚本，被当成调用方拖进程序，白跑了一整片该测试的
 * import 图。注释不 import 任何东西，不能算调用方。
 */
function looksLikeImport(line: string): boolean {
  const text = line.trim()
  if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return false
  return /\bfrom\s*['"]/u.test(text) || /\bimport\s*\(/u.test(text) || /\brequire\s*\(/u.test(text)
}

/**
 * 引用了 `stems` 里任一名字的文件。一次 `git grep` 查完所有名字：单独查每个文件会把次数乘上提交文件数。
 * 匹配的是「`/名字` 后跟引号或可选扩展名」——import 说明符永远带 `/`（相对路径或别名），裸名字没有。
 */
function filesImporting(cwd: string, stems: readonly string[]): string[] {
  if (stems.length === 0) return []
  const names = stems.map(escapeForRegex).join('|')
  // POSIX ERE（`git grep -E`）没有非捕获组：只能用普通括号。
  const pattern = `/(${names})(\\.(ts|tsx|mts|cts|js|jsx|mjs|cjs))?["'\`]`
  let output: string
  try {
    output = execFileSync('git', ['grep', '-n', '-E', '--', pattern, '--', '*.ts', '*.tsx', '*.mts', '*.cts'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024
    })
  } catch {
    // `git grep` 没有命中时退出码是 1；不是错误。
    return []
  }
  const importing = new Set<string>()
  for (const line of output.split('\n')) {
    const match = GREP_LINE.exec(line)
    if (match === null) continue
    const [, path, , text] = match
    if (looksLikeImport(text)) importing.add(path)
  }
  return [...importing]
}

export function findCallers({ cwd, staged, limit = 60 }: CallerSearchInput): CallerSearchResult {
  const stagedCode = staged.filter((path) => CODE_FILE.test(path))
  const stems = [...new Set(stagedCode.map(stemOf).filter((stem): stem is string => stem !== null))]
  const stagedSet = new Set(staged)
  const found = [...new Set(filesImporting(cwd, stems))]
    .filter((path) => !stagedSet.has(path))
    .filter((path) => existsSync(`${cwd}/${path}`))
    .sort()
  const callers = found.slice(0, limit)
  return { callers, skipped: found.length - callers.length }
}

/**
 * 喂给 `tsconfig.pre-commit.json` 的 `files`：本笔的文件 + 反查到的调用方 + 环境声明。
 *
 * 抽出来是为了能被用例直接断言「调用方真的进了程序」——这一环漏掉，前面找得再准也白搭。
 */
export function programFiles(input: {
  staged: readonly string[]
  callers: readonly string[]
  ambient: readonly string[]
}): string[] {
  return [...input.staged, ...input.callers, ...input.ambient].map((path) => `./${path}`)
}
