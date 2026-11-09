import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '../schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { createAgentStoreState, type AgentStoreState } from '../store/agentStore'
import { createAgentPlatformServices, type AgentPlatformStateStore } from './agentServices'

/**
 * 「同进程卡死」那一半：打开/附着某个会话时，如果它在本进程里**没有活着的运行**，
 * 就把**这一个会话**残留的 pending 收成失败。别的会话一条都不许动——它们可能正在跑。
 */

const at = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = { id: 'w', name: 'W', path: '/tmp/w', type: 'user', orderKey: 'w', createdAt: at, updatedAt: at }
const agent: AgentEntity = {
  id: 'agent-1', type: 'claude-code', name: 'A', description: '', instructions: '',
  model: 'provider:model-a', modelName: 'model-a', mcps: [], disabledTools: [],
  configuration: {}, orderKey: 'a', createdAt: at, updatedAt: at
}

function session(id: string): AgentSessionEntity {
  return { id, agentId: agent.id, name: id, workspaceId: workspace.id, workspace, orderKey: id, createdAt: at, updatedAt: at }
}

function pending(sessionId: string): AgentSessionMessageEntity {
  return {
    id: `m-${sessionId}`, sessionId, role: 'assistant',
    data: { parts: [{ type: 'text', text: '半截' }] }, searchableText: '半截',
    status: 'pending', modelId: null, modelSnapshot: null, stats: null, runtimeResumeToken: null,
    createdAt: at, updatedAt: at
  }
}

function memoryStore(state: AgentStoreState): AgentPlatformStateStore {
  let current = state
  return { getState: async () => current, update: async (updater) => { current = updater(current); return current }, replace: async (next) => { current = next; return current } }
}

function harness() {
  const store = memoryStore(createAgentStoreState({
    agents: [agent],
    sessions: [session('session-a'), session('session-b')],
    workspaces: [workspace],
    messagesBySessionId: { 'session-a': [pending('session-a')], 'session-b': [pending('session-b')] }
  }))
  return { store, services: createAgentPlatformServices(store) }
}

describe('opening a session whose turn is gone', () => {
  it('settles only that session, and leaves another session’s running turn alone', async () => {
    const { store, services } = harness()

    await services.messages.settlePendingTurnIfGone('session-a', false)
    const afterA = await store.getState()
    expect(afterA.messagesBySessionId['session-a']?.[0]?.status).toBe('error')
    // 会话 B 正在跑：一条都不许动。
    expect(afterA.messagesBySessionId['session-b']?.[0]?.status).toBe('pending')

    // 会话 B 自己的回合还活着时，连它自己也不动。
    await services.messages.settlePendingTurnIfGone('session-b', true)
    expect((await store.getState()).messagesBySessionId['session-b']?.[0]?.status).toBe('pending')
  })
})
