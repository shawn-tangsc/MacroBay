import { describe, expect, it } from 'vitest'

import { normalizePublishedAt, stripCdata, stripHtmlFragments } from './publishedAtNormalizer'

describe('publishedAtNormalizer', () => {
  it('strips CDATA wrappers from published timestamps', () => {
    expect(stripCdata('<![CDATA[Mon, 05 Jul 2026 10:00:00 GMT]]>')).toBe('Mon, 05 Jul 2026 10:00:00 GMT')
  })

  it('strips HTML fragments from published timestamps', () => {
    expect(stripHtmlFragments('<span>Mon, 05 Jul 2026 10:00:00 GMT</span>')).toBe('Mon, 05 Jul 2026 10:00:00 GMT')
  })

  it('normalizes RFC822 timestamps to ISO', () => {
    expect(normalizePublishedAt('<![CDATA[Mon, 05 Jul 2026 10:00:00 GMT]]>')).toBe('2026-07-05T10:00:00.000Z')
  })

  it('returns undefined for invalid timestamps', () => {
    expect(normalizePublishedAt('<![CDATA[not-a-date]]>')).toBeUndefined()
  })
})
