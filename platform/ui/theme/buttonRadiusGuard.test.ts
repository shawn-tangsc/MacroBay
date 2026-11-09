import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 按钮五档（界面设计 2026-11-09 第四条选择器守卫，我这边第 5 条）。
 *
 * 两件事：
 * 1. `border-radius: 999px` 是「胶囊」那一档，只许出现在**已登记的胶囊**里（徽标、状态点、
 *    头像、输入框外壳…）。新增一个胶囊必须先登记——否则「按钮」会悄悄长出第五档圆角。
 * 2. **危险色只在 `:hover` 出现即红**：危险动作必须静止可见（红字/红边），靠悬停才变红的按钮，
 *    在键盘与触屏上等于没有提示。允许 `:hover` 里**保持**危险色，但它必须在非悬停规则里已经出现。
 */

const ROOT = process.cwd()
const SCANNED_ROOTS = ['apps', 'products', 'platform']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'release'])
const BASELINE = new Set(
  JSON.parse(readFileSync(resolve(__dirname, 'buttonRadiusBaseline.json'), 'utf8')) as string[]
)
/**
 * 存量「危险色只在 hover」的规则：**只减不增**。这四条在基线里，新增一条即红。
 * 其中两条（`.icon-button--danger…`、`.context-menu …-danger:hover`）其实在非悬停规则里已经给过
 * 危险色，只是选择器形状不同、静态规则匹配不到，所以一并挂在基线里而不是放宽判据。
 */
const HOVER_DANGER_BASELINE = new Set(
  JSON.parse(readFileSync(resolve(__dirname, 'hoverDangerBaseline.json'), 'utf8')) as string[]
)

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) cssFiles(absolute, out)
    else if (name.endsWith('.css') && !name.endsWith('.test.css')) out.push(absolute)
  }
  return out
}

const FILES = SCANNED_ROOTS.flatMap((root) => {
  try {
    return cssFiles(join(ROOT, root))
  } catch {
    return []
  }
})

type Rule = { file: string; selectors: string[]; body: string }

function rules(): Rule[] {
  const out: Rule[] = []
  for (const file of FILES) {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of source.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selectors = (match[1] ?? '').split(',').map((part) => part.trim()).filter(Boolean)
      out.push({ file: relative(ROOT, file).replace(/\\/g, '/'), selectors, body: match[2] ?? '' })
    }
  }
  return out
}

const RULES = rules()
const DANGER = /var\(--danger\)|--danger\b/u

/** 未登记的新胶囊选择器。 */
function newCapsules(): string[] {
  const hits: string[] = []
  for (const rule of RULES) {
    if (!/border-radius:\s*999px/u.test(rule.body)) continue
    for (const selector of rule.selectors) {
      if (BASELINE.has(selector)) continue
      hits.push(`${rule.file} → ${selector}`)
    }
  }
  return hits
}

/** 危险色只出现在 `:hover` 里的规则。 */
function hoverOnlyDanger(): string[] {
  const staticDanger = new Set<string>()
  for (const rule of RULES) {
    if (rule.selectors.some((selector) => selector.includes(':hover'))) continue
    if (!DANGER.test(rule.body)) continue
    for (const selector of rule.selectors) staticDanger.add(selector)
  }
  const hits: string[] = []
  for (const rule of RULES) {
    if (!DANGER.test(rule.body)) continue
    for (const selector of rule.selectors) {
      if (!selector.includes(':hover')) continue
      const base = selector.replace(/:hover[^\s]*/gu, '').trim()
      if (staticDanger.has(base)) continue
      const key = `${rule.file} → ${selector}`
      if (HOVER_DANGER_BASELINE.has(key)) continue
      hits.push(key)
    }
  }
  return hits
}

describe('button geometry and the danger colour', () => {
  it('keeps 999px radius on registered capsules only', () => {
    expect(newCapsules()).toEqual([])
  })

  it('never adds a rule where the danger colour only appears on hover', () => {
    expect(hoverOnlyDanger()).toEqual([])
  })

  it('is a real guard: the baselines are finite and the detectors fire', () => {
    expect(BASELINE.has('.brand-new-capsule')).toBe(false)
    expect(HOVER_DANGER_BASELINE.size).toBe(4)
    expect(DANGER.test('color: var(--danger)')).toBe(true)
  })
})
