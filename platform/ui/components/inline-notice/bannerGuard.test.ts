import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 警告用提示条，不是一行裸文字：屏里不许用裸 `<p role="alert">` 充当横幅。
 *
 * 存量按**文件**登记进 `scripts/inline-notice-baseline.json`（每条带 owner 与清理时机），
 * **只减不增**：新出现的裸告警直接红，不进基线——27 处是可见的债，不是豁免。
 */
const ROOT = process.cwd()
const BASELINE = JSON.parse(readFileSync(join(ROOT, 'scripts/inline-notice-baseline.json'), 'utf8')) as {
  entries: Record<string, { count: number; owner: string; shared: string; clearWhen: string }>
}

/** 纯函数：源码 → 裸 `<p role="alert">` 的行号。 */
export function bareAlertLines(source: string): number[] {
  return source.split('\n').flatMap((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return []
    return /<p\b[^>]*role="alert"/u.test(line) ? [index + 1] : []
  })
}

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'out', 'dist', 'build', 'coverage', 'release'].includes(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) files(absolute, out)
    else if (name.endsWith('.tsx') && !name.includes('.test.')) out.push(absolute)
  }
  return out
}

describe('warnings are notices, not bare paragraphs', () => {
  it('flags a bare <p role="alert"> and names the line', () => {
    expect(bareAlertLines("<p className=\"warn\" role=\"alert\">保存失败</p>")).toEqual([1])
    expect(bareAlertLines("<InlineNotice tone=\"danger\">保存失败</InlineNotice>")).toEqual([])
  })

  it('never lets a new bare alert in, and never lets an existing file grow', () => {
    const offenders: string[] = []
    for (const root of ['apps', 'platform', 'products']) {
      let list: string[] = []
      try { list = files(root) } catch { list = [] }
      for (const file of list) {
        const path = relative(ROOT, file).split('\\').join('/')
        const found = bareAlertLines(readFileSync(file, 'utf8')).length
        if (found === 0) continue
        const allowed = BASELINE.entries[path]
        if (allowed === undefined) offenders.push(`${path}（新出现，${found} 处）`)
        else if (found > allowed.count) offenders.push(`${path}（基线 ${allowed.count} → 现在 ${found}）`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps every baseline entry owned and dated', () => {
    for (const [path, entry] of Object.entries(BASELINE.entries)) {
      expect(entry.owner.length, `${path} 的 owner`).toBeGreaterThan(1)
      expect(entry.clearWhen.length, `${path} 的清理时机`).toBeGreaterThan(5)
    }
  })
})
