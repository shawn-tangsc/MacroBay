import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AssistantPage open request wiring', () => {
  it('accepts assistant/topic open requests from shell navigation', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/assistants/AssistantPage.tsx'),
      'utf8'
    )

    expect(source).toContain('openRequest?: AssistantOpenRequest | null')
    expect(source).toMatch(/openRequest[\s\S]*setActiveAssistantId\(openRequest\.assistantId\)/)
    expect(source).toMatch(/openRequest[\s\S]*setCurrentTopicId\(openRequest\.topicId\)/)
    expect(source).toMatch(/setCurrentTopicId[\s\S]*activeTopicIdRef\.current = topicId[\s\S]*setActiveTopicId\(topicId\)/)
    expect(source).toMatch(/openRequest[\s\S]*setActiveTab\('topics'\)/)
  })
})
