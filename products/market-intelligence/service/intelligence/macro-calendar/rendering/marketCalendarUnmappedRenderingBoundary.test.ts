import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **结构棘轮：渲染专用读口只能住在 `rendering/`，只有 `ipc/` 与 `rendering/` 自身可以 import 它。**
 *
 * 契约 §10（架构师 2026-11-16）：判的是**位置与依赖方向**，不是命名。起因是简报线那条静态守卫
 * 认的是名字里有没有 `unmapped`——改一次名就瞎；而「简报不许 import `macro-calendar/` 目录族」
 * 也立不住（`dailyBriefingRenderLocalize.ts` 本来就引了那个目录里的东西）。
 *
 * **这条证明什么**：没有服务层文件从这个位置引用它（依赖方向单向）。
 * **这条不证明什么**：不证明「简报不会读未映射行」——那由简报线 `5391975` 的命名守卫 + 评审负责。
 * 两条分工不同，别把一条当成两条。
 */
// 扫描根是**服务层**（`products/market-intelligence/service`）。渲染层（`desktop/`）import 它的
// **类型**是合法的：渲染层就是要用它，契约禁的是「服务层反向 import 渲染专用读口」。
const PRODUCT_SERVICE = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const READER = 'marketCalendarUnmappedMonthRead'

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { sourceFiles(full, out); continue }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('渲染专用读口的依赖方向', () => {
  it('除 `ipc/` 与 `rendering/` 外，服务层没有任何文件 import 它', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(PRODUCT_SERVICE)) {
      const rel = relative(PRODUCT_SERVICE, file)
      if (rel.includes(`${join('', 'ipc')}${'/'}`) || rel.includes('rendering/')) continue
      const source = readFileSync(file, 'utf8')
      // 只看真正的 import/export 行：注释里提到它（比如「不许读」）不算引用。
      for (const line of source.split('\n')) {
        if (!/^\s*(import|export)\b.*\bfrom\b/.test(line) && !/^\s*import\s*\(/.test(line)) continue
        if (line.includes(READER)) { offenders.push(`${rel}: ${line.trim()}`); break }
      }
    }
    expect(offenders).toEqual([])
  })
})
