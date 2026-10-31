import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const CONTEXT_DIR = __dirname

/** 契约目录只能依赖自己与标准库类型；碰到下面任何一个都说明分层被穿透了。 */
const FORBIDDEN_IMPORT_FRAGMENTS = [
  'assistant-platform',
  'agent-platform',
  'platform/settings',
  '@platform/settings',
  'electron',
  'node:sqlite',
  'better-sqlite3',
  'db/'
]

function readContextSources(): Array<{ file: string; source: string }> {
  return readdirSync(CONTEXT_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => ({ file, source: readFileSync(join(CONTEXT_DIR, file), 'utf8') }))
}

function importsOf(source: string): string[] {
  const matches = source.matchAll(/from\s+'([^']+)'/g)
  return [...matches].map((match) => match[1] ?? '')
}

describe('session-context import boundary', () => {
  it('only imports itself and the runtime builtins', () => {
    const sources = readContextSources()
    expect(sources.length).toBeGreaterThan(0)

    for (const { file, source } of sources) {
      for (const specifier of importsOf(source)) {
        const isLocal = specifier.startsWith('./')
        const forbidden = FORBIDDEN_IMPORT_FRAGMENTS.some((fragment) => specifier.includes(fragment))
        expect({ file, specifier, ok: isLocal }).toEqual({ file, specifier, ok: true })
        expect({ file, specifier, forbidden }).toEqual({ file, specifier, forbidden: false })
      }
    }
  })

  it('rejects the boundary check when a forbidden import is injected', () => {
    // 反向用例：守卫本身必须会红。故意造一条违规导入，走同一套判定。
    const injected = "import { createAssistantChatRuntimeService } from '@platform/ai/assistant-platform/runtime/AssistantChatRuntimeService'"
    const violations = importsOf(injected).filter(
      (specifier) => !specifier.startsWith('./') || FORBIDDEN_IMPORT_FRAGMENTS.some((fragment) => specifier.includes(fragment))
    )

    expect(violations).toEqual(['@platform/ai/assistant-platform/runtime/AssistantChatRuntimeService'])
  })

  it('does not reach outside its own directory for relative imports', () => {
    for (const { file, source } of readContextSources()) {
      for (const specifier of importsOf(source)) {
        if (!specifier.startsWith('.')) continue
        const resolved = resolve(CONTEXT_DIR, specifier)
        expect({ file, specifier, inside: resolved.startsWith(CONTEXT_DIR) }).toEqual({
          file,
          specifier,
          inside: true
        })
      }
    }
  })
})
