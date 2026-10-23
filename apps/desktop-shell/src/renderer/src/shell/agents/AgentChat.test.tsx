import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import { createAgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import AgentChat from './AgentChat'
import { AgentTextProvider } from './agentTextProvider'

const createdAt = '2026-07-17T00:00:00.000Z'

describe('AgentChat', () => {
  it.each([
    ['model-service-unavailable', undefined],
    ['runtime-unverified', new Map([['provider:model', {
      providerId: 'provider',
      modelId: 'model',
      runtimeId: 'claude-code' as const,
      selectable: false,
      route: 'none' as const,
      status: 'unknown' as const,
      summary: 'Runtime has not been verified.'
    }]])]
  ])('keeps Task Center reachable while %s blocks messaging', (_name, compatibilityByModelKey) => {
    const markup = render({
      state: createAgentStoreState({
        agents: [agent()],
        sessions: [session()],
        workspaces: [workspace()],
        activeAgentId: 'agent-1',
        activeSessionId: 'session-1'
      }),
      compatibilityByModelKey
    })

    expect(markup).toContain('aria-label="Task center"')
    expect(markup).toContain('agent-chat-pane empty with-navbar')
    expect(markup).toContain('agent-status-screen')
    expect(markup).not.toContain('agent-session-inputbar')
  })

  it.each([
    ['no agents', createAgentStoreState({})],
    ['no session', createAgentStoreState({ agents: [agent()], activeAgentId: 'agent-1' })]
  ])('does not render Task Center when there are %s', (_name, state) => {
    const markup = render({ state })

    expect(markup).not.toContain('aria-label="Task center"')
    expect(markup).not.toContain('with-navbar')
  })

  it('reserves a fixed header row for blocked Task Center access', () => {
    const styles = readFileSync(resolve(import.meta.dirname, '../../styles.css'), 'utf8')

    expect(styles).toContain('.agent-chat-pane.empty.with-navbar')
    expect(styles).toContain('grid-template-rows: 44px minmax(0, 1fr);')
  })
})

function render(input: {
  state: ReturnType<typeof createAgentStoreState>
  compatibilityByModelKey?: ReadonlyMap<string, {
    providerId: string
    modelId: string
    runtimeId: 'claude-code'
    selectable: boolean
    route: 'none'
    status: 'unknown'
    summary: string
  }>
}) {
  return renderToStaticMarkup(
    <AgentTextProvider language="en-US">
      <AgentChat
        state={input.state}
        runtimeSnapshot={{ sessions: {}, toolApprovals: [], toolApprovalHistory: [], chunksBySessionId: {}, updatedAt: '' }}
        channelRuntimeSnapshot={{ channels: [] }}
        providers={[]}
        pinnedModelIds={[]}
        chatSettings={createDefaultAppSettings().chat}
        compatibilityByModelKey={input.compatibilityByModelKey}
        onStateChange={() => undefined}
        onRuntimeSnapshotChange={() => undefined}
        onChannelRuntimeSnapshotChange={() => undefined}
        onEditAgent={() => undefined}
      />
    </AgentTextProvider>
  )
}

function agent(): AgentEntity {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Agent',
    model: 'provider:model',
    modelName: 'Model',
    orderKey: '0001',
    createdAt,
    updatedAt: createdAt,
    configuration: { permission_mode: 'bypassPermissions' }
  }
}

function workspace(): AgentWorkspaceEntity {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    type: 'user',
    orderKey: '0001',
    createdAt,
    updatedAt: createdAt
  }
}

function session(): AgentSessionEntity {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    name: 'Session',
    workspaceId: 'workspace-1',
    workspace: workspace(),
    orderKey: '0001',
    createdAt,
    updatedAt: createdAt
  }
}
