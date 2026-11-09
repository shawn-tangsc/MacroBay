import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `role="tab"` / `role="tablist"` 只许来自平台 `Tabs`（界面设计 2026-11-09 第二条）。
 *
 * 自绘页签要自己承担：roving tabindex、方向键、`aria-controls` 指向真实面板、选中态。
 * 这些一件写漏就是键盘走不通，而不是「看起来丑一点」。antd 与平台 `Tabs` 内部才有唯一实现。
 *
 * 放行规则：平台 `Tabs` 组件文件 + **按文件路径登记**的例外（工作区 Tab 条：它带关闭/拖拽/重开，
 * 语义是平台 `Tabs` 的超集）。**不许按注释或函数名放行**——那等于写上角色再配一句解释就过。
 */

const ROOT = process.cwd()
const SCANNED_ROOTS = ['apps', 'products', 'platform']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'release'])
/** 平台 `Tabs` 的实现目录：页签角色的唯一来源。 */
const PLATFORM_TABS_DIR = 'platform/ui/components/tabs/'

/** 存量例外：只减不增；每条写清为什么不能用 `Tabs`。 */
const ALLOWED: Readonly<Record<string, string>> = {
  'apps/desktop-shell/src/renderer/src/shell/workspace/WorkspaceTabStrip.tsx':
    '工作区 Tab 条：每个页签带关闭键、可拖拽、可重开，语义是平台 Tabs 的超集，换过去要丢掉这些行为'
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) sourceFiles(absolute, out)
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) out.push(absolute)
  }
  return out
}

const FILES = SCANNED_ROOTS.flatMap((root) => {
  try {
    return sourceFiles(join(ROOT, root))
  } catch {
    return []
  }
})

/** 注释里的字样不算使用处。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function offenders(): string[] {
  const hits: string[] = []
  for (const file of FILES) {
    const path = relative(ROOT, file).replace(/\\/g, '/')
    if (path.startsWith(PLATFORM_TABS_DIR)) continue
    if (ALLOWED[path] !== undefined) continue
    const source = stripComments(readFileSync(file, 'utf8'))
    if (source.includes('role="tab"') || source.includes('role="tablist"')) hits.push(path)
  }
  return hits
}

describe('role="tab" only comes from the platform Tabs', () => {
  it('finds no hand-written tab outside the registered exception', () => {
    expect(offenders()).toEqual([])
  })

  it('keeps every exception justified', () => {
    for (const [path, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, path).toBeGreaterThan(10)
    }
    // 例外只按路径登记：不许出现「按注释/函数名放行」的形状。
    expect(Object.keys(ALLOWED).every((path) => path.endsWith('.tsx'))).toBe(true)
  })
})
