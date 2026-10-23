import { describe, expect, it } from 'vitest'

import type { McpServerEntity } from '@platform/ai/agent-platform/schemas/mcpServerSchemas'

import { planMcpToolRefreshes } from './agentMcpRefreshPlanner'

const activeServer: McpServerEntity = {
  id: 'mcp-files',
  name: 'Filesystem',
  isActive: true
}

const inactiveServer: McpServerEntity = {
  id: 'mcp-git',
  name: 'Git',
  isActive: false
}

describe('Agent MCP refresh planner', () => {
  it('refreshes bound active servers that do not have tools yet', () => {
    expect(
      planMcpToolRefreshes({
        boundServerIds: ['mcp-files', 'mcp-git', 'manual-id'],
        servers: [activeServer, inactiveServer],
        toolsByServerId: {}
      })
    ).toEqual(['mcp-files'])
  })

  it('does not refresh servers with existing tools or already requested ids', () => {
    expect(
      planMcpToolRefreshes({
        boundServerIds: ['mcp-files'],
        servers: [activeServer],
        toolsByServerId: { 'mcp-files': [{ id: 'read', name: 'read' }] },
        requestedServerIds: new Set(['mcp-files'])
      })
    ).toEqual([])

    expect(
      planMcpToolRefreshes({
        boundServerIds: ['mcp-files'],
        servers: [activeServer],
        toolsByServerId: {},
        requestedServerIds: new Set(['mcp-files'])
      })
    ).toEqual([])
  })
})
