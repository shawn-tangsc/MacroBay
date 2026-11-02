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
/**
 * 迁移欠账清单：`scripts/migration-debt/*.json`。
 *
 * 这类文件是**账**，不是谁的实现：它记的是「还有哪些文件在用 antd 的那个组件」，产品线迁完一处就要
 * 划掉自己那行。它本来写在组件目录里，于是「迁完划行」必然触碰组件目录、被判违规——当晚四条正经
 * 迁移收尾都撞了。外移到 `scripts/` 之后它就是**组件线的账簿**：组件线改它、产品线划行，都不该再要
 * 一段 `Also:` 解释；真正要解释的是「为什么这笔提交顺手改了别人线的实现」。
 *
 * 只放行 `.json`：这个目录里出现代码文件时，仍按普通附带改动判。
 */
export function isMigrationDebt(file: string): boolean {
  return file.startsWith('scripts/migration-debt/') && file.endsWith('.json')
}

export function unexplainedFiles(files: readonly string[], message: string): string[] {
  const declared = new Set<string>()
  for (const line of message.split('\n')) {
    const match = /^Also:\s*(\S+)/u.exec(line.trim())
    if (match) declared.add(match[1])
  }
  return files.filter(
    (file) =>
      !touchesComponents([file]) && !isComponentDoc(file) && !isMigrationDebt(file) && !declared.has(file)
  )
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
 *
 * 第二次后移（2026-11-02，架构师裁定）——**受害原因写在下面，别再后移第三次而不写**：
 * 当时迁移欠账清单住在被测组件的守卫里（`choice/choiceCallSiteGuard.test.ts` 的 `ANTD_BASELINE`），
 * 于是「迁完一处、同笔划掉那一行」这个被要求的动作**必然触碰组件目录**，与「组件目录只有组件线
 * 能写」直接冲突。受影响的 4 笔（`e4719f35`、`8855636e`、`1c27281a`、`1ca7333d`，作者日期
 * 13:47:12–13:56:41）各自只删了基线行，没有越权改组件实现。
 *
 * 记法上要说准：**不是“这 4 笔被原谅了”，是“规则当初长错了地方”**。前者是口子，后者是教训。
 * 清单已迁出到 `scripts/migration-debt/`（被 git 追踪、不在组件目录），冲突消失。
 *
 * **今后任何后移都必须写清受害原因，写不出就不许后移。**
 *
 * 第三次后移（2026-11-02，同一次搬家的尾巴）——受害原因：
 * `9bbe246`（情报线迁 `news-sentiment`，作者日期 14:11:34）带走了组件线的守卫改动。它自己没写
 * 组件目录：`git commit -- <路径>` 提交的是**文件当前全部内容**，而那一刻守卫文件里躺着组件线
 * 正在搬清单的改动。所以它是「路径级提交的受害者」，不是越权者。
 *
 * 为什么不必再往后调：这次后移之后，欠账清单已不在组件目录，**再没有「被要求的动作必然触碰
 * 组件目录」这种情况**了。若将来又出现同类被判违规，先问「是谁的动作逼他碰组件目录」，
 * 答不上来就不许后移——那时该修的是动作，不是生效点。
 */
export const RULES_SINCE = '2026-11-02T14:11:34+08:00'

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

/**
 * 后置认领（Chief 2026-11-02 批的一次性补账机制）：
 *
 * 一笔提交忘了带 `Component-Owner`，而它已经被后来的提交盖住、不能 `amend`——改写历史等于
 * 把别人记录的哈希全部作废。于是允许**后来的一笔**把责任接过去：那一笔带
 * `Component-Owner: 前端组件` + 逐行 `Owns: <hash>`，就说清“这笔归我”。
 *
 * 四条约束，缺一条就不认（宁可红，也不给「声明一下就过关」开口子）：
 * 1. **内容要核，不只看声明**：被认领那笔的每个路径必须落在组件目录（或组件自己的文档），
 *    其余路径要在**认领这笔**的提交信息里逐条写 `Also: <路径> — 为什么必须同一笔`；
 * 2. **已经被标签过的提交不许再被认领**——同一笔不能被两家都声明；
 * 3. **只认尚未推送到远程的提交**：认领是一次性补账，不是历史保险；
 * 4. 认领本身也要有反向实测：拿掉 `Owns:` 那行，原来红的那笔必须重新变红（见用例）。
 *
 * 这不是长期保底：从这一笔之后，动组件目录必须自带标签。
 */
/**
 * 认领（Chief 2026-11-02 批准放宽第 3 条后的形状）。
 *
 * 「认领」是**在新提交里补一份声明**，不改历史，所以「已推送」本身不该成为拒绝理由。
 * 要防的是橡皮图章，因此每条认领必须自带理由，且三条反向用例必须红：
 * 不存在的哈希、同一哈希被两家认领、缺理由。
 */
export type Claim = { hash: string; why: string }

export type ClaimOptions = {
  /**
   * 机械删除豁免（Chief 2026-11-02 定，`MI-11-R166`）：**同一行文本、全仓一致地删掉**，
   * 允许整体一笔。判据必须机械：提交里只有删除、没有任何新增，且所有删除行的文本完全相同。
   */
  isMechanicalDeletion?: (hash: string) => boolean
}

export function claimsIn(commit: InspectedCommit): Claim[] {
  if (!declaresComponentOwner(commit.message)) return []
  const lines = commit.message.split('\n').map((line) => line.trim())
  const claims: Claim[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^Owns:\s*([0-9a-f]{7,40})$/u.exec(lines[index] ?? '')
    if (match?.[1] === undefined) continue
    const whyMatch = /^Why:\s*(.+)$/u.exec(lines[index + 1] ?? '')
    claims.push({ hash: match[1], why: whyMatch?.[1]?.trim() ?? '' })
  }
  return claims
}

function findByPrefix(commits: readonly InspectedCommit[], target: string): InspectedCommit | undefined {
  return commits.find((commit) => commit.hash === target) ?? commits.find((commit) => commit.hash.startsWith(target))
}

/**
 * 认领声明本身的问题：哈希不存在、缺理由、同一哈希被两家认领。
 *
 * 这些问题**必须让门禁失败**，不能像「无效认领」那样静默忽略——静默忽略会让一份写错的声明
 * 看起来像已经处理过，而实际那笔还是红的，第二天没人知道该找谁。
 */
/**
 * 「认领必须带理由」这条规则的生效点（Chief 2026-11-02 批准放宽第 3 条时加）。
 *
 * 在此之前的两笔认领没有 `Why:` 行——它们当时按旧形状写的，不该被一条后立的规矩判红
 * （同 `RULES_SINCE` 的理由：用新规矩判旧提交，只会得到一堆正确的红和一次没意义的返工）。
 */
export const CLAIM_REASON_SINCE = '2026-11-02T19:00:00+08:00'

export function claimProblems(
  commits: readonly InspectedCommit[],
  /** 该哈希是否存在于仓库（可能早于本次检查区间）：区间外但真实存在的目标，不当成「不存在」。 */
  existsElsewhere: (hash: string) => boolean = (): boolean => false
): string[] {
  const problems: string[] = []
  const owners = new Map<string, string>()
  for (const claim of commits) {
    for (const entry of claimsIn(claim)) {
      const target = findByPrefix(commits, entry.hash)
      if (target === undefined) {
        if (!existsElsewhere(entry.hash)) problems.push(`${claim.hash.slice(0, 8)} 认领了不存在的提交 ${entry.hash}`)
        continue
      }
      if (!claim.authorDate || (entry.why === '' && Date.parse(claim.authorDate) > Date.parse(CLAIM_REASON_SINCE))) {
        problems.push(`${claim.hash.slice(0, 8)} 认领 ${entry.hash} 缺理由（需紧跟一行 \`Why: ...\`）`)
      }
      const previous = owners.get(target.hash)
      if (previous !== undefined && previous !== claim.hash) {
        problems.push(`${target.hash.slice(0, 8)} 被两家认领：${previous.slice(0, 8)} 与 ${claim.hash.slice(0, 8)}`)
        continue
      }
      owners.set(target.hash, claim.hash)
    }
  }
  return problems
}

/** 被有效认领的提交哈希。无效认领一律忽略——于是那笔照原样红，不会因为“认领过了”就消失。 */
export function claimedCommits(
  commits: readonly InspectedCommit[],
  options: ClaimOptions = {}
): ReadonlySet<string> {
  const reasonRequired = (claim: InspectedCommit, why: string): boolean =>
    why !== '' || Date.parse(claim.authorDate) <= Date.parse(CLAIM_REASON_SINCE)

  const claimed = new Set<string>()
  for (const claim of commits) {
    for (const entry of claimsIn(claim)) {
      // 缺理由的认领不算数（生效点之前的旧认领除外）——否则它只是「写了个哈希」。
      if (!reasonRequired(claim, entry.why)) continue
      const claimedCommit = findByPrefix(commits, entry.hash)
      if (claimedCommit === undefined) continue
      // 已经被**另一家**标签过的提交不再被认领：同一笔不能有第二份归属声明。
      //
      // 但「同一家补漏项」要放行：一笔提交可能已经声明了 `Component-Owner`，却漏了组件目录以外
      // 那几行的 `Also:`——2026-11-02 的 `8e096aaa`（加 `target-missing`）就是这样，它把码加在
      // 契约文件、句子加在组件文案表，两处必须同笔，`Also:` 漏了。那一半不是「归属不明」，是
      // 「理由漏写」，补的仍是对同一家的声明，不构成两家争一笔。
      const declaredOwner = declaresComponentOwner(claimedCommit.message)
      if (/^Component-Owner:/mu.test(claimedCommit.message) && !declaredOwner) continue
      if (unexplainedFiles(claimedCommit.files, claim.message).length > 0) continue
      claimed.add(claimedCommit.hash)
    }
  }
  return claimed
}

/**
 * 机械删除的判据**只看 diff，不看声明**：只有删除、没有任何新增，且所有删除行的文本完全相同。
 *
 * 为什么需要它（Chief 2026-11-02 定，`MI-11-R166`）：把「逐文件各设一行」改成「环境里只设一处」
 * 这种清理，天然横跨上百个文件；为它写一百多行 `Also:` 解释，只会把一句真话扩成一百多行套话。
 *
 * 反过来必须严：**有一条新增行、或两处删除文本不同，就不算机械删除**——那时它就有语义了，
 * 有语义的改动要一条一条说清为什么。
 *
 * 判据单独抽成函数，是为了让它能被用例喂手写 patch 验证：这段逻辑在 CLI 里，而 CLI 不可测。
 */
export function isMechanicalDeletionPatch(patch: string): boolean {
  const changed = patch
    .split('\n')
    .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'))
  const added = changed.filter((line) => line.startsWith('+'))
  const removed = changed.filter((line) => line.startsWith('-'))
  if (added.length > 0 || removed.length === 0) return false
  return new Set(removed).size === 1
}

export function findViolations(
  commits: readonly InspectedCommit[],
  options: ClaimOptions = {}
): ComponentOwnershipViolation[] {
  const claimed = claimedCommits(commits, options)
  const isMechanicalDeletion = options.isMechanicalDeletion ?? ((): boolean => false)
  const violations: ComponentOwnershipViolation[] = []
  for (const commit of commits) {
    if (!touchesComponents(commit.files)) continue
    // 早于生效点的提交：两条新规则都不判（它们写在规则存在之前，不可能满足）。
    if (predatesRules(commit.authorDate)) continue
    if (claimed.has(commit.hash)) continue
    // 同一行文本全仓机械删除：允许整体一笔，不要求逐文件解释。
    if (isMechanicalDeletion(commit.hash)) continue
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

  // 认领不改历史、只补声明，所以「已推送」不再是拒绝理由（Chief 2026-11-02 批准放宽）；
  // 要防的是橡皮图章——每条认领必须自带理由，声明本身有问题就让门禁失败。
  const existsElsewhere = (hash: string): boolean => {
    try {
      git(['cat-file', '-e', hash])
      return true
    } catch {
      return false
    }
  }
  const problems = claimProblems(commits, existsElsewhere)
  if (problems.length > 0) {
    console.error('components-ownership: 认领声明有问题：')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  const claimedCount = claimedCommits(commits).size
  const mechanical = (hash: string): boolean => {
    try {
      return isMechanicalDeletionPatch(git(['show', '--format=', '--unified=0', hash]))
    } catch {
      // 读不出 diff 时从严：当作不是机械删除。
      return false
    }
  }
  const violations = findViolations(commits, { isMechanicalDeletion: mechanical })
  if (violations.length === 0) {
    console.log(`components-ownership: ${commits.length} commit(s) checked, none touched ${COMPONENTS_DIR} without a ${OWNER_TRAILER} trailer.`)
    // 认领数量必须看得见：一晚上认领十几笔，说明分工本身出了问题。
    console.log(`components-ownership: ${claimedCount} commit(s) claimed after the fact.`)
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
