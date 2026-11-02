import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `Modal` 的调用点守卫。
 *
 * **模态弹窗只有一份实现。** `apps/` 与 `products/` 里不许再 `import { Modal } from 'antd'`：
 * 现存 1 处是迁移欠账，记在下面的清单里，**只减不增**——切一处必须同笔删掉那一行，
 * 否则「清单在缩小」那条红。一份只会变长的豁免，第二天就是永久豁免。
 *
 * 为什么这条值得守：直接引 antd 的模态弹窗各有各的宽度数字与层级写法，而档位、居中、层级
 * 正是三处「同名不同值」的高发地（`modal.md` 里那四档就是为了消掉它们）。
 */

const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

/** antd `Modal` 的既有调用点（迁移欠账，按文件记，不按行号——行号会随迁移漂）。 */
const ANTD_BASELINE: ReadonlySet<string> = new Set([
  'products/market-intelligence/desktop/pages/intelligence/MarketAnalysisSettingsDialog.tsx'
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

/** 从 `import … from 'antd'` 的具名列表里取出 `Modal`（`Modal as X` 也算）。 */
export function importsAntdModal(text: string): boolean {
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'antd'/g)) {
    const names = (match[1] ?? '').split(',')
    if (names.some((name) => /^\s*Modal(\s+as\s+\w+)?\s*$/.test(name))) return true
  }
  return false
}

function relativeToRoot(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/')
}

describe('Modal call sites', () => {
  it('keeps the hand-written antd modals on the shrinking list, and nothing else', () => {
    const offenders = FILES.map(relativeToRoot).filter(
      (file) => importsAntdModal(readFileSync(join(ROOT, file), 'utf8')) && !ANTD_BASELINE.has(file)
    )

    // 要弹窗用 `@platform/ui/components/modal`：宽度档位与层级只在组件里定义一次。
    expect(offenders).toEqual([])
  })

  it('shrinks the list: a migrated file must have its line deleted', () => {
    const stale = [...ANTD_BASELINE].filter((file) => {
      try {
        return !importsAntdModal(readFileSync(join(ROOT, file), 'utf8'))
      } catch {
        // 文件没了也算迁移完成：同样必须删掉清单里那一行。
        return true
      }
    })

    expect(stale).toEqual([])
  })

  it('catches each shape, so the guard cannot pass vacuously', () => {
    expect(importsAntdModal("import { Modal } from 'antd'")).toBe(true)
    expect(importsAntdModal("import { Form, Modal, message } from 'antd'")).toBe(true)
    expect(importsAntdModal("import { Modal as M } from 'antd'")).toBe(true)
    expect(importsAntdModal("import { Button } from 'antd'")).toBe(false)
    // 平台组件不算违规：这条守卫守的是「从哪儿来」，不是「叫什么」。
    expect(importsAntdModal("import { Modal } from '@platform/ui/components/modal'")).toBe(false)
  })
})
