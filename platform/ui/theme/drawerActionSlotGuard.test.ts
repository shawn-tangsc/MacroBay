import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 抽屉的标题行动作槽只许走平台 `Drawer` 的 `actions` prop（界面设计 2026-11-09 第五条）。
 *
 * 自建一个「头行右侧动作」的类（`*-header-action` / `*-drawer-action`）等于拿产品 CSS 去改平台组件的
 * 布局：平台一调头行的 `12 / 45% / flex` 比例，产品那套就散架。而平台已经给了槽位，
 * 间距、`max-width: 45cqw`、关闭键不被挤动都由组件固定。
 *
 * 判据：**只看 import 了平台 `Drawer` 的文件**，类名里出现 `-header-action` / `-drawer-action`
 * （平台自己的 `.drawer-actions` 与 `--drawer` 修饰类不算）即红。
 */

const ROOT = process.cwd()
const SCANNED_ROOTS = ['apps', 'products', 'platform']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'release'])
const DRAWER_IMPORT = '@platform/ui/components/drawer'
/** 已登记例外：只减不增，每条写清为什么平台槽位不够用。 */
const ALLOWED: Readonly<Record<string, string>> = {}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) tsxFiles(absolute, out)
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) out.push(absolute)
  }
  return out
}

const FILES = SCANNED_ROOTS.flatMap((root) => {
  try {
    return tsxFiles(join(ROOT, root))
  } catch {
    return []
  }
})

/** 自建头行动作类的形状：`*--header-action` / `*-drawer-action`，不含平台自己的 `drawer-actions`。 */
const CUSTOM_SLOT = /className=(?:"|'|\{`)[^"'`]*[\w-]+-(?:header-action|drawer-action)\b/u

function offenders(): string[] {
  const hits: string[] = []
  for (const file of FILES) {
    const path = relative(ROOT, file).replace(/\\/g, '/')
    if (ALLOWED[path] !== undefined) continue
    const source = readFileSync(file, 'utf8')
    if (!source.includes(DRAWER_IMPORT)) continue
    if (CUSTOM_SLOT.test(source)) hits.push(path)
  }
  return hits
}

describe('a drawer header action slot comes from the Drawer prop', () => {
  it('has no hand-built drawer header action class', () => {
    expect(offenders()).toEqual([])
  })

  it('is a real guard: the detector matches the shapes it claims to', () => {
    expect(CUSTOM_SLOT.test('className="source-detail-drawer-action"')).toBe(true)
    expect(CUSTOM_SLOT.test('className={`x-header-action ${active}`}')).toBe(true)
    // 平台自己的页脚动作组不算：它不是头行槽位。
    expect(CUSTOM_SLOT.test('className="drawer-actions drawer-actions-split"')).toBe(false)
  })
})
