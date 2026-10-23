import { describe, expect, it } from 'vitest'

import { filterWebSearchBlacklist, normalizeWebSearchBlacklist } from './webSearchBlacklist'

describe('web search blacklist', () => {
  it('normalizes exact and wildcard domain patterns', () => {
    expect(normalizeWebSearchBlacklist([' HTTPS://Example.com/path ', '*.News.Example.com/', 'bad pattern'])).toEqual([
      'example.com',
      '*.news.example.com'
    ])
  })

  it('filters exact domains and wildcard subdomains', () => {
    const results = [
      { title: 'Root', content: 'root', url: 'https://example.com/a', sourceInput: 'q' },
      { title: 'Sub', content: 'sub', url: 'https://daily.news.example.com/a', sourceInput: 'q' },
      { title: 'Allowed', content: 'ok', url: 'https://allowed.example.org/a', sourceInput: 'q' }
    ]

    const filtered = filterWebSearchBlacklist(results, ['example.com', '*.news.example.com'])
    expect(filtered.results.map((result) => result.title)).toEqual(['Allowed'])
    expect(filtered.status).toEqual({
      phase: 'blacklist_filtered',
      countBefore: 3,
      countAfter: 1
    })
  })
})
