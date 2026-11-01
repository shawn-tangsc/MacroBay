import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const CONTEXT_DIR = __dirname

type ImportedFile = { file: string; source: string }

/**
 * 三种导入形态都要扫：静态 `from '…'`、动态 `import('…')`、`require('…')`。
 * 只匹配第一种的话，后两种能整条穿过去。
 */
function scanImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specifiers.push(match[1] ?? '')
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1] ?? '')
  for (const match of source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1] ?? '')
  return specifiers.filter((specifier) => specifier.length > 0)
}

/** 契约目录只许引用自己目录里的文件：`./…` 且解析后仍在目录内。 */
function findViolations(sources: readonly ImportedFile[]): string[] {
  const violations: string[] = []
  for (const { file, source } of sources) {
    for (const specifier of scanImportSpecifiers(source)) {
      const isLocal = specifier.startsWith('./')
      const escapes = !isLocal || !resolve(CONTEXT_DIR, specifier).startsWith(CONTEXT_DIR)
      if (escapes) violations.push(`${file}: ${specifier}`)
    }
  }
  return violations
}

function readContextSources(): ImportedFile[] {
  return readdirSync(CONTEXT_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => ({ file, source: readFileSync(join(CONTEXT_DIR, file), 'utf8') }))
}

describe('session-context import boundary', () => {
  it('imports nothing but files inside its own directory', () => {
    const sources = readContextSources()
    expect(sources.length).toBeGreaterThan(0)

    expect(findViolations(sources)).toEqual([])
  })

  it('flags all three import forms when a forbidden specifier is injected', () => {
    const injected: ImportedFile[] = [
      {
        file: 'static.ts',
        source: "import { x } from '@platform/ai/assistant-platform/runtime/AssistantChatRuntimeService'"
      },
      { file: 'dynamic.ts', source: "const x = await import('@platform/ai/agent-platform/runtime/agentChatRuntime')" },
      { file: 'require.ts', source: "const fs = require('node:fs')" }
    ]

    expect(findViolations(injected)).toEqual([
      'static.ts: @platform/ai/assistant-platform/runtime/AssistantChatRuntimeService',
      'dynamic.ts: @platform/ai/agent-platform/runtime/agentChatRuntime',
      'require.ts: node:fs'
    ])
  })

  it('flags a relative import that walks out of the directory', () => {
    const injected: ImportedFile[] = [{ file: 'escape.ts', source: "import { x } from '../agent-platform/store/agentStore'" }]

    expect(findViolations(injected)).toEqual(['escape.ts: ../agent-platform/store/agentStore'])
  })
})
