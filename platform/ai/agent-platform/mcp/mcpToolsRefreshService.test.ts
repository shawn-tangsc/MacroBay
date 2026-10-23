import { describe, expect, it } from 'vitest'

import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import { createAgentStoreState } from '../store/agentStore'
import { refreshMcpServerTools } from './mcpToolsRefreshService'

const activeServer: McpServerEntity = {
  id: 'mcp-files',
  name: 'Filesystem',
  type: 'stdio',
  command: 'npx',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const inactiveServer: McpServerEntity = {
  ...activeServer,
  id: 'mcp-disabled',
  name: 'Disabled',
  isActive: false
}

describe('MCP tools refresh service', () => {
  it('stores discovered tools and connected status for active servers', async () => {
    const state = createAgentStoreState({ mcpServers: [activeServer] })
    const result = await refreshMcpServerTools(state, 'mcp-files', {
      discoverTools: async (server) => [
        { name: 'read_file', description: `Read through ${server.name}` },
        { id: 'search-id', name: 'search' }
      ],
      now: () => 10
    })

    expect(result.state.mcpRuntimeStatusByServerId['mcp-files']).toEqual({
      state: 'connected',
      lastCheckedAt: 10
    })
    expect(result.state.mcpToolsByServerId['mcp-files']).toEqual([
      {
        id: 'read_file',
        name: 'read_file',
        description: 'Read through Filesystem',
        inputSchema: undefined
      },
      {
        id: 'search-id',
        name: 'search',
        description: undefined,
        inputSchema: undefined
      }
    ])
    expect(result.tools.map((tool) => tool.name)).toEqual(['read_file', 'search'])
  })

  it('marks inactive servers as disabled and clears stale tools without calling discovery', async () => {
    const state = createAgentStoreState({
      mcpServers: [inactiveServer],
      mcpToolsByServerId: { 'mcp-disabled': [{ id: 'old', name: 'old' }] }
    })
    let called = false

    const result = await refreshMcpServerTools(state, 'mcp-disabled', {
      discoverTools: async () => {
        called = true
        return [{ name: 'unexpected' }]
      },
      now: () => 20
    })

    expect(called).toBe(false)
    expect(result.tools).toEqual([])
    expect(result.state.mcpToolsByServerId['mcp-disabled']).toEqual([])
    expect(result.state.mcpRuntimeStatusByServerId['mcp-disabled']).toEqual({
      state: 'disabled',
      lastCheckedAt: 20
    })
  })

  it('marks errors and clears stale tools when discovery fails', async () => {
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: { 'mcp-files': [{ id: 'old', name: 'old' }] }
    })

    await expect(
      refreshMcpServerTools(state, 'mcp-files', {
        discoverTools: async () => {
          throw new Error('spawn failed')
        },
        now: () => 30
      })
    ).rejects.toThrow('spawn failed')

    const result = await refreshMcpServerTools(state, 'mcp-files', {
      discoverTools: async () => {
        throw new Error('spawn failed')
      },
      now: () => 30,
      throwOnError: false
    })

    expect(result.tools).toEqual([])
    expect(result.state.mcpToolsByServerId['mcp-files']).toEqual([])
    expect(result.state.mcpRuntimeStatusByServerId['mcp-files']).toEqual({
      state: 'error',
      message: 'spawn failed',
      errorKind: 'transient',
      retryable: true,
      lifecycleState: 'reconnect-scheduled',
      lastCheckedAt: 30
    })
  })

  it('can preserve stale tools on error for runtime policy rebuild paths', async () => {
    const state = createAgentStoreState({
      mcpServers: [activeServer],
      mcpToolsByServerId: { 'mcp-files': [{ id: 'old', name: 'old', description: 'Old tool' }] }
    })

    const result = await refreshMcpServerTools(state, 'mcp-files', {
      discoverTools: async () => {
        throw new Error('spawn failed')
      },
      now: () => 31,
      throwOnError: false,
      preserveToolsOnError: true
    })

    expect(result.tools).toEqual([
      {
        id: 'old',
        name: 'old',
        description: 'Old tool',
        inputSchema: undefined
      }
    ])
    expect(result.state.mcpToolsByServerId['mcp-files']).toEqual([
      {
        id: 'old',
        name: 'old',
        description: 'Old tool',
        inputSchema: undefined
      }
    ])
    expect(result.state.mcpRuntimeStatusByServerId['mcp-files']).toEqual({
      state: 'error',
      message: 'spawn failed',
      errorKind: 'transient',
      retryable: true,
      lifecycleState: 'reconnect-scheduled',
      lastCheckedAt: 31
    })
  })

  it('throws for unknown servers without mutating state', async () => {
    const state = createAgentStoreState({ mcpServers: [activeServer] })

    await expect(
      refreshMcpServerTools(state, 'missing-server', {
        discoverTools: async () => []
      })
    ).rejects.toThrow('MCP server "missing-server" was not found.')
  })
})
