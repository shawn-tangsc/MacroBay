import { describe, expect, it } from 'vitest'

import { normalizeWebSearchKeywords, normalizeWebSearchUrls } from './webSearchInputNormalization'

describe('web search input normalization', () => {
  it('trims, deduplicates, and caps keyword inputs', () => {
    expect(normalizeWebSearchKeywords([' alpha ', 'alpha', '', ' beta ', 'gamma'], 2)).toEqual(['alpha', 'beta'])
  })

  it('trims, deduplicates, and caps URL inputs', () => {
    expect(normalizeWebSearchUrls([' https://example.com/a ', 'https://example.com/a', 'https://example.com/b'], 2)).toEqual([
      'https://example.com/a',
      'https://example.com/b'
    ])
  })
})
