import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 「图形本身就是个圆」的图标不许拿有边框的档位。
 *
 * 用户看到的双圈是两条形状在抢同一个位置：图标自己那一圈（`Info`、`CircleHelp`）加上按钮的底框。
 * `plain` 档没有边框，所以正确的答案早就存在——问题是**答案是默认值**，源码里看不见。
 * 一个看不见的决定，下一次「顺手统一成工具栏样式」就会把双圈带回来，而它只在一张截图上看得出来。
 *
 * 所以这条守卫要的是**答案写出来**：这类图标必须显式 `variant="plain"`。
 *
 * **守卫扫源码，不在运行时抛错**（架构师 2026-11-02 定）：运行时 throw 会把整颗按钮炸掉，
 * 用户看到的是「悬停没反应」，比双圈更糟。检查放在测试里，坏的是构建，不是页面。
 *
 * 过渡期用一个只减不增的清单：清单上的站点**行为本来就对**（默认就是 `plain`），
 * 只是还没把那句话写出来。各线迁自己的那处时同笔删掉自己那行；清单和规则分开住，
 * 谁也不用来碰组件目录。
 */

const ROOT = resolve(__dirname, '../../../..')
const DEBT_FILE = resolve(ROOT, 'scripts/migration-debt/icon-glyph-variant.json')
const SCANNED_ROOTS = ['apps', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

/** 自带一圈轮廓的图形；新增这类图标时把名字加进来。 */
const CIRCULAR_GLYPHS = '(Info|CircleHelp|HelpCircle)'
const CIRCULAR_ICON = new RegExp(`icon=\\{\\s*${CIRCULAR_GLYPHS}\\s*\\}`, 'u')
const EXPLICIT_PLAIN = /variant=(?:"|')plain(?:"|')/u

function readDebt(): ReadonlySet<string> {
  if (!existsSync(DEBT_FILE)) {
    throw new Error(
      `glyph variant list missing: ${DEBT_FILE}\n` +
        'It lives in scripts/migration-debt/ on purpose: a product line must be able to strike its own line without touching platform/ui/components.'
    )
  }
  const parsed = JSON.parse(readFileSync(DEBT_FILE, 'utf8')) as { entries?: Record<string, number> }
  if (parsed.entries === undefined) throw new Error(`${DEBT_FILE} has no "entries"`)
  return new Set(Object.keys(parsed.entries))
}

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(join(dir, entry.name)))
      continue
    }
    if (!/\.tsx$/u.test(entry.name) || /\.test\.tsx$/u.test(entry.name)) continue
    found.push(join(dir, entry.name))
  }
  return found
}

/** 取出每个 `<IconButton … />` 的实参块。这个组件目前一律自闭合，不需要通用 JSX 解析。 */
export function iconButtonBlocks(text: string): string[] {
  return [...text.matchAll(/<IconButton\b[\s\S]*?\/>/gu)].map((match) => match[0])
}

/** 这个文件里「圆形图标但没写 plain」的处数。 */
export function unmarkedCircularSites(text: string): number {
  return iconButtonBlocks(text).filter((block) => CIRCULAR_ICON.test(block) && !EXPLICIT_PLAIN.test(block)).length
}

const DEBT = readDebt()
const FILES = SCANNED_ROOTS.flatMap((root) => {
  try {
    return sourceFiles(join(ROOT, root))
  } catch {
    return []
  }
})
const OFFENDERS = FILES
  .map((file) => ({ file: relative(ROOT, file).replace(/\\/gu, '/'), count: unmarkedCircularSites(readFileSync(file, 'utf8')) }))
  .filter((entry) => entry.count > 0)

describe('IconButton glyph variant', () => {
  it('keeps every circular glyph on an explicit plain variant, and nothing else', () => {
    // 要「问一句」用 `plain`（无框、无底，悬停才出圆角浅底）；`solid` 只属于工具栏那一排。
    expect(OFFENDERS.filter((entry) => !DEBT.has(entry.file)).map((entry) => `${entry.file} ×${entry.count}`)).toEqual([])
  })

  it('shrinks the list: a file that wrote the variant out must have its line deleted', () => {
    const stale = [...DEBT].filter((file) => {
      try {
        return unmarkedCircularSites(readFileSync(join(ROOT, file), 'utf8')) === 0
      } catch {
        return true
      }
    })
    expect(stale).toEqual([])
  })

  it('catches each shape, so the guard cannot pass vacuously', () => {
    const circular = '<IconButton\n  ariaLabelKey="x.y"\n  icon={Info}\n  resolveText={key}\n/>'
    expect(unmarkedCircularSites(circular)).toBe(1)
    expect(unmarkedCircularSites(circular.replace('/>', '\n  variant="plain"\n/>'))).toBe(0)
    expect(unmarkedCircularSites(circular.replace('/>', "\n  variant='plain'\n/>"))).toBe(0)
    // 只有圆形图标才受这条约束：关闭、刷新这类不带的字形可以照常走默认档。
    expect(unmarkedCircularSites('<IconButton ariaLabelKey="x.y" icon={X} resolveText={key} />')).toBe(0)
  })
})
