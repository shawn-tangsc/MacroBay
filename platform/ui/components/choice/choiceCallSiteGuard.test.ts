import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `Tabs` / `Segmented` 的调用点守卫（契约 §7）。
 *
 * **一组互斥选项只有一份实现。** `apps/` 与 `products/` 里不许再 `import { Tabs | Segmented } from 'antd'`：
 * 直接引 antd 的那批是迁移欠账，记在 `scripts/migration-debt/tabs-segmented.json` 里，**只减不增**——
 * 切一处必须同笔删掉那一行，否则「清单在缩小」那条红。一份只会变长的豁免，第二天就是永久豁免。
 *
 * **清单为什么不在这个文件里**（2026-11-02，架构师裁定）：一类互斥选项的欠账是**账**，不是组件实现。
 * 它原来写成这里的常量，于是「迁完一处、同笔划掉那一行」这个被要求的动作必然触碰组件目录，与
 * 「`platform/ui/components/**` 只有组件线能写」直接冲突——当晚 4 笔正经的迁移收尾因此被判违规。
 * 现在清单住在 `scripts/`（被 git 追踪、不在组件目录），调用方迁完改 JSON、不碰组件。
 *
 * **不要搬回 `docs-private`**：那个目录被 gitignore，`git archive`、CI、任何新 clone 都没有它；
 * 守卫读它只能 `existsSync` 跳过（那条红静默失效）或 ENOENT（快照里必红）。
 *
 * 键形状那条在 `choiceKeyGuard.test.ts`，两者分工：那份管**传进来的字**，这份管**从哪儿来的组件**。
 */

const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

/** 迁移欠账清单的位置：被 git 追踪、不在组件目录。 */
const DEBT_FILE = resolve(ROOT, 'scripts/migration-debt/tabs-segmented.json')

/**
 * 读欠账清单。**读不到就抛，不吞**——兜底静默降级会让这条红在别处（快照、CI）无声失效，
 * 而那正是它存在的理由。清单按文件记，不按行号：行号会随迁移漂。
 */
function readDebt(): ReadonlySet<string> {
  const parsed = JSON.parse(readFileSync(DEBT_FILE, 'utf8')) as { entries?: Record<string, number> }
  if (parsed.entries === undefined) throw new Error(`${DEBT_FILE} has no "entries"`)
  return new Set(Object.keys(parsed.entries))
}

const ANTD_BASELINE: ReadonlySet<string> = readDebt()

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
