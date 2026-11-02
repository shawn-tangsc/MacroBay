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
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type TreeSample = {
  head: string
  /** 未提交路径数；`-1` 表示不是 git 仓库（快照/CI tarball），无法见证。 */
  dirty: number
  at: string
}

/** 起点采样的落点：临时目录、固定文件名。放仓库里会把树弄脏，正好破坏它要验的东西。 */
export function samplePath(): string {
  return join(tmpdir(), 'macrobay-verify-sample.json')
}

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], { encoding: 'utf8' }).trimEnd()
}

/** 取一次采样。不是 git 仓库时不抛：快照里也要能跑，只是结论会是 `unknown`。 */
export function sampleTree(now: () => Date = () => new Date()): TreeSample {
  try {
    const head = git(['rev-parse', '--short', 'HEAD'])
    const porcelain = git(['status', '--porcelain'])
    const dirty = porcelain === '' ? 0 : porcelain.split('\n').filter((line) => line.trim() !== '').length
    return { head, dirty, at: now().toISOString() }
  } catch {
    return { head: 'no-git', dirty: -1, at: now().toISOString() }
  }
}

export type Verdict = 'valid' | 'invalid' | 'unknown'

export type Comparison = { verdict: Verdict; reason: string }

/**
 * 比较首尾两次采样。
 *
 * 三种结论，不含糊：
 * - `valid`：`head` 与 `dirty` 都一致——这次跑的是同一棵树，红绿可引用；
 * - `invalid`：任一不一致——**既不是绿也不是红**，是有并发编辑，必须重跑；
 * - `unknown`：有一侧不是 git 仓库，无法见证（快照/CI tarball），不当成 valid。
 */
export function compareSamples(start: TreeSample, end: TreeSample): Comparison {
  if (start.head === 'no-git' || end.head === 'no-git') {
    return { verdict: 'unknown', reason: 'not a git checkout, so the tree state cannot be attested' }
  }
  if (start.head !== end.head) {
    return { verdict: 'invalid', reason: `HEAD moved during the run: ${start.head} → ${end.head}` }
  }
  if (start.dirty !== end.dirty) {
    return { verdict: 'invalid', reason: `the working tree changed during the run: dirty ${start.dirty} → ${end.dirty}` }
  }
  if (start.dirty !== 0) {
    // 首尾一致但本来就不干净：这是一次**受污染但稳定**的跑，绿也只在「现在没坏」的意义上成立。
    return { verdict: 'valid', reason: `the tree was already dirty (${start.dirty} path(s)) at both samples` }
  }
  return { verdict: 'valid', reason: 'same commit, clean tree at both samples' }
}
