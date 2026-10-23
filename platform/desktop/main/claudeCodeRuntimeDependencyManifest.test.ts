import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createClaudeCodeSdkModuleLoader } from './claudeCodeRuntimeDependencies'

describe('claude code runtime dependency manifest', () => {
  it('declares the Claude Agent SDK as a root runtime dependency for the desktop main process', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as {
      dependencies?: Record<string, string>
    }

    expect(packageJson.dependencies).toHaveProperty('@anthropic-ai/claude-agent-sdk')
  })

  it('loads the Claude Agent SDK through the default desktop main process loader', async () => {
    const loadClaudeSdkModule = createClaudeCodeSdkModuleLoader()
    const loaded = await loadClaudeSdkModule()

    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(typeof loaded.module.query).toBe('function')
  })
})
