import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 一颗 ⓘ 只有一个入口：**同一个文件里不许同时用两种**。
 *
 * 仓里现在有三层同一个能力（差别在输入，不在实现）：
 * - `helpTrigger`（平台）：手里只有一句现成文字时用；
 * - `SettingsInfo`（产品）：手里是产品文案键、可多行时用；
 * - `SettingInfoPopover`（壳）：通用设置页那一层。
 *
 * 三层对策没问题（实现将来合成一份），但**一屏混用**就是两种样式各自漂的开始：一处有 Esc 回焦点、
 * 另一处没有，读者看到的是两个 ⓘ。这条只挡混用，不动任何实现。
 */
const ROOTS = ['apps', 'platform', 'products']
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'build', 'coverage', 'release'])
const INFO_SOURCES = ['helpTrigger', 'SettingsInfo', 'SettingInfoPopover'] as const

/** 纯函数：源码 + 文件名 → 命中的组件名（>1 个即违规）。 */
export function infoSourcesIn(source: string): string[] {
  return INFO_SOURCES.filter((name) => new RegExp(`(?:^|[^\\w])${name}(?:[^\\w]|$)`, 'u').test(source))
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) sourceFiles(absolute, out)
    else if ((name.endsWith('.tsx') || name.endsWith('.ts')) && !name.includes('.test.') && !name.endsWith('settingsInfo.tsx') && !name.endsWith('SettingInfoPopover.tsx') && !name.endsWith('helpTrigger.tsx')) out.push(absolute)
  }
  return out
}

describe('one info trigger per file', () => {
  it('flags a file that mixes two of them', () => {
    const mixed = "import { helpTrigger } from '@platform/ui/components/popover'\nimport { SettingsInfo } from '../settingsInfo'\nexport const X = () => <>{helpTrigger({ text: 'a' })}{SettingsInfo}</>"
    expect(infoSourcesIn(mixed)).toEqual(['helpTrigger', 'SettingsInfo'])
  })

  it('accepts a file that uses exactly one', () => {
    expect(infoSourcesIn("import { SettingsInfo } from './settingsInfo'\n<SettingsInfo ariaLabelKey='k' labelKeys={[]} resolveText={() => ''} />")).toEqual(['SettingsInfo'])
  })

  it('keeps the repository free of mixed info triggers', () => {
    const offenders = ROOTS.flatMap((root) => {
      let files: string[] = []
      try { files = sourceFiles(root) } catch { files = [] }
      return files.flatMap((file) => {
        const hits = infoSourcesIn(readFileSync(file, 'utf8'))
        return hits.length > 1 ? [`${relative(process.cwd(), file).split('\\').join('/')}: ${hits.join(' + ')}`] : []
      })
    })
    expect(offenders).toEqual([])
  })
})
