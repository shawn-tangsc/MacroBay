import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import { createAgentStoreState } from '../store/agentStore'
import { ToolRegistry } from '../tools/registry'
import { SkillsRuntimeService } from './SkillsRuntimeService'

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Agent',
  model: 'provider:model-a',
  modelName: 'Model A',
  orderKey: 'agent-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const codeReaderSkill: InstalledSkill = {
  id: 'skill-1',
  name: 'Code Reader',
  description: 'Reads and analyzes code',
  folderName: 'code-reader',
  source: 'local',
  sourceUrl: null,
  namespace: null,
  author: 'OpenAI',
  sourceTags: ['code', 'analysis'],
  contentHash: 'hash-1',
  isEnabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const refactorSkill: InstalledSkill = {
  ...codeReaderSkill,
  id: 'skill-2',
  name: 'Refactor Helper',
  folderName: 'refactor-helper',
  contentHash: 'hash-2'
}

describe('skills runtime service', () => {
  it('builds a per-agent runtime snapshot from enabled skill bindings', () => {
    const runtime = new SkillsRuntimeService({
      getSkillTools: (skill) => {
        if (skill.id === 'skill-1') return ['Read', 'Grep']
        return ['Edit']
      }
    })

    const snapshot = runtime.getAgentRuntime(
      createAgentStoreState({
        agents: [agent],
        skills: [codeReaderSkill, refactorSkill],
        agentSkills: [
          { agentId: 'agent-1', skillId: 'skill-1', isEnabled: true },
          { agentId: 'agent-1', skillId: 'skill-2', isEnabled: false }
        ]
      }),
      'agent-1'
    )

    expect(snapshot).toEqual({
      agentId: 'agent-1',
      skills: [
        {
          skillId: 'skill-1',
          name: 'Code Reader',
          description: 'Reads and analyzes code',
          author: 'OpenAI',
          namespace: null,
          folderName: 'code-reader',
          source: 'local',
          tags: ['code', 'analysis'],
          tools: ['Read', 'Grep']
        }
      ],
      toolIds: ['skill__code-reader__read', 'skill__code-reader__grep']
    })
  })

  it('deduplicates overlapping tool ids across enabled skills', () => {
    const runtime = new SkillsRuntimeService({
      getSkillTools: (skill) => (skill.id === 'skill-1' ? ['Read', 'Grep'] : ['Grep', 'Edit'])
    })

    const snapshot = runtime.getAgentRuntime(
      createAgentStoreState({
        agents: [agent],
        skills: [codeReaderSkill, refactorSkill],
        agentSkills: [
          { agentId: 'agent-1', skillId: 'skill-1', isEnabled: true },
          { agentId: 'agent-1', skillId: 'skill-2', isEnabled: true }
        ]
      }),
      'agent-1'
    )

    expect(snapshot.toolIds).toEqual(['skill__code-reader__read', 'skill__code-reader__grep', 'skill__refactor-helper__grep', 'skill__refactor-helper__edit'])
  })

  it('injects skill file capabilities into the runtime snapshot', () => {
    const runtime = new SkillsRuntimeService({
      getSkillTools: () => ['Read'],
      getSkillCapabilities: (skill) => [
        {
          capabilityId: `${skill.id}:SKILL.md`,
          kind: 'entry-file-summary',
          title: 'Code Reader instructions',
          summary: 'Use this skill when inspecting unfamiliar repositories.',
          sourcePath: 'SKILL.md',
          entryFile: 'SKILL.md',
          bodyPreview: 'Read package boundaries before changing files.',
          bodyPreviewTruncated: false
        }
      ]
    })

    const snapshot = runtime.getAgentRuntime(
      createAgentStoreState({
        agents: [agent],
        skills: [codeReaderSkill],
        agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
      }),
      'agent-1'
    )

    expect(snapshot.skills[0]?.capabilities).toEqual([
      {
        capabilityId: 'skill-1:SKILL.md',
        kind: 'entry-file-summary',
        title: 'Code Reader instructions',
        summary: 'Use this skill when inspecting unfamiliar repositories.',
        sourcePath: 'SKILL.md',
        entryFile: 'SKILL.md',
        bodyPreview: 'Read package boundaries before changing files.',
        bodyPreviewTruncated: false
      }
    ])
  })

  it('defaults legacy capability descriptors onto the platform-owned entry-file schema', () => {
    const runtime = new SkillsRuntimeService({
      getSkillTools: () => ['Read'],
      getSkillCapabilities: (skill) => [
        {
          capabilityId: ` ${skill.id}:SKILL.md `,
          title: ' Code Reader instructions ',
          summary: ' Legacy summary ',
          sourcePath: ' SKILL.md ',
          entryFile: ' SKILL.md ',
          bodyPreview: ' Legacy preview ',
          bodyPreviewTruncated: true
        } as never
      ]
    })

    const snapshot = runtime.getAgentRuntime(
      createAgentStoreState({
        agents: [agent],
        skills: [codeReaderSkill],
        agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
      }),
      'agent-1'
    )

    expect(snapshot.skills[0]?.capabilities).toEqual([
      {
        capabilityId: 'skill-1:SKILL.md',
        kind: 'entry-file-summary',
        title: 'Code Reader instructions',
        summary: 'Legacy summary',
        sourcePath: 'SKILL.md',
        entryFile: 'SKILL.md',
        bodyPreview: 'Legacy preview',
        bodyPreviewTruncated: true
      }
    ])
  })

  it('preserves supporting-file capability descriptors in runtime snapshots', () => {
    const runtime = new SkillsRuntimeService({
      getSkillTools: () => ['Read'],
      getSkillCapabilities: (skill) => [
        {
          capabilityId: `${skill.id}:references/usage.md`,
          kind: 'supporting-file-summary',
          title: 'Usage guide',
          summary: 'Extra instructions for runtime use.',
          sourcePath: 'references/usage.md',
          bodyPreview: 'Read supporting guidance before invoking tools.',
          bodyPreviewTruncated: false
        }
      ]
    })

    const snapshot = runtime.getAgentRuntime(
      createAgentStoreState({
        agents: [agent],
        skills: [codeReaderSkill],
        agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
      }),
      'agent-1'
    )

    expect(snapshot.skills[0]?.capabilities).toEqual([
      {
        capabilityId: 'skill-1:references/usage.md',
        kind: 'supporting-file-summary',
        title: 'Usage guide',
        summary: 'Extra instructions for runtime use.',
        sourcePath: 'references/usage.md',
        bodyPreview: 'Read supporting guidance before invoking tools.',
        bodyPreviewTruncated: false
      }
    ])
  })

  it('returns an empty runtime snapshot for missing agents or no enabled skills', () => {
    const runtime = new SkillsRuntimeService()
    const state = createAgentStoreState({
      agents: [agent],
      skills: [codeReaderSkill],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: false }]
    })

    expect(runtime.getAgentRuntime(state, 'missing-agent')).toEqual({
      agentId: 'missing-agent',
      skills: [],
      toolIds: []
    })
    expect(runtime.getAgentRuntime(state, 'agent-1')).toEqual({
      agentId: 'agent-1',
      skills: [],
      toolIds: []
    })
  })

  it('registers enabled skill-derived tools into ToolRegistry sources for the current agent', () => {
    const toolRegistry = new ToolRegistry()
    const runtime = new SkillsRuntimeService({
      toolRegistry,
      getSkillTools: (installedSkill) => (installedSkill.id === 'skill-1' ? ['Read Docs', 'Grep'] : ['Edit Code'])
    })
    const snapshot = runtime.syncAgentTools(
      createAgentStoreState({
        agents: [agent],
        skills: [codeReaderSkill, refactorSkill],
        agentSkills: [
          { agentId: 'agent-1', skillId: 'skill-1', isEnabled: true },
          { agentId: 'agent-1', skillId: 'skill-2', isEnabled: false }
        ]
      }),
      'agent-1'
    )

    expect(snapshot.toolIds).toEqual(['skill__code-reader__read-docs', 'skill__code-reader__grep'])
    expect(toolRegistry.listBySource('skill:agent-1:skill-1')).toEqual([
      {
        id: 'skill__code-reader__read-docs',
        name: 'Read Docs',
        description: 'Code Reader capability: Reads and analyzes code',
        origin: 'internal',
        approval: 'auto',
        sourceId: 'skill-1',
        sourceName: 'Code Reader'
      },
      {
        id: 'skill__code-reader__grep',
        name: 'Grep',
        description: 'Code Reader capability: Reads and analyzes code',
        origin: 'internal',
        approval: 'auto',
        sourceId: 'skill-1',
        sourceName: 'Code Reader'
      }
    ])
    expect(toolRegistry.listBySource('skill:agent-1:skill-2')).toEqual([])
  })

  it('cleans stale skill sources when an agent skill is disabled on a later sync', () => {
    const toolRegistry = new ToolRegistry()
    const runtime = new SkillsRuntimeService({
      toolRegistry,
      getSkillTools: () => ['Grep']
    })

    runtime.syncAgentTools(
      createAgentStoreState({
        agents: [agent],
        skills: [codeReaderSkill],
        agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
      }),
      'agent-1'
    )

    runtime.syncAgentTools(
      createAgentStoreState({
        agents: [agent],
        skills: [codeReaderSkill],
        agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: false }]
      }),
      'agent-1'
    )

    expect(toolRegistry.listBySource('skill:agent-1:skill-1')).toEqual([])
  })

  it('invokes an enabled declared skill tool through the platform runtime host seam', async () => {
    const invokeSkillTool = vi.fn(async () => ({
      output: 'analysis complete',
      structuredContent: { ok: true }
    }))
    const runtime = new SkillsRuntimeService({
      getSkillTools: () => ['Read Docs'],
      invokeSkillTool
    })
    const signal = new AbortController().signal
    const state = createAgentStoreState({
      agents: [agent],
      skills: [codeReaderSkill],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
    })

    await expect(
      runtime.invokeSkillTool(state, {
        agentId: 'agent-1',
        sessionId: 'session-1',
        toolId: 'skill__code-reader__read-docs',
        input: { path: 'README.md' },
        signal
      })
    ).resolves.toEqual({
      output: 'analysis complete',
      structuredContent: { ok: true }
    })

    expect(invokeSkillTool).toHaveBeenCalledWith({
      agentId: 'agent-1',
      sessionId: 'session-1',
      skill: codeReaderSkill,
      toolId: 'skill__code-reader__read-docs',
      toolName: 'Read Docs',
      input: { path: 'README.md' },
      signal
    })
  })

  it('rejects disabled or undeclared skill tool invocations before reaching the host seam', async () => {
    const invokeSkillTool = vi.fn(async () => ({ output: 'should not run' }))
    const runtime = new SkillsRuntimeService({
      getSkillTools: () => ['Read Docs'],
      invokeSkillTool
    })
    const state = createAgentStoreState({
      agents: [agent],
      skills: [codeReaderSkill],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: false }]
    })

    await expect(
      runtime.invokeSkillTool(state, {
        agentId: 'agent-1',
        toolId: 'skill__code-reader__read-docs'
      })
    ).rejects.toThrow('Skill runtime tool "skill__code-reader__read-docs" is not enabled for agent "agent-1".')

    await expect(
      runtime.invokeSkillTool(
        createAgentStoreState({
          agents: [agent],
          skills: [codeReaderSkill],
          agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
        }),
        {
          agentId: 'agent-1',
          toolId: 'skill__code-reader__write-docs'
        }
      )
    ).rejects.toThrow('Skill runtime tool "skill__code-reader__write-docs" is not enabled for agent "agent-1".')

    expect(invokeSkillTool).not.toHaveBeenCalled()
  })

  it('rejects skill tool invocations for missing agents even when stale bindings exist', async () => {
    const invokeSkillTool = vi.fn(async () => ({ output: 'should not run' }))
    const runtime = new SkillsRuntimeService({
      getSkillTools: () => ['Read Docs'],
      invokeSkillTool
    })

    await expect(
      runtime.invokeSkillTool(
        createAgentStoreState({
          agents: [],
          skills: [codeReaderSkill],
          agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
        }),
        {
          agentId: 'agent-1',
          toolId: 'skill__code-reader__read-docs'
        }
      )
    ).rejects.toThrow('Skill runtime tool "skill__code-reader__read-docs" is not enabled for agent "agent-1".')

    expect(invokeSkillTool).not.toHaveBeenCalled()
  })
})
