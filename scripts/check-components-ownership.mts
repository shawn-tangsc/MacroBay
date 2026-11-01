import { execFileSync } from 'node:child_process'

/**
 * 通用组件目录的所有权守卫。
 *
 * 用户 2026-11-01 定的硬规矩：`platform/ui/components/**` 只允许「前端组件」这一条线改，
 * 别的线一律不许私自改。规矩靠人记一定会漏（当晚漏了两次），所以这里做成机械检查。
 *
 * 为什么不用提交人（author / committer）判：本仓所有线共用同一个 git 身份
 * （`Shawn_tang <24619820+shawn-tangsc@…>`，40/40 都是它），按作者判等于永远通过。
 * 所以判据落在**提交声明的 trailer** 上：动了这个目录的提交必须带
 * `Component-Owner: 前端组件`。
 *
 * 这条门能拦的是「悄悄改」；它拦不住「撒谎改」——trailer 谁都能写。撒谎那一半靠审核清单里的
 * 路径触发规则（命中 `platform/ui/components/**` 的提交一律由前端组件线复审），两条缺一不可。
 */

export const COMPONENTS_DIR = 'platform/ui/components'
export const OWNER_TRAILER = 'Component-Owner'
export const OWNER_VALUE = '前端组件'

/** 是否命中受保护目录。`platform/ui/components-old/` 这种前缀相同但不同的目录不算。 */
export function touchesComponents(files: readonly string[]): boolean {
  return files.some((file) => file === COMPONENTS_DIR || file.startsWith(`${COMPONENTS_DIR}/`))
}

/** 提交信息里是否声明了组件线所有权。 */
export function declaresComponentOwner(message: string): boolean {
  for (const line of message.split('\n')) {
    const match = /^Component-Owner:\s*(.+)$/u.exec(line.trim())
    if (match && match[1].trim() === OWNER_VALUE) return true
  }
  return false
}

export type ComponentOwnershipViolation = {
  hash: string
  subject: string
  files: readonly string[]
}

export type InspectedCommit = {
  hash: string
  subject: string
  message: string
  files: readonly string[]
}

export function findViolations(commits: readonly InspectedCommit[]): ComponentOwnershipViolation[] {
  return commits
    .filter((commit) => touchesComponents(commit.files) && !declaresComponentOwner(commit.message))
    .map((commit) => ({
      hash: commit.hash,
      subject: commit.subject,
      files: commit.files.filter((file) => touchesComponents([file]))
    }))
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

/** 引入这条规矩的那次提交：它之后的提交才受检，之前的自动豁免，不用维护一份历史 sha 清单。 */
function cutoverCommit(): string | null {
  try {
    return git(['log', '--diff-filter=A', '--format=%H', '--', 'scripts/check-components-ownership.mts']) || null
  } catch {
    return null
  }
}

function readCommits(range: string): InspectedCommit[] {
  const hashes = git(['rev-list', '--no-merges', range]).split('\n').filter(Boolean)
  return hashes.reverse().map((hash) => ({
    hash,
    subject: git(['log', '-1', '--format=%s', hash]),
    message: git(['log', '-1', '--format=%B', hash]),
    files: git(['show', '--name-only', '--format=', hash]).split('\n').filter(Boolean)
  }))
}

function main(): void {
  const baseArg = process.argv.indexOf('--base')
  const explicitBase = baseArg > -1 ? process.argv[baseArg + 1]?.trim() : undefined
  const base = explicitBase || process.env.COMPONENTS_OWNERSHIP_BASE?.trim() || cutoverCommit()

  if (!base) {
    console.log('components-ownership: no base commit yet; nothing to check.')
    return
  }

  let commits: InspectedCommit[]
  try {
    commits = readCommits(`${base}..HEAD`)
  } catch {
    console.log(`components-ownership: cannot read range ${base}..HEAD; skipping.`)
    return
  }

  const violations = findViolations(commits)
  if (violations.length === 0) {
    console.log(`components-ownership: ${commits.length} commit(s) checked, none touched ${COMPONENTS_DIR} without a ${OWNER_TRAILER} trailer.`)
    return
  }

  console.error(`components-ownership: ${violations.length} commit(s) touched ${COMPONENTS_DIR} without "${OWNER_TRAILER}: ${OWNER_VALUE}".`)
  for (const violation of violations) {
    console.error(`  ${violation.hash.slice(0, 8)} ${violation.subject}`)
    for (const file of violation.files) console.error(`      ${file}`)
  }
  console.error('')
  console.error('这个目录只允许前端组件线改。如果你不是那条线：撤回这处改动，交给他们做。')
  console.error(`如果你就是那条线：在提交信息里加一行 trailer —— ${OWNER_TRAILER}: ${OWNER_VALUE}`)
  console.error('（已提交的用 `git commit --amend --trailer "Component-Owner: 前端组件"` 修正；改写历史前先确认没有别人基于它工作。）')
  process.exit(1)
}

if (process.argv[1] && process.argv[1].endsWith('check-components-ownership.mts')) main()
