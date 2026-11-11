import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { productIds, productSettingsEntries } from '@products/generated/shellRegistry'

/**
 * 平台不许知道产品：`platform/**` 与 `apps/desktop-shell/src/**` 里
 *
 * 1. **只允许** import 生成注册表（`@products/generated/*`，构建期产物）；
 *    任何解析到 `products/<id>/` 的 import / export-from / require / 动态 import 即红；
 * 2. **产品 id 一个字都不许出现**（代码与注释都算）。id 清单取自生成注册表的 `productIds`，
 *    不在这里手写——新增产品时守卫自动覆盖，不用改两份。
 *
 * 产品**设置面板 id** 也按同一把尺子：平台只许用「注册表里这条数据的 id」，不许拼它的短名
 * （`<productId>.<panelId>` 去掉产品前缀），那等于壳层记住某个产品的内部分区名。
 *
 * 测试文件只对 import 规则负责：用例可以拿产品 id 当夹具（真实集成断言），生产代码不行。
 */
const ROOT = process.cwd()
const SCANNED_ROOTS = ['platform', 'apps/desktop-shell/src'] as const
const ALLOWED_IMPORT_PREFIX = '@products/generated/'

/** 产品在平台侧的全部合法称呼：id、注册面板 id、面板 id 的产品内短名。 */
export function productTokens(): string[] {
  const tokens = new Set<string>(productIds)
  // 生成物里的设置条目今天可能是空数组（产品撤了注册），类型会被推成 `readonly []`；
  // 这里显式写元素类型，只影响类型，不改运行时数据。
  const entries: readonly { id: string; productId: string }[] = productSettingsEntries
  for (const entry of entries) {
    tokens.add(entry.id)
    if (entry.id.startsWith(`${entry.productId}.`)) tokens.add(entry.id.slice(entry.productId.length + 1))
  }
  return [...tokens]
}

export function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'out', 'dist', 'build', 'coverage', '.git'].includes(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) filesUnder(absolute, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(absolute)
  }
  return out
}

/** 源码里每个 import / export-from / require / 动态 import 的说明符与行号。 */
export function importSpecifiers(source: string): Array<{ line: number; specifier: string }> {
  const found: Array<{ line: number; specifier: string }> = []
  source.split('\n').forEach((line, index) => {
    const patterns = [
      /(?:^|\s)(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/u,
      /\brequire\(\s*['"]([^'"]+)['"]\s*\)/u,
      /\bimport\(\s*['"]([^'"]+)['"]\s*\)/u
    ]
    for (const pattern of patterns) {
      const match = pattern.exec(line)
      if (match) found.push({ line: index + 1, specifier: match[1]! })
    }
  })
  return found
}

function offendersForImports(): string[] {
  const offenders: string[] = []
  for (const root of SCANNED_ROOTS) {
    for (const file of filesUnder(join(ROOT, root))) {
      const path = relative(ROOT, file).split('\\').join('/')
      for (const { line, specifier } of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (!specifier.includes('products/')) continue
        if (specifier.startsWith(ALLOWED_IMPORT_PREFIX)) continue
        offenders.push(`${path}:${line} imports ${specifier}`)
      }
    }
  }
  return offenders
}

function offendersForTokens(tokens: readonly string[]): string[] {
  const offenders: string[] = []
  for (const root of SCANNED_ROOTS) {
    for (const file of filesUnder(join(ROOT, root))) {
      if (/\.test\.(ts|tsx)$/.test(file)) continue
      const path = relative(ROOT, file).split('\\').join('/')
      const source = readFileSync(file, 'utf8')
      for (const token of tokens) {
        const pattern = new RegExp(`(^|[^\\w-])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`, 'u')
        if (pattern.test(source)) offenders.push(`${path} names the product token "${token}"`)
      }
    }
  }
  return offenders
}

describe('the platform does not know any product', () => {
  it('flags a product import but allows the generated registry', () => {
    const productImport = ['./products', 'sample-product', 'desktop', 'page'].join('/')
    expect(importSpecifiers(`import { x } from '${productImport}'`)).toEqual([
      { line: 1, specifier: productImport }
    ])
    expect(importSpecifiers("import { productIds } from '@products/generated/shellRegistry'")).toHaveLength(1)
  })

  it('never imports product code outside the generated registry', () => {
    expect(offendersForImports()).toEqual([])
  })

  it('never names a product in platform code or comments', () => {
    const tokens = productTokens()
    expect(tokens.length).toBeGreaterThan(0)
    expect(offendersForTokens(tokens)).toEqual([])
  })
})
