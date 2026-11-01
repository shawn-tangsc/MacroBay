import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `IconButton` 的读屏名与提示只收 i18n 键，但为了不逼产品绕过组件，类型是开区间 `string`
 * （见 `IconButton.tsx` 里那段说明）。开区间就得有一条守卫替类型把关：
 * **键长什么样**——点分小写，无空白、无中文。写成一个中文句子、或者把已解析好的文案直接
 * 塞进去，读屏会念出键名或者一句脱离语言环境的话，这里当场变红。
 */
const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'platform', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

/** 单元测试里用 `ui.test.*` 这类假键，形状与真键一致，不需要例外。 */
const KEY_SHAPE = /^[a-z][a-z0-9]*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/

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

function offendersIn(file: string): Offender[] {
  const text = readFileSync(file, 'utf8')
  const offenders: Offender[] = []
  // 只认赋/传字面量：`ariaLabelKey: '…'`、`tooltipKey="…"`。变量、常量、函数调用一律跳过。
  const pattern = /(?:ariaLabelKey|tooltipKey)\s*[:=]\s*\{?\s*['"`]([^'"`\n]*)['"`]/g
  for (const match of text.matchAll(pattern)) {
    const value = match[1] ?? ''
    if (KEY_SHAPE.test(value)) continue
    const line = text.slice(0, match.index ?? 0).split('\n').length
    offenders.push({ file, line, prop: match[0].split(/[:=]/)[0]!.trim(), value })
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
    const bad = ["ariaLabelKey: 'Close the panel'", "tooltipKey: '关闭面板'", "ariaLabelKey = 'ui.icon.close '"]
      .map((line) => [...line.matchAll(/(?:ariaLabelKey|tooltipKey)\s*[:=]\s*\{?\s*['"`]([^'"`\n]*)['"`]/g)][0]?.[1] ?? '')
      .filter((value) => !KEY_SHAPE.test(value))

    expect(bad).toHaveLength(3)
  })
})
