import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '../../ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '../../ai/agent-platform/schemas/sessionSchemas'
import type { InstalledSkill } from '../../ai/agent-platform/schemas/skillSchemas'
import type { AgentWorkspaceEntity } from '../../ai/agent-platform/schemas/workspaceSchemas'
import { createAgentStoreState, type AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import { createSkillService, type SkillServicePaths } from '../../ai/agent-platform/skills/skillService'
import { createAgentStateCoordinator } from './agentStateCoordinator'

const createdAt = '2026-01-01T00:00:00.000Z'

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Agent',
  model: 'provider:model',
  modelName: 'Model',
  configuration: {},
  createdAt,
  updatedAt: createdAt,
  orderKey: '0001'
}

function paths(root: string): SkillServicePaths {
  return {
    skillsRoot: join(root, 'Skills'),
    installTempRoot: join(root, 'tmp')
  }
}

async function createSourceSkill(root: string, folder = 'code-reader'): Promise<string> {
  const source = join(root, 'source', folder)
  await mkdir(join(source, 'references'), { recursive: true })
  await writeFile(
    join(source, 'SKILL.md'),
    [
      '---',
      'name: Code Reader',
      'description: Reads source context',
      'author: Demo Author',
      'tags:',
      '  - code',
      '---',
      '',
      '# Code Reader'
    ].join('\n'),
    'utf8'
  )
  await writeFile(join(source, 'references', 'guide.md'), 'Use carefully', 'utf8')
  return source
}

function createCoordinator(
  service: ReturnType<typeof createSkillService>,
  initialState: AgentStoreState
) {
  let state = initialState
  const syncSkillsRuntimeFromState = vi.fn()
  const syncMcpRuntimeFromState = vi.fn()
  const syncChannelsFromState = vi.fn()
  const syncTaskSchedulerFromState = vi.fn()
  const emitStateChanged = vi.fn()
  const coordinator = createAgentStateCoordinator({
    getState: async () => state,
    replaceState: async (nextState) => {
      state = nextState
      return state
    },
    enableBuiltinSkillsForNewAgents: service.enableBuiltinSkillsForNewAgents.bind(service),
    reconcileWorkspaceSkills: service.reconcileWorkspaceSkills.bind(service),
    syncSkillsRuntimeFromState,
    syncMcpRuntimeFromState,
    syncChannelsFromState,
    syncTaskSchedulerFromState,
    emitStateChanged
  })

  return {
    coordinator,
    getState: () => state,
    setState: (nextState: AgentStoreState) => {
      state = nextState
    },
    syncSkillsRuntimeFromState,
    syncMcpRuntimeFromState,
    syncChannelsFromState,
    syncTaskSchedulerFromState,
    emitStateChanged
  }
}

async function installBuiltinSkill(
  root: string,
  service: ReturnType<typeof createSkillService>
): Promise<{ state: AgentStoreState; skill: InstalledSkill }> {
  const source = await createSourceSkill(root, 'builtin-code-reader')
  return service.syncBuiltinSkill(createAgentStoreState(), 'builtin-code-reader', source, true)
}

describe('agent state coordinator', () => {
  it('enables builtin skills for a new agent, reconciles workspace links, and emits synced state', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'agent-state-coordinator', `builtin-${Date.now()}`)
    const workspace: AgentWorkspaceEntity = {
      id: 'workspace-1',
      name: 'Workspace',
      path: join(root, 'workspace'),
      type: 'user',
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    }
    await mkdir(workspace.path, { recursive: true })
    const service = createSkillService({ paths: paths(root) })
    const builtin = await installBuiltinSkill(root, service)
    const session: AgentSessionEntity = {
      id: 'session-1',
      agentId: agent.id,
      name: 'Session',
      workspaceId: workspace.id,
      workspace,
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    }
    const nextState = createAgentStoreState({
      ...builtin.state,
      agents: [agent],
      workspaces: [workspace],
      sessions: [session]
    })
    const harness = createCoordinator(service, builtin.state)
    const beforePersist = vi.fn()

    const result = await harness.coordinator.replaceState(nextState, { previousState: builtin.state, beforePersist })

    expect(result.agentSkills).toEqual([{ agentId: agent.id, skillId: builtin.skill.id, isEnabled: true }])
    expect(beforePersist).toHaveBeenCalledOnce()
    expect(beforePersist.mock.calls[0]?.[0]).toBe(builtin.state)
    expect(beforePersist.mock.calls[0]?.[1].agentSkills).toEqual([
      { agentId: agent.id, skillId: builtin.skill.id, isEnabled: true }
    ])
    expect((await lstat(join(workspace.path, '.claude', 'skills', 'builtin-code-reader'))).isSymbolicLink()).toBe(true)
    expect(harness.syncSkillsRuntimeFromState).toHaveBeenCalledWith(result)
    expect(harness.syncMcpRuntimeFromState).toHaveBeenCalledWith(result)
    expect(harness.syncChannelsFromState).toHaveBeenCalledWith(result)
    expect(harness.syncTaskSchedulerFromState).toHaveBeenCalledWith(result)
    expect(harness.emitStateChanged).toHaveBeenCalledWith(result)
  })

  it('uses the previous state to clean stale workspace links after a session rebind', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'agent-state-coordinator', `rebind-${Date.now()}`)
    const firstWorkspace: AgentWorkspaceEntity = {
      id: 'workspace-1',
      name: 'Workspace One',
      path: join(root, 'workspace-1'),
      type: 'user',
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    }
    const secondWorkspace: AgentWorkspaceEntity = {
      id: 'workspace-2',
      name: 'Workspace Two',
      path: join(root, 'workspace-2'),
      type: 'user',
      orderKey: '0002',
      createdAt,
      updatedAt: createdAt
    }
    await mkdir(firstWorkspace.path, { recursive: true })
    await mkdir(secondWorkspace.path, { recursive: true })
    const service = createSkillService({ paths: paths(root) })
    const source = await createSourceSkill(root, 'code-reader')
    const installed = await service.installFromDirectory(
      createAgentStoreState({
        agents: [agent],
        workspaces: [firstWorkspace, secondWorkspace],
        sessions: [
          {
            id: 'session-1',
            agentId: agent.id,
            name: 'Session',
            workspaceId: firstWorkspace.id,
            workspace: firstWorkspace,
            orderKey: '0001',
            createdAt,
            updatedAt: createdAt
          }
        ]
      }),
      { directoryPath: source }
    )
    const previousState = createAgentStoreState({
      ...installed.state,
      workspaces: [firstWorkspace, secondWorkspace],
      agentSkills: [{ agentId: agent.id, skillId: installed.skill.id, isEnabled: true }]
    })
    const nextState = createAgentStoreState({
      ...previousState,
      sessions: [
        {
          id: 'session-1',
          agentId: agent.id,
          name: 'Session',
          workspaceId: secondWorkspace.id,
          workspace: secondWorkspace,
          orderKey: '0001',
          createdAt,
          updatedAt: createdAt
        }
      ]
    })
    await service.linkSkill(installed.skill.folderName, firstWorkspace.path)
    const harness = createCoordinator(service, nextState)

    await harness.coordinator.syncAfterMutation(previousState)

    await expect(lstat(join(firstWorkspace.path, '.claude', 'skills', 'code-reader'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await lstat(join(secondWorkspace.path, '.claude', 'skills', 'code-reader'))).isSymbolicLink()).toBe(true)
    expect(harness.emitStateChanged).toHaveBeenCalledWith(harness.getState())
  })
})
