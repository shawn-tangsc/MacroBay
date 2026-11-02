import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 「禁用」不许用透明度把字压暗。
 *
 * 今天已经在三处量到同一个缺陷（`Tabs`、`Segmented`、`FilterChip`）：`opacity: .4/.5` 叠在文字色上，
 * 合成后是 **2.0–2.4:1**（深色）／**1.7–2.0:1**（浅色）——低于 3:1。它传达的是「这字很难认」，
 * 而读者要读到的是「这项不可用」。**接近但读不清，比明确的灰更难用**：读者会以为是自己看错了。
 *
 * 判据：`platform/ui` 下的样式表里，带 `:disabled` 的规则体出现 `opacity < 1` 即红。
 * 例外只放「被压暗的是字形而不是文字」的站点，并且必须写明理由；清单只减不增。
 */
const ROOT = resolve(__dirname, '../../..')
const SCANNED = resolve(__dirname)
const DEBT_FILE = resolve(ROOT, 'scripts/migration-debt/disabled-opacity.json')

function readDebt(): ReadonlyMap<string, string> {
  const parsed = JSON.parse(readFileSync(DEBT_FILE, 'utf8')) as { entries?: Record<string, string> }
  const entries = parsed.entries ?? {}
  return new Map(Object.entries(entries))
}

function cssFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...cssFiles(join(dir, entry.name)))
      continue
    }
    if (/\.css$/u.test(entry.name)) found.push(join(dir, entry.name))
  }
  return found
}

/** 去掉注释：本仓库注释里会写 `opacity: .5` 当反例，不能让它自己变红。 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '')
}

/** 取所有 `:disabled` 选择器的规则体。 */
export function disabledRules(css: string): string[] {
  const clean = withoutComments(css)
  const rules: string[] = []
  for (const match of clean.matchAll(/([^{}]+)\{([^}]*)\}/gu)) {
    const [, selector, body] = match
    if (/:disabled|\[disabled\]/u.test(selector ?? '')) rules.push(body ?? '')
  }
  return rules
}

/** 规则体里是否有「把不透明度调到 1 以下」的声明。 */
export function dimsWithOpacity(body: string): boolean {
  for (const match of body.matchAll(/opacity\s*:\s*([0-9.]+)/gu)) {
    if (Number(match[1]) < 1) return true
  }
  return false
}

const FILES = cssFiles(SCANNED)
const DEBT = readDebt()

describe('disabled states', () => {
  it('never dims a disabled control with opacity, and nothing else', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      const key = relative(ROOT, file).replace(/\\/gu, '/')
      if (DEBT.has(key)) continue
      if (disabledRules(readFileSync(file, 'utf8')).some(dimsWithOpacity)) offenders.push(key)
    }
    expect(offenders).toEqual([])
  })

  it('keeps the exemptions honest: each must still dim something, and must give a reason', () => {
    for (const [file, reason] of DEBT) {
      // 过期豁免和过期欠账是同一种东西：文件改了、规则没了，这行就是在替一个结束的状态作证。
      expect(disabledRules(readFileSync(join(ROOT, file), 'utf8')).some(dimsWithOpacity), `${file} no longer dims`).toBe(true)
      expect(reason.length).toBeGreaterThan(20)
    }
  })

  it('catches both shapes, so the guard cannot pass vacuously', () => {
    expect(dimsWithOpacity('opacity: 0.5;')).toBe(true)
    expect(dimsWithOpacity('opacity: 1;')).toBe(false)
    expect(dimsWithOpacity('opacity: 1; color: var(--muted);')).toBe(false)
    expect(disabledRules('.x:disabled { opacity: .4 }')).toHaveLength(1)
    // 注释里的反例不算违规，否则这条守卫会被自己的说明文字绊倒。
    expect(disabledRules('/* .x:disabled { opacity: .4 } */ .y { color: red }')).toHaveLength(0)
  })
})
