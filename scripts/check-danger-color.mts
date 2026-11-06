#!/usr/bin/env tsx
/**
 * 状态色前景门禁：`color: var(--danger)` 不许在基线之外新增。
 *
 * 基线在 `scripts/danger-color-baseline.json`，只减不增。修掉一处违规时，同一个提交里删掉对应条目；
 * 想新增一处，必须先说明为什么那句话非用 --danger 不可（深色下它是 3.25–3.94，正文门槛 4.5）。
 *
 * 不做用途分类：分类是基线里的另一列，人工填；闸门只管「有没有在基线之外多出来」。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import {
  compareWithBaseline,
  formatViolations,
  scanDangerColor,
  type DangerColorUse
} from '../tools/danger-color-guard/dangerColorGuard'

const ROOT = resolve(process.cwd())
const BASELINE_PATH = join(ROOT, 'scripts', 'danger-color-baseline.json')
const SCAN_ROOTS = ['apps', 'platform', 'products']

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
    // 目录不存在时跳过：三个根里少一个不该让门禁崩掉。
  }
}

const uses: DangerColorUse[] = []
for (const file of files) {
  // 基线键一律正斜杠：见 check-file-size / check-hex-color 同一条注释。
  uses.push(...scanDangerColor(readFileSync(file, 'utf8'), relative(ROOT, file).split(sep).join('/')))
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>
const violations = compareWithBaseline(uses, baseline)

if (violations.length > 0) {
  console.error('状态色前景门禁未通过（基线只减不增）：')
  console.error(formatViolations(violations))
  process.exit(1)
}

console.log(`状态色前景门禁通过：${files.length} 个 CSS 文件，${uses.length} 处 color: var(--danger)，与基线一致。`)
