import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `role="menuitem"` 只许出现在平台菜单组件里（界面设计 2026-11-09 第三条）。
 *
 * 手写菜单项要自己承担：roving focus、方向键、Home/End、禁用项不可聚焦、点击后关闭。
 * 这些写漏一件，键盘用户就走进一条死路。antd 自己不产生这个**字面量**，所以误伤为零。
 *
 * 放行规则：平台菜单实现目录 + **按文件路径登记**的例外（每条写清为什么现在还不能换）。
 */

const ROOT = process.cwd()
const SCANNED_ROOTS = ['apps', 'products', 'platform']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', 'release'])
/** 平台菜单组件的实现目录。 */
const PLATFORM_MENU_DIR = 'platform/ui/components/menu/'

/** 存量例外：只减不增，每条必须写清「换 ContextMenu 会怎样」。 */
const ALLOWED: Readonly<Record<string, string>> = {
  'apps/desktop-shell/src/renderer/src/shell/workspace/WorkspaceTabMenu.tsx':
    '与页签条共用开合与键盘编排（roving focus、禁用原因 aria-description），换 ContextMenu 会丢这套编排',
  'apps/desktop-shell/src/renderer/src/shell/model-service/ModelServiceProviderMoreMenu.tsx':
    '内联面板（非 portal）以保证外点/Esc 关闭与 DOM 顺序稳定，换 ContextMenu 会把面板挪出上层结构',
  'apps/desktop-shell/src/renderer/src/shell/model-service/ProviderRowContextMenu.tsx':
    '供应商行右键菜单带图标与禁用原因，且与行的选中态联动，换 ContextMenu 要重接行状态'
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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function offenders(): string[] {
  const hits: string[] = []
  for (const file of FILES) {
    const path = relative(ROOT, file).replace(/\\/g, '/')
    if (path.startsWith(PLATFORM_MENU_DIR)) continue
    if (ALLOWED[path] !== undefined) continue
    if (stripComments(readFileSync(file, 'utf8')).includes('role="menuitem"')) hits.push(path)
  }
  return hits
}

describe('role="menuitem" only comes from the platform menu', () => {
  it('finds no hand-written menu item outside the registered exceptions', () => {
    expect(offenders()).toEqual([])
  })

  it('keeps every exception justified and path-based', () => {
    for (const [path, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, path).toBeGreaterThan(10)
      expect(path.endsWith('.tsx'), path).toBe(true)
    }
  })
})
