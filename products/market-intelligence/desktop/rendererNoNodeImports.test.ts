import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 渲染层**不许传递性 import 到 `node:` 或 `electron`**（2026-11-14 事故）。
 *
 * 那天视图从 service 里 import 了一个函数，而那个文件的第一行是 `node:fs/promises`——
 * 浏览器里没有文件系统，于是整个页面加载失败、应用开不了机。类型检查、用例全绿也拦不住它：
 * 只有打包器会炸，而打包器不在这条链上跑。
 *
 * 这条守卫走**传递闭包**（只跟相对路径的 import），一发现 `node:` / `electron` 就红，
 * 并打印那条链路，下一个人不用再靠猜。
 */
const RENDERER_ROOT = join(process.cwd(), 'products/market-intelligence/desktop')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const IMPORT = /(?:from\s+|import\s+|require\()\s*['"]([^'"]+)['"]/g

function importsOf(file: string): string[] {
  /* **`import type` / `export type` 不算**：它们在编译时被抹掉，运行时不会把 `node:` 带进包里。
     只看值位置（真正会被执行/打包的 import），否则这条守卫会被几十条纯类型引用淹掉。 */
  const source = readFileSync(file, 'utf8')
    .replace(/import\s+type\s+[\s\S]*?from\s*['"][^'"]+['"]/g, '')
    .replace(/export\s+type\s+[\s\S]*?from\s*['"][^'"]+['"]/g, '')
  const found: string[] = []
  for (const match of source.matchAll(IMPORT)) found.push(match[1]!)
  return found
}

function resolveRelative(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  const base = resolve(dirname(from), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch { /* 不是文件就继续试下一个 */ }
  }
  return undefined
}

/** 从每个渲染层文件出发，返回第一条能走到 `node:` / `electron` 的链路。 */
function offendingChains(): string[] {
  const chains: string[] = []
  for (const entry of sourceFiles(RENDERER_ROOT)) {
    const seen = new Set<string>()
    const queue: Array<readonly [string, readonly string[]]> = [[entry, [relative(process.cwd(), entry)]]]
    while (queue.length > 0) {
      const [file, path] = queue.shift()!
      if (seen.has(file)) continue
      seen.add(file)
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith('node:') || specifier === 'electron') {
          chains.push([...path, specifier].join(' -> '))
          queue.length = 0
          break
        }
        const target = resolveRelative(file, specifier)
        /* 只跟产品内的相对路径：跨包别名（@platform/...）由各自的守卫管，跟进来会走不完。 */
        if (target !== undefined && target.startsWith(join(process.cwd(), 'products'))) {
          queue.push([target, [...path, relative(process.cwd(), target)]])
        }
      }
    }
  }
  return chains
}

describe('renderer import graph', () => {
  it('never reaches node: or electron, even transitively', () => {
    expect(offendingChains()).toEqual([])
  })
})
