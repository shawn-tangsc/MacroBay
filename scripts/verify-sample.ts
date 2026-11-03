/**
 * 验证的**首尾两次采样**：一次验证只在「起跑线与终点线是同一棵树」时才有效。
 *
 * 为什么需要它（2026-11-02 的一次事故）：`verify:sole` 在开头报 `dirty=0`，但 7 分钟的链路里，
 * 别人把文件改到一半，typecheck 于是红在别人手上——**起跑线干净，赛道不是同一条**。
 * 那一轮的结论既不是绿也不是红，而是「无效」，可它被当成了结论。
 *
 * 所以采样抽到这里，preflight 与 postflight 共用一份实现：两边各写一遍，就会出现一边算
 * `git status --porcelain`、另一边算 `git diff --stat` 的漂移。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type TreeSample = {
  head: string
  /** 未提交路径数；`-1` 表示不是 git 仓库（快照/CI tarball），无法见证。 */
  dirty: number
  at: string
}

/**
 * 起点采样的落点：临时目录里，**一个 checkout 一个文件**。
 *
 * 放仓库里会把树弄脏，正好破坏它要验的东西；所以落在临时目录。但**只落临时目录还不够**：
 * `tmpdir()` 是按机器、不是按 checkout 的，两个克隆会撞到同一个文件名——
 *
 *   克隆里跑一次、共享树跑一次 → 后起的那次覆盖起点样本 → 先起的那次收尾时读到别人的 `dirty`
 *   → 判 `invalid`。**合法被作废**，而且最坏的情况是它教会人「这门禁爱乱报 invalid」然后去找绕过。
 *
 * 「关账去钉死 SHA 的克隆里跑」这条规矩依赖它：稳态下同时只该有一次全量，但共享树上的范围测试
 * 与克隆里的关账可以同时存在，这正是撞名会发生的场景。所以键取仓库根路径的哈希，而不是机器。
 */
export function samplePath(): string {
  return join(tmpdir(), `macrobay-verify-sample-${checkoutKey()}.json`)
}

/** 仓库根的短哈希。不是 git 仓库时固定一个键——那种环境下本来就没有第二个 checkout 可撞。 */
function checkoutKey(): string {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    return createHash('sha256').update(root).digest('hex').slice(0, 12)
  } catch {
    return 'no-git'
  }
}

/**
 * 检查清单**唯一来源**。加一步只改这里：`verify-run` 照着跑，AGENTS 的步骤表与守卫都读它。
 * 放在这个纯模块里而不是执行器里——执行器被 import 时会真的开始跑验证。
 */
export const VERIFY_CHECKS = [
  'docs:check',
  'check:file-size',
  'check:danger-color',
  'check:hex-color',
  'check:undefined-token',
  'check:components-ownership',
  'check:async-initial-state',
  'check:state-content-ternary',
  'typecheck',
  'test',
  'build'
] as const

/** 数未提交路径。抽成纯函数：`-uall` 与折叠目录的差别只能在这一层被测出来。 */
export function countDirty(porcelain: string): number {
  return porcelain === '' ? 0 : porcelain.split('\n').filter((line) => line.trim() !== '').length
}

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], { encoding: 'utf8' }).trimEnd()
}

/** 取一次采样。不是 git 仓库时不抛：快照里也要能跑，只是结论会是 `unknown`。 */
export function sampleTree(now: () => Date = () => new Date()): TreeSample {
  try {
    const head = git(['rev-parse', '--short', 'HEAD'])
    // `-uall`：默认会把未跟踪目录折叠成 `?? dir/` 一行，跑中有人往这个目录里再加文件时
    // 计数不变——漂移就漏了。今天这棵树恰好两种计数一样，是留给下一次的。
    const porcelain = git(['status', '--porcelain', '-uall'])
    const dirty = countDirty(porcelain)
    return { head, dirty, at: now().toISOString() }
  } catch {
    return { head: 'no-git', dirty: -1, at: now().toISOString() }
  }
}

/**
 * 四种结论，一个词只表示一件事。
 *
 * 之前 `valid` 同时表示「干净可归因」和「稳定但脏」，报告行只打一个词——下一个人只会读那一个词，
 * 然后拿一次脏树的绿去关账。**这等于把今晚要消灭的习惯换了个位置**。
 *
 * - `valid`：首尾都干净且一致——**只有它能关账**；
 * - `polluted`：首尾一致但脏（与 preflight 同一个词），`attributable=no`，退出 0；
 * - `invalid`：首尾不一致，非零退出；既不是绿也不是红；
 * - `unknown`：没有 git（快照/CI tarball），`attributable=no`。
 */
export type Verdict = 'valid' | 'polluted' | 'invalid' | 'unknown'

export type Comparison = { verdict: Verdict; attributable: boolean; reason: string }

/**
 * 比较首尾两次采样。
 *
 * `attributable` 才是「这次结果能不能记在某个提交上」的唯一答案；`valid` 只是它的充分条件之一，
 * 所以报告行两个都打——只打一个词，就一定有人只读那一个词。
 */
export function compareSamples(start: TreeSample, end: TreeSample): Comparison {
  if (start.head === 'no-git' || end.head === 'no-git') {
    return { verdict: 'unknown', attributable: false, reason: 'not a git checkout, so the tree state cannot be attested' }
  }
  if (start.head !== end.head) {
    return { verdict: 'invalid', attributable: false, reason: `HEAD moved during the run: ${start.head} → ${end.head}` }
  }
  if (start.dirty !== end.dirty) {
    return { verdict: 'invalid', attributable: false, reason: `the working tree changed during the run: dirty ${start.dirty} → ${end.dirty}` }
  }
  if (start.dirty !== 0) {
    // 首尾一致但本来就不干净：稳定，但**不能归因到任何提交**。
    return { verdict: 'polluted', attributable: false, reason: `the tree was already dirty (${start.dirty} path(s)) at both samples` }
  }
  return { verdict: 'valid', attributable: true, reason: 'same commit, clean tree at both samples' }
}
