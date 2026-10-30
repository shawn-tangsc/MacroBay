import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '../schemas/agentSchemas'
import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import type { AgentSessionEntity } from '../schemas/sessionSchemas'
import { DEFAULT_SYSTEM_WORKSPACE_PATH, type AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import { createAgentStoreState } from '../store/agentStore'
import { ToolRegistry } from '../tools/registry'
import { McpRuntimeService } from '../mcp/McpRuntimeService'
import { SkillsRuntimeService } from '../skills/SkillsRuntimeService'
import { AgentRuntimeCompositionService } from './AgentRuntimeCompositionService'

const createdAt = '2026-01-01T00:00:00.000Z'

const workspace: AgentWorkspaceEntity = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  type: 'user',
  orderKey: 'workspace-1',
  createdAt,
  updatedAt: createdAt
}

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'Agent',
  model: 'provider:model-a',
  modelName: 'Model A',
  mcps: ['mcp-files'],
  disabledTools: ['Bash', 'mcp__filesystem__writeFile'],
  configuration: {
    permission_mode: 'acceptEdits',
    env_vars: {
      FOO: 'bar'
    }
  },
  orderKey: 'agent-1',
  createdAt,
  updatedAt: createdAt
}

const session: AgentSessionEntity = {
  id: 'session-1',
  agentId: 'agent-1',
  name: 'Session',
  workspaceId: workspace.id,
  workspace,
  orderKey: 'session-1',
  createdAt,
  updatedAt: createdAt
}

const mcpServer: McpServerEntity = {
  id: 'mcp-files',
  name: 'Filesystem',
  type: 'stdio',
  command: 'npx',
  isActive: true,
  createdAt,
  updatedAt: createdAt
}

const skill: InstalledSkill = {
  id: 'skill-1',
  name: 'Code Reader',
  description: 'Reads code',
  folderName: 'code-reader',
  source: 'local',
  sourceUrl: null,
  namespace: null,
  author: 'OpenAI',
  sourceTags: ['code'],
  contentHash: 'hash-1',
  isEnabled: true,
  createdAt,
  updatedAt: createdAt
}

describe('agent runtime composition service', () => {
  it('carries the normalized session allowlist into the composition', async () => {
    const toolRegistry = new ToolRegistry()
    const mcpRuntime = new McpRuntimeService({ toolRegistry })
    const skillsRuntime = new SkillsRuntimeService({ getSkillTools: () => [] })
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [{ ...session, allowedTools: ['WebSearch', 'WebSearch', 'NotATool', 'WebFetch'] }],
      workspaces: [workspace]
    })

    const composition = await new AgentRuntimeCompositionService({
      toolRegistry,
      mcpRuntime,
      skillsRuntime
    }).compose({ state, agentId: 'agent-1', sessionId: 'session-1' })

    expect(composition.sessionAllowedTools).toEqual(['WebSearch', 'WebFetch'])
  })

  it('leaves the session allowlist undefined when the session has none', async () => {
    const toolRegistry = new ToolRegistry()
    const mcpRuntime = new McpRuntimeService({ toolRegistry })
    const skillsRuntime = new SkillsRuntimeService({ getSkillTools: () => [] })
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace]
    })

    const composition = await new AgentRuntimeCompositionService({
      toolRegistry,
      mcpRuntime,
      skillsRuntime
    }).compose({ state, agentId: 'agent-1', sessionId: 'session-1' })

    expect(composition.sessionAllowedTools).toEqual([])
  })

  it('builds a driver-ready runtime snapshot from agent/session/store state', async () => {
    const toolRegistry = new ToolRegistry()
    const mcpRuntime = new McpRuntimeService({ toolRegistry })
    const skillsRuntime = new SkillsRuntimeService({
      getSkillTools: () => ['Read', 'Grep']
    })
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      mcpServers: [mcpServer],
      mcpToolsByServerId: {
        'mcp-files': [
          { id: 'read_file', name: 'read_file' },
          { id: 'write_file', name: 'write_file' }
        ]
      },
      skills: [skill],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
    })
    mcpRuntime.syncFromState(state)
    skillsRuntime.syncAgentTools(state, 'agent-1')

    const composition = await new AgentRuntimeCompositionService({
      toolRegistry,
      mcpRuntime,
      skillsRuntime
    }).compose({
      state,
      agentId: 'agent-1',
      sessionId: 'session-1'
    })

    expect(composition).toMatchObject({
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider:model-a',
      modelName: 'Model A',
      permissionMode: 'acceptEdits',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {
        FOO: 'bar'
      },
      mcp: {
        sources: [
          {
            serverId: 'mcp-files',
            sourceId: 'mcp:mcp-files',
            toolCount: 2,
            isActive: true
          }
        ],
        servers: [
          {
            id: 'mcp-files',
            name: 'Filesystem',
            type: 'stdio',
            command: 'npx',
            isActive: true,
            createdAt,
            updatedAt: createdAt
          }
        ]
      },
      skills: {
        agentId: 'agent-1',
        skills: [
          {
            skillId: 'skill-1',
            name: 'Code Reader',
            description: 'Reads code',
            author: 'OpenAI',
            namespace: null,
            folderName: 'code-reader',
            source: 'local',
            tags: ['code'],
            tools: ['Read', 'Grep']
          }
        ],
        toolIds: ['skill__code-reader__read', 'skill__code-reader__grep']
      }
    })

    expect(composition.tools.enabled.map((tool) => tool.id)).toEqual(
      expect.arrayContaining(['Read', 'Edit', 'mcp__filesystem__readFile'])
    )
    expect(composition.tools.disabled.map((tool) => tool.id)).toEqual(
      expect.arrayContaining(['Bash', 'mcp__filesystem__writeFile'])
    )
  })

  it('only merges registry tools that belong to the current agent runtime sources', async () => {
    const toolRegistry = new ToolRegistry()
    toolRegistry.registerTools('mcp:mcp-files', [
      {
        id: 'mcp__filesystem__readFile',
        name: 'read_file',
        origin: 'mcp',
        approval: 'auto',
        sourceId: 'mcp-files',
        sourceName: 'Filesystem'
      }
    ])
    toolRegistry.registerTools('skill:agent-1:skill-1', [
      {
        id: 'skill__code-reader__grep',
        name: 'Grep',
        origin: 'internal',
        approval: 'auto',
        sourceId: 'skill-1',
        sourceName: 'Code Reader'
      }
    ])
    toolRegistry.registerTools('skill:agent-2:skill-2', [
      {
        id: 'skill__other-agent__edit',
        name: 'Edit Code',
        origin: 'internal',
        approval: 'prompt',
        sourceId: 'skill-2',
        sourceName: 'Other Agent Skill'
      }
    ])

    const mcpRuntime = new McpRuntimeService({ toolRegistry })
    const skillsRuntime = new SkillsRuntimeService({
      getSkillTools: (installedSkill) => (installedSkill.id === 'skill-1' ? ['Grep'] : ['Edit Code'])
    })
    const otherSkill: InstalledSkill = {
      ...skill,
      id: 'skill-2',
      name: 'Other Agent Skill',
      folderName: 'other-agent-skill',
      contentHash: 'hash-2'
    }
    const otherAgent: AgentEntity = {
      ...agent,
      id: 'agent-2',
      name: 'Other Agent'
    }
    const otherSession: AgentSessionEntity = {
      ...session,
      id: 'session-2',
      agentId: 'agent-2',
      name: 'Other Session'
    }
    const state = createAgentStoreState({
      agents: [agent, otherAgent],
      sessions: [session, otherSession],
      workspaces: [workspace],
      mcpServers: [mcpServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file' }]
      },
      skills: [skill, otherSkill],
      agentSkills: [
        { agentId: 'agent-1', skillId: 'skill-1', isEnabled: true },
        { agentId: 'agent-2', skillId: 'skill-2', isEnabled: true }
      ]
    })
    mcpRuntime.syncFromState(state)
    skillsRuntime.syncAgentTools(state, 'agent-1')
    skillsRuntime.syncAgentTools(state, 'agent-2')

    const composition = await new AgentRuntimeCompositionService({
      toolRegistry,
      mcpRuntime,
      skillsRuntime
    }).compose({
      state,
      agentId: 'agent-1',
      sessionId: 'session-1'
    })

    expect(composition.tools.all.map((tool) => tool.id)).toContain('skill__code-reader__grep')
    expect(composition.tools.all.map((tool) => tool.id)).not.toContain('skill__other-agent__edit')
  })

  it('normalizes blank system workspace paths for driver-ready composition', async () => {
    const systemWorkspace: AgentWorkspaceEntity = {
      ...workspace,
      id: 'system-workspace',
      name: 'Default Workspace',
      path: '',
      type: 'system'
    }
    const systemSession: AgentSessionEntity = {
      ...session,
      workspaceId: systemWorkspace.id,
      workspace: systemWorkspace
    }
    const composition = await new AgentRuntimeCompositionService({
      toolRegistry: new ToolRegistry(),
      mcpRuntime: new McpRuntimeService({ toolRegistry: new ToolRegistry() }),
      skillsRuntime: new SkillsRuntimeService()
    }).compose({
      state: createAgentStoreState({
        agents: [agent],
        sessions: [systemSession],
        workspaces: [systemWorkspace]
      }),
      agentId: 'agent-1',
      sessionId: 'session-1'
    })

    expect(composition.workspaceType).toBe('system')
    expect(composition.workspacePath).toBe(DEFAULT_SYSTEM_WORKSPACE_PATH)
  })

  it('only exposes MCP runtime sources that are enabled for the current agent', async () => {
    const toolRegistry = new ToolRegistry()
    const mcpRuntime = new McpRuntimeService({ toolRegistry })
    const skillsRuntime = new SkillsRuntimeService()
    const otherServer: McpServerEntity = {
      ...mcpServer,
      id: 'mcp-git',
      name: 'Git'
    }
    const state = createAgentStoreState({
      agents: [agent],
      sessions: [session],
      workspaces: [workspace],
      mcpServers: [mcpServer, otherServer],
      mcpToolsByServerId: {
        'mcp-files': [{ id: 'read_file', name: 'read_file' }],
        'mcp-git': [{ id: 'git_status', name: 'git_status' }]
      }
    })
    mcpRuntime.syncFromState(state)

    const composition = await new AgentRuntimeCompositionService({
      toolRegistry,
      mcpRuntime,
      skillsRuntime
    }).compose({
      state,
      agentId: 'agent-1',
      sessionId: 'session-1'
    })

    expect(composition.mcp.servers.map((server) => server.id)).toEqual(['mcp-files'])
    expect(composition.mcp.sources).toEqual([
      {
        serverId: 'mcp-files',
        sourceId: 'mcp:mcp-files',
        toolCount: 1,
        isActive: true,
        runtimeState: 'connecting'
      }
    ])
  })

  it('projects task-management tools only for autonomous Agents', async () => {
    const autonomousAgent: AgentEntity = {
      ...agent,
      configuration: { ...agent.configuration, permission_mode: 'bypassPermissions' }
    }
    const normalComposition = new AgentRuntimeCompositionService({
      toolRegistry: new ToolRegistry(),
      mcpRuntime: new McpRuntimeService({ toolRegistry: new ToolRegistry() }),
      skillsRuntime: new SkillsRuntimeService()
    })
    const autonomousComposition = await normalComposition.compose({
      state: createAgentStoreState({ agents: [autonomousAgent], sessions: [session], workspaces: [workspace] }),
      agentId: autonomousAgent.id,
      sessionId: session.id
    })
    const normal = await normalComposition.compose({
      state: createAgentStoreState({ agents: [agent], sessions: [session], workspaces: [workspace] }),
      agentId: agent.id,
      sessionId: session.id
    })

    expect(autonomousComposition.taskManagement?.toolNames).toEqual(
      expect.arrayContaining(['scheduled_task_create', 'scheduled_task_update'])
    )
    expect(autonomousComposition.taskManagement?.toolNames).not.toContain('scheduled_task_run_now')
    expect(autonomousComposition.taskManagement?.toolNames).not.toContain('scheduled_task_cancel_run')
    expect(normal.taskManagement).toBeUndefined()
  })

  it('throws a clear error when the target agent or session is missing', async () => {
    const compositionService = new AgentRuntimeCompositionService({
      toolRegistry: new ToolRegistry(),
      mcpRuntime: new McpRuntimeService({ toolRegistry: new ToolRegistry() }),
      skillsRuntime: new SkillsRuntimeService()
    })
    const state = createAgentStoreState()

    await expect(
      compositionService.compose({
        state,
        agentId: 'missing-agent',
        sessionId: 'missing-session'
      })
    ).rejects.toThrow('Agent "missing-agent" was not found.')
  })

  it('validates that the session belongs to the requested agent', async () => {
    const otherAgent: AgentEntity = {
      ...agent,
      id: 'agent-2',
      name: 'Other Agent'
    }
    const compositionService = new AgentRuntimeCompositionService({
      toolRegistry: new ToolRegistry(),
      mcpRuntime: new McpRuntimeService({ toolRegistry: new ToolRegistry() }),
      skillsRuntime: new SkillsRuntimeService()
    })
    const state = createAgentStoreState({
      agents: [agent, otherAgent],
      sessions: [session],
      workspaces: [workspace]
    })

    await expect(
      compositionService.compose({
        state,
        agentId: 'agent-2',
        sessionId: 'session-1'
      })
    ).rejects.toThrow('Session "session-1" does not belong to agent "agent-2".')
  })

  it('uses the resolved effective model when the agent has no explicit model', async () => {
    const compositionService = new AgentRuntimeCompositionService({
      toolRegistry: new ToolRegistry(),
      mcpRuntime: new McpRuntimeService({ toolRegistry: new ToolRegistry() }),
      skillsRuntime: new SkillsRuntimeService(),
      resolveEffectiveModel: async () => ({
        model: 'anthropic:claude-sonnet',
        modelName: 'Anthropic / Claude'
      })
    })
    const unconfiguredAgent: AgentEntity = {
      ...agent,
      model: 'unconfigured:default-chat-model' as AgentEntity['model'],
      modelName: '未选择模型'
    }

    const composition = await compositionService.compose({
      state: createAgentStoreState({ agents: [unconfiguredAgent], sessions: [session], workspaces: [workspace] }),
      agentId: unconfiguredAgent.id,
      sessionId: session.id
    })

    expect(composition.modelId).toBe('anthropic:claude-sonnet')
    expect(composition.modelName).toBe('Anthropic / Claude')
  })

  it('keeps the agent model when no effective-model resolver is wired', async () => {
    const compositionService = new AgentRuntimeCompositionService({
      toolRegistry: new ToolRegistry(),
      mcpRuntime: new McpRuntimeService({ toolRegistry: new ToolRegistry() }),
      skillsRuntime: new SkillsRuntimeService()
    })

    const composition = await compositionService.compose({
      state: createAgentStoreState({ agents: [agent], sessions: [session], workspaces: [workspace] }),
      agentId: agent.id,
      sessionId: session.id
    })

    expect(composition.modelId).toBe('provider:model-a')
  })
})
