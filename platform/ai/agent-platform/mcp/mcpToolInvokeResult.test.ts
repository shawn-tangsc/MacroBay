import { describe, expect, it } from 'vitest'

import { normalizeMcpRuntimeToolInvokeResult } from './mcpToolInvokeResult'

describe('normalizeMcpRuntimeToolInvokeResult', () => {
  it('collapses text-only MCP content into a string output while preserving content metadata', () => {
    expect(
      normalizeMcpRuntimeToolInvokeResult({
        content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }],
        isError: false
      })
    ).toEqual({
      output: 'Hello world',
      content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }],
      isError: false
    })
  })

  it('prefers structuredContent as output while preserving richer MCP result fields', () => {
    expect(
      normalizeMcpRuntimeToolInvokeResult({
        content: [
          { type: 'text', text: 'Missing file' },
          { type: 'resource', resource: { uri: 'file:///tmp/missing.txt' } }
        ],
        structuredContent: { code: 'ENOENT' },
        isError: true,
        sessionContext: { id: 'mcp-session-2' }
      })
    ).toEqual({
      output: { code: 'ENOENT' },
      content: [
        { type: 'text', text: 'Missing file' },
        { type: 'resource', resource: { uri: 'file:///tmp/missing.txt' } }
      ],
      structuredContent: { code: 'ENOENT' },
      isError: true,
      sessionContext: { id: 'mcp-session-2' }
    })
  })

  it('keeps explicit platform output untouched when the result is already normalized', () => {
    expect(
      normalizeMcpRuntimeToolInvokeResult({
        output: { ok: true },
        content: [{ type: 'text', text: 'ok' }],
        sessionContext: null
      })
    ).toEqual({
      output: { ok: true },
      content: [{ type: 'text', text: 'ok' }],
      sessionContext: null
    })
  })
})
