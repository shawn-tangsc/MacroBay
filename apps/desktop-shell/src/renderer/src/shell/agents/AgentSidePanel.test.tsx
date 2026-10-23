import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import { createAgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import AgentSidePanel from './AgentSidePanel'
import { AgentTextProvider } from './agentTextProvider'

const createdAt = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/Users/demo/project',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt,
  updatedAt: createdAt
}

const agents: AgentEntity[] = [
  agent('agent-1', 'Research Agent'),
  agent('agent-2', 'Code Agent')
]

const sessions: AgentSessionEntity[] = [
  session('session-1', 'agent-1', 'Research chat'),
  session('session-2', 'agent-2', 'Code chat')
]

describe('AgentSidePanel', () => {
  it('renders agent and session tabs while scoping sessions to the active agent', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentSidePanel
          state={createAgentStoreState({
            agents,
            sessions,
            workspaces: [workspace],
            activeAgentId: 'agent-1',
            activeSessionId: 'session-1'
          })}
          runtimeStateBySessionId={{}}
          channelRuntimeSnapshot={{ channels: [] }}
          sessionPanelPosition="left"
          onUpdateSessionPanelPosition={() => undefined}
          onCreateAgent={() => undefined}
          onEditAgent={() => undefined}
          onStateChange={(updater) => updater({} as never)}
        />
      </AgentTextProvider>
    )

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('>智能体<')
    expect(markup).toContain('>会话<')
    expect(markup).toContain('>新建会话<')
    expect(markup).toContain('Research chat')
    expect(markup).not.toContain('Code chat')
  })

  it('does not render nested buttons in session rows', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentSidePanel
          state={createAgentStoreState({
            agents,
            sessions,
            workspaces: [workspace],
            activeAgentId: 'agent-1',
            activeSessionId: 'session-1'
          })}
          runtimeStateBySessionId={{}}
          channelRuntimeSnapshot={{ channels: [] }}
          sessionPanelPosition="left"
          onUpdateSessionPanelPosition={() => undefined}
          onCreateAgent={() => undefined}
          onEditAgent={() => undefined}
          onStateChange={(updater) => updater({} as never)}
        />
      </AgentTextProvider>
    )

    expect(markup).not.toMatch(/<button[^>]*class="[^"]*agent-session-item[\s\S]*?<button/)
  })
})

function agent(id: string, name: string): AgentEntity {
  return {
    id,
    type: 'claude-code',
    name,
    model: `provider:${id}`,
    modelName: id,
    createdAt,
    updatedAt: createdAt,
    orderKey: id,
    configuration: {}
  }
}

function session(id: string, agentId: string, name: string): AgentSessionEntity {
  return {
    id,
    agentId,
    name,
    workspaceId: workspace.id,
    workspace,
    orderKey: id,
    createdAt,
    updatedAt: createdAt
  }
}
