#!/usr/bin/env tsx
/**
 * 前景色字面量门禁：`color: #hex` 不许在基线之外新增。
 *
 * 与 `check-danger-color` 同一套机制（基线只减不增、双向集合），只是换了一种写法：
 * 门禁只覆盖一种写法时，另一种写法就是静默通道——`#dc2626` 就是这么躲过 `--danger` 门禁的。
 *
 * **范围**：`apps` / `platform` / `products` 下全部 `.css`，排除导出件。
 * 导出件（`dailyBriefingShareCard.css`）是导出成 PNG 的纸面配色，按设计必须与主题解耦，
 * 不是待修项；把它算进基线，等于让一半条目永远减不掉。将来出现第二个导出件，加一行白名单即可。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import {
  compareWithBaseline,
  formatViolations,
  scanHexColorLiteral,
  type DangerColorUse
} from '../tools/danger-color-guard/dangerColorGuard'

const ROOT = resolve(process.cwd())
const BASELINE_PATH = join(ROOT, 'scripts', 'hex-color-baseline.json')
const SCAN_ROOTS = ['apps', 'platform', 'products']
const EXCLUDED_FILES = new Set(['products/market-intelligence/desktop/pages/intelligence/dailyBriefingShareCard.css'])

function collectCssFiles(directory: string, out: string[]): void {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(directory, name)
    const stat = statSync(full)
    if (stat.isDirectory()) collectCssFiles(full, out)
    else if (name.endsWith('.css')) out.push(full)
  }
}

const files: string[] = []
for (const root of SCAN_ROOTS) {
  try {
    collectCssFiles(join(ROOT, root), files)
  } catch {
    // 根不存在时跳过，不让门禁因为少一个目录崩掉。
  }
}

const uses: DangerColorUse[] = []
for (const file of files) {
  // 基线键一律正斜杠：Windows 的 relative() 给反斜杠，直接查表会把每个基线文件当成新违规。
  const path = relative(ROOT, file).split(sep).join('/')
  if (EXCLUDED_FILES.has(path)) continue
  uses.push(...scanHexColorLiteral(readFileSync(file, 'utf8'), path))
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>
const violations = compareWithBaseline(uses, baseline)

if (violations.length > 0) {
  console.error('前景色字面量门禁未通过（基线只减不增）：')
  console.error(formatViolations(violations))
  process.exit(1)
}

console.log(`前景色字面量门禁通过：${files.length - EXCLUDED_FILES.size} 个 CSS 文件，${uses.length} 处 color: #hex，与基线一致。`)
