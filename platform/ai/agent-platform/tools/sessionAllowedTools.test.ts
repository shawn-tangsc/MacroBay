import { describe, expect, it } from 'vitest'

import { normalizeSessionAllowedTools } from './sessionAllowedTools'

/**
 * Session-scoped allowlist: a product may grant a built-in tool to one session only.
 * Anything that is not a built-in name must never reach the tool policy.
 */
describe('normalizeSessionAllowedTools', () => {
  it('keeps built-in tool names', () => {
    expect(normalizeSessionAllowedTools(['WebSearch', 'WebFetch', 'Read'])).toEqual([
      'WebSearch',
      'WebFetch',
      'Read'
    ])
  })

  it('trims names and drops empty entries', () => {
    expect(normalizeSessionAllowedTools([' WebSearch ', '', '   ', 'WebFetch'])).toEqual([
      'WebSearch',
      'WebFetch'
    ])
  })

  it('dedupes while keeping the first occurrence order', () => {
    expect(normalizeSessionAllowedTools(['WebFetch', 'WebSearch', 'WebFetch'])).toEqual([
      'WebFetch',
      'WebSearch'
    ])
  })

  it('drops names that are not built-in tools', () => {
    expect(
      normalizeSessionAllowedTools(['WebSearch', 'mcp__filesystem__readFile', 'skill__code-reader__read', 'NotATool'])
    ).toEqual(['WebSearch'])
  })

  it('treats a missing allowlist as empty', () => {
    expect(normalizeSessionAllowedTools(undefined)).toEqual([])
    expect(normalizeSessionAllowedTools([])).toEqual([])
  })
})
