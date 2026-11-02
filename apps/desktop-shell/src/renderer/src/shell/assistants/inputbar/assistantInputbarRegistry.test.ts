import { describe, expect, it } from 'vitest'

import { createAssistantInputbarTools, listVisibleAssistantInputbarTools } from './assistantInputbarRegistry'

describe('assistantInputbarRegistry', () => {
  it('never renders a placeholder tool as a disabled button', () => {
    const tools = createAssistantInputbarTools()
    const visible = listVisibleAssistantInputbarTools(tools)
    expect(visible.some((tool) => tool.placeholder)).toBe(false)
    expect(visible.map((tool) => tool.id)).toEqual(['attachment', 'new-topic', 'clear-topic', 'quick-panel'])
  })
})
