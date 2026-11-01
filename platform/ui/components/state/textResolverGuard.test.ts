import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Owner: platform/ui（**不许用「吃掉键」的解析器绕开文案表**）。
 *
 * `StateView` / `IconButton` 的读屏名只收键，句子由注入的 `resolveText` 解析。但
 * `resolveText={() => 已解析好的句子}` 一样能编译、一样能过键形状守卫——键形同虚设，
 * 自由文本只是换了一件合法外衣。这正是收键要防的事，靠规范写在纸上挡不住。
 *
 * 所以：产品代码里出现**零参箭头**当 `resolveText` 一律红；测试文件放行（测试就是要把键回显出来，
 * `(key) => key` 或 `() => 'fixed'` 都合理）。要一句固定文案，走**键 + 文案表**，不要喂空。
 */

const ROOT = process.cwd()
const SOURCE_ROOTS = ['products', 'apps/desktop-shell/src']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage'])
/** 零参箭头当解析器：`resolveText={() => …}`、`resolveText={ () => … }`、`resolveText={()=>…}` 全算。 */
const EMPTY_RESOLVER = /resolveText=\{\s*\(\s*\)\s*=>/

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) {
      collectSourceFiles(absolute, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    // 测试本来就要把键回显或钉死一句，放行。
    if (/\.(test|spec)\.tsx?$/.test(name)) continue
    out.push(relative(ROOT, absolute).replace(/\\/g, '/'))
  }
  return out
}

describe('解析器不许吃掉键', () => {
  it('产品与外壳源码里没有零参 resolveText', () => {
    const offenders = SOURCE_ROOTS
      .flatMap((root) => collectSourceFiles(resolve(ROOT, root)))
      .filter((file) => EMPTY_RESOLVER.test(readFileSync(resolve(ROOT, file), 'utf8')))

    // 要固定文案就加键；把句子直接喂给解析器，等于让「键 → 句子」这条约定失效。
    expect(offenders).toEqual([])
  })
})
