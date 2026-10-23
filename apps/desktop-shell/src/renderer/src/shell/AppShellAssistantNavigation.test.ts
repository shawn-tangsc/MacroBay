import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AppShell assistant navigation', () => {
  it('forwards assistant topic navigation detail into AssistantPage', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx'),
      'utf8'
    )

    expect(source).toContain('type AssistantOpenRequest')
    expect(source).toMatch(/detail\?\.assistant[\s\S]*setAssistantOpenRequest\(detail\.assistant\)/)
    expect(source).toMatch(/<AssistantPage[\s\S]*openRequest=\{assistantOpenRequest\}/)
  })
})
