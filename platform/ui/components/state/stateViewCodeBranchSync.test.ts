import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 码表与联合必须逐条相等（Chief 2026-11-03 提，由 `page-load-failed` 那次漏分支换来）。
 *
 * 那个码落地时：码表有、两句文案有、动作键有，**唯独 `StateViewProps` 联合里没有分支**，
 * 于是它在仓库里存在、却没人能用——调用点一写就编译不过。这种缺口比「没做」更难发现，
 * 因为每一处单看都对。
 *
 * 两个方向都要红：
 * 1. 文案表里有句子、联合里没有分支 → **存在但不可用**；
 * 2. 联合里有分支、文案表里没有句子 → **能渲染但没有话**（渲染成空串，读屏什么也听不到）。
 *
 * 判据一句话：两个集合做集合比较，差集必须为空。
 */

const ROOT = join(__dirname, '..', '..', '..', '..')
const STATE_VIEW = join(ROOT, 'platform/ui/components/state/StateView.tsx')
const STATE_TEXT = join(ROOT, 'platform/ui/components/state/stateViewText.ts')

/** 从文案表里取「有句子」的码：`ui.state.<state>.reason.<code>` → `<state>.<code>`。 */
export function codesFromCopy(text: string): Set<string> {
  const codes = new Set<string>()
  for (const match of text.matchAll(/'ui\.state\.(empty|error|disabled|permission)\.reason\.([a-z-]+)'\s*:/g)) {
    codes.add(`${match[1]}.${match[2]}`)
  }
  return codes
}

/** 从 props 联合里取「有分支」的码：只认 `export type StateViewProps` 之后那段。 */
export function codesFromUnion(source: string): Set<string> {
  const start = source.indexOf('export type StateViewProps =')
  const block = start === -1 ? '' : source.slice(start, source.indexOf('\n\n', start) === -1 ? undefined : source.indexOf('\n\n', start))
  const codes = new Set<string>()
  for (const match of block.matchAll(
    /state:\s*'(empty|error|disabled|permission)'[\s\S]{0,160}?reasonCode:\s*'([a-z-]+)'/g
  )) {
    codes.add(`${match[1]}.${match[2]}`)
  }
  return codes
}

function difference(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((entry) => !b.has(entry)).sort()
}

describe('StateView reason codes: copy table and props union agree', () => {
  it('has a branch for every sentence, and a sentence for every branch', () => {
    const copy = codesFromCopy(readFileSync(STATE_TEXT, 'utf8'))
    const union = codesFromUnion(readFileSync(STATE_VIEW, 'utf8'))

    // 有句子没分支：写成调用点会编译不过（`page-load-failed` 就是这么漏的）。
    expect(difference(copy, union), '文案表里有句子，但 props 联合里没有这一支').toEqual([])
    // 有分支没句子：渲染成空串，读者什么也听不到。
    expect(difference(union, copy), 'props 联合里有分支，但文案表里没有对应句子').toEqual([])
    expect(copy.size).toBeGreaterThan(10)
  })

  it('catches both directions, so the guard cannot pass vacuously', () => {
    const copy = `'ui.state.error.reason.unreadable': 'x',\n'ui.state.error.reason.page-load-failed': 'y',`
    const unionMissingBranch = `export type StateViewProps =\n  | (StateViewBase & { state: 'error'; reasonCode: 'unreadable' })\n`
    const unionWithExtraBranch = `export type StateViewProps =\n  | (StateViewBase & { state: 'error'; reasonCode: 'unreadable' })\n  | (StateViewBase & { state: 'empty'; reasonCode: 'no-sentence' })\n`

    expect(difference(codesFromCopy(copy), codesFromUnion(unionMissingBranch))).toEqual([
      'error.page-load-failed'
    ])
    expect(difference(codesFromUnion(unionWithExtraBranch), codesFromCopy(copy))).toEqual([
      'empty.no-sentence'
    ])
  })
})
