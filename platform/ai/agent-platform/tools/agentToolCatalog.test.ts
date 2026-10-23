import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import {
  buildAgentToolCatalog,
  createMcpTool,
  createMcpToolsByServerId,
  listMcpToolsForServer,
  upsertMcpToolsForServer
} from './agentToolCatalog'

const baseAgent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Agent',
  model: 'openai:gpt-4.1',
  modelName: 'gpt-4.1',
  mcps: ['mcp-files'],
  disabledTools: [],
  configuration: { permission_mode: 'default' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  orderKey: 'a'
}

const filesServer: McpServerEntity = {
  id: 'mcp-files',
  name: 'Filesystem',
  description: 'Local workspace files',
  type: 'stdio',
  command: 'npx',
  isActive: true,
  sortOrder: 1
}

const disabledServer: McpServerEntity = {
  id: 'mcp-disabled',
  name: 'Disabled',
  description: 'Inactive tools',
  type: 'stdio',
  command: 'npx',
  isActive: false,
  sortOrder: 2
}

describe('MCP tool cache helpers', () => {
  it('normalizes tools and replaces the tool snapshot for one server', () => {
    const cache = upsertMcpToolsForServer(createMcpToolsByServerId(), 'mcp-files', [
      createMcpTool({ name: 'read_file', description: 'Read a file' }),
      createMcpTool({ id: 'custom-id', name: 'search' })
    ])

    expect(Object.keys(cache)).toEqual(['mcp-files'])
    expect(listMcpToolsForServer(cache, 'mcp-files')).toEqual([
      {
        id: 'read_file',
        name: 'read_file',
        description: 'Read a file',
        inputSchema: undefined
      },
      {
        id: 'custom-id',
        name: 'search',
        description: undefined,
        inputSchema: undefined
      }
    ])

    const replaced = upsertMcpToolsForServer(cache, 'mcp-files', [createMcpTool({ name: 'write_file' })])
    expect(listMcpToolsForServer(replaced, 'mcp-files').map((tool) => tool.name)).toEqual(['write_file'])
  })
})

describe('Agent tool catalog', () => {
  it('combines Claude built-in tools with discovered tools for bound active MCP servers', () => {
    const catalog = buildAgentToolCatalog({
      agent: baseAgent,
      mcpServers: [filesServer, disabledServer],
      mcpToolsByServerId: {
        'mcp-files': [createMcpTool({ name: 'read_file', description: 'Read a file' })],
        'mcp-disabled': [createMcpTool({ name: 'hidden' })]
      }
    })

    expect(catalog.builtin.length).toBeGreaterThan(0)
    expect(catalog.mcp).toEqual([
      expect.objectContaining({
        id: 'mcp__filesystem__readFile',
        name: 'read_file',
        description: 'Read a file',
        origin: 'mcp',
        sourceId: 'mcp-files',
        sourceName: 'Filesystem',
        approval: 'prompt'
      })
    ])
    expect(catalog.enabled.some((tool) => tool.id === 'mcp__disabled__hidden')).toBe(false)
  })

  it('applies disabledTools to built-in and MCP descriptors', () => {
    const catalog = buildAgentToolCatalog({
      agent: {
        ...baseAgent,
        disabledTools: ['Bash', 'mcp__filesystem__readFile']
      },
      mcpServers: [filesServer],
      mcpToolsByServerId: {
        'mcp-files': [createMcpTool({ name: 'read_file' })]
      }
    })

    expect(catalog.disabled.map((tool) => tool.id)).toEqual(expect.arrayContaining(['Bash', 'mcp__filesystem__readFile']))
    expect(catalog.enabled.some((tool) => tool.id === 'Bash')).toBe(false)
    expect(catalog.enabled.some((tool) => tool.id === 'mcp__filesystem__readFile')).toBe(false)
  })

  it('respects source-level MCP disabled and force-prompt policies', () => {
    const catalog = buildAgentToolCatalog({
      agent: baseAgent,
      mcpServers: [
        {
          ...filesServer,
          disabledTools: ['write_file'],
          disabledAutoApproveTools: ['read_file']
        }
      ],
      mcpToolsByServerId: {
        'mcp-files': [createMcpTool({ name: 'read_file' }), createMcpTool({ name: 'write_file' })]
      }
    })

    expect(catalog.mcp).toEqual([
      expect.objectContaining({
        id: 'mcp__filesystem__readFile',
        approval: 'prompt'
      })
    ])
    expect(catalog.all.some((tool) => tool.id === 'mcp__filesystem__writeFile')).toBe(false)
  })

  it('auto-approves built-in tools in bypass permission mode but keeps MCP source prompt stronger', () => {
    const catalog = buildAgentToolCatalog({
      agent: {
        ...baseAgent,
        configuration: { permission_mode: 'bypassPermissions' }
      },
      mcpServers: [
        {
          ...filesServer,
          disabledAutoApproveTools: ['read_file']
        }
      ],
      mcpToolsByServerId: {
        'mcp-files': [createMcpTool({ name: 'read_file' })]
      }
    })

    expect(catalog.all.find((tool) => tool.id === 'Bash')?.approval).toBe('auto')
    expect(catalog.all.find((tool) => tool.id === 'mcp__filesystem__readFile')?.approval).toBe('prompt')
  })
})
