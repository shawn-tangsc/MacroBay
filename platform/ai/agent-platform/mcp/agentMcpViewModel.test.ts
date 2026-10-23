import { describe, expect, it } from 'vitest'

import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import { buildAgentMcpCatalog } from './agentMcpViewModel'

const activeServer: McpServerEntity = {
  id: 'mcp-files',
  name: 'Filesystem',
  description: 'Local file access',
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  tags: ['local', 'files'],
  isActive: true,
  sortOrder: 1
}

const inactiveServer: McpServerEntity = {
  id: 'mcp-github',
  name: 'GitHub',
  description: 'Issue and repository tools',
  type: 'sse',
  baseUrl: 'https://example.test/mcp',
  tags: ['code'],
  isActive: false,
  sortOrder: 2
}

describe('agent MCP view model', () => {
  it('builds bound and addable MCP catalog items with inactive servers visible but not pickable', () => {
    const catalog = buildAgentMcpCatalog(
      [activeServer, inactiveServer],
      ['mcp-github'],
      '',
      { 'mcp-files': { state: 'connected', lastCheckedAt: 1 } }
    )

    expect(catalog.bound.map((item) => item.id)).toEqual(['mcp-github'])
    expect(catalog.addable.map((item) => item.id)).toEqual(['mcp-files'])
    expect(catalog.all.find((item) => item.id === 'mcp-files')).toMatchObject({
      bound: false,
      pickable: true,
      status: 'connected'
    })
    expect(catalog.all.find((item) => item.id === 'mcp-github')).toMatchObject({
      bound: true,
      pickable: false,
      status: 'disabled'
    })
  })

  it('searches across MCP metadata', () => {
    const catalog = buildAgentMcpCatalog([activeServer, inactiveServer], [], 'repo')

    expect(catalog.all.map((item) => item.id)).toEqual(['mcp-github'])
  })

  it('uses runtime status snapshots with runtime defaults', () => {
    const catalog = buildAgentMcpCatalog(
      [activeServer, inactiveServer],
      [],
      '',
      {
        'mcp-files': {
          state: 'error',
          message: 'Process exited',
          lastCheckedAt: 42
        }
      }
    )

    expect(catalog.all.find((item) => item.id === 'mcp-files')).toMatchObject({
      status: 'error',
      statusText: 'Process exited',
      actions: [
        {
          id: 'copy-hint',
          labelKey: 'editor.tools.mcpActionCopyHint',
          hint: 'Process exited'
        },
        {
          id: 'restart',
          labelKey: 'editor.tools.mcpActionRestart'
        }
      ]
    })
    expect(catalog.all.find((item) => item.id === 'mcp-github')).toMatchObject({
      status: 'disabled',
      statusText: '',
      actions: []
    })
  })

  it('surfaces auth credential actions from runtime diagnostics', () => {
    const catalog = buildAgentMcpCatalog(
      [
        {
          ...inactiveServer,
          isActive: true,
          providerUrl: 'https://github.com/settings/tokens'
        }
      ],
      [],
      '',
      {
        'mcp-github': {
          state: 'error',
          errorKind: 'auth',
          message: 'Unauthorized',
          lastCheckedAt: 7
        }
      }
    )

    expect(catalog.all.find((item) => item.id === 'mcp-github')).toMatchObject({
      status: 'error',
      errorKind: 'auth',
      providerUrl: 'https://github.com/settings/tokens',
      actions: [
        {
          id: 'open-url',
          url: 'https://github.com/settings/tokens'
        },
        { id: 'open-settings' },
        {
          id: 'copy-hint',
          hint: 'Unauthorized'
        },
        { id: 'restart' }
      ]
    })
  })
})
