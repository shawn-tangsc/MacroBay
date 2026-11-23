import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { captureOnlySurfaces, isCaptureOnlySurface, mergeBaseline } from './check-body-prose.mts'

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

/**
 * 截图面白名单：它存在的唯一理由是**产物是一张图**，不是「这句话看着像说明」。
 *
 * 三条互相咬住：
 * - 只放过写死的那一个文件（海报窗口），同样一句出现在页面里照样红——白名单不许长成整门禁的旁路；
 * - 名单里每条路径必须真的存在（文件改了名还留着豁免，等于一条谁也看不见的旁路）；
 * - 页面那半个不算截图面：`DailyBriefingPage.tsx` 里有整页界面，它那句只能待在基线里被逐次清掉。
 */
describe('capture-only surfaces', () => {
  it('exempts the poster capture window and nothing else that carries the same sentence', () => {
    expect(isCaptureOnlySurface('products/market-intelligence/desktop/pages/intelligence/BriefingPosterWindow.tsx')).toBe(true)
    expect(isCaptureOnlySurface('products/market-intelligence/desktop/pages/intelligence/DailyBriefingPage.tsx')).toBe(false)
    expect(isCaptureOnlySurface('products/market-intelligence/desktop/pages/intelligence/SomePanel.tsx')).toBe(false)
  })

  it('names only files that still exist', () => {
    const missing = captureOnlySurfaces().filter((file) => !existsSync(join(process.cwd(), file)))
    expect(missing).toEqual([])
  })
})
