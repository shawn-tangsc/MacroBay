import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 区块的容器样式（边框 / 圆角 / `--surface` 底 / 内边距）**只有 `SettingsSection` 一份**。
 *
 * 事故苗头：存储与舆情两屏各自在自己的 CSS 里给 `.settings-section` 包了一层
 * （一份 1px + 圆角 10 + surface，另一份另一套数），改一处另一处不跟。
 *
 * 判据（纯字符串扫描）：任何屏的 CSS 里，**同一条规则**既出现 `border:` 又出现 `border-radius:`
 * 且选择器里带 `settings-section` → 违规。只扫 CSS，不碰 TSX。
 */
const ROOTS = ['apps', 'platform', 'products']
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', 'build', 'coverage', 'release'])
/** 唯一允许写这条容器样式的地方。 */
const OWNER = 'platform/ui/components/settings-section/styles.css'

/** 存量（待各线删）：两条都已由各自线路删掉规则，这里是空的——再有屏写第二条容器样式就直接红。 */
const ALLOWED: Readonly<Record<string, string>> = {}

/** 纯函数：CSS 文本 + 文件路径 → 违规选择器。 */
export function sectionContainerOffenders(file: Readonly<{ path: string; source: string }>): string[] {
  if (file.path === OWNER || ALLOWED[file.path] !== undefined) return []
  return [...file.source.matchAll(/([^{}]+)\{([^}]*)\}/gu)]
    .filter(([, selector]) => (selector ?? '').includes('settings-section'))
    .filter(([, , body]) => /border\s*:/u.test(body ?? '') && /border-radius\s*:/u.test(body ?? ''))
    .map(([, selector]) => `${file.path}: ${selector!.trim().split('\n').pop()?.trim() ?? ''}`)
}

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) cssFiles(absolute, out)
    else if (name.endsWith('.css')) out.push(absolute)
  }
  return out
}

describe('one block container style', () => {
  it('flags a screen that gives .settings-section its own border and radius', () => {
    const fixture = { path: 'products/x/screen.css', source: '.x > .settings-section { border: 1px solid var(--border); border-radius: 10px; }' }
    expect(sectionContainerOffenders(fixture)).toHaveLength(1)
  })

  it('accepts a rule that only tweaks spacing', () => {
    expect(sectionContainerOffenders({ path: 'products/x/screen.css', source: '.x > .settings-section { margin-top: 8px; }' })).toEqual([])
  })

  it('keeps the flat variant free of its own frame', () => {
    const css = readFileSync(join(process.cwd(), 'platform/ui/components/settings-section/styles.css'), 'utf8')
    const flat = /\.settings-section--flat\s*\{([^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(flat).toContain('border: 0')
    expect(flat).not.toContain('border-radius')
  })

  it('keeps the repository free of a second container style', () => {
    const offenders = ROOTS.flatMap((root) => {
      let files: string[] = []
      try { files = cssFiles(root) } catch { files = [] }
      return files.flatMap((file) => sectionContainerOffenders({
        path: relative(process.cwd(), file).split('\\').join('/'),
        source: readFileSync(file, 'utf8')
      }))
    })
    expect(offenders).toEqual([])
  })
})
