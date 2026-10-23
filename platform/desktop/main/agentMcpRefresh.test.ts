import { describe, expect, it, vi } from 'vitest'

import type { RefreshMcpServerToolsResult } from '../../ai/agent-platform/mcp'
import { createAgentStoreState } from '../../ai/agent-platform/store/agentStore'
import { refreshAgentMcpTools } from './agentMcpRefresh'

describe('agent MCP refresh', () => {
  it('writes back refreshed state and returns tools on success', async () => {
    const state = createAgentStoreState({
      mcpServers: [
        {
          id: 'mcp-files',
          name: 'Filesystem',
          type: 'stdio',
          command: 'npx',
          isActive: true
        }
      ]
    })
    const refreshedState = createAgentStoreState({
      ...state,
      mcpRuntimeStatusByServerId: {
        'mcp-files': {
          state: 'connected',
          lastCheckedAt: 123
        }
      },
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })
    const refreshServerTools = vi.fn<
      (_state: typeof state, serverId: string, options: { preserveToolsOnError: true; throwOnError: false }) => Promise<RefreshMcpServerToolsResult>
    >(async () => ({
      state: refreshedState,
      tools: refreshedState.mcpToolsByServerId['mcp-files'] ?? []
    }))
    const replaceAgentState = vi.fn(async () => refreshedState)

    await expect(
      refreshAgentMcpTools(
        {
          getState: async () => state,
          refreshServerTools,
          replaceAgentState
        },
        'mcp-files'
      )
    ).resolves.toEqual([
      {
        id: 'read_file',
        name: 'read_file',
        description: 'Read a file'
      }
    ])

    expect(refreshServerTools).toHaveBeenCalledWith(state, 'mcp-files', {
      preserveToolsOnError: true,
      throwOnError: false
    })
    expect(replaceAgentState).toHaveBeenCalledWith(refreshedState)
  })

  it('writes back error state before rethrowing a refresh failure to the caller', async () => {
    const state = createAgentStoreState({
      mcpServers: [
        {
          id: 'mcp-files',
          name: 'Filesystem',
          type: 'stdio',
          command: 'npx',
          isActive: true
        }
      ],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file', description: 'Read a file' }]
      }
    })
    const errorState = createAgentStoreState({
      ...state,
      mcpRuntimeStatusByServerId: {
        'mcp-files': {
          state: 'error',
          message: 'spawn failed',
          lastCheckedAt: 123
        }
      }
    })
    const refreshServerTools = vi.fn<
      (_state: typeof state, serverId: string, options: { preserveToolsOnError: true; throwOnError: false }) => Promise<RefreshMcpServerToolsResult>
    >(async () => ({
      state: errorState,
      tools: errorState.mcpToolsByServerId['mcp-files'] ?? []
    }))
    const replaceAgentState = vi.fn(async () => errorState)

    await expect(
      refreshAgentMcpTools(
        {
          getState: async () => state,
          refreshServerTools,
          replaceAgentState
        },
        'mcp-files'
      )
    ).rejects.toThrow('spawn failed')

    expect(replaceAgentState).toHaveBeenCalledWith(errorState)
  })
})
