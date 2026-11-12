import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { looksLikeTextKey } from '../textKeyShape'
import { sentinelResolveText } from '../resolveTextShape'
import { declaredTextKeysIn, literalAriaLabelKeys } from '../textKeyPaths'

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
    // 产品侧那条守卫的夹具里就有「写坏的键」，它们不是调用点。
    if (entry.name === 'ariaLabelKeyGuard.test.ts') continue
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

/**
 * 守卫 A（平台/壳层）：`ariaLabelKey` 的**字面量**必须是某张文案表里声明过的键。
 *
 * 这一侧没有统一点分表（各屏有自己的本地映射），所以「声明过」按两处收：
 * 树内对象字面量的**属性路径**，以及组件自带 `*Text.ts` 的键与 `*_KEY` 常量（`textKeyPaths`）。
 *
 * 为什么必须按属性路径而不是「文件里出现过这个字符串」：哨兵解析器自己就把键写在比较式里
 * （`key === 'briefingPush.stripInfo'`），按「出现过」判它一定绿；按属性名判它才红。
 *
 * 已知残差：键是运行时拼出来的字符串时 AST 收不到——这类只允许登记例外，默认没有例外。
 */
describe('ariaLabelKey 必须是声明过的键（平台/壳层）', () => {
  /** 守卫自己的实现文件会把 `ariaLabelKey` 写进正则与类型，它们不是调用点。 */
  const GUARD_IMPLEMENTATION = new Set([
    'platform/ui/components/textKeyPaths.ts',
    'platform/ui/components/resolveTextShape.ts'
  ])

  function offendersIn(sources: ReadonlyArray<Readonly<{ path: string; text: string }>>): string[] {
    const declared = declaredTextKeysIn(sources)
    return sources.flatMap((source) => literalAriaLabelKeys(source.text)
      .filter((entry) => !declared.has(entry.key))
      .map((entry) => `${source.path}:${entry.line} ${entry.key}`))
  }

  it('only ever names a key some text table declares', () => {
    const sources = ['platform', 'apps']
      .flatMap((root) => sourceFiles(join(ROOT, root)))
      .map((file) => ({ path: relative(ROOT, file), text: readFileSync(file, 'utf8') }))
      // 用例里的 `ui.test.*` 是夹具键，不是调用点：守卫看的是产品与平台的源码。
      .filter((source) => !/\.test\.(ts|tsx)$/.test(source.path))
      .filter((source) => !GUARD_IMPLEMENTATION.has(source.path))

    expect(offendersIn(sources)).toEqual([])
  })

  it('tells a declared key from a key that only appears in a comparison', () => {
    const real = { path: 'a.tsx', text: "const T = { ui: { drawer: { close: '关闭' } } }\n<IconButton ariaLabelKey=\"ui.drawer.close\" />" }
    const fake = { path: 'b.tsx', text: "<IconButton ariaLabelKey=\"ui.not.defined\" />" }
    const sentinel = { path: 'c.tsx', text: "<IconButton ariaLabelKey=\"briefingPush.stripInfo\" resolveText={(key) => key === 'briefingPush.stripInfo' ? 'x' : ''} />" }

    expect(offendersIn([real])).toEqual([])
    expect(offendersIn([fake])).toEqual(['b.tsx:1 ui.not.defined'])
    // 哨兵自己把键写在比较式里——按属性名判它仍是「没声明过」。
    expect(offendersIn([sentinel])).toEqual(['c.tsx:1 briefingPush.stripInfo'])
  })
})

/**
 * 守卫 B：`resolveText` 不许是「哨兵形状」。
 *
 * 抓三类：首参与字符串字面量做 `===`/`!==`、对首参 `switch`、函数体恒等（`(key) => key`）。
 * **不抓**「内联 lambda 一律」：平台各屏合法地写 `resolveText={(key) => localMap[key] ?? ''}`，
 * 一刀切只会把合规代码全打红，然后被加豁免。
 */
describe('resolveText 不许是哨兵形状', () => {
  const COMPONENT_PATTERN = new RegExp(`<(${['IconButton', 'Popover', 'Tabs', 'Segmented', 'StatusPill', 'StateView', 'Tooltip', 'FilterChip', 'InlineNotice', 'DisabledHint', 'SidePanel', 'Drawer', 'ToastHost'].join('|')})\\b`)

  function sentinelsIn(sources: ReadonlyArray<Readonly<{ path: string; text: string }>>) {
    return sources.flatMap((source) => {
      const found = sentinelResolveText(source.path, source.text)
      // 只看真的在这颗组件上的：`resolveText` 也是别的组件的属性名。
      return found.filter((entry) => {
        const line = source.text.split('\n')[entry.line - 1] ?? ''
        if (COMPONENT_PATTERN.test(line)) return true
        const above = source.text.split('\n').slice(Math.max(0, entry.line - 6), entry.line).join('\n')
        return COMPONENT_PATTERN.test(above)
      })
    })
  }

  it('never hard-codes key → sentence in a comparison, a switch or an identity function', () => {
    const sources = ['apps', 'platform', 'products']
      .flatMap((root) => sourceFiles(join(ROOT, root)))
      .map((file) => ({ path: relative(ROOT, file), text: readFileSync(file, 'utf8') }))
      // 用例里的哨兵是**反向夹具**（它们必须红），不参与「当前树全绿」这条。
      .filter((source) => !/\.test\.(ts|tsx)$/.test(source.path))
      .filter((source) => !source.path.startsWith('platform/ui/components/textKeyPaths.ts')
        && !source.path.startsWith('platform/ui/components/resolveTextShape.ts'))

    expect(sentinelsIn(sources).map((entry) => `${entry.path}:${entry.line} ${entry.shape}`)).toEqual([])
  })

  it('catches the three shapes and leaves a table lookup alone', () => {
    const comparison = { path: 'a.tsx', text: "const A = <IconButton resolveText={(key) => key === 'a.b' ? 'X' : ''} />\n" }
    const switching = { path: 'b.tsx', text: "const B = <IconButton resolveText={(key) => { switch (key) { case 'a.b': return 'X'; default: return '' } }} />\n" }
    const identity = { path: 'c.tsx', text: "const C = <IconButton resolveText={(key) => key} />\n" }
    const lookup = { path: 'd.tsx', text: "const D = <IconButton resolveText={(key) => map[key] ?? ''} />\n" }
    const resolver = { path: 'e.tsx', text: "const E = <IconButton resolveText={resolveProductTextKey} />\n" }

    expect(sentinelsIn([comparison]).map((entry) => entry.shape)).toEqual(['comparison'])
    expect(sentinelsIn([switching]).map((entry) => entry.shape)).toEqual(['switch'])
    expect(sentinelsIn([identity]).map((entry) => entry.shape)).toEqual(['identity'])
    expect(sentinelsIn([lookup])).toEqual([])
    expect(sentinelsIn([resolver])).toEqual([])
  })
})
