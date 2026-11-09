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
    '已评估（2026-11-09）：ContextMenu 用 createPortal 渲染、没有内联模式，这一处要的是「内联面板（非 portal）」，'
    + '组件表达不了。换它会怎样：面板被挪进 portal，DOM 结构变化；外点/Esc 关闭与焦点归还要重写；'
    + '发版期不做可见结构变化，且需界面签字。长期保留，除非 ContextMenu 增加非 portal 内联模式。',
  'apps/desktop-shell/src/renderer/src/shell/model-service/ProviderRowContextMenu.tsx':
    '已评估（2026-11-09）：菜单项带图标与**禁用原因**，且与行选中态联动，而 ContextMenu 的 item 契约只收 '
    + '`{key,labelKey,disabled,tone}`。换它会怎样：禁用原因无处可放、行状态要重接，等于改行为不是替换。'
    + '长期保留，除非 ContextMenu 支持行状态联动与禁用原因。'
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
