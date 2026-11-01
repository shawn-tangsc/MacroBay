import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(__dirname, '../..')

/** 唯一允许直接碰全局出网对象的地方：代理适配器自己。 */
const ADAPTER_FILE = resolve(__dirname, 'platformFetch.ts')

const SCAN_ROOTS = ['platform', 'products', 'apps/desktop-shell/src/renderer']

const SCAN_EXTENSIONS = ['.ts', '.tsx']

type SourceFile = { file: string; source: string }

function collectSources(): SourceFile[] {
  const files: SourceFile[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
        continue
      }
      if (!SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension))) continue
      if (entry.includes('.test.') || entry.includes('.spec.')) continue
      if (resolve(full) === ADAPTER_FILE) continue
      files.push({ file: relative(REPO_ROOT, full), source: readFileSync(full, 'utf8') })
    }
  }
  for (const root of SCAN_ROOTS) walk(join(REPO_ROOT, root))
  return files
}

/** 这个标识符在同文件里有没有本地绑定（参数、解构、常量、容器属性读取）。 */
function hasLocalBinding(source: string, identifier: string): boolean {
  const name = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`(?:const|let|var)\\s+${name}\\b`),
    new RegExp(`\\{\\s*${name}\\s*\\}`),
    new RegExp(`[{,]\\s*${name}\\s*[,}]`),
    new RegExp(`\\(\\s*${name}\\s*[,):]`),
    new RegExp(`,\\s*${name}\\s*[,):]`)
  ]
  return patterns.some((pattern) => pattern.test(source))
}

export function findTransportViolations(sources: readonly SourceFile[]): string[] {
  const violations: string[] = []
  for (const { file, source } of sources) {
    // 第一步：直接取全局对象当值的四种形态。
    const globalForms = [
      /\?\?\s*fetch\b/,
      /globalThis\.fetch\b/,
      /window\.fetch\b/,
      /self\.fetch\b/
    ]
    for (const pattern of globalForms) {
      if (pattern.test(source)) violations.push(`${file}: ${pattern.source}`)
    }

    // 第二步：裸 `fetch(` 只有在同文件没有本地绑定时才算违规——有绑定就是调用方给的东西。
    if (/(?<![\w.$])fetch\s*\(/.test(source) && !hasLocalBinding(source, 'fetch')) {
      violations.push(`${file}: bare fetch( without a local binding`)
    }

    // 第三步：`typeof X === 'function'` 的 X 必须本地可查，否则就是在问「全局有没有」。
    for (const match of source.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*===\s*'function'/g)) {
      const identifier = match[1] ?? ''
      if (!hasLocalBinding(source, identifier)) {
        violations.push(`${file}: typeof ${identifier} === 'function' without a local binding`)
      }
    }
  }
  return violations
}

describe('outbound transport boundary', () => {
  it('has no direct global fetch usage outside the platform adapter', () => {
    const violations = findTransportViolations(collectSources())

    expect(violations).toEqual([])
  })

  it('flags every banned form when one is injected', () => {
    const injected: SourceFile[] = [
      { file: 'a.ts', source: 'const f = input.fetch ?? fetch' },
      { file: 'b.ts', source: 'const f = globalThis.fetch' },
      { file: 'c.ts', source: 'window.fetch("https://example.test")' },
      { file: 'd.ts', source: 'self.fetch("https://example.test")' },
      { file: 'e.ts', source: 'const response = await fetch(url)' },
      { file: 'f.ts', source: "if (typeof loader === 'function') {}" }
    ]

    const violations = findTransportViolations(injected)

    expect(violations).toEqual([
      'a.ts: \\?\\?\\s*fetch\\b',
      'b.ts: globalThis\\.fetch\\b',
      'c.ts: window\\.fetch\\b',
      'd.ts: self\\.fetch\\b',
      'e.ts: bare fetch( without a local binding',
      "f.ts: typeof loader === 'function' without a local binding"
    ])
  })

  it('allows a typeof check on a value the caller supplied', () => {
    // 与 BLS 探针同形：fetch 来自注入容器的自有属性，校验的是「调用方给了我什么」。
    const allowed: SourceFile[] = [
      {
        file: 'probe.ts',
        source: [
          'const fetch = readOwnData(value, "fetch")',
          "const available = typeof fetch === 'function'"
        ].join('\n')
      }
    ]

    expect(findTransportViolations(allowed)).toEqual([])
  })
})
