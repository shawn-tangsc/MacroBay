#!/usr/bin/env node
/**
 * 文件体积门禁：只减不增。
 *
 * 两条规则，缺一不可：
 *   1. 新增文件不得超过 500 行（含）——不是「建议」，是失败；
 *   2. 基线里已有的文件，行数不得增加——超长文件只能被拆小，不能被写大。
 *
 * 基线是 `scripts/file-size-baseline.json`，只减不增。要增加某个基线文件的行数，
 * 唯一正当做法是**先抽离再补功能**；确实无法抽离时，改基线必须出现在同一个提交里，
 * 让评审看得见「这个文件又长了一点」。
 *
 * 扫描范围与非测试、非 i18n 的源码一致；数据型注册表本来就允许更长，但它们已经在基线里，
 * 同样只减不增。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const BASELINE_PATH = process.env.FILE_SIZE_BASELINE
  ? resolve(process.env.FILE_SIZE_BASELINE)
  : join(ROOT, 'scripts', 'file-size-baseline.json')
const SCAN_ROOTS = ['platform', 'products', 'apps/desktop-shell/src']
const LIMIT = 500

function isSource(name) {
  return (name.endsWith('.ts') || name.endsWith('.tsx')) &&
    !name.includes('.test.') && !name.includes('.spec.')
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) { walk(full, out); continue }
    if (!isSource(entry)) continue
    out.push(full)
  }
  return out
}

function countLines(path) {
  const content = readFileSync(path, 'utf8')
  return content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const failures = []

for (const root of SCAN_ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const rel = relative(ROOT, file)
    if (rel.includes('/i18n/')) continue
    const lines = countLines(file)
    const known = baseline[rel]
    if (known === undefined) {
      if (lines > LIMIT) {
        failures.push(`${rel}: ${lines} 行 —— 新文件不得超过 ${LIMIT} 行`)
      }
      continue
    }
    if (lines > known) {
      failures.push(`${rel}: ${known} → ${lines} 行 —— 基线文件只能变小；先抽离，不要加长`)
    }
  }
}

if (failures.length > 0) {
  console.error('文件体积门禁未通过（只减不增）：')
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('\n处理方式：抽离出一个聚焦模块；若确实必须增长，在同一提交里更新 scripts/file-size-baseline.json，让评审看见。')
  process.exit(1)
}

const stale = Object.keys(baseline)
const oversizeKnown = Object.values(baseline).filter((n) => n > LIMIT).length
console.log(`文件体积门禁通过：${stale.length} 个基线文件中 ${oversizeKnown} 个超过 ${LIMIT} 行，本批没有增长；新增文件均不超过 ${LIMIT} 行。`)
