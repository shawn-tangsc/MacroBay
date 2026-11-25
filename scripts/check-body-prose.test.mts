import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

import {
  captureOnlySurfaces, exemptHintKeySpans, floatingBlockSpans, isCaptureOnlySurface, mergeBaseline, stripFloatingBlocks
} from './check-body-prose.mts'

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

/** 豁免区间落在源码的哪些片段上：返回被豁免的那几次键（`.liveHint` / `'…liveHint'`）。 */
const exemptText = (source: string): string[] =>
  exemptHintKeySpans(source).map(([start, end]) => source.slice(start, end))

/**
 * 「先把键赋给变量、再交给 ⓘ」不是正文（2026-11-25 的误报：`liveHint` 先 `resolveText` 再进 `lines`）。
 *
 * 五条互相咬住，缺一条这条豁免就会变成旁路：
 * - 只进 `lines` / `content` / `labelKey` 的变量，它的定义那一次键不算正文；
 * - **同一个变量还在正文里用过一次就不豁免**——这是反向判据，把这句话挪出 ⓘ 必须当场红；
 * - 用了但用在水口之外（普通段落 `{liveHint}`）同样不豁免；
 * - 键根本没赋给变量（正文里直接写 `.liveHint`）照旧算正文，一个都不放过；
 * - **豁免按位置、不按行**：同一行里两个候选，只有进了水口的那一个被豁免。
 */
describe('keys bound only to floating entries', () => {
  const intoLines = [
    "const liveHint = resolveText('pages.x.crossAsset.liveHint')",
    'return <Popover lines={[liveHint]} />'
  ].join('\n')

  it('exempts the definition when every use sits inside lines={…}', () => {
    expect(exemptText(intoLines)).toEqual(["'pages.x.crossAsset.liveHint'"])
  })

  it('still reports it when the same variable is also rendered in the body', () => {
    const source = [
      "const liveHint = resolveText('pages.x.crossAsset.liveHint')",
      'return <><p>{liveHint}</p><Popover lines={[liveHint]} /></>'
    ].join('\n')
    expect(exemptText(source)).toEqual([])
  })

  it('exempts a key handed to a component that shows it on a trigger', () => {
    const source = [
      "const freshnessNote = t('settings.x.freshnessNote')",
      'return <SettingInfoPopover hintKey={freshnessNote} />'
    ].join('\n')
    expect(exemptText(source)).toEqual(["'settings.x.freshnessNote'"])
  })

  it('does not exempt a bare key used in body position', () => {
    const source = 'return <p>{labels.x.liveHint}</p>'
    expect(exemptText(source)).toEqual([])
  })

  /**
   * `helpTrigger(` 是这条豁免的**真实动机**（`BriefingManualRunDialog.tsx` 的 `cutoffHelp` 就是
   * 「模板串 + `copy.nowHint` 拼一句、交给 question 形按钮」）。漏了这条，动机那条路径只剩手跑证据。
   */
  it('exempts the definition when it is handed to helpTrigger(…) as a third argument', () => {
    const source = [
      "const cutoffHelp = `${gridHint(text)} ${copy.nowHint.replace('{zone}', zoneLabel)}`",
      'return <>{helpTrigger(keys.cutoff, copy.cutoffHintLabel, cutoffHelp)}</>'
    ].join('\n')
    expect(exemptText(source)).toEqual(['.nowHint'])
  })

  it('but the same helpTrigger helper does not cover the sentence when it is rendered in the body', () => {
    const source = [
      "const cutoffHelp = copy.nowHint.replace('{zone}', zoneLabel)",
      'return <><p>{cutoffHelp}</p>{helpTrigger(keys.cutoff, copy.cutoffHintLabel, cutoffHelp)}</>'
    ].join('\n')
    expect(exemptText(source)).toEqual([])
  })

  /**
   * 豁免以前是**整行**跳过：同一行里两个候选时，第一个进了水口就把整行放过，第二个去哪都没人看。
   * 现在只豁免「那个定义表达式里的那一次键」，第二个进正文照旧算命中。
   */
  it('exempts only the candidate that reached the floating entry when two sit on one line', () => {
    const source = [
      'const a = copy.aHint, b = copy.bodyHint',
      'return <><Popover lines={[a]} /><p>{b}</p></>'
    ].join('\n')
    const exempted = exemptText(source)
    // 进了水口的那一个豁免……
    expect(exempted.some((text) => text.includes('aHint'))).toBe(true)
    // ……进正文的那一个不许跟着一起放过（整行豁免就是这么漏的）。
    expect(exempted.some((text) => text.includes('bodyHint'))).toBe(false)
  })
})

/**
 * 浮层块的边界**过去只决定剥哪些字符**（判错是假红，安全）；现在它还是豁免边界，
 * 判错就等于把正文圈进水口**放过**。所以两条：字符串里的 `{` 不许把块拖长，模板里的 `}` 同理。
 */
describe('floating block spans respect strings and template literals', () => {
  it('a `{` inside a string does not stretch the block over the code that follows', () => {
    const source = [
      "return <Popover lines={['a{b']} />",
      'const leak = copy.bodyHint'
    ].join('\n')
    expect(stripFloatingBlocks(source)).toContain('copy.bodyHint')
    const [span] = floatingBlockSpans(source)
    expect(source.slice(span![0], span![1])).toBe("lines={['a{b']}")
  })

  it('a `}` inside a template literal does not end the block early', () => {
    const source = [
      'return <Popover content={`a}b`} />',
      'const leak = copy.bodyHint'
    ].join('\n')
    const [span] = floatingBlockSpans(source)
    expect(source.slice(span![0], span![1])).toBe('content={`a}b`}')
    expect(stripFloatingBlocks(source)).toContain('copy.bodyHint')
  })

  it('nested braces and ${…} inside a template are balanced to the real closing brace', () => {
    const source = 'return <Popover content={`${flag ? `x${y}` : `}`}`} />\nconst leak = copy.bodyHint'
    expect(stripFloatingBlocks(source)).toContain('copy.bodyHint')
  })
})

/**
 * 基线只许降：`total` 必须等于条目之和，别再留余量（116 → 115 → 114 都是这么一路收的）。
 * 余量会让人以为「还剩一处可以顺手清」，而下一个人照着它去删条目就成了放宽。
 */
describe('baseline ratchet', () => {
  it('total equals the sum of its entries', () => {
    const baseline = JSON.parse(readFileSync(join(process.cwd(), 'scripts/body-prose-baseline.json'), 'utf8')) as
      { total: number; entries: Record<string, number> }
    const sum = Object.values(baseline.entries).reduce((total, value) => total + value, 0)
    expect(baseline.total).toBe(sum)
  })
})
