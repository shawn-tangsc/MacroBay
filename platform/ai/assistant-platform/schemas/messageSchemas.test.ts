import { describe, expect, it } from 'vitest'

import { createAssistantWebSearchMessagePart } from '../../web-search/assistant/assistantWebSearchMessageParts'
import { extractAssistantSearchableText } from './messageSchemas'

describe('assistant message schemas', () => {
  it('does not index full Web Search source content as searchable text', () => {
    const data = {
      parts: [
        { type: 'text', text: 'Final answer' },
        createAssistantWebSearchMessagePart({
          toolName: 'web_search',
          status: 'success',
          providerId: 'tavily',
          query: 'docs',
          sources: [
            {
              id: 1,
              title: 'Docs',
              url: 'https://example.com/docs',
              snippet: 'Short source summary'
            }
          ]
        })
      ]
    }

    const searchable = extractAssistantSearchableText(data)

    expect(searchable).toContain('Final answer')
    expect(searchable).not.toContain('Short source summary')
    expect(searchable).not.toContain('https://example.com/docs')
  })
})
