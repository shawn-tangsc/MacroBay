import { describe, expect, it } from 'vitest'

import { resolveToolDisplayName, summarizeToolCallInput } from './agentToolCallSummary'

describe('resolveToolDisplayName', () => {
  it('drops the MCP transport prefix from product tools', () => {
    expect(resolveToolDisplayName('mcp__market-intelligence__query_sentiment_snapshot')).toBe(
      'query_sentiment_snapshot'
    )
    expect(resolveToolDisplayName('mcp__docs__search')).toBe('search')
  })

  it('keeps built-in tool names untouched', () => {
    expect(resolveToolDisplayName('Bash')).toBe('Bash')
    expect(resolveToolDisplayName('Task')).toBe('Task')
  })
})

describe('summarizeToolCallInput', () => {
  it('shows the command a shell call ran, folded onto one line', () => {
    expect(
      summarizeToolCallInput('Bash', {
        command: 'cd products/market-intelligence &&\n  pnpm test --run',
        description: 'Run tests'
      })
    ).toBe('cd products/market-intelligence && pnpm test --run')
  })

  it('shows the file a read or write call touched', () => {
    expect(summarizeToolCallInput('Read', { file_path: '/repo/docs/README.md' })).toBe(
      '/repo/docs/README.md'
    )
    expect(
      summarizeToolCallInput('Edit', {
        file_path: '/repo/products/market-intelligence/service/intelligence/application/sourceCatalog.ts',
        old_string: 'a',
        new_string: 'b'
      })
    ).toBe('…/application/sourceCatalog.ts')
  })

  it('shows the pattern and root of a search call', () => {
    expect(summarizeToolCallInput('Glob', { pattern: '**/*.ts', path: 'apps' })).toBe('**/*.ts · apps')
    expect(summarizeToolCallInput('Grep', { pattern: 'tool-input-available', glob: '*.ts' })).toBe(
      'tool-input-available · *.ts'
    )
  })

  it('shows what a fetch, search or subagent call is about', () => {
    expect(summarizeToolCallInput('WebFetch', { url: 'https://example.com/a', prompt: 'x' })).toBe(
      'https://example.com/a'
    )
    expect(summarizeToolCallInput('WebSearch', { query: 'BTC ETF flows' })).toBe('BTC ETF flows')
    expect(summarizeToolCallInput('Task', { description: 'Audit the trace view' })).toBe(
      'Audit the trace view'
    )
  })

  it('falls back to the first meaningful field for an unknown or product tool', () => {
    expect(
      summarizeToolCallInput('query_sentiment_snapshot', {
        asOf: '2026-10-23T00:00:00.000Z',
        scope: { symbol: 'BTC' }
      })
    ).toBeNull()
    expect(summarizeToolCallInput('get_evidence_excerpt', { evidenceRefId: 'ev-1' })).toBeNull()
    expect(summarizeToolCallInput('write_file', { path: 'notes.md', content: 'x' })).toBe('notes.md')
  })

  it('stays quiet for tools whose input says nothing useful', () => {
    expect(summarizeToolCallInput('TodoWrite', { todos: [{ content: 'a', status: 'pending' }] })).toBeNull()
    expect(summarizeToolCallInput('Bash', {})).toBeNull()
    expect(summarizeToolCallInput('Bash', null)).toBeNull()
  })

  it('truncates very long summaries', () => {
    const summary = summarizeToolCallInput('Bash', { command: 'echo ' + 'x'.repeat(400) })
    expect(summary).toHaveLength(161)
    expect(summary?.endsWith('…')).toBe(true)
  })
})
