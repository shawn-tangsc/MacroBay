import { describe, expect, it } from 'vitest'

import type { McpRuntimeLifecycleState, McpRuntimeState, McpServerEntity } from '../schemas/mcpServerSchemas'
import { mcpRuntimeLifecycleStates, mcpRuntimeStates } from '../schemas/mcpServerSchemas'
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

  it('reports a server without any runtime report as idle, not as connecting', () => {
    const catalog = buildAgentMcpCatalog([activeServer], [], '')

    expect(catalog.all.find((item) => item.id === 'mcp-files')).toMatchObject({
      status: 'idle',
      statusText: '',
      pickable: true
    })
  })

  it('keeps an errored server pickable and carries the runtime reason', () => {
    const catalog = buildAgentMcpCatalog([activeServer], [], '', {
      'mcp-files': { state: 'error', message: 'Process exited', lastCheckedAt: 1 }
    })

    expect(catalog.all.find((item) => item.id === 'mcp-files')).toMatchObject({
      status: 'error',
      statusText: 'Process exited',
      pickable: true
    })
  })

  it('binds every runtime state to the lifecycle vocabulary instead of inventing a word', () => {
    // 两个闭集共用一套词：`state` 的每一格都必须能在 `mcpRuntimeLifecycleStates` 里找到同名或同义的对应物。
    // 写成 `Record<McpRuntimeState, …>` 是有意的——新增一格却忘了在这里表态会直接编译失败，
    // 这正是 `idle` 缺格那次的成因：缺一格，兜底就替它编了一格。
    const lifecycle: Record<McpRuntimeState, readonly McpRuntimeLifecycleState[]> = {
      idle: ['idle'],
      connecting: ['connecting', 'reconnecting'],
      connected: ['connected'],
      error: ['terminal-error', 'retry-exhausted', 'reconnect-scheduled'],
      disabled: ['disabled']
    }

    for (const [state, equivalents] of Object.entries(lifecycle)) {
      expect(mcpRuntimeStates).toContain(state)
      for (const equivalent of equivalents) {
        expect(mcpRuntimeLifecycleStates).toContain(equivalent)
      }
    }
  })
})
