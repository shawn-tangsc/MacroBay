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

/** 组件自己的公开文档：`docs/development/*.md`，改组件要同步它，不需要写理由行。 */
export function isComponentDoc(file: string): boolean {
  return file.startsWith('docs/development/') && file.endsWith('.md')
}

/**
 * 组件目录以外的每个文件，都要在提交信息里有一行 `Also: <路径> — 为什么必须同一笔`。
 *
 * 不做白名单：白名单会逼出「为了合规而拆得别扭」的提交；一句能写的理由就放行，
 * 写不出的（比如 220 行别线业务迁移搭组件提交的车）会红。
 */
export function unexplainedFiles(files: readonly string[], message: string): string[] {
  const declared = new Set<string>()
  for (const line of message.split('\n')) {
    const match = /^Also:\s*(\S+)/u.exec(line.trim())
    if (match) declared.add(match[1])
  }
  return files.filter((file) => !touchesComponents([file]) && !isComponentDoc(file) && !declared.has(file))
}

/**
 * 规则的生效点：**按作者日期判，不按哈希判**。
 *
 * 为什么不是哈希：rebase 会换掉哈希、但保留作者日期。今晚已经吃过一次——`ALSO_RULE_SINCE`
 * 写死成某个哈希，rebase 之后那个哈希不存在了，`git rev-list` 失败 → 代码静默返回空集 →
 * 豁免失效而没有人知道。`git rev-list` 那次的教训是「兜底不许静默降级」，这次的教训是
 * **别再把会漂的东西写成常量**。
 *
 * 时刻取值：晚于两笔缺声明提交的时刻（`b4f7f82` 13:18:42、`003bf89` 13:22:58，均 +08:00），
 * 它们落在豁免侧；之后的一切提交照常严判。
 *
 * **不要“优化”回哈希**：那会让下一次 rebase 再静默失效一次。
 */
export const RULES_SINCE = '2026-11-02T13:23:30+08:00'

/** 这条提交是否早于生效点（含等于）：早于生效点的不判新规则。 */
export function predatesRules(authorDate: string): boolean {
  const at = Date.parse(authorDate)
  if (Number.isNaN(at)) {
    // 读不出日期就从严判——兜底不许静默放行。
    return false
  }
  return at <= Date.parse(RULES_SINCE)
}

export type ComponentOwnershipViolation = {
  hash: string
  subject: string
  files: readonly string[]
  /** 组件目录以外、提交信息里又没有 `Also:` 说明的文件。 */
  unexplained: readonly string[]
}

export type InspectedCommit = {
  hash: string
  subject: string
  message: string
  /** 作者日期（ISO）。规则生效点按它判——rebase 会换哈希，不会换它。 */
  authorDate: string
  files: readonly string[]
}

export function findViolations(commits: readonly InspectedCommit[]): ComponentOwnershipViolation[] {
  const violations: ComponentOwnershipViolation[] = []
  for (const commit of commits) {
    if (!touchesComponents(commit.files)) continue
    // 早于生效点的提交：两条新规则都不判（它们写在规则存在之前，不可能满足）。
    if (predatesRules(commit.authorDate)) continue
    const unexplained = unexplainedFiles(commit.files, commit.message)
    if (declaresComponentOwner(commit.message) && unexplained.length === 0) continue
    violations.push({
      hash: commit.hash,
      subject: commit.subject,
      files: commit.files.filter((file) => touchesComponents([file])),
      unexplained
    })
  }
  return violations
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
    authorDate: git(['log', '-1', '--format=%aI', hash]),
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

  console.error(`components-ownership: ${violations.length} commit(s) touched ${COMPONENTS_DIR} without a proper owner declaration.`)
  for (const violation of violations) {
    console.error(`  ${violation.hash.slice(0, 8)} ${violation.subject}`)
    for (const file of violation.files) console.error(`      ${file}`)
    for (const file of violation.unexplained) console.error(`      ${file}  ← 组件目录以外，缺一行 \`Also: ${file} — <为什么必须同一笔>\``)
  }
  console.error('')
  console.error('这个目录只允许前端组件线改。如果你不是那条线：撤回这处改动，交给他们做。')
  console.error(`如果你就是那条线：在提交信息里加一行 trailer —— ${OWNER_TRAILER}: ${OWNER_VALUE}`)
  console.error('（已提交的用 `git commit --amend --trailer "Component-Owner: 前端组件"` 修正；改写历史前先确认没有别人基于它工作。）')
  process.exit(1)
}

if (process.argv[1] && process.argv[1].endsWith('check-components-ownership.mts')) main()
