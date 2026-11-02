import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { looksLikeTextKey } from '../textKeyShape'

/**
 * `Tooltip` 的两条调用点守卫（契约 §6）。
 *
 * 1. **`labelKey` 只收键**：与 `IconButton` 同口径——开区间 `string`，由守卫保证形状，
 *    含中文、空白或已解析句子即红。
 * 2. **禁用触发器不许挂提示**：禁用的控件接不到焦点，提示就只剩鼠标能看。这条只能扫调用点：
 *    组件无法从一个 `ReactElement` 推导出它会被渲染成禁用，尤其它可能被别的组件包住。
 *
 * 两条都配了反向用例——一条永远通过的守卫比没有守卫更糟。
 */

const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'platform', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

type Finding = { file: string; line: number; detail: string }

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(join(dir, entry.name)))
      continue
    }
    if (!/\.tsx$/.test(entry.name)) continue
    if (/\.test\.tsx$/.test(entry.name)) continue
    found.push(join(dir, entry.name))
  }
  return found
}

/** 只看我们这件组件的调用点：直接 import antd `Tooltip` 的旧代码是迁移对象，不归这两条守卫。 */
const OUR_IMPORT = '@platform/ui/components/tooltip'

function callSitesIn(file: string): Array<{ line: number; source: string }> {
  const text = readFileSync(file, 'utf8')
  if (!text.includes(OUR_IMPORT)) return []
  const sites: Array<{ line: number; source: string }> = []
  for (const match of text.matchAll(/<Tooltip\b/g)) {
    const start = match.index ?? 0
    const window = text.slice(start, start + 500)
    // 开标签到此为止；再往后是子元素，属于禁用检查的范围。
    const openEnd = window.indexOf('>')
    sites.push({
      line: text.slice(0, start).split('\n').length,
      source: openEnd >= 0 ? window.slice(0, openEnd) : window,
      child: openEnd >= 0 ? window.slice(openEnd + 1, openEnd + 300) : ''
    } as { line: number; source: string })
  }
  return sites
}

const files = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)))

describe('Tooltip call sites', () => {
  it('only ever passes a key-shaped string as the hint', () => {
    const offenders: Finding[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const site of callSitesIn(file)) {
        const literal = /labelKey\s*[:=]\s*\{?\s*['"`]([^'"`\n]*)['"`]/.exec(site.source)?.[1]
        // 传变量/常量的调用点由定义处判，守卫只判字面量。
        // 键的形状与 `IconButton`、`StatusPill` 共用一份（`../textKeyShape`）：点分、无空白、无中文，**允许驼峰**。
        if (literal === undefined || looksLikeTextKey(literal)) continue
        offenders.push({ file: relative(ROOT, file), line: site.line, detail: literal })
      }
      void text
    }

    expect(offenders).toEqual([])
  })

  it('never lets a literal sentence into dataText: data comes from variables', () => {
    const offenders: Finding[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes(OUR_IMPORT)) continue
      // `dataText` 只准来自变量或查询结果：字面量里出现中文或空白即红——那是把句子伪装成数据。
      for (const match of text.matchAll(/dataText\s*=\s*\{?\s*['"`]([^'"`\n]*)['"`]/g)) {
        const value = match[1] ?? ''
        if (/[\u4e00-\u9fff]/.test(value) || /\s/.test(value)) {
          offenders.push({ file: relative(ROOT, file), line: text.slice(0, match.index ?? 0).split('\n').length, detail: value })
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('catches a sentence smuggled into dataText, so the guard is not vacuous', () => {
    const literal = '变化还在计算中'
    expect(/[\u4e00-\u9fff]/.test(literal) || /\s/.test(literal)).toBe(true)
  })

  it('never attaches a hint to a disabled trigger', () => {
    const offenders: Finding[] = []
    for (const file of files) {
      for (const site of callSitesIn(file)) {
        const child = (site as unknown as { child?: string }).child ?? ''
        // 子元素带 `disabled`（字面属性、`disabled` 或 `disabled={true}`）即红。
        if (/<[A-Z][A-Za-z0-9.]*[^>]*\sdisabled(?:[=\s/>]|$)/.test(child)) {
          offenders.push({ file: relative(ROOT, file), line: site.line, detail: 'disabled trigger' })
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('catches both shapes, so neither guard passes vacuously', () => {
    const keyOf = (line: string): string => /labelKey\s*[:=]\s*\{?\s*['"`]([^'"`\n]*)['"`]/.exec(line)?.[1] ?? ''
    // 反向实测（Chief 2026-11-02 要求）：**故意写一个中文键，必须被拒**。
    // 注意这一条比「没写点」严格：`ui.state.刷新` 是点分键，只有真按「无中文」判才会红。
    expect(looksLikeTextKey(keyOf("labelKey='ui.state.刷新'"))).toBe(false)
    expect(looksLikeTextKey(keyOf("labelKey='刷新数据'"))).toBe(false)
    expect(looksLikeTextKey(keyOf("labelKey='ui.state.saved '"))).toBe(false)
    // 放开驼峰不能把「一句话」也放进来，这是这条守卫存在的理由。
    expect(looksLikeTextKey(keyOf("labelKey='pages.intelligence.portal.analysisWorkspace.newChatAction'"))).toBe(true)
    expect(looksLikeTextKey(keyOf("labelKey='crossAsset.subtitle'"))).toBe(true)
    expect(/<Button[^>]*\sdisabled(?:[=\s/>]|$)/.test('<Button disabled>go</Button>')).toBe(true)
    expect(/<Button[^>]*\sdisabled(?:[=\s/>]|$)/.test('<Button disabled={true}>go</Button>')).toBe(true)
    expect(/<Button[^>]*\sdisabled(?:[=\s/>]|$)/.test('<Button>go</Button>')).toBe(false)
  })
})
