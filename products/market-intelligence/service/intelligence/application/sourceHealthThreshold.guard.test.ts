import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SOURCE_HEALTH_THRESHOLD_DEBT } from './sourceHealthThresholdDebt'

/**
 * 阈值常量的出现位置守卫（C6 判据 1）。
 *
 * 允许出现的地方只有两处：
 * - 派生处 `sourceProjection.ts`（常量定义与唯一一次使用）；
 * - 登记文件里的欠账（`ProviderDetail.tsx`，配置线迁移完删登记项）。
 *
 * 其余任何产品/平台/壳层源文件里出现它，都说明有人又自己判了一遍健康——那正是「同一份数据
 * 两处说不一样」的来源。测试文件不扫：断言里的常量名是读取而不是判断。
 */
const REPO_ROOT = join(__dirname, '../../../../..')
const SCAN_ROOTS = ['products', 'platform', 'apps']
const DEFINITION_FILE = 'products/market-intelligence/service/intelligence/application/sourceProjection.ts'
const CONSTANT = 'SOURCE_REPEATED_FAILURE_THRESHOLD'
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'build', '.cache', 'coverage'])

function sourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry)) continue
    const absolute = join(directory, entry)
    if (statSync(absolute).isDirectory()) { found.push(...sourceFiles(absolute)); continue }
    if (!/\.(?:ts|tsx)$/.test(entry)) continue
    if (/\.test\.(?:ts|tsx)$/.test(entry)) continue
    found.push(relative(REPO_ROOT, absolute).split(sep).join('/'))
  }
  return found
}

function filesContainingConstant(): string[] {
  return SCAN_ROOTS
    .flatMap((root) => sourceFiles(join(REPO_ROOT, root)))
    .filter((file) => readFileSync(join(REPO_ROOT, file), 'utf8').includes(CONSTANT))
    .sort()
}

describe('the repeated-failure threshold lives in one place', () => {
  it('appears only in the derivation and in the registered debt', () => {
    const allowed = new Set([DEFINITION_FILE, ...SOURCE_HEALTH_THRESHOLD_DEBT])
    expect(filesContainingConstant().filter((file) => !allowed.has(file))).toEqual([])
  })

  it('keeps every registered debt entry alive, so the registry cannot rot into an excuse', () => {
    const holders = new Set(filesContainingConstant())
    expect(SOURCE_HEALTH_THRESHOLD_DEBT.filter((file) => !holders.has(file))).toEqual([])
  })
})
