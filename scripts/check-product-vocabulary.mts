#!/usr/bin/env tsx
/**
 * 平台侧不许出现产品业务概念（用户 2026-11-08 拍死，契约 §七）。
 *
 * 判据：删掉 `products/` 任一包，平台照样启动，**平台目录里一个产品词不剩**。
 * 这条门禁只管「别再多出来」——现存欠账记在 `scripts/product-vocabulary-baseline.json`，
 * **只许减少**：新文件命中即红，清单里已经清干净的文件也要当场删掉（否则会报过期）。
 *
 * 为什么不一次清完：78 个文件里有 60 多个是平台自己的测试夹具，改它们不影响任何读者，
 * 但一次全改会让这一轮的验证不可读。分批清、清单只减，是可检查的收敛方式；
 * 「数行数」那种验收不算数（契约 §七 第 4 条）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = resolve(ROOT, 'scripts/product-vocabulary-baseline.json')
/** 产品词：事件 id、产品包名、模块名、资产缩写。 */
export const PRODUCT_VOCABULARY = /market-intelligence|@products\/|briefing|sentiment|\bOI\b|\bETF\b\//u
const SCAN_ROOTS = ['platform', 'apps/desktop-shell']
const SCAN_GLOBS = ['--include=*.ts', '--include=*.tsx', '--include=*.mts', '--include=*.css', '--include=*.json', '--include=*.md']

export function isProductVocabulary(line: string): boolean {
  return /market-intelligence|@products\/|\bbriefing\b|\bsentiment\b|\bOI\b|\bETF\b/u.test(line)
}

/** 命中产品词的文件（仓库相对路径）。生产与测试都算：平台里不该出现产品词的任何一处。 */
export function filesWithProductVocabulary(): string[] {
  try {
    const out = execFileSync('grep', ['-rEl', ...SCAN_GLOBS, 'market-intelligence|@products/|briefing|sentiment|\\bOI\\b|\\bETF\\b', ...SCAN_ROOTS], {
      cwd: ROOT,
      encoding: 'utf8'
    })
    return out.split('\n').map((line) => line.trim()).filter((line) => line !== '').sort()
  } catch (error) {
    // grep 的退出码 1 = 没有命中，是好事。
    if ((error as { status?: number }).status === 1) return []
    throw error
  }
}

export function compareWithBaseline(current: readonly string[], baseline: readonly string[]): {
  added: string[]
  stale: string[]
} {
  const known = new Set(baseline)
  const present = new Set(current)
  return {
    added: current.filter((file) => !known.has(file)),
    stale: baseline.filter((file) => !present.has(file))
  }
}

function main(): void {
  const baseline = (JSON.parse(readFileSync(BASELINE, 'utf8')) as { files: string[] }).files
  const current = filesWithProductVocabulary()
  const { added, stale } = compareWithBaseline(current, baseline)
  if (added.length === 0 && stale.length === 0) {
    console.log(`product-vocabulary: ${current.length} 个文件仍有欠账（清单一致），没有新增。`)
    return
  }
  if (added.length > 0) {
    console.error(`product-vocabulary: ${added.length} 个文件**新**把产品概念写进了平台侧：`)
    for (const file of added) console.error(`  ${file}`)
  }
  if (stale.length > 0) {
    console.error(`product-vocabulary: ${stale.length} 个文件已经从清单里清干净，请把它们从基线删掉（否则清单只增不减）：`)
    for (const file of stale) console.error(`  ${file}`)
  }
  process.exit(1)
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main()
}
