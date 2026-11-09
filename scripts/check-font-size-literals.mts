#!/usr/bin/env tsx
/**
 * 字号字面量棘轮：`font-size` 写成 px 的总数**只降不升**。
 *
 * 为什么是「总数只降」而不是「全仓正则判红」：图表轴标签那一档 9px 有合法出处
 * （`--mi-chart-label-size`），一刀切下去会把正确写法判红——门禁第一次误报就会被人加白名单，
 * 加两次就失效。所以这里只数**字面量**：`var(--font-body)` 不算，`calc()` 不算，写成数才叫写死。
 * 基线是脚本自己数出来的数（`scripts/font-size-literal-baseline.json`），任何「顺手调大一点」
 * 都必须先改基线，而那会在评审里被看见。
 *
 * 挡什么：`.css` 里 `font-size: <数>px` 的**声明**，以及 `.ts/.tsx` 里 `fontSize: <数>` 或
 * `fontSize: '<数>px'` 的**内联样式**——只扫 CSS 时，内联那几行就是静默通道。
 * 不挡什么：`var()` / `calc()` / `clamp()` / `em` / `rem` / `%`；`font:` 简写里的字号；
 * SVG 属性 `font-size=`（不是 CSS 声明）。这三类要管时另开判据，不许用这条假装覆盖。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  REPOSITORY_ROOT,
  declarationsOf,
  inlineStyleValuesOf,
  isPixelLiteral,
  sourceFilesUnder
} from './ui-scan/cssDeclarations'

const BASELINE_PATH = join(REPOSITORY_ROOT, 'scripts', 'font-size-literal-baseline.json')
const ROOTS = ['apps', 'platform', 'products'] as const

type Baseline = Readonly<{ total: number; byRoot: Readonly<Record<string, number>> }>

function measure(): { byRoot: Record<string, number>; total: number } {
  const byRoot: Record<string, number> = {}
  for (const root of ROOTS) {
    let count = 0
    for (const file of sourceFilesUnder([root], ['.css', '.ts', '.tsx'])) {
      const values = file.endsWith('.css')
        ? declarationsOf(file, 'font-size').map((declaration) => declaration.value.replace(/!important/iu, '').trim())
        : inlineStyleValuesOf(file, 'fontSize').map((declaration) => declaration.value)
      count += values.filter((value) => isPixelLiteral(value)).length
    }
    byRoot[root] = count
  }
  const total = Object.values(byRoot).reduce((sum, count) => sum + count, 0)
  return { byRoot, total }
}

function main(): number {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline
  const current = measure()
  const problems: string[] = []
  if (current.total > baseline.total) {
    problems.push(`合计：基线 ${baseline.total} 处，现在 ${current.total} 处（新增 ${current.total - baseline.total}）`)
  } else if (current.total < baseline.total) {
    problems.push(`合计：基线 ${baseline.total} 处，现在 ${current.total} 处 —— 已令牌化 ${baseline.total - current.total} 处，把基线改小（否则会一直过期）`)
  }
  for (const root of ROOTS) {
    const before = baseline.byRoot[root] ?? 0
    const now = current.byRoot[root] ?? 0
    if (now !== before) problems.push(`${root}：基线 ${before}，现在 ${now}`)
  }

  if (problems.length === 0) {
    console.log(`字号字面量棘轮通过：${current.total} 处（壳层 ${current.byRoot.apps} / 产品 ${current.byRoot.products} / 平台 ${current.byRoot.platform}），没有新增。`)
    return 0
  }
  console.error('字号字面量棘轮未通过（只降不升；字号请用 --font-body / --font-meta / --font-section）：')
  for (const line of problems) console.error(`  ${line}`)
  console.error('处理方式：换成对应档位的 token；令牌化之后把 scripts/font-size-literal-baseline.json 改小。不许放宽基线。')
  return 1
}

process.exit(main())
