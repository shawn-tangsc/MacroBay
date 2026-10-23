import { describe, expect, it } from 'vitest'

import { addManualMcpBinding } from './agentMcpManualBinding'

describe('agent MCP manual binding', () => {
  it('rejects empty input so the UI can show feedback instead of appearing inert', () => {
    expect(addManualMcpBinding([], '   ')).toEqual({ status: 'empty' })
  })

  it('rejects duplicate MCP server ids', () => {
    expect(addManualMcpBinding(['builtin-git'], ' builtin-git ')).toEqual({
      status: 'duplicate',
      id: 'builtin-git'
    })
  })

  it('adds a trimmed custom MCP server id', () => {
    expect(addManualMcpBinding(['builtin-git'], ' custom-mcp ')).toEqual({
      status: 'added',
      id: 'custom-mcp',
      mcps: ['builtin-git', 'custom-mcp']
    })
  })
})
