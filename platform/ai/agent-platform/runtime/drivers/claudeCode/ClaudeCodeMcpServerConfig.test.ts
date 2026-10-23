import { describe, expect, it } from 'vitest'

import type { McpRuntimeSourceSnapshot } from '../../../mcp/McpRuntimeService'
import type { McpServerEntity } from '../../../schemas/mcpServerSchemas'
import { buildClaudeCodeMcpServerConfigs } from './ClaudeCodeMcpServerConfig'

const stdioServer: McpServerEntity = {
  id: 'mcp-files',
  name: 'Filesystem',
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  env: {
    ROOT: '/tmp/workspace'
  },
  isActive: true
}

const sseServer: McpServerEntity = {
  id: 'mcp-remote',
  name: 'Remote Docs',
  type: 'sse',
  baseUrl: 'https://example.test/mcp',
  headers: {
    Authorization: 'Bearer token'
  },
  isActive: true
}

describe('Claude Code MCP server config', () => {
  it('maps connected stdio and remote MCP servers into SDK-ready configs', () => {
    const configs = buildClaudeCodeMcpServerConfigs({
      servers: [stdioServer, sseServer],
      runtimeSources: [connected('mcp-files'), connected('mcp-remote')]
    })

    expect(configs).toEqual([
      {
        serverId: 'mcp-files',
        serverName: 'Filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: {
          ROOT: '/tmp/workspace'
        }
      },
      {
        serverId: 'mcp-remote',
        serverName: 'Remote Docs',
        transport: 'sse',
        url: 'https://example.test/mcp',
        headers: {
          Authorization: 'Bearer token'
        }
      }
    ])
  })

  it('skips inactive, disconnected, and malformed MCP servers', () => {
    const configs = buildClaudeCodeMcpServerConfigs({
      servers: [
        stdioServer,
        { ...stdioServer, id: 'mcp-inactive', name: 'Inactive', isActive: false },
        { ...sseServer, id: 'mcp-bad', name: 'Bad Remote', baseUrl: '   ' }
      ],
      runtimeSources: [failed('mcp-files'), connected('mcp-inactive'), connected('mcp-bad')]
    })

    expect(configs).toEqual([])
  })

  it('deduplicates duplicate runtime source entries by server id', () => {
    const configs = buildClaudeCodeMcpServerConfigs({
      servers: [stdioServer],
      runtimeSources: [connected('mcp-files'), connected('mcp-files')]
    })

    expect(configs).toEqual([
      {
        serverId: 'mcp-files',
        serverName: 'Filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: {
          ROOT: '/tmp/workspace'
        }
      }
    ])
  })
})

function connected(serverId: string): McpRuntimeSourceSnapshot {
  return {
    serverId,
    sourceId: `mcp:${serverId}`,
    toolCount: 1,
    isActive: true,
    runtimeState: 'connected',
    lastCheckedAt: 1
  }
}

function failed(serverId: string): McpRuntimeSourceSnapshot {
  return {
    serverId,
    sourceId: `mcp:${serverId}`,
    toolCount: 1,
    isActive: true,
    runtimeState: 'error',
    runtimeMessage: 'spawn failed',
    lastCheckedAt: 1
  }
}
