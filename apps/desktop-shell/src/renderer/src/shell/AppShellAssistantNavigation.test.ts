import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AppShell assistant navigation', () => {
  it('forwards assistant topic navigation detail into AssistantPage', () => {
    // 2026-11-09：外壳拆成 AppShell + AppShellView，判据不变，两处一起读。
    const shellRoot = resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell')
    const source = readFileSync(resolve(shellRoot, 'AppShell.tsx'), 'utf8')
      + readFileSync(resolve(shellRoot, 'AppShellView.tsx'), 'utf8')

    expect(source).toContain('type AssistantOpenRequest')
    expect(source).toMatch(/detail\?\.assistant[\s\S]*setAssistantOpenRequest\(detail\.assistant\)/)
    expect(source).toMatch(/<AssistantPage[\s\S]*openRequest=\{assistantOpenRequest\}/)
  })
})
