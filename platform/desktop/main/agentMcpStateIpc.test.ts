import { describe, expect, it } from 'vitest'

import { buildAgentMcpCatalog } from '../../ai/agent-platform/mcp/agentMcpViewModel'
import type { McpServerEntity } from '../../ai/agent-platform/schemas/mcpServerSchemas'
import { createAgentStoreState, type AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import { createAgentPlatformServices, type AgentPlatformStateStore } from '../../ai/agent-platform/services'
import type { AgentWorkspaceEntity } from '../../ai/agent-platform/schemas/workspaceSchemas'
import { createAgentIpcHandlers } from './agentIpcHandlers'

const timestamp = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt: timestamp,
  updatedAt: timestamp
}

const server: McpServerEntity = {
  id: 'mcp-files',
  name: 'Filesystem',
  description: 'Local file access',
  type: 'stdio',
  command: 'npx',
  args: [],
  tags: [],
  isActive: true,
  sortOrder: 1
}

function createMemoryStateStore(initialState: AgentStoreState): AgentPlatformStateStore {
  let state = initialState
  return {
    getState: async () => state,
    update: async (updater) => {
      state = updater(state)
      return state
    },
    replace: async (nextState) => {
      state = nextState
      return state
    }
  }
}

describe('agent MCP runtime state over the existing IPC surface', () => {
  it('carries a never-reported server through as idle, all the way to the catalog', async () => {
    // 既有读取口：`agentsGetState`。不新增通道、不新增读取口，只把一条 idle 状态塞进去。
    const services = createAgentPlatformServices(
      createMemoryStateStore(createAgentStoreState({ mcpServers: [server], workspaces: [workspace] })),
      {}
    )
    const handlers = createAgentIpcHandlers(services)

    const state = (await handlers.getState()) as AgentStoreState
    // IPC 边界是 JSON 序列化：这一步能吃掉枚举值、undefined 与不可枚举字段。
    const overTheWire = JSON.parse(JSON.stringify(state)) as AgentStoreState

    expect(overTheWire.mcpRuntimeStatusByServerId['mcp-files']).toBeUndefined()

    const catalog = buildAgentMcpCatalog(
      overTheWire.mcpServers,
      [],
      '',
      overTheWire.mcpRuntimeStatusByServerId
    )

    expect(catalog.all.find((item) => item.id === 'mcp-files')).toMatchObject({
      status: 'idle',
      pickable: true
    })
  })

  it('carries an explicit idle status through serialization unchanged', async () => {
    const services = createAgentPlatformServices(
      createMemoryStateStore(
        createAgentStoreState({
          mcpServers: [server],
          workspaces: [workspace],
          mcpRuntimeStatusByServerId: { 'mcp-files': { state: 'idle', lastCheckedAt: 1 } }
        })
      ),
      {}
    )
    const handlers = createAgentIpcHandlers(services)

    const state = (await handlers.getState()) as AgentStoreState
    const overTheWire = JSON.parse(JSON.stringify(state)) as AgentStoreState
    const catalog = buildAgentMcpCatalog(overTheWire.mcpServers, [], '', overTheWire.mcpRuntimeStatusByServerId)

    expect(catalog.all[0]?.status).toBe('idle')
  })
})
