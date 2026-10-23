import { describe, expect, it } from 'vitest'

import { toSlackMarkdown } from './slackMarkdown'

describe('toSlackMarkdown', () => {
  it('returns empty string unchanged', () => {
    expect(toSlackMarkdown('')).toBe('')
  })

  it('converts **bold** to *bold*', () => {
    expect(toSlackMarkdown('Hello **world**')).toBe('Hello *world*')
  })

  it('handles multiple bold segments', () => {
    expect(toSlackMarkdown('**a** and **b**')).toBe('*a* and *b*')
  })

  it('converts *italic* to _italic_', () => {
    expect(toSlackMarkdown('Hello *world*')).toBe('Hello _world_')
  })

  it('handles bold and italic in the same text', () => {
    expect(toSlackMarkdown('**bold** and *italic*')).toBe('*bold* and _italic_')
  })

  it('converts ~~strikethrough~~ to ~strikethrough~', () => {
    expect(toSlackMarkdown('~~deleted~~')).toBe('~deleted~')
  })

  it('converts [text](url) to <url|text>', () => {
    expect(toSlackMarkdown('[Click here](https://example.com)')).toBe('<https://example.com|Click here>')
  })

  it('converts headers to bold', () => {
    expect(toSlackMarkdown('# Title')).toBe('*Title*')
    expect(toSlackMarkdown('## Subtitle')).toBe('*Subtitle*')
  })

  it('preserves inline code and fenced blocks', () => {
    expect(toSlackMarkdown('Use `**not bold**` here')).toBe('Use `**not bold**` here')
    const input = 'Before\n```\n**bold** and *italic*\n```\nAfter **bold**'
    const expected = 'Before\n```\n**bold** and *italic*\n```\nAfter *bold*'
    expect(toSlackMarkdown(input)).toBe(expected)
  })
})
