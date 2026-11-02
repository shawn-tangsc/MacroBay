import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { looksLikeTextKey } from '../textKeyShape'

/**
 * `StatusPill` 的三条守卫（架构师 2026-11-02 定的门槛）：
 *
 * 1. **`labelKey` 只收键。** 类型是开区间 `string`（每个站点的状态词不同，平台枚举不出来），
 *    所以「必填且必须是键」只能由守卫保证：值含中文、空白或已解析的句子即红。
 *    与 `IconButton` 的 `iconButtonKeyGuard.test.ts` 同一套判据，两个组件不能两套标准。
 * 2. **这个名字只属于平台组件。** 产品里再出现一个同名 `StatusPill`，读代码的人就分不清
 *    哪个是状态药丸、哪个是别的东西（`TranslationPreferencesSection.tsx` 那个实际是
 *    label+value 的计数徽标，已改名 `CountBadge`）。
 * 3. **迁移欠账清单只减不增**：`apps/` 与 `products/` 里还在 `import { Tag } from 'antd'` 的文件记在
 *    `scripts/migration-debt/status-pill.json`，**双向断言**。
 *
 *    **范围故意窄到 antd `Tag`，不收手写的 chip/pill/badge 类名。** 类名不说明它是不是一个 settled
 *    状态词——同一个 `-badge`/`-pill` 后缀下，既可能是未读数（计数）、也可能是分类标签、也可能是类型
 *    标注。把它们算进机器清单，会一次种进十几条没人能迁的假条目，而**一份永远缩不短的清单会被整条
 *    关掉**。手写那批逐处判，记在人读的映射文档里。
 */
const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'platform', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])
const PLATFORM_ROOT = join(ROOT, 'platform')

/** 迁移欠账清单：被 git 追踪、不在组件目录；读不到就抛，不吞。 */
const DEBT_FILE = resolve(ROOT, 'scripts/migration-debt/status-pill.json')
function readDebt(): ReadonlySet<string> {
  const parsed = JSON.parse(readFileSync(DEBT_FILE, 'utf8')) as { entries?: Record<string, number> }
  if (parsed.entries === undefined) throw new Error(`${DEBT_FILE} has no "entries"`)
  return new Set(Object.keys(parsed.entries))
}
const ANTD_TAG_BASELINE = readDebt()
const DEBT_SCANNED_ROOTS = ['apps', 'products'] as const

/** 从 `import … from 'antd'` 的具名列表里取出 `Tag`（`Tag as X` 也算）。 */
export function importsAntdTag(text: string): boolean {
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'antd'/g)) {
    const names = (match[1] ?? '').split(',')
    if (names.some((name) => /^\s*Tag(\s+as\s+\w+)?\s*$/.test(name))) return true
  }
  return false
}

/**
 * 单元测试里用 `ui.test.*` 这类假键，形状与真键一致，不需要例外。
 * 判据与 `IconButton`、`Tooltip` 共用一份（`../textKeyShape`）：点分、无空白、无中文，允许驼峰。
 */

const LABEL_KEY = /labelKey\s*[:=]\s*\{?\s*['"`]([^'"`\n]*)['"`]/
/** 只在 `<StatusPill …>` 的调用点里看 `labelKey`：全仓别的组件也有叫 `labelKey` 的字段。 */
const CALL_SITE = /<StatusPill\b/g
/** 一个调用点的字面量通常就在附近；取一段窗口比解析 JSX 稳，也不会把别人的字段卷进来。 */
const CALL_WINDOW = 400
const LOCAL_NAME = /\b(?:function|const|class)\s+StatusPill\b/g

type Offender = { file: string; line: number; value: string }

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(join(dir, entry.name)))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (entry.name === 'statusPillKeyGuard.test.ts') continue
    found.push(join(dir, entry.name))
  }
  return found
}

function matches(file: string, pattern: RegExp, pick: (match: RegExpMatchArray) => string): Offender[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(pattern)].map((match) => ({
    file: relative(ROOT, file),
    line: text.slice(0, match.index ?? 0).split('\n').length,
    value: pick(match)
  }))
}

const files = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)))

describe('StatusPill guards', () => {
  it('only ever passes a key-shaped string as the status word', () => {
    // 只看 `<StatusPill …>` 调用点里 `labelKey` 的字面量：变量、常量、函数调用一律跳过。
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return [...text.matchAll(CALL_SITE)].flatMap((call) => {
        const window = text.slice(call.index ?? 0, (call.index ?? 0) + CALL_WINDOW)
        const literal = LABEL_KEY.exec(window)?.[1]
        // 传的是变量/常量时这里看不到值，交给类型与评审；守卫只判字面量。
        if (literal === undefined || looksLikeTextKey(literal)) return []
        const line = text.slice(0, call.index ?? 0).split('\n').length
        return [{ file: relative(ROOT, file), line, value: literal }]
      })
    })

    expect(offenders).toEqual([])
  })

  it('is the only thing named StatusPill in the tree', () => {
    const offenders = files
      .filter((file) => !file.startsWith(PLATFORM_ROOT))
      .flatMap((file) => matches(file, LOCAL_NAME, () => 'StatusPill'))
      // 测试文件里会出现这个名字（守卫自己与平台组件的用例），声明式定义才算撞名。
      .filter((offender) => !/\.test\.tsx?$/.test(offender.file))

    expect(offenders).toEqual([])
  })

  it('keeps the antd tags on the shrinking list, and nothing else', () => {
    const files = DEBT_SCANNED_ROOTS.flatMap((root) => {
      try {
        return sourceFiles(join(ROOT, root))
      } catch {
        return []
      }
    })
    const offenders = files
      .map((file) => relative(ROOT, file).replace(/\\/g, '/'))
      .filter((file) => importsAntdTag(readFileSync(join(ROOT, file), 'utf8')) && !ANTD_TAG_BASELINE.has(file))

    // 状态词用 `@platform/ui/components/status-pill`。
    expect(offenders).toEqual([])
  })

  it('shrinks the list: a migrated file must have its line deleted', () => {
    const stale = [...ANTD_TAG_BASELINE].filter((file) => {
      try {
        return !importsAntdTag(readFileSync(join(ROOT, file), 'utf8'))
      } catch {
        return true
      }
    })

    expect(stale).toEqual([])
  })

  it('catches a sentence, a CJK label and a second declaration, so neither guard passes vacuously', () => {
    const keyOf = (line: string): string => LABEL_KEY.exec(line)?.[1] ?? ''
    const badKeys = ["labelKey: '已启用'", "labelKey: 'status saved'", "labelKey = 'ui.status.saved '"]
      .map(keyOf)
      .filter((value) => !looksLikeTextKey(value))
    const redeclaration = ["function StatusPill(props: X)", 'const StatusPill = 1']
      .map((line) => [...line.matchAll(LOCAL_NAME)].length)
      .reduce((sum, count) => sum + count, 0)

    expect(badKeys).toHaveLength(3)
    expect(redeclaration).toBe(2)
  })
})
