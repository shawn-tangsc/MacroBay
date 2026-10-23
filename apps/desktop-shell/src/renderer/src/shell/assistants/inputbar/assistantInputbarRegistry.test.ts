import { describe, expect, it } from 'vitest'

import { createAssistantInputbarTools, listVisibleAssistantInputbarTools } from './assistantInputbarRegistry'

describe('assistantInputbarRegistry', () => {
  it('keeps placeholder tools visible but disabled', () => {
    const tools = createAssistantInputbarTools()
    const visible = listVisibleAssistantInputbarTools(tools)
    expect(visible.some((tool) => tool.id === 'mcp-tools' && tool.placeholder)).toBe(true)
    expect(visible.some((tool) => tool.id === 'attachment' && tool.enabled)).toBe(true)
  })
})
