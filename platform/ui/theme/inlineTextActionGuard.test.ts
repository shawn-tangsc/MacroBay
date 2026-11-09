import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 句子里的行内动作不许长成按钮（界面设计 2026-11-09 第三条选择器守卫）。
 *
 * 判据：CSS 里以 `p button` / `small button` / `span > button` 这类「句子内的按钮」为目标的规则，
 * **设了 `border` 或 `background` 即红**——那等于把一句话拆成两个并列控件，读者读到一半被一个盒子打断。
 * 行内动作的正确形态是 `.text-action`（带下划线、只取 `--accent`、焦点环统一）。
 *
 * 排除：`IconButton`（图标按钮有自己的盒子）与表格内的按钮（表格单元格里的动作是独立控件）。
 */

const ROOT = process.cwd()
const SCANNED_ROOTS = ['apps', 'products', 'platform']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'release'])

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

/** 选择器形如「句子内的按钮」，且不属于排除项。 */
function isInlineButtonSelector(selector: string): boolean {
  const normalized = selector.trim()
  if (/icon-button|filter-chip|status-pill/.test(normalized)) return false
  // 表格内的按钮是独立控件：选择器里出现 table/tbody/td/th 就不算「句子里」。
  if (/\b(table|tbody|thead|tr|td|th)\b/.test(normalized)) return false
  return /(^|[\s,>])(p|small|span)\s*(>|\s)\s*button\b/.test(normalized)
}

function offenders(): string[] {
  const hits: string[] = []
  for (const file of FILES) {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = /([^{}]+)\{([^}]*)\}/g
    let match: RegExpExecArray | null
    while ((match = rule.exec(source)) !== null) {
      const selector = match[1] ?? ''
      const body = match[2] ?? ''
      if (!isInlineButtonSelector(selector)) continue
      if (/(^|;)\s*(border|border-top|border-right|border-bottom|border-left|border-color|background|background-color)\s*:/u.test(body)) {
        hits.push(`${relative(ROOT, file).replace(/\\/g, '/')} → ${selector.trim()}`)
      }
    }
  }
  return hits
}

describe('inline text actions stay text, not boxes', () => {
  it('has no sentence-level button rule with a border or a background', () => {
    expect(offenders()).toEqual([])
  })

  it('is a real guard: a bordered sentence button is reported', () => {
    const sample = 'p button { border: 1px solid var(--border); background: var(--surface); }'
    const selector = sample.slice(0, sample.indexOf('{'))
    expect(isInlineButtonSelector(selector)).toBe(true)
    // 表格里的同一形状不算：它是独立控件。
    expect(isInlineButtonSelector('td button { border: 0; }')).toBe(false)
    // 图标按钮也不算。
    expect(isInlineButtonSelector('.icon-button { border: 0; }')).toBe(false)
  })
})
