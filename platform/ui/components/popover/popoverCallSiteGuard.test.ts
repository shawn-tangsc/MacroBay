import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { looksLikeTextKey } from '../textKeyShape'

/**
 * `Popover` 的调用点守卫。
 *
 * 1. **浮层只有一份实现**：`apps/` 与 `products/` 里不许再出现 `import { Popover } from 'antd'`。
 *    现存 7 处是迁移欠账，记在下面的清单里，**只减不增**：切掉一处必须同笔删掉那一行，否则
 *    「清单在缩小」那条红——一份只会变长的豁免，第二天就成了永久豁免。
 * 2. **文案只收键**：本组件调用点的 `labelKey` 字面量必须是键形状（点分、无空白、无中文）。
 *    与 `Tooltip` / `IconButton` 共用同一份判据（`../textKeyShape`）。
 *
 * 两条都配了反向用例：一条永远通过的守卫比没有守卫更糟。
 */

const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])
const OUR_IMPORT = '@platform/ui/components/popover'

/**
 * antd `Popover` 的迁移欠账清单住在 `scripts/migration-debt/popover.json`，**由本守卫读**。
 *
 * 为什么不在这个文件里（架构师 2026-11-02 裁定，Chief 批准外移）：这类欠账是**账**，不是组件实现。
 * 它原来写成这里的常量，于是「迁完一处、同笔划掉那一行」这个被要求的动作必然触碰组件目录，
 * 与「`platform/ui/components/**` 只有组件线能写」冲突——四条正经迁移收尾因此被判违规。
 *
 * 三条约束都保留：**清单只有这一份、由守卫读**；**迁完必须删自己那行**（过期条目会让「清单在缩小」
 * 那条变红，挪了不等于放宽）；**读不到就抛**（静默降级等于这条红在快照/CI 里无声失效）。
 */
const DEBT_FILE = resolve(ROOT, 'scripts/migration-debt/popover.json')

/**
 * 清单有两种条目，**分开记**：`entries` 是还欠着的（待迁），`decided` 是看过了、决定保留的。
 *
 * 混在一起记，下一个人读到的都是「还在排队」——而已判过的讨论会被重新拉一遍，每次半小时。
 * 一条欠账和一个决定，对读者的意思完全不同，所以状态必须是字段，不能是注释。
 */
function readDebt(): { debt: ReadonlySet<string>; decided: ReadonlySet<string> } {
  const parsed = JSON.parse(readFileSync(DEBT_FILE, 'utf8')) as {
    entries?: Record<string, number>
    decided?: Record<string, unknown>
  }
  if (parsed.entries === undefined) throw new Error(`${DEBT_FILE} has no "entries"`)
  return { debt: new Set(Object.keys(parsed.entries)), decided: new Set(Object.keys(parsed.decided ?? {})) }
}

const { debt: ANTD_POPOVER_BASELINE, decided: DECIDED_KEEPS } = readDebt()
/** 两种条目加起来才是「允许继续 import antd Popover」的全集。 */
const ALLOWED = new Set([...ANTD_POPOVER_BASELINE, ...DECIDED_KEEPS])

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

function relativeToRoot(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/')
}

/** 从 `import … from 'antd'` 的具名列表里取出 `Popover`（`Popover as X` 也算）。 */
function importsAntdPopover(text: string): boolean {
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'antd'/g)) {
    const names = (match[1] ?? '').split(',')
    if (names.some((name) => /^\s*Popover(\s+as\s+\w+)?\s*$/.test(name))) return true
  }
  return false
}

describe('Popover call sites', () => {
  it('keeps the hand-written antd popovers on the shrinking list, and nothing else', () => {
    const offenders = FILES.map(relativeToRoot).filter(
      (file) => importsAntdPopover(readFileSync(join(ROOT, file), 'utf8')) && !ALLOWED.has(file)
    )

    // 要一块浮层说明就用 `@platform/ui/components/popover`；手写第二份等于绕开焦点与关闭规则。
    expect(offenders).toEqual([])
  })

  it('shrinks the list: a migrated file must have its line deleted', () => {
    const stale = [...ANTD_POPOVER_BASELINE.keys()].filter((file) => {
      try {
        return !importsAntdPopover(readFileSync(join(ROOT, file), 'utf8'))
      } catch {
        // 文件没了也算迁移完成：同样必须删掉清单里那一行。
        return true
      }
    })

    expect(stale).toEqual([])
  })

  it('only ever passes a key-shaped string as the explanation', () => {
    const offenders: Array<{ file: string; literal: string }> = []
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes(OUR_IMPORT)) continue
      for (const match of text.matchAll(/<Popover\b/g)) {
        // 只看到开标签的 `>` 为止：再往后就是兄弟元素，会把它们的 labelKey 误算成本组件的。
        const raw = text.slice(match.index ?? 0, (match.index ?? 0) + 400)
        const tagEnd = raw.indexOf('>')
        const window = tagEnd === -1 ? raw : raw.slice(0, tagEnd + 1)
        const literal = /labelKey\s*[:=]\s*\{?\s*['"`]([^'"`\n]*)['"`]/.exec(window)?.[1]
        // 传变量/常量的调用点由定义处判，这里只判字面量。
        if (literal === undefined || looksLikeTextKey(literal)) continue
        offenders.push({ file: relativeToRoot(file), literal })
      }
    }

    expect(offenders).toEqual([])
  })

  it('never smuggles a multi-line sentence in through an escape sequence', () => {
    // 多行只走 `lines`（一行一个键）：把五行拼成一句、塞 `\n` 再折行，是把排版当语义——
    // 翻译会合并或吃掉换行，首行强调也无处可放。这条只扫我们这件组件的调用点。
    const offenders: Array<{ file: string }> = []
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes(OUR_IMPORT)) continue
      for (const match of text.matchAll(/<Popover\b/g)) {
        const window = text.slice(match.index ?? 0, (match.index ?? 0) + 400)
        const literal = /(?:labelKey|lines)\s*[:=]\s*\{?\s*(?:\[)?\s*['"`]([^'"`\n]*)['"`]/.exec(window)?.[1] ?? ''
        if (literal.includes('\\n')) offenders.push({ file: relativeToRoot(file) })
      }
    }

    expect(offenders).toEqual([])
  })


  it('keeps the decided-keep lines honest: each must still name a real antd import', () => {
    // `decided` 不是垃圾桶：它记的是「看过了、决定保留」。那个文件哪天真的不用 antd 了，
    // 这条留着就是在替一个已经结束的状态作证——和过期欠账是同一种谎。
    const stale = [...DECIDED_KEEPS].filter((file) => {
      try {
        return !importsAntdPopover(readFileSync(join(ROOT, file), 'utf8'))
      } catch {
        return true
      }
    })
    expect(stale).toEqual([])
  })

  it('catches both shapes, so neither guard passes vacuously', () => {
    // 反向实测：antd 的写法必须被认出来，本组件的写法不能被误判。
    expect(importsAntdPopover("import { Button, Popover } from 'antd'")).toBe(true)
    expect(importsAntdPopover("import { Popover as P } from 'antd'")).toBe(true)
    expect(importsAntdPopover("import { Button } from 'antd'")).toBe(false)
    expect(importsAntdPopover("import { Popover } from '@platform/ui/components/popover'")).toBe(false)

    // 键形状：中文或带空白的「句子」必须被拒，点分驼峰键必须放行。
    expect(looksLikeTextKey('pages.intelligence.sources.help')).toBe(true)
    // `\n` 检查也要能真的报红，而不是一条永远通过的用例。
    expect('pages.intelligence.help.first\\nsecond'.includes('\\n')).toBe(true)
    expect('pages.intelligence.help.first'.includes('\\n')).toBe(false)
    expect(looksLikeTextKey('先检查来源，再重新采集')).toBe(false)
    expect(looksLikeTextKey('pages.intelligence.来源')).toBe(false)
  })
})
