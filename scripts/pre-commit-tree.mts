/**
 * 提交树落盘（`pre-commit.mts` 的第 2 步，抽出来是为了能测）。
 *
 * **要落的是「提交之后仓库长什么样」，不是「这一笔里有哪些文件」**。两者差一整棵 HEAD：
 * `git commit -- <路径>` 只给具名路径建临时索引，`git checkout-index -a` 落出来的树因此缺了其余文件。
 * 于是任何「A 依赖 B 的既有内容」都会被报成缺模块/缺字段的假红——2026-11-08 两条线各撞一次，
 * 每次的绕过方式都是 `SKIP_PRE_COMMIT=1`，而那条应急通道一旦变成常规，检查就等于不存在。
 *
 * 做法只用 git 命令（不依赖 tar：Windows 上的 bsdtar 版本不一致）：
 *   1. `git read-tree HEAD` 到一份**独立临时索引**；
 *   2. 把本笔的每个路径按它在提交索引里的 blob 覆盖进去（删除的路径 force-remove）；
 *   3. 用这份索引 `checkout-index -a` 落到目标目录。
 */
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

export type MaterializeCommitTreeInput = {
  /** 仓库根（`git rev-parse --show-toplevel`）。 */
  cwd: string
  /** 落盘目标目录，必须已存在。 */
  treeRoot: string
  /** 本笔提交的路径（新增/修改/重命名后的路径）。 */
  staged: readonly string[]
  /** 本笔提交删除的路径：提交之后不该存在于树里。 */
  deleted?: readonly string[]
  /**
   * 提交索引所在的环境。钩子里 git 会通过 `GIT_INDEX_FILE` 把**临时索引**交进来，
   * 这里必须继承它才能读到「这一笔会进库的 blob」；缺省用 cwd 的索引。
   */
  sourceEnv?: NodeJS.ProcessEnv
}

function runGit(args: readonly string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): string {
  return execFileSync('git', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    ...(options.env === undefined ? {} : { env: options.env })
  })
}

/** 本笔提交里被删除的路径。 */
export function readDeletedPaths(cwd: string, env?: NodeJS.ProcessEnv): string[] {
  return runGit(['diff', '--cached', '--name-only', '--diff-filter=D'], {
    cwd,
    ...(env === undefined ? {} : { env })
  })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

type IndexEntry = { mode: string; sha: string; path: string }

/** 提交索引里这一笔的条目：`100644 <sha> 0\t<path>`。 */
function stagedEntries(cwd: string, staged: readonly string[], env?: NodeJS.ProcessEnv): IndexEntry[] {
  if (staged.length === 0) return []
  return runGit(['ls-files', '-s', '--', ...staged], { cwd, ...(env === undefined ? {} : { env }) })
    .split('\n')
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = /^(\d{6}) ([0-9a-f]+) \d\t(.+)$/u.exec(line)
      const mode = match?.[1]
      const sha = match?.[2]
      const path = match?.[3]
      return mode === undefined || sha === undefined || path === undefined ? [] : [{ mode, sha, path }]
    })
}

/**
 * 落出「HEAD + 本笔改动」的完整树。
 *
 * 抛错即代表树不完整：调用方必须报「这一次没有检查」，不能继续跑 tsc——残缺树上的类型错全是假的。
 */
export function materializeCommitTree(input: MaterializeCommitTreeInput): void {
  const { cwd, treeRoot, staged } = input
  const deleted = input.deleted ?? []
  const entries = stagedEntries(cwd, staged, input.sourceEnv)

  // 独立索引：绝不碰提交索引，也不碰工作区的真实索引。
  const scratchIndex = join(treeRoot, '.pre-commit-index')
  const scratchEnv = { ...process.env, GIT_INDEX_FILE: scratchIndex }
  rmSync(scratchIndex, { force: true })
  runGit(['read-tree', 'HEAD'], { cwd, env: scratchEnv })

  const updateArgs = ['update-index']
  for (const entry of entries) updateArgs.push('--add', '--cacheinfo', entry.mode, entry.sha, entry.path)
  if (entries.length > 0) runGit(updateArgs, { cwd, env: scratchEnv })

  for (const path of deleted) {
    runGit(['update-index', '--force-remove', '--', path], { cwd, env: scratchEnv })
  }

  runGit(['checkout-index', '-a', `--prefix=${treeRoot}/`], { cwd, env: scratchEnv })
  rmSync(scratchIndex, { force: true })
}
