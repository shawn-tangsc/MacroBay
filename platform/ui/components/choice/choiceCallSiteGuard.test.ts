import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `Tabs` / `Segmented` 的调用点守卫（契约 §7）。
 *
 * **一组互斥选项只有一份实现。** `apps/` 与 `products/` 里不许再 `import { Tabs | Segmented } from 'antd'`：
 * 直接引 antd 的那批是迁移欠账，记在下面的清单里，**只减不增**——切一处必须同笔删掉那一行，
 * 否则「清单在缩小」那条红。一份只会变长的豁免，第二天就是永久豁免。
 *
 * 键形状那条在 `choiceKeyGuard.test.ts`，两者分工：那份管**传进来的字**，这份管**从哪儿来的组件**。
 */

const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

/** antd `Tabs` / `Segmented` 的既有调用点（迁移欠账，按文件记，不按行号——行号会随迁移漂）。 */
const ANTD_BASELINE: ReadonlySet<string> = new Set([
  'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx',
  'apps/desktop-shell/src/renderer/src/shell/agents/editor/sections/ToolsSection.tsx',
  'apps/desktop-shell/src/renderer/src/shell/workspace/WorkspacePanelFrame.tsx',
  'products/market-intelligence/desktop/features/industry/news-sentiment/NewsSentimentDrawer.tsx',
  'products/market-intelligence/desktop/pages/intelligence/MarketAnalysisDashboardLayout.tsx',
  'products/market-intelligence/desktop/settings/intelligence-sources/SettingsSourceTree.tsx'
])

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

const FILES = SCANNED_ROOTS.flatMap((root) => {
  try {
    return sourceFiles(join(ROOT, root))
  } catch {
    return []
  }
})

/** 从 `import … from 'antd'` 的具名列表里取出 `Tabs` / `Segmented`（`as X` 也算）。 */
export function importsAntdChoice(text: string): boolean {
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'antd'/g)) {
    const names = (match[1] ?? '').split(',')
    if (names.some((name) => /^\s*(Tabs|Segmented)(\s+as\s+\w+)?\s*$/.test(name))) return true
  }
  return false
}

function relativeToRoot(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/')
}

describe('Tabs / Segmented call sites', () => {
  it('keeps the hand-written antd tabs and segments on the shrinking list, and nothing else', () => {
    const offenders = FILES.map(relativeToRoot).filter(
      (file) => importsAntdChoice(readFileSync(join(ROOT, file), 'utf8')) && !ANTD_BASELINE.has(file)
    )

    // 要页签用 `@platform/ui/components/tabs`，要一组取值用 `@platform/ui/components/segmented`。
    expect(offenders).toEqual([])
  })

  it('shrinks the list: a migrated file must have its line deleted', () => {
    const stale = [...ANTD_BASELINE].filter((file) => {
      try {
        return !importsAntdChoice(readFileSync(join(ROOT, file), 'utf8'))
      } catch {
        // 文件没了也算迁移完成：同样必须删掉清单里那一行。
        return true
      }
    })

    expect(stale).toEqual([])
  })

  it('catches each shape, so the guard cannot pass vacuously', () => {
    expect(importsAntdChoice("import { Tabs } from 'antd'")).toBe(true)
    expect(importsAntdChoice("import { Input, Segmented, Select } from 'antd'")).toBe(true)
    expect(importsAntdChoice("import { Segmented as S } from 'antd'")).toBe(true)
    expect(importsAntdChoice("import { Button } from 'antd'")).toBe(false)
    // 平台组件不算违规：这条守卫守的是「从哪儿来」，不是「叫什么」。
    expect(importsAntdChoice("import { Tabs } from '@platform/ui/components/tabs'")).toBe(false)
  })
})
