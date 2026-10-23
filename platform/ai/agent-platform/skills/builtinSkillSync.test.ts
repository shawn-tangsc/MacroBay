import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { createAgentStoreState } from '../store/agentStore'
import { createSkillService, type SkillServicePaths } from './skillService'
import { syncBuiltinSkillsFromResource } from './builtinSkillSync'

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

async function createBuiltinSkill(resourceRoot: string, folder = 'skill-creator'): Promise<void> {
  const source = join(resourceRoot, folder)
  await mkdir(source, { recursive: true })
  await writeFile(
    join(source, 'SKILL.md'),
    ['---', 'name: Skill Creator', 'description: Creates high quality skills', 'tags: [skill, authoring]', '---', '', '# Skill Creator'].join(
      '\n'
    ),
    'utf8'
  )
}

describe('built-in skill sync', () => {
  it('returns the original state when the bundled resource directory is missing', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'builtin-sync', `missing-${Date.now()}`)
    const service = createSkillService({ paths: paths(root) })
    const state = createAgentStoreState({ agents: [agent] })

    await expect(
      syncBuiltinSkillsFromResource({
        state,
        service,
        resourceSkillsRoot: join(root, 'missing-resources'),
        appVersion: '1.0.0'
      })
    ).resolves.toBe(state)
  })

  it('copies bundled skills, writes the install version, and registers them as enabled built-ins', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'builtin-sync', `install-${Date.now()}`)
    const resourceRoot = join(root, 'resources', 'skills')
    const workspace: AgentWorkspaceEntity = {
      id: 'workspace-1',
      name: 'Workspace',
      path: join(root, 'workspace'),
      type: 'user',
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    }
    await createBuiltinSkill(resourceRoot)
    const service = createSkillService({ paths: paths(root) })
    const state = createAgentStoreState({
      agents: [agent],
      workspaces: [workspace],
      sessions: [
        {
          id: 'session-1',
          agentId: agent.id,
          name: 'Session',
          workspaceId: workspace.id,
          workspace,
          orderKey: '0001',
          createdAt,
          updatedAt: createdAt
        }
      ]
    })

    const next = await syncBuiltinSkillsFromResource({
      state,
      service,
      resourceSkillsRoot: resourceRoot,
      appVersion: '1.0.0'
    })

    expect(next.skills[0]).toMatchObject({
      name: 'Skill Creator',
      folderName: 'skill-creator',
      source: 'builtin'
    })
    expect(next.agentSkills).toEqual([{ agentId: agent.id, skillId: next.skills[0].id, isEnabled: true }])
    expect(await readFile(join(root, 'Skills', 'skill-creator', '.version'), 'utf8')).toBe('1.0.0')
    expect((await lstat(join(workspace.path, '.claude', 'skills', 'skill-creator'))).isSymbolicLink()).toBe(true)
  })

  it('still syncs metadata when files are already on the current app version', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'builtin-sync', `metadata-${Date.now()}`)
    const resourceRoot = join(root, 'resources', 'skills')
    await createBuiltinSkill(resourceRoot)
    await mkdir(join(root, 'Skills', 'skill-creator'), { recursive: true })
    await writeFile(join(root, 'Skills', 'skill-creator', 'SKILL.md'), '# stale but versioned', 'utf8')
    await writeFile(join(root, 'Skills', 'skill-creator', '.version'), '1.0.0', 'utf8')
    const service = createSkillService({ paths: paths(root) })

    const next = await syncBuiltinSkillsFromResource({
      state: createAgentStoreState({ agents: [agent] }),
      service,
      resourceSkillsRoot: resourceRoot,
      appVersion: '1.0.0'
    })

    expect(next.skills[0]).toMatchObject({
      folderName: 'skill-creator',
      source: 'builtin'
    })
    expect(await readFile(join(root, 'Skills', 'skill-creator', 'SKILL.md'), 'utf8')).toBe('# stale but versioned')
  })
})
