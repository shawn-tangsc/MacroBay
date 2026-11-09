#!/usr/bin/env tsx
/**
 * 字重门禁：只有 400 / 500 / 600 / 650 四档，**只挡新增**。
 *
 * 为什么是「只挡新增」而不是全仓红一次：用户 2026-11-09 第三次追问字号之后才查出来，规范里写着
 * 四档、页面上却有一堆 550 / 620 / 640 / 680 / 700 / 720 / 740 / 750 / 760 / 780 / 800——那是
 * 「再粗一点」一点点拧出来的，不是档位。存量记在 `scripts/font-weight-baseline.json`，**只许减少**：
 * 新文件出现非档位值即红；清单里的文件并掉一条就要把基线改小，否则报过期。
 *
 * 挡什么：`.css` 的 `font-weight:` 与 `.ts/.tsx` 的 `fontWeight:` 里**写死的**非档位值
 * （含 `bold`，它就是 700）。两种写法都算，只扫 CSS 会让内联那几行成为静默通道。
 * 不挡什么：`var(--weight-x)` / `values.bold` 这类间接值；`font:` 简写里的字重；`*.test.*` 里的
 * 断言字符串（`toContain('font-weight: 700')` 是文本，不是声明——按裸 grep 数它，会多出一处，
 * 而且每改一次断言都要动基线）。
 *
 * 复算：`pnpm exec tsx scripts/check-font-weight.mts`。基线就是这个脚本数出来的数；
 * 换一种数法（裸 grep）会得到 81，多出来的那一条在 `MarketCalendarEvents.test.tsx:165` 的断言字符串里。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  REPOSITORY_ROOT,
  declarationsOf,
  inlineStyleValuesOf,
  sourceFilesUnder
} from './ui-scan/cssDeclarations'

const BASELINE_PATH = join(REPOSITORY_ROOT, 'scripts', 'font-weight-baseline.json')
const SCAN_ROOTS = ['apps', 'platform', 'products'] as const
/** 四档 + 继承关键字。`bold` 不在里面：它就是 700。 */
const ALLOWED = new Set(['400', '500', '600', '650', 'normal', 'inherit', 'initial', 'unset', 'revert'])

type Baseline = Readonly<{ files: Readonly<Record<string, number>>; total: number }>
type Violation = Readonly<{ file: string; line: number; value: string }>

/** 一个声明值算不算非档位：字面数字不在四档内即算；`var()`/变量/已知关键字放行。 */
export function isOffTier(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('var(') || normalized.startsWith('calc(')) return false
  return !ALLOWED.has(normalized)
}

function collect(): Map<string, Violation[]> {
  const byFile = new Map<string, Violation[]>()
  for (const file of sourceFilesUnder([...SCAN_ROOTS], ['.css', '.ts', '.tsx'])) {
    const declarations = file.endsWith('.css')
      ? declarationsOf(file, 'font-weight')
      : inlineStyleValuesOf(file, 'fontWeight')
    const hits = declarations
      .filter((declaration) => isOffTier(declaration.value))
      .map((declaration) => ({ file, line: declaration.line, value: declaration.value }))
    if (hits.length > 0) byFile.set(file, hits)
  }
  return byFile
}

function main(): number {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline
  const current = collect()
  const problems: string[] = []

  for (const [file, hits] of current) {
    const allowance = baseline.files[file] ?? 0
    if (hits.length > allowance) {
      problems.push(`${file}: 基线 ${allowance} 处，现在 ${hits.length} 处（新增 ${hits.length - allowance}）`)
      for (const hit of hits.slice(allowance)) problems.push(`    ${file}:${hit.line}  font-weight: ${hit.value}`)
    } else if (hits.length < allowance) {
      problems.push(`${file}: 基线 ${allowance} 处，现在 ${hits.length} 处 —— 已并掉 ${allowance - hits.length} 处，把基线改小（否则会一直过期）`)
    }
  }
  for (const [file, allowance] of Object.entries(baseline.files)) {
    if (!current.has(file)) problems.push(`${file}: 基线还记着 ${allowance} 处，代码里已经一处都没有了，删掉这条`)
  }
  const total = [...current.values()].reduce((sum, hits) => sum + hits.length, 0)
  if (total !== baseline.total) problems.push(`合计：基线 ${baseline.total} 处，现在 ${total} 处`)

  if (problems.length === 0) {
    console.log(`字重门禁通过：${total} 处历史欠账（清单一致），没有新增。`)
    return 0
  }
  console.error('字重门禁未通过（只挡新增；档位只有 400 / 500 / 600 / 650）：')
  for (const line of problems) console.error(`  ${line}`)
  console.error('处理方式：新增处并到四档之一；并掉存量就把 scripts/font-weight-baseline.json 改小。不许放宽基线。')
  return 1
}

process.exit(main())
