import { describe, expect, it } from 'vitest'

import type { AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'

import { buildTaskWorkspaceOptions } from './agentTaskWorkspaceOptions'

describe('agentTaskWorkspaceOptions', () => {
  it('does not duplicate persisted system workspaces as user task workspace sources', () => {
    expect(
      buildTaskWorkspaceOptions(
        [
          workspaceFixture({
            id: 'workspace-system',
            name: 'System persisted workspace',
            path: '/tmp/system',
            type: 'system'
          }),
          workspaceFixture({
            id: 'workspace-user',
            name: 'Project',
            path: '/project',
            type: 'user'
          })
        ],
        { systemWorkspace: 'System workspace' }
      )
    ).toEqual([
      { value: '__system__', label: 'System workspace', workspace: { type: 'system' } },
      { value: 'workspace-user', label: 'Project', workspace: { type: 'user', workspaceId: 'workspace-user' } }
    ])
  })
})

function workspaceFixture(overrides: Partial<AgentWorkspaceEntity> = {}): AgentWorkspaceEntity {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/workspace',
    type: 'user',
    orderKey: 'a',
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    ...overrides
  }
}
