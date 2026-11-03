import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * **一个应用只允许一套图标来源**（用户 2026-11-03 拍定，Chief 收口）。
 *
 * 事实：壳层里 `from 'lucide-react'` 的文件 100+，`@ant-design/icons` 一度只出现在关于页的四个链接图标上——
 * 为了那四个图标，整个渲染层出现了第二套图标来源，还带一条只为它们存在的依赖。
 *
 * 为什么写成断言而不是写进规范：这类「顺手加一个」靠人记是记不住的，而它恰好可以机械判——
 * 只要有人再 `import` 第二套图标，这条就红。**要引入第二套，必须单独一笔并说清理由**（那时把这条改成白名单，
 * 让评审看见，而不是悄悄扩一个 import）。
 *
 * 范围只扫壳层渲染代码：`platform/` 里的图标组件本身不在此列（那是组件库实现，不是「谁在用哪套图标」）。
 */
const shellRoot = resolve(__dirname, '..')
const secondIconSource = "@ant-design/icons"

describe('one icon source for the whole app', () => {
  it('never imports a second icon set anywhere in the shell renderer', () => {
    const offenders = sourcesImporting(shellRoot, secondIconSource)
    expect(offenders).toEqual([])
  })

  it('still uses lucide, so the rule has a real single source', () => {
    // 反向断言：如果连 lucide 都不用了，说明这条规则的前提变了，该重新看它，而不是让它空转。
    const lucideUsers = sourcesImporting(shellRoot, 'lucide-react')
    expect(lucideUsers.length).toBeGreaterThan(50)
  })
})

/** 只读 TypeScript 源码，跳过测试与 node_modules。 */
function sourcesImporting(root: string, moduleName: string): string[] {
  const hits: string[] = []
  const walk = (directory: string): void => {
    for (const dirent of readdirSync(directory, { withFileTypes: true })) {
      const name = dirent.name
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = resolve(directory, name)
      if (dirent.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/u.test(name) || /\.test\.(ts|tsx)$/u.test(name)) continue
      const text = readFileSync(full, 'utf8')
      if (text.includes(`from '${moduleName}'`) || text.includes(`from "${moduleName}"`)) {
        hits.push(full.slice(root.length + 1))
      }
    }
  }
  walk(root)
  return hits
}
