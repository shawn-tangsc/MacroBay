import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  compareWithBaseline,
  scanDangerColor,
  scanHexColorLiteral,
  type DangerColorUse
} from './dangerColorGuard'

/**
 * 颜色基线必须仍然对应**真实存在的规则**。
 *
 * 门禁本身已经会报 `stale`，但它只在 `pnpm verify` 的第三、四步报——而它上一次真正报的时候，
 * 是「换掉状态词、删了 `.is-degraded` 规则、忘了删基线行」，两个人先怀疑代码、再怀疑门禁，
 * 花了比删除本身更久的时间。这条测试把同一个判据搬进 `pnpm test`：**规则没了、基线还在**，
 * 测试阶段就红，不必等到验证第几步。
 *
 * 两份基线（`hex-color` / `danger-color`）共用一份判据（`compareWithBaseline`），所以一条测试
 * 覆盖两条门禁；**反向验证**也在这里：拿一份「规则已删、基线仍在」的合成输入，必须报 `stale`。
 */

const ROOT = resolve(__dirname, '../..')
const SCAN_ROOTS = ['apps', 'platform', 'products']
/** 导出件是纸面配色，按设计不跟随主题；门禁把它排除，这里也必须排除，否则会收到一条假 red。 */
const EXPORTED_FILE = 'products/market-intelligence/desktop/pages/intelligence/dailyBriefingShareCard.css'

function collectCssFiles(directory: string, out: string[]): void {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(directory, name)
    if (statSync(full).isDirectory()) collectCssFiles(full, out)
    else if (name.endsWith('.css')) out.push(full)
  }
}

function scannedFiles(): string[] {
  const files: string[] = []
  for (const root of SCAN_ROOTS) {
    try {
      collectCssFiles(join(ROOT, root), files)
    } catch {
      // 少一个根不影响判据：扫描结果只用于「基线条目还能不能对应到规则」。
    }
  }
  return files
}

const baseline = (name: string): Record<string, number> =>
  JSON.parse(readFileSync(join(ROOT, 'scripts', name), 'utf8')) as Record<string, number>

const files = scannedFiles()

function uses(scan: (css: string, file: string) => DangerColorUse[], skipExported: boolean): DangerColorUse[] {
  const found: DangerColorUse[] = []
  for (const file of files) {
    // 基线键一律正斜杠：Windows 的 relative() 给反斜杠，直接当键查表会把每条基线都判成失效。
    const path = relative(ROOT, file).split(sep).join('/')
    if (skipExported && path === EXPORTED_FILE) continue
    found.push(...scan(readFileSync(file, 'utf8'), path))
  }
  return found
}

describe('colour baselines still match the code', () => {
  it('has no danger-colour baseline entry whose rule is gone', () => {
    const stale = compareWithBaseline(uses(scanDangerColor, false), baseline('danger-color-baseline.json')).filter(
      (violation) => violation.kind === 'stale'
    )
    // 规则删了、基线没删：门禁第 4 步会红，这里先红，省掉一次「先怀疑代码」的排查。
    expect(stale).toEqual([])
  })

  it('has no hex-literal baseline entry whose rule is gone', () => {
    const stale = compareWithBaseline(uses(scanHexColorLiteral, true), baseline('hex-color-baseline.json')).filter(
      (violation) => violation.kind === 'stale'
    )
    expect(stale).toEqual([])
  })

  it('fails that same judgement when a rule is deleted but its baseline row is not', () => {
    // 反向验证：把一条规则拿掉，基线仍写着它——判据必须报 stale，否则上面两条就是永远绿的空断言。
    const before = '.card { color: #dc2626; }'
    const after = '.card { color: var(--text); }'
    const baselineWithCard = { 'sample.css :: .card': 1 }

    expect(compareWithBaseline(scanHexColorLiteral(before, 'sample.css'), baselineWithCard)).toEqual([])
    expect(compareWithBaseline(scanHexColorLiteral(after, 'sample.css'), baselineWithCard)).toEqual([
      { kind: 'stale', file: 'sample.css', selector: '.card' }
    ])
  })
})
