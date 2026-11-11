import { describe, expect, it } from 'vitest'

import { mergeBaseline } from './check-body-prose.mts'

/**
 * `--write-baseline` 的唯一判断抽成纯函数（原来埋在 argv 分支里，测不了）。
 *
 * 断的不只是 `refused` 非空，还断**它列出来的原文**：只断「拒绝了」的话，下一个人把原因吞掉
 * （变成一句空的 `[]` 或笼统提示）也没人发现，而这次事故丢的正是「哪三条被覆盖」。
 */
describe('mergeBaseline', () => {
  it('lets a purely additive write through', () => {
    const { merged, refused } = mergeBaseline({ 'a.tsx :: kHint': 2 }, new Map([['a.tsx :: kHint', 2], ['b.tsx :: kNote', 1]]))
    expect(refused).toEqual([])
    expect(merged).toEqual({ 'a.tsx :: kHint': 2, 'b.tsx :: kNote': 1 })
  })

  it('refuses when an existing entry shrinks or disappears, and names it in the message', () => {
    const shrunk = mergeBaseline({ 'a.tsx :: kHint': 3 }, new Map([['a.tsx :: kHint', 1]]))
    expect(shrunk.refused).toEqual(['a.tsx :: kHint（基线 3 → 现在 1）'])
    const gone = mergeBaseline({ 'a.tsx :: kHint': 2 }, new Map())
    expect(gone.refused).toEqual(['a.tsx :: kHint（基线 2 → 现在不存在）'])
  })
})
