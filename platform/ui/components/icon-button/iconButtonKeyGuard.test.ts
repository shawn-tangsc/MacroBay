import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { looksLikeTextKey } from '../textKeyShape'

/**
 * `IconButton` 的读屏名与提示只收 i18n 键，但为了不逼产品绕过组件，类型是开区间 `string`
 * （见 `IconButton.tsx` 里那段说明）。开区间就得有一条守卫替类型把关：
 * **键长什么样**——点分小写，无空白、无中文。写成一个中文句子、或者把已解析好的文案直接
 * 塞进去，读屏会念出键名或者一句脱离语言环境的话，这里当场变红。
 */
const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'platform', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

/**
 * 键的形状：点分，**允许驼峰**（产品文案键就是 `portal.calendarCard.openCalendar` 这种），
 * 但不许空白、不许中文——那才是「一句话被当成键」的样子。
 *
 * 判据只有这一份（`../textKeyShape`）：`StatusPill`、`Tooltip` 用同一个函数，不留第二套标准。
 * 这里只判「像不像键」，不判「键在不在表里」：产品自有 i18n 表是合法来源，键在不在那张表里
 * 由各产品自己的用例保证，组件侧无法枚举。
 */

type Offender = { file: string; line: number; prop: string; value: string }

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(join(dir, entry.name)))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (entry.name === 'iconButtonKeyGuard.test.ts') continue
    found.push(join(dir, entry.name))
  }
  return found
}

/**
 * 取出每个 `<IconButton …>` 开标签的文本。
 *
 * **必须按组件切段**：`ariaLabelKey` 这个属性名在别的组件上也用（过滤器组、状态药丸…），
 * 全文件扫会把它们的键算到本组件头上——一条只会误伤的守卫，最后会被人加豁免而不是被修。
 *
 * 标签里可能含 `{…}`（内联处理器、模板字符串），所以按花括号深度找 `>`，不用 `indexOf('>')`。
 */
export function iconButtonTags(text: string): string[] {
  const tags: string[] = []
  for (const match of text.matchAll(/<IconButton\b/g)) {
    let depth = 0
    let end = -1
    for (let index = (match.index ?? 0) + 1; index < text.length; index += 1) {
      const char = text[index]
      if (char === '{') depth += 1
      else if (char === '}') depth = Math.max(0, depth - 1)
      else if (char === '>' && depth === 0) {
        end = index
        break
      }
    }
    if (end !== -1) tags.push(text.slice(match.index ?? 0, end + 1))
  }
  return tags
}

function offendersIn(file: string): Offender[] {
  const text = readFileSync(file, 'utf8')
  const offenders: Offender[] = []
  // 只认赋/传字面量：`ariaLabelKey: '…'`、`tooltipKey="…"`。变量、常量、函数调用一律跳过。
  const pattern = /(?:ariaLabelKey|tooltipKey)\s*[:=]\s*\{?\s*['"`]([^'"`\n]*)['"`]/g
  for (const tag of iconButtonTags(text)) {
    const tagStart = text.indexOf(tag)
    for (const match of tag.matchAll(pattern)) {
      const value = match[1] ?? ''
      if (looksLikeTextKey(value)) continue
      const line = text.slice(0, tagStart + (match.index ?? 0)).split('\n').length
      offenders.push({ file, line, prop: match[0].split(/[:=]/)[0]!.trim(), value })
    }
  }
  return offenders
}

describe('IconButton key guard', () => {
  it('only ever passes key-shaped strings as the screen-reader name and tooltip', () => {
    const offenders = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root))).flatMap((file) =>
      offendersIn(file).map((offender) => ({ ...offender, file: relative(ROOT, offender.file) }))
    )

    expect(offenders).toEqual([])
  })

  it('catches a sentence and a CJK label, so the guard cannot pass vacuously', () => {
    const bad = [
      "<IconButton ariaLabelKey='Close the panel' />",
      "<IconButton tooltipKey='关闭面板' />",
      "<IconButton ariaLabelKey = 'ui.icon.close ' />"
    ]
      .map((tag) => [...tag.matchAll(/(?:ariaLabelKey|tooltipKey)\s*[:=]\s*\{?\s*['"`]([^'"`\n]*)['"`]/g)][0]?.[1] ?? '')
      .filter((value) => !looksLikeTextKey(value))

    expect(bad).toHaveLength(3)
  })
  it('尺度收紧的方向：句子和带空白的值仍然被拒', () => {
    // 放开驼峰不能顺手把「一句话」也放进来——这才是这条守卫存在的理由。
    expect(looksLikeTextKey('portal.calendarCard.openCalendar')).toBe(true)
    expect(looksLikeTextKey('ui.state.action.focus-form')).toBe(true)
    expect(looksLikeTextKey('打开日历')).toBe(false)
    // 点分但含中文：只有真按「无中文」判才拦得住，只判「有没有点」会放它过去。
    expect(looksLikeTextKey('ui.state.刷新')).toBe(false)
    expect(looksLikeTextKey('Open the calendar')).toBe(false)
    expect(looksLikeTextKey('nokeydothere')).toBe(false)
  })

})
