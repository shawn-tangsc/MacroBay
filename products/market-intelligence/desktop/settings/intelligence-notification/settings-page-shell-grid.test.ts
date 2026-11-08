import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 一条约定，也是一条能红的判据：**设置页自己带两列，就必须把壳的列定义覆盖成单列**。
 *
 * 平台设置壳本身是两列（318px + 1fr）。页面如果再自带「列表 | 详情」，整页就会被塞进壳的
 * 318px 那一格——列表名字裁成「模块…」、详情挤成窄带、右边一大片空着。2026-11-07 用户连看
 * 三次都是这个，而**所有只看页面内部宽度的测试都发现不了**：它们量的是页面自己算出来的数，
 * 不是「页面被放在哪一格」。
 *
 * 判据：CSS 里出现「页面级两列」（选择器含 workspace / panes / master-detail 的规则给了多轨
 * grid-template-columns），却没有一条 `.settings-workspace` 规则把它覆盖成单列 → 违规。
 */
const SINGLE_TRACK = /^(\s*(?:minmax\(\s*0(?:px)?\s*,\s*1fr\s*\)|1fr)\s*)$/u

function pageLevelSplitSelectors(css: string): string[] {
  const offenders: string[] = []
  for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/gu)) {
    const selector = match[1]!.trim()
    if (!/(workspace|panes|master-detail)/u.test(selector)) continue
    const declaration = /grid-template-columns\s*:\s*([^;]+);?/u.exec(match[2] ?? '')
    if (declaration === null) continue
    if (SINGLE_TRACK.test(declaration[1] ?? '')) continue
    offenders.push(selector.split('\n').pop()?.trim() ?? selector)
  }
  return offenders
}

function overridesShellToSingleColumn(css: string): boolean {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)].some((match) => {
    if (!match[1]!.includes('.settings-workspace')) return false
    const declaration = /grid-template-columns\s*:\s*([^;]+);?/u.exec(match[2] ?? '')
    return declaration !== null && SINGLE_TRACK.test(declaration[1] ?? '')
  })
}

export function shellGridViolations(css: string): readonly string[] {
  const pages = pageLevelSplitSelectors(css)
  return pages.length > 0 && !overridesShellToSingleColumn(css) ? pages : []
}

describe('settings pages that bring their own columns', () => {
  it('flags a page-level two-column layout that leaves the shell grid in place (red fixture)', () => {
    const red = `
      .intelligence-notification-workspace { padding: 24px; }
      .intelligence-notification-panes { display: grid; grid-template-columns: 232px minmax(0, 1fr); }
    `
    expect(shellGridViolations(red).length).toBeGreaterThan(0)
  })

  it('accepts the same layout once the shell column definition is overridden (green fixture)', () => {
    const green = `
      .settings-workspace.intelligence-notification-workspace { grid-template-columns: minmax(0, 1fr); }
      .intelligence-notification-panes { display: grid; grid-template-columns: 232px minmax(0, 1fr); }
    `
    expect(shellGridViolations(green)).toEqual([])
  })

  it('does not confuse an inner table grid with a page split', () => {
    const tableOnly = `.mi-sync-run__grid { grid-template-columns: 88px 180px 92px minmax(0, 1fr); }`
    expect(shellGridViolations(tableOnly)).toEqual([])
  })

  it('keeps this page compliant', () => {
    const css = readFileSync(join(__dirname, 'intelligence-notification.css'), 'utf8')
    expect(shellGridViolations(css)).toEqual([])
  })
})
