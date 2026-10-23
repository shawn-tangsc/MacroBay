import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentStoreSeed, AgentStoreState } from './agentStore'
import {
  createAgentPersistentStore,
  createDefaultAgentPersistentState,
  mergeAgentStoreSeeds,
  normalizeAgentStoreState
} from './agentPersistentStore'

const createdAt = '2026-01-01T00:00:00.000Z'

const baseAgent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Seed Agent',
  model: 'provider:model-a',
  modelName: 'Model A',
  createdAt,
  updatedAt: createdAt,
  orderKey: '0001',
  configuration: { avatar: 'A' }
}

const extraAgent: AgentEntity = {
  ...baseAgent,
  id: 'agent-2',
  name: 'Extra Seed Agent',
  orderKey: '0002'
}

function seed(agent: AgentEntity = baseAgent): AgentStoreSeed {
  return {
    agents: [agent],
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/tmp/workspace',
        type: 'user',
        orderKey: '0001',
        createdAt,
        updatedAt: createdAt
      }
    ],
    sessions: [
      {
        id: 'session-1',
        agentId: agent.id,
        name: 'Seed Session',
        workspaceId: 'workspace-1',
        workspace: {
          id: 'workspace-1',
          name: 'Workspace',
          path: '/tmp/workspace',
          type: 'user',
          orderKey: '0001',
          createdAt,
          updatedAt: createdAt
        },
        orderKey: '0001',
        createdAt,
        updatedAt: createdAt
      }
    ],
    activeAgentId: agent.id,
    activeSessionId: 'session-1'
  }
}

describe('agent persistent store', () => {
  it('preserves an explicitly selected unassigned session when merging seeds', () => {
    const state = createDefaultAgentPersistentState(seed())
    const original = { ...state.sessions[0], agentId: null }
    state.sessions = [{ ...original, id: 'first' }, { ...original, id: 'selected' }]
    state.activeAgentId = null
    state.activeSessionId = 'selected'
    expect(mergeAgentStoreSeeds(state, {}).activeSessionId).toBe('selected')
  })
  it('preserves an explicitly selected agent without sessions through normalization and seed merge', () => {
    const selected = { ...createDefaultAgentPersistentState(seed()), agents: [baseAgent, extraAgent], activeAgentId: extraAgent.id, activeSessionId: null }
    const normalized = normalizeAgentStoreState(selected)
    expect(normalized.activeAgentId).toBe(extraAgent.id)
    expect(normalized.activeSessionId).toBeNull()
    const merged = mergeAgentStoreSeeds(normalized, seed())
    expect(merged.activeAgentId).toBe(extraAgent.id)
    expect(merged.activeSessionId).toBeNull()
    expect(merged.sessions).toHaveLength(1)
  })
  it('creates a complete empty state', () => {
    const state = createDefaultAgentPersistentState()

    expect(state).toMatchObject({
      agents: [],
      sessions: [],
      workspaces: [],
      sessionPins: [],
      messagesBySessionId: {},
      mcpServers: [],
      mcpToolsByServerId: {},
      mcpRuntimeStatusByServerId: {},
      channels: [],
      skills: [],
      agentSkills: [],
      tasks: [],
      taskRunLogs: [],
      channelTaskSubscriptions: [],
      activeAgentId: null,
      activeSessionId: null
    })
  })

  it('normalizes malformed persisted values instead of leaking invalid collections', () => {
    const state = normalizeAgentStoreState({
      agents: 'broken',
      sessions: [{ id: 'session-1' }],
      workspaces: null,
      messagesBySessionId: { 'session-1': 'broken' },
      mcpServers: [{ id: 'mcp-1' }],
      mcpToolsByServerId: {
        'mcp-1': [{ name: 'search' }, { broken: true }]
      },
      mcpRuntimeStatusByServerId: {
        'mcp-1': { state: 'connected', lastCheckedAt: 1 },
        broken: { state: 'unknown' }
      },
      channels: [{ id: 'channel-1' }],
      activeAgentId: 42
    })

    expect(state.agents).toEqual([])
    expect(state.sessions).toEqual([{ id: 'session-1' }])
    expect(state.workspaces).toEqual([])
    expect(state.messagesBySessionId).toEqual({})
    expect(state.mcpServers).toEqual([{ id: 'mcp-1' }])
    expect(state.mcpToolsByServerId).toEqual({ 'mcp-1': [{ name: 'search' }] })
    expect(state.mcpRuntimeStatusByServerId).toEqual({ 'mcp-1': { state: 'connected', lastCheckedAt: 1 } })
    expect(state.channels).toEqual([{ id: 'channel-1' }])
    expect(state.activeAgentId).toBeNull()
  })

  it('merges new seed records without overwriting user-owned agent configuration', () => {
    const userState = normalizeAgentStoreState(seed({ ...baseAgent, name: 'User Renamed Agent' }))
    const merged = mergeAgentStoreSeeds(userState, {
      ...seed(),
      agents: [baseAgent, extraAgent]
    })

    expect(merged.agents.find((agent) => agent.id === 'agent-1')?.name).toBe('User Renamed Agent')
    expect(merged.agents.find((agent) => agent.id === 'agent-2')?.name).toBe('Extra Seed Agent')
  })

  it('upgrades a seeded agent from the unconfigured model placeholder when a provider model becomes available', () => {
    const userState = normalizeAgentStoreState(
      seed({
        ...baseAgent,
        name: 'User Renamed Agent',
        model: 'unconfigured:default-chat-model',
        modelName: '未选择模型'
      })
    )
    const merged = mergeAgentStoreSeeds(userState, {
      ...seed({
        ...baseAgent,
        model: 'silicon:deepseek-ai/DeepSeek-V3.2',
        modelName: 'Silicon / DeepSeek V3.2'
      })
    })

    expect(merged.agents.find((agent) => agent.id === 'agent-1')).toMatchObject({
      name: 'User Renamed Agent',
      model: 'silicon:deepseek-ai/DeepSeek-V3.2',
      modelName: 'Silicon / DeepSeek V3.2'
    })
  })

  it('does not overwrite a seeded agent model that the user already configured', () => {
    const userState = normalizeAgentStoreState(
      seed({
        ...baseAgent,
        model: 'openai:gpt-5',
        modelName: 'OpenAI / GPT-5'
      })
    )
    const merged = mergeAgentStoreSeeds(userState, {
      ...seed({
        ...baseAgent,
        model: 'silicon:deepseek-ai/DeepSeek-V3.2',
        modelName: 'Silicon / DeepSeek V3.2'
      })
    })

    expect(merged.agents.find((agent) => agent.id === 'agent-1')).toMatchObject({
      model: 'openai:gpt-5',
      modelName: 'OpenAI / GPT-5'
    })
  })

  it('upgrades the platform default assistant from an obsolete seed model to the current ready seed model', () => {
    const userState = normalizeAgentStoreState(
      seed({
        ...baseAgent,
        id: 'default-assistant',
        name: '默认助手',
        model: 'silicon:deepseek-ai/DeepSeek-V4-Pro',
        modelName: 'Silicon / DeepSeek V4 Pro'
      })
    )
    const merged = mergeAgentStoreSeeds(userState, {
      ...seed({
        ...baseAgent,
        id: 'default-assistant',
        name: '默认助手',
        model: 'deepseek:deepseek-v4-pro',
        modelName: 'deepseek / deepseek-v4-pro'
      })
    })

    expect(merged.agents.find((agent) => agent.id === 'default-assistant')).toMatchObject({
      model: 'deepseek:deepseek-v4-pro',
      modelName: 'deepseek / deepseek-v4-pro'
    })
  })

  it('loads seeded state, persists updates, and reloads the saved snapshot', async () => {
    let persisted: unknown = null
    const writes: AgentStoreState[] = []
    const storage = {
      read: async () => persisted,
      write: async (state: AgentStoreState) => {
        persisted = state
        writes.push(state)
      }
    }
    const store = createAgentPersistentStore(storage, seed())

    const initial = await store.getState()
    expect(initial.agents.map((agent) => agent.id)).toEqual(['agent-1'])

    const updated = await store.update((current) => ({
      ...current,
      agents: current.agents.map((agent) => (agent.id === 'agent-1' ? { ...agent, name: 'Saved Agent' } : agent))
    }))

    expect(updated.agents[0].name).toBe('Saved Agent')
    expect(writes).toHaveLength(1)

    const reloadedStore = createAgentPersistentStore(storage, seed({ ...extraAgent, id: 'agent-3' }))
    const reloaded = await reloadedStore.getState()
    expect(reloaded.agents.find((agent) => agent.id === 'agent-1')?.name).toBe('Saved Agent')
    expect(reloaded.agents.find((agent) => agent.id === 'agent-3')?.name).toBe('Extra Seed Agent')
  })

  it('publishes only after storage succeeds and continues after a failed write', async () => {
    let persisted: AgentStoreState | null = null
    let failNextWrite = true
    const storage = {
      read: async () => persisted,
      write: async (next: AgentStoreState) => {
        if (failNextWrite) {
          failNextWrite = false
          throw new Error('disk-full')
        }
        persisted = next
      }
    }
    const store = createAgentPersistentStore(storage, seed())

    await expect(
      store.update((current) => ({
        ...current,
        agents: current.agents.map((agent) => ({ ...agent, name: 'Failed write' }))
      }))
    ).rejects.toThrow('disk-full')
    expect((await store.getState()).agents[0]?.name).toBe('Seed Agent')
    expect(persisted).toBeNull()

    await store.update((current) => ({
      ...current,
      agents: current.agents.map((agent) => ({ ...agent, name: 'Saved after failure' }))
    }))
    expect((await store.getState()).agents[0]?.name).toBe('Saved after failure')
    const savedState = persisted as AgentStoreState | null
    expect(savedState?.agents[0]?.name).toBe('Saved after failure')
  })

  it('serializes concurrent updates without losing different agent subtree patches', async () => {
    const storage = {
      read: async () => null,
      write: async () => undefined
    }
    const store = createAgentPersistentStore(storage, seed())

    await Promise.all([
      store.update((current) => ({
        ...current,
        agents: current.agents.map((agent) => ({
          ...agent,
          configuration: { ...agent.configuration, sessionPanelPosition: 'left' }
        }))
      })),
      store.update((current) => ({
        ...current,
        agents: current.agents.map((agent) => ({
          ...agent,
          configuration: { ...agent.configuration, sessionNaming: 'manual' }
        }))
      }))
    ])

    expect((await store.getState()).agents[0]?.configuration).toMatchObject({
      sessionPanelPosition: 'left',
      sessionNaming: 'manual'
    })
  })
})
