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

/**
 * 迁移欠账清单：`scripts/migration-debt/modal.json`，被 git 追踪、不在组件目录。
 *
 * **不写在这个文件里**：清单写进守卫，就等于「划掉欠账」必须触碰组件目录，而那个目录只有
 * 组件线能写——今天已经因此判过四条正经迁移收尾为违规（`choice` 那份）。账是账、代码是代码。
 *
 * **现在是空清单，不是删掉清单**：空清单让两个方向继续跑——下一处 antd `Modal` 一出现就红，
 * 而不是安静地溜进来。删掉清单，守卫就只剩「读不到就抛」，而那是另一回事。
 */
const DEBT_FILE = resolve(ROOT, 'scripts/migration-debt/modal.json')

/** 读不到就抛，不吞：静默降级会让这条红在快照/CI 里无声失效。 */
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
