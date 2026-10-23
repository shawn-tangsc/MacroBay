import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { createAgentStoreState } from '../store/agentStore'
import { createSkillService, type SkillRepositoryFetcher, type SkillServicePaths } from './skillService'

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
      '  - review',
      '---',
      '',
      '# Code Reader'
    ].join('\n'),
    'utf8'
  )
  await writeFile(join(source, 'references', 'guide.md'), 'Use carefully', 'utf8')
  return source
}

describe('skill service', () => {
  it('uses repository-backed list query adapter when one is provided', () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `query-adapter-${Date.now()}`)
    const rowSkill = {
      id: 'skill-row',
      name: 'Row Skill',
      description: 'Loaded from repository',
      folderName: 'row-skill',
      source: 'local',
      sourceUrl: null,
      namespace: null,
      author: null,
      sourceTags: ['row'],
      contentHash: 'hash-row',
      isEnabled: true,
      createdAt,
      updatedAt: createdAt
    }
    const service = createSkillService({
      paths: paths(root),
      queries: {
        list: (query) => (query?.agentId === agent.id && query.search === 'row' ? [rowSkill] : [])
      }
    })
    const snapshotState = createAgentStoreState({
      skills: [
        {
          ...rowSkill,
          id: 'skill-snapshot',
          name: 'Snapshot Skill',
          folderName: 'snapshot-skill'
        }
      ]
    })

    expect(service.list(snapshotState, { agentId: agent.id, search: 'row' })).toEqual([rowSkill])
  })

  it('installs a local skill directory and preserves the skill id on update', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `install-${Date.now()}`)
    const source = await createSourceSkill(root)
    const service = createSkillService({ paths: paths(root) })
    const state = createAgentStoreState({ agents: [agent] })

    const first = await service.installFromDirectory(state, { directoryPath: source })
    const second = await service.installFromDirectory(first.state, { directoryPath: source })

    expect(first.skill).toMatchObject({
      name: 'Code Reader',
      description: 'Reads source context',
      folderName: 'code-reader',
      source: 'local',
      sourceTags: ['code', 'review'],
      isEnabled: true
    })
    expect(second.skill.id).toBe(first.skill.id)
    expect(second.state.skills).toHaveLength(1)
    expect(await readFile(join(root, 'Skills', 'code-reader', 'references', 'guide.md'), 'utf8')).toBe('Use carefully')
  })

  it('syncs a new built-in skill, enables it for every existing agent, and links active workspaces', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `builtin-${Date.now()}`)
    const workspace: AgentWorkspaceEntity = {
      id: 'workspace-1',
      name: 'Workspace',
      path: join(root, 'workspace'),
      type: 'user',
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    }
    const source = await createSourceSkill(root, 'builtin-code-reader')
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

    const result = await service.syncBuiltinSkill(state, 'builtin-code-reader', source, true)

    expect(result.skill).toMatchObject({
      name: 'Code Reader',
      folderName: 'builtin-code-reader',
      source: 'builtin',
      sourceUrl: null,
      isEnabled: true
    })
    expect(result.state.agentSkills).toEqual([{ agentId: agent.id, skillId: result.skill.id, isEnabled: true }])
    expect((await lstat(join(workspace.path, '.claude', 'skills', 'builtin-code-reader'))).isSymbolicLink()).toBe(true)
  })

  it('refreshes built-in metadata in place without overriding existing per-agent choices', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `builtin-update-${Date.now()}`)
    const source = await createSourceSkill(root, 'builtin-code-reader')
    const service = createSkillService({ paths: paths(root) })
    const existing = await service.syncBuiltinSkill(createAgentStoreState({ agents: [agent] }), 'builtin-code-reader', source, true)
    const disabledState = await service.toggle(existing.state, {
      agentId: agent.id,
      skillId: existing.skill.id,
      isEnabled: false
    })

    await writeFile(
      join(source, 'SKILL.md'),
      [
        '---',
        'name: Better Reader',
        'description: Reads updated source context',
        'author: Demo Author',
        'tags:',
        '  - updated',
        '---',
        '',
        '# Better Reader'
      ].join('\n'),
      'utf8'
    )
    const updated = await service.syncBuiltinSkill(disabledState.state, 'builtin-code-reader', source, true)

    expect(updated.skill.id).toBe(existing.skill.id)
    expect(updated.skill).toMatchObject({
      name: 'Better Reader',
      description: 'Reads updated source context',
      sourceTags: ['updated']
    })
    expect(updated.state.agentSkills).toEqual([{ agentId: agent.id, skillId: existing.skill.id, isEnabled: false }])
  })

  it('auto-enables built-in skills only for agents without an existing skill choice', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `builtin-agent-defaults-${Date.now()}`)
    const service = createSkillService({ paths: paths(root) })
    const state = createAgentStoreState({
      agents: [
        agent,
        {
          ...agent,
          id: 'agent-2',
          name: 'Agent Two',
          orderKey: '0002'
        }
      ],
      skills: [
        {
          id: 'skill-builtin',
          name: 'Builtin Skill',
          description: null,
          folderName: 'builtin-skill',
          source: 'builtin',
          sourceUrl: null,
          namespace: null,
          author: null,
          sourceTags: [],
          contentHash: 'hash',
          isEnabled: true,
          createdAt,
          updatedAt: createdAt
        }
      ],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-builtin', isEnabled: false }]
    })

    const next = await service.enableBuiltinSkillsForNewAgents(state)

    expect(next.agentSkills).toEqual([
      { agentId: 'agent-1', skillId: 'skill-builtin', isEnabled: false },
      { agentId: 'agent-2', skillId: 'skill-builtin', isEnabled: true }
    ])
  })

  it('toggles a skill for an agent and syncs the workspace .claude/skills link', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `toggle-${Date.now()}`)
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
    const source = await createSourceSkill(root)
    const service = createSkillService({ paths: paths(root) })
    const installed = await service.installFromDirectory(
      createAgentStoreState({
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
      }),
      { directoryPath: source }
    )

    const enabled = await service.toggle(installed.state, {
      agentId: agent.id,
      skillId: installed.skill.id,
      isEnabled: true
    })
    const linkPath = join(workspace.path, '.claude', 'skills', 'code-reader')
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true)
    expect(enabled.state.agentSkills).toEqual([{ agentId: agent.id, skillId: installed.skill.id, isEnabled: true }])

    const disabled = await service.toggle(enabled.state, {
      agentId: agent.id,
      skillId: installed.skill.id,
      isEnabled: false
    })
    await expect(lstat(linkPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(disabled.skill?.isEnabled).toBe(false)
  })

  it('reconciles a workspace to the union of enabled skills across its bound agents', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `workspace-union-${Date.now()}`)
    const workspace: AgentWorkspaceEntity = {
      id: 'workspace-1',
      name: 'Workspace',
      path: join(root, 'workspace'),
      type: 'user',
      orderKey: '0001',
      createdAt,
      updatedAt: createdAt
    }
    const secondAgent: AgentEntity = {
      ...agent,
      id: 'agent-2',
      name: 'Agent Two',
      orderKey: '0002'
    }
    await mkdir(workspace.path, { recursive: true })
    const source = await createSourceSkill(root, 'code-reader')
    const secondSource = await createSourceSkill(root, 'reviewer')
    const service = createSkillService({ paths: paths(root) })
    const firstInstalled = await service.installFromDirectory(
      createAgentStoreState({
        agents: [agent, secondAgent],
        workspaces: [workspace],
        sessions: [
          {
            id: 'session-1',
            agentId: agent.id,
            name: 'Session One',
            workspaceId: workspace.id,
            workspace,
            orderKey: '0001',
            createdAt,
            updatedAt: createdAt
          },
          {
            id: 'session-2',
            agentId: secondAgent.id,
            name: 'Session Two',
            workspaceId: workspace.id,
            workspace,
            orderKey: '0002',
            createdAt,
            updatedAt: createdAt
          }
        ]
      }),
      { directoryPath: source }
    )
    const secondInstalled = await service.installFromDirectory(firstInstalled.state, { directoryPath: secondSource })
    const state = createAgentStoreState({
      ...secondInstalled.state,
      agentSkills: [
        { agentId: agent.id, skillId: firstInstalled.skill.id, isEnabled: true },
        { agentId: secondAgent.id, skillId: secondInstalled.skill.id, isEnabled: true }
      ]
    })

    await service.reconcileWorkspaceSkills(state, workspace.path)

    expect((await lstat(join(workspace.path, '.claude', 'skills', 'code-reader'))).isSymbolicLink()).toBe(true)
    expect((await lstat(join(workspace.path, '.claude', 'skills', 'reviewer'))).isSymbolicLink()).toBe(true)
  })

  it('reconciles a workspace by removing stale skill links when no bound session keeps them enabled', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `workspace-stale-${Date.now()}`)
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
    const source = await createSourceSkill(root, 'code-reader')
    const service = createSkillService({ paths: paths(root) })
    const installed = await service.installFromDirectory(
      createAgentStoreState({
        agents: [agent],
        workspaces: [workspace]
      }),
      { directoryPath: source }
    )
    const linkPath = join(workspace.path, '.claude', 'skills', 'code-reader')
    await service.linkSkill(installed.skill.folderName, workspace.path)

    await service.reconcileWorkspaceSkills(
      createAgentStoreState({
        ...installed.state,
        workspaces: [workspace],
        agentSkills: [{ agentId: agent.id, skillId: installed.skill.id, isEnabled: true }]
      }),
      workspace.path
    )

    await expect(lstat(linkPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('lists and reads skill files while rejecting path traversal', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `files-${Date.now()}`)
    const source = await createSourceSkill(root)
    const service = createSkillService({ paths: paths(root) })
    const installed = await service.installFromDirectory(createAgentStoreState({ agents: [agent] }), { directoryPath: source })

    await expect(service.readFile(installed.state, installed.skill.id, 'SKILL.md')).resolves.toContain('Code Reader')
    await expect(service.readFile(installed.state, installed.skill.id, '../outside.md')).resolves.toBeNull()
    await expect(service.listFiles(installed.state, installed.skill.id)).resolves.toEqual([
      {
        name: 'references',
        path: 'references',
        type: 'directory',
        children: [{ name: 'guide.md', path: 'references/guide.md', type: 'file' }]
      },
      { name: 'SKILL.md', path: 'SKILL.md', type: 'file' }
    ])
  })

  it('installs claude-plugins skills from a cloned GitHub repository path', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `claude-plugins-${Date.now()}`)
    const calls: Array<{ repoUrl: string; destDir: string }> = []
    const fetchRepository: SkillRepositoryFetcher = async (repoUrl, destDir) => {
      calls.push({ repoUrl, destDir })
      await createSourceSkill(destDir, join('skills', 'code-reader'))
    }
    const service = createSkillService({ paths: paths(root), fetchRepository })

    const result = await service.install(createAgentStoreState({ agents: [agent] }), {
      installSource: 'claude-plugins:anthropic/skills/skills/code-reader'
    })

    expect(calls.map((call) => call.repoUrl)).toEqual(['https://github.com/anthropic/skills'])
    expect(result.skill).toMatchObject({
      name: 'Code Reader',
      folderName: 'code-reader',
      source: 'marketplace',
      sourceUrl: 'https://github.com/anthropic/skills/tree/main/skills/code-reader'
    })
    expect(await readFile(join(root, 'Skills', 'code-reader', 'SKILL.md'), 'utf8')).toContain('Code Reader')
  })

  it('installs skills.sh repositories by resolving the matching nested skill directory', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `skills-sh-${Date.now()}`)
    const fetchRepository: SkillRepositoryFetcher = async (_repoUrl, destDir) => {
      await createSourceSkill(destDir, join('other', 'ignored-skill'))
      await createSourceSkill(destDir, join('pack', 'code-reader'))
    }
    const service = createSkillService({ paths: paths(root), fetchRepository })

    const result = await service.install(createAgentStoreState({ agents: [agent] }), {
      installSource: 'skills.sh:owner/repo/code-reader'
    })

    expect(result.skill).toMatchObject({
      name: 'Code Reader',
      folderName: 'code-reader',
      source: 'marketplace',
      sourceUrl: 'https://github.com/owner/repo'
    })
  })

  it('installs zip skills by extracting and resolving the nested skill directory', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `zip-${Date.now()}`)
    await mkdir(root, { recursive: true })
    const zipFilePath = join(root, 'skill.zip')
    await writeFile(zipFilePath, 'fake zip fixture', 'utf8')
    const service = createSkillService({
      paths: paths(root),
      inspectZip: async () => ({ totalSize: 1024, fileCount: 2 }),
      extractZip: async (_zipFilePath, destDir) => {
        await createSourceSkill(destDir, join('bundle', 'code-reader'))
      }
    })

    const result = await service.installFromZip(createAgentStoreState({ agents: [agent] }), { zipFilePath })

    expect(result.skill).toMatchObject({
      name: 'Code Reader',
      folderName: 'code-reader',
      source: 'zip',
      sourceUrl: null
    })
    expect(await readFile(join(root, 'Skills', 'code-reader', 'SKILL.md'), 'utf8')).toContain('Code Reader')
  })

  it('rejects non-zip files during zip skill install', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `zip-invalid-${Date.now()}`)
    await mkdir(root, { recursive: true })
    const filePath = join(root, 'skill.txt')
    await writeFile(filePath, 'not a zip', 'utf8')
    const service = createSkillService({ paths: paths(root) })

    await expect(service.installFromZip(createAgentStoreState({ agents: [agent] }), { zipFilePath: filePath })).rejects.toThrow(
      'Not a ZIP file'
    )
  })

  it('rejects zip skills that exceed the extracted size limit before extraction', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `zip-large-${Date.now()}`)
    await mkdir(root, { recursive: true })
    const zipFilePath = join(root, 'skill.zip')
    await writeFile(zipFilePath, 'fake zip fixture', 'utf8')
    let extracted = false
    const service = createSkillService({
      paths: paths(root),
      inspectZip: async () => ({ totalSize: 101 * 1024 * 1024, fileCount: 2 }),
      extractZip: async () => {
        extracted = true
      }
    })

    await expect(service.installFromZip(createAgentStoreState({ agents: [agent] }), { zipFilePath })).rejects.toThrow('ZIP too large')
    expect(extracted).toBe(false)
  })

  it('rejects zip skills that exceed the file-count limit before extraction', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `zip-count-${Date.now()}`)
    await mkdir(root, { recursive: true })
    const zipFilePath = join(root, 'skill.zip')
    await writeFile(zipFilePath, 'fake zip fixture', 'utf8')
    let extracted = false
    const service = createSkillService({
      paths: paths(root),
      inspectZip: async () => ({ totalSize: 1024, fileCount: 1001 }),
      extractZip: async () => {
        extracted = true
      }
    })

    await expect(service.installFromZip(createAgentStoreState({ agents: [agent] }), { zipFilePath })).rejects.toThrow(
      'ZIP has too many files'
    )
    expect(extracted).toBe(false)
  })

  it('installs clawhub skills by downloading the skill zip and reusing zip resolution', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `clawhub-${Date.now()}`)
    const fetchedUrls: string[] = []
    const service = createSkillService({
      paths: paths(root),
      fetchHttp: async (url) => {
        fetchedUrls.push(url)
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new TextEncoder().encode('zip bytes').buffer
        }
      },
      inspectZip: async () => ({ totalSize: 1024, fileCount: 2 }),
      extractZip: async (_zipFilePath, destDir) => {
        await createSourceSkill(destDir, 'code-reader')
      }
    })

    const result = await service.install(createAgentStoreState({ agents: [agent] }), { installSource: 'clawhub:code-reader' })

    expect(fetchedUrls).toEqual([
      'https://api.clawhub.ai/api/v1/skills/code-reader',
      'https://api.clawhub.ai/api/v1/skills/code-reader/download'
    ])
    expect(result.skill).toMatchObject({
      name: 'Code Reader',
      folderName: 'code-reader',
      source: 'marketplace',
      sourceUrl: 'https://clawhub.ai/skills/code-reader'
    })
  })

  it('rejects unknown marketplace install source prefixes', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `unknown-source-${Date.now()}`)
    const service = createSkillService({ paths: paths(root) })

    await expect(
      service.install(createAgentStoreState({ agents: [agent] }), {
        installSource: 'unknown:owner/repo'
      })
    ).rejects.toThrow('Unknown install source: unknown')
  })

  it('does not uninstall built-in skills', async () => {
    const root = join(tmpdir(), 'ai-desktop-platform-tests', 'skill-service', `builtin-uninstall-${Date.now()}`)
    const source = await createSourceSkill(root, 'builtin-code-reader')
    const service = createSkillService({ paths: paths(root) })
    const installed = await service.syncBuiltinSkill(createAgentStoreState({ agents: [agent] }), 'builtin-code-reader', source, true)

    await expect(service.uninstall(installed.state, installed.skill.id)).rejects.toThrow('Built-in skills cannot be uninstalled')
  })
})
