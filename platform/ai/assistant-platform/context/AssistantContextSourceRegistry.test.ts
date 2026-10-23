import { describe, expect, it } from 'vitest'

import { createAssistantContextSourceRegistry } from './AssistantContextSourceRegistry'

describe('createAssistantContextSourceRegistry', () => {
  it('registers and lists generic context sources', () => {
    const registry = createAssistantContextSourceRegistry()
    registry.register({ id: 'web-search', label: 'Web search', enabledByDefault: false })
    expect(registry.list()).toEqual([{ id: 'web-search', label: 'Web search', enabledByDefault: false }])
  })
})
