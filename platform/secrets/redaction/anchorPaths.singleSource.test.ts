import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 脱敏只有一份实现。
 *
 * 启动失败页与产品页失败折叠区读的是同一个入口；渲染层只许**深路径** import 纯文件，
 * 不许 import `@platform/secrets` 桶（会拉 electron/vault）。这条守卫让「渲染层另写一份」
 * 在评审前就红，而不是等两份实现慢慢分叉。
 */

const ROOT = process.cwd()
const SOURCE_ROOTS = ['apps', 'platform', 'products']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', '.git'])
const OWNER = 'platform/secrets/redaction/anchorPaths.ts'
const DIAGNOSTIC_OWNER = 'platform/secrets/redaction/redactDiagnostic.ts'
const BOOT_PRESENTATION = 'platform/desktop/main/failurePresentation.ts'

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) {
      collectSourceFiles(absolute, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (/\.(test|spec)\.tsx?$/.test(name)) continue
    out.push(relative(ROOT, absolute).replace(/\\/g, '/'))
  }
  return out
}

const files = SOURCE_ROOTS.flatMap((root) => collectSourceFiles(resolve(ROOT, root)))
const sources = new Map(files.map((file) => [file, readFileSync(resolve(ROOT, file), 'utf8')]))

function definingFiles(pattern: RegExp): string[] {
  return [...sources.entries()].filter(([, source]) => pattern.test(source)).map(([file]) => file)
}

describe('diagnostic redaction has exactly one implementation', () => {
  it('defines the path patterns and the two path functions only in the shared module', () => {
    expect(definingFiles(/const HOME_PATH_PATTERNS/u)).toEqual([OWNER])
    expect(definingFiles(/export function anchorPaths\(/u)).toEqual([OWNER])
    expect(definingFiles(/export function anchorOne\(/u)).toEqual([OWNER])
  })

  it('defines the redaction entry only in the shared module', () => {
    expect(definingFiles(/export function redactDiagnosticText\(/u)).toEqual([DIAGNOSTIC_OWNER])
  })

  it('makes the boot failure presentation read the shared entry instead of keeping its own copy', () => {
    const source = sources.get(BOOT_PRESENTATION) ?? ''
    expect(source).toContain("from '../../secrets/redaction/anchorPaths'")
    expect(source).toContain('redactDiagnosticText(')
    expect(source).not.toContain('const HOME_PATH_PATTERNS')
    expect(source).not.toContain('function anchorOne(')
  })

  it('lets the renderer deep-import the pure files, never the secrets barrel', () => {
    const offenders = [...sources.entries()]
      .filter(([file]) => file.startsWith('apps/desktop-shell/src/'))
      .filter(([, source]) => /from\s+'@platform\/secrets'/u.test(source))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
