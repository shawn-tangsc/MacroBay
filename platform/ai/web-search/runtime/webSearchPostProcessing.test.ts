import { describe, expect, it } from 'vitest'

import { applyWebSearchPostProcessing } from './webSearchPostProcessing'

describe('web search post processing', () => {
  it('keeps content unchanged when compression is none', () => {
    const response = {
      providerId: 'fetch' as const,
      capability: 'fetchUrls' as const,
      inputs: ['https://example.com'],
      results: [{ title: 'Title', content: 'abcdef', url: 'https://example.com', sourceInput: 'https://example.com' }]
    }

    expect(
      applyWebSearchPostProcessing(response, {
        method: 'none',
        cutoffLimit: 100,
        cutoffUnit: 'char'
      }).results[0].content
    ).toBe('abcdef')
  })

  it('applies cutoff compression across results', () => {
    const response = {
      providerId: 'fetch' as const,
      capability: 'fetchUrls' as const,
      inputs: ['https://example.com'],
      results: [
        { title: 'One', content: '1234567890', url: 'https://example.com/1', sourceInput: 'https://example.com/1' },
        { title: 'Two', content: 'abcdefghij', url: 'https://example.com/2', sourceInput: 'https://example.com/2' }
      ]
    }

    const processed = applyWebSearchPostProcessing(response, {
      method: 'cutoff',
      cutoffLimit: 10,
      cutoffUnit: 'char'
    })

    expect(processed.results.map((result) => result.content)).toEqual(['12345', 'abcde'])
    expect(processed.status).toContainEqual({
      phase: 'cutoff',
      countBefore: 20,
      countAfter: 10
    })
  })
})
