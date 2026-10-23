import { describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeComposition } from '../../ai/agent-platform/runtime/AgentRuntimeCompositionService'
import type { AgentEntity } from '../../ai/agent-platform/schemas/agentSchemas'
import type { InstalledSkill } from '../../ai/agent-platform/schemas/skillSchemas'
import { SkillsRuntimeService } from '../../ai/agent-platform/skills/SkillsRuntimeService'
import { createAgentStoreState } from '../../ai/agent-platform/store/agentStore'
import { buildSkillToolSdkMcpServers } from './buildSkillToolSdkMcpServers'

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

const skill: InstalledSkill = {
  id: 'skill-1',
  name: 'Code Reader',
  description: 'Reads docs',
  folderName: 'code-reader',
  source: 'local',
  sourceUrl: null,
  namespace: null,
  author: null,
  sourceTags: [],
  contentHash: 'hash-1',
  isEnabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('buildSkillToolSdkMcpServers', () => {
  it('exposes enabled skill runtime tools through a generic SDK MCP server', async () => {
    const invokeSkillTool = vi.fn(async () => ({
      output: 'analysis complete',
      structuredContent: { ok: true }
    }))
    const runtime = new SkillsRuntimeService({
      getSkillTools: () => ['Read Docs'],
      invokeSkillTool
    })
    const state = createAgentStoreState({
      agents: [agent],
      skills: [skill],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
    })
    const getAgentState = vi.fn(async () => state)
    const sdk = {
      tool: vi.fn((_name, _description, schema, handler) => ({ schema, handler })),
      createSdkMcpServer: vi.fn((input) => input)
    }
    const emitChunk = vi.fn()
    const composition: AgentRuntimeComposition = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider:model-a',
      modelName: null,
      permissionMode: 'acceptEdits',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: runtime.getAgentRuntime(state, 'agent-1')
    }

    const servers = await buildSkillToolSdkMcpServers({
      composition,
      agentId: 'agent-1',
      sessionId: 'session-1',
      getAgentState,
      runtime,
      emitChunk,
      loadSdkHelpers: async () => sdk
    })

    expect(Object.keys(servers)).toEqual(['agent-skills'])
    expect(sdk.tool).toHaveBeenCalledWith(
      'skill__code-reader__read-docs',
      'Code Reader skill tool: Read Docs',
      { type: 'object' },
      expect.any(Function)
    )

    const handler = sdk.tool.mock.calls[0]?.[3] as (args: Record<string, unknown>) => Promise<unknown>
    await expect(handler({ path: 'README.md' })).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: 'analysis complete'
        }
      ],
      structuredContent: { ok: true }
    })

    expect(getAgentState).toHaveBeenCalled()
    expect(emitChunk).toHaveBeenCalledWith({
      type: 'tool-input-start',
      sessionId: 'session-1',
      toolCallId: 'skill__code-reader__read-docs',
      toolName: 'Read Docs'
    })
    expect(emitChunk).toHaveBeenCalledWith({
      type: 'tool-input-available',
      sessionId: 'session-1',
      toolCallId: 'skill__code-reader__read-docs',
      toolName: 'Read Docs',
      input: { path: 'README.md' }
    })
    expect(emitChunk).toHaveBeenCalledWith({
      type: 'tool-output-available',
      sessionId: 'session-1',
      toolCallId: 'skill__code-reader__read-docs',
      output: 'analysis complete'
    })
    expect(invokeSkillTool).toHaveBeenCalledWith({
      agentId: 'agent-1',
      sessionId: 'session-1',
      skill,
      toolId: 'skill__code-reader__read-docs',
      toolName: 'Read Docs',
      input: { path: 'README.md' }
    })
  })

  it('returns SDK error content and emits output-error chunks when skill runtime invocation fails', async () => {
    const runtime = new SkillsRuntimeService({
      getSkillTools: () => ['Read Docs'],
      invokeSkillTool: async () => {
        throw new Error('skill failed')
      }
    })
    const state = createAgentStoreState({
      agents: [agent],
      skills: [skill],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
    })
    const sdk = {
      tool: vi.fn((_name, _description, schema, handler) => ({ schema, handler })),
      createSdkMcpServer: vi.fn((input) => input)
    }
    const emitChunk = vi.fn()
    const composition: AgentRuntimeComposition = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider:model-a',
      modelName: null,
      permissionMode: 'acceptEdits',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: runtime.getAgentRuntime(state, 'agent-1')
    }

    await buildSkillToolSdkMcpServers({
      composition,
      agentId: 'agent-1',
      sessionId: 'session-1',
      getAgentState: async () => state,
      runtime,
      emitChunk,
      loadSdkHelpers: async () => sdk
    })

    const handler = sdk.tool.mock.calls[0]?.[3] as (args: Record<string, unknown>) => Promise<unknown>
    await expect(handler({ path: 'README.md' })).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: 'skill failed'
        }
      ],
      isError: true,
      structuredContent: {
        error: {
          message: 'skill failed'
        }
      }
    })

    expect(emitChunk).toHaveBeenCalledWith({
      type: 'tool-output-error',
      sessionId: 'session-1',
      toolCallId: 'skill__code-reader__read-docs',
      errorText: 'skill failed'
    })
  })
})
