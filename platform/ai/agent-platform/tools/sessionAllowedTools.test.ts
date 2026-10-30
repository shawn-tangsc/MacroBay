import { describe, expect, it } from 'vitest'

import { claudeCodeBuiltinTools } from './builtinClaudeTools'
import {
  isBuiltinToolName,
  isSessionAllowableToolName,
  normalizeSessionAllowedTools,
  sessionBlockedBuiltinTools,
  sessionReadOnlyBuiltinTools
} from './sessionAllowedTools'

/**
 * Session-scoped allowlist: a product may grant a read-only built-in tool to one session only.
 * Anything that is not a read-only built-in name must never reach the tool policy.
 */
describe('normalizeSessionAllowedTools', () => {
  it('keeps read-only built-in tool names', () => {
    expect(normalizeSessionAllowedTools(['WebSearch', 'WebFetch', 'Read', 'Glob', 'Grep'])).toEqual([
      'WebSearch',
      'WebFetch',
      'Read',
      'Glob',
      'Grep'
    ])
  })

  it('rejects write and execute built-ins even when they lead the list', () => {
    expect(
      normalizeSessionAllowedTools([
        'Bash',
        'Write',
        'Edit',
        'MultiEdit',
        'NotebookEdit',
        'Task',
        'TodoWrite',
        'WebSearch'
      ])
    ).toEqual(['WebSearch'])
  })

  it('drops write and execute built-ins one by one', () => {
    for (const blocked of sessionBlockedBuiltinTools) {
      expect(normalizeSessionAllowedTools([blocked])).toEqual([])
      expect(isSessionAllowableToolName(blocked)).toBe(false)
    }
  })

  it('never widens the allowlist through a name the agent surface does not know', () => {
    for (const readOnly of sessionReadOnlyBuiltinTools) {
      expect(isBuiltinToolName(readOnly)).toBe(true)
      expect(isSessionAllowableToolName(readOnly)).toBe(true)
    }
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

  it('drops names that differ only by case', () => {
    expect(normalizeSessionAllowedTools(['bash', 'websearch', 'READ'])).toEqual([])
  })

  it('treats a missing allowlist as empty', () => {
    expect(normalizeSessionAllowedTools(undefined)).toEqual([])
    expect(normalizeSessionAllowedTools(null)).toEqual([])
    expect(normalizeSessionAllowedTools([])).toEqual([])
  })

  it('keeps the read-only and blocked lists disjoint', () => {
    const readOnly = new Set<string>(sessionReadOnlyBuiltinTools)
    for (const blocked of sessionBlockedBuiltinTools) {
      expect(readOnly.has(blocked)).toBe(false)
    }
    expect(sessionReadOnlyBuiltinTools.length).toBeGreaterThanOrEqual(5)
  })
})

describe('claudeCodeBuiltinTools coverage', () => {
  it('accounts for every built-in tool as either read-only or explicitly blocked', () => {
    const classified = new Set<string>([...sessionReadOnlyBuiltinTools, ...sessionBlockedBuiltinTools])
    for (const tool of claudeCodeBuiltinTools) {
      expect(classified.has(tool.id)).toBe(true)
    }
  })
})
