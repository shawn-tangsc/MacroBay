/**
 * 「本次要提交的文件，同时还有未暂存改动」——钩子的第二条警示（不拦截）。
 *
 * 为什么值得专门报一句：`git commit -- <路径>` 提交的是**工作区里那份文件的当前内容**，不读暂存区。
 * 所以只要文件里还留着别人的在途 hunk，按路径提交就会把它们一起带进 HEAD——2026-11-10 真发生过一次：
 * 有人按路径提交，带走了同一文件里另一条线没写完的改动。
 *
 * 判据只有一条：`git diff --name-only`（暂存区 ↔ 工作区）与本次提交的文件取交集。
 * **只警告、不拦截**：分次 `git add -p` 是正常手法，把正常提交堵死比这个风险更糟。
 */
import { execFileSync } from 'node:child_process'

export type UnstagedDriftInput = {
  /** 仓库根。 */
  cwd: string
  /** 本次提交的文件（相对仓库根）。 */
  staged: readonly string[]
  /** 按需要注入 git 环境（钩子里是 git 交给它的那份临时索引）。 */
  env?: NodeJS.ProcessEnv
}

/** 既是本次提交、又还有未暂存改动的文件（保持 `staged` 的顺序）。 */
export function filesWithUnstagedChanges({ cwd, staged, env }: UnstagedDriftInput): string[] {
  if (staged.length === 0) return []
  let output: string
  try {
    output = execFileSync('git', ['diff', '--name-only', '--no-ext-diff', '--', ...staged], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      ...(env === undefined ? {} : { env })
    })
  } catch {
    // 读不出来时不硬报：这条只是警示，不能因为它自己失败而挡住提交。
    return []
  }
  const drifted = new Set(
    output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
  )
  return staged.filter((path) => drifted.has(path))
}
