import { describe, expect, it } from 'vitest'

import type { AgentRuntimeComposition } from '../../AgentRuntimeCompositionService'
import { buildClaudeCodeSettingsFromComposition } from './ClaudeCodeSettingsBuilder'

const baseComposition: AgentRuntimeComposition = {
  agentId: 'agent-1',
  sessionId: 'session-1',
  agentType: 'claude-code',
  instructions: null,
  modelId: 'provider:model-a',
  modelName: null,
  permissionMode: 'acceptEdits',
  workspacePath: '/tmp/workspace',
  workspaceType: 'user',
  environment: {
    FOO: 'bar'
  },
  tools: {
    all: [
      { id: 'Read', name: 'Read', origin: 'builtin', approval: 'auto' },
      { id: 'Edit', name: 'Edit', origin: 'builtin', approval: 'auto' },
      { id: 'Bash', name: 'Bash', origin: 'builtin', approval: 'prompt' },
      { id: 'mcp__filesystem__readFile', name: 'readFile', origin: 'mcp', approval: 'auto', sourceId: 'mcp-files' },
      { id: 'mcp__filesystem__writeFile', name: 'writeFile', origin: 'mcp', approval: 'prompt', sourceId: 'mcp-files' }
    ],
    enabled: [
      { id: 'Read', name: 'Read', origin: 'builtin', approval: 'auto' },
      { id: 'Edit', name: 'Edit', origin: 'builtin', approval: 'auto' },
      { id: 'mcp__filesystem__readFile', name: 'readFile', origin: 'mcp', approval: 'auto', sourceId: 'mcp-files' }
    ],
    disabled: [
      { id: 'Bash', name: 'Bash', origin: 'builtin', approval: 'prompt' },
      { id: 'mcp__filesystem__writeFile', name: 'writeFile', origin: 'mcp', approval: 'prompt', sourceId: 'mcp-files' }
    ]
  },
  mcp: {
    sources: [
      {
        serverId: 'mcp-files',
        sourceId: 'mcp:mcp-files',
        toolCount: 2,
        isActive: true,
        runtimeState: 'connected',
        lastCheckedAt: 1
      }
    ],
    servers: [
      {
        id: 'mcp-files',
        name: 'Filesystem',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: {
          ROOT: '/tmp/workspace'
        },
        isActive: true
      }
    ]
  },
  skills: {
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
        tools: ['Read', 'Grep'],
        capabilities: [
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
        ]
      }
    ],
    toolIds: ['skill__code-reader__read', 'skill__code-reader__grep']
  }
}

describe('Claude Code settings builder', () => {
  it('maps runtime composition into a driver-facing settings snapshot', () => {
    const settings = buildClaudeCodeSettingsFromComposition(baseComposition)

    expect(settings).toEqual({
      cwd: '/tmp/workspace',
      env: {
        FOO: 'bar'
      },
      permissionMode: 'acceptEdits',
      allowedTools: ['Read'],
      policyAllowedTools: ['Edit', 'mcp__filesystem__readFile'],
      disallowedTools: ['Bash', 'mcp__filesystem__writeFile'],
      mcpSources: [
        {
          serverId: 'mcp-files',
          sourceId: 'mcp:mcp-files',
          toolCount: 2,
          isActive: true,
          runtimeState: 'connected',
          lastCheckedAt: 1
        }
      ],
      mcpServers: [
        {
          serverId: 'mcp-files',
          serverName: 'Filesystem',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          env: {
            ROOT: '/tmp/workspace'
          }
        }
      ],
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
          tools: ['Read', 'Grep'],
          capabilities: [
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
          ]
        }
      ],
      skillToolIds: ['skill__code-reader__read', 'skill__code-reader__grep'],
      runtimeMcpToolNames: [],
      runtimeMcpApprovalByName: {},
      skillContext: [
        'Enabled skills:',
        '',
        '- Code Reader: Reads and analyzes code. Declared tools: Read, Grep. Tags: code, analysis. Author: OpenAI. Source: local. Capabilities: Code Reader instructions - Use this skill when inspecting unfamiliar repositories. File: SKILL.md. Notes: Read package boundaries before changing files.'
      ].join('\n')
    })
  })

  it('merges default environment variables without letting defaults override agent env', () => {
    const settings = buildClaudeCodeSettingsFromComposition(baseComposition, {
      defaultEnv: {
        FOO: 'default',
        ENABLE_TOOL_SEARCH: 'auto'
      }
    })

    expect(settings.env).toEqual({
      ENABLE_TOOL_SEARCH: 'auto',
      FOO: 'bar'
    })
  })

  it('deduplicates tool ids and preserves a null cwd for the future driver to validate', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...baseComposition,
      workspacePath: null,
      tools: {
        ...baseComposition.tools,
        enabled: [...baseComposition.tools.enabled, { id: 'Read', name: 'Read', origin: 'builtin', approval: 'auto' }],
        disabled: [
          ...baseComposition.tools.disabled,
          { id: 'Bash', name: 'Bash', origin: 'builtin', approval: 'prompt' }
        ]
      }
    })

    expect(settings.cwd).toBeNull()
    expect(settings.allowedTools).toEqual(['Read'])
    expect(settings.policyAllowedTools).toEqual(['Edit', 'mcp__filesystem__readFile'])
    expect(settings.disallowedTools).toEqual(['Bash', 'mcp__filesystem__writeFile'])
  })

  it('projects task tools into the source-neutral runtime MCP approval map', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...baseComposition,
      taskManagement: {
        agentId: 'agent-1',
        toolNames: ['scheduled_task_list', 'scheduled_task_create'],
        tools: []
      }
    })

    expect(settings.runtimeMcpToolNames).toEqual(['scheduled_task_list', 'scheduled_task_create'])
    expect(settings.runtimeMcpApprovalByName).toEqual({
      scheduled_task_list: 'auto',
      scheduled_task_create: 'auto'
    })
    expect(settings.runtimeMcpToolNames).not.toContain('scheduled_task_run_now')
    expect(settings.runtimeMcpToolNames).not.toContain('scheduled_task_cancel_run')
  })

  it('keeps product tool approvals in the same source-neutral map', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...baseComposition,
      tools: {
        ...baseComposition.tools,
        enabled: [
          ...baseComposition.tools.enabled,
          {
            id: 'product__market-intelligence__get-source-health__v1',
            name: 'get_source_health',
            origin: 'product',
            approval: 'prompt',
            productId: 'market-intelligence'
          }
        ]
      },
      productTools: {
        agentId: 'agent-1',
        packages: [{
          productId: 'market-intelligence',
          status: 'available',
          permissionMode: 'prompt',
          toolNames: ['get_source_health'],
          toolIds: ['product__market-intelligence__get-source-health__v1']
        }],
        toolIds: ['product__market-intelligence__get-source-health__v1'],
        toolNames: ['get_source_health']
      }
    })

    expect(settings.runtimeMcpToolNames).toEqual(['mcp__market-intelligence__get_source_health'])
    expect(settings.runtimeMcpApprovalByName).toEqual({
      'mcp__market-intelligence__get_source_health': 'prompt'
    })
  })

  it('keeps Product Tool Provider runtime names and approvals in the generic map', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...baseComposition,
      tools: {
        ...baseComposition.tools,
        enabled: [
          ...baseComposition.tools.enabled,
          {
            id: 'product__market-intelligence__source-health__v1',
            name: 'source_health',
            origin: 'product',
            productId: 'market-intelligence',
            approval: 'prompt'
          }
        ]
      },
      productTools: {
        agentId: 'agent-1',
        packages: [{
          productId: 'market-intelligence',
          status: 'available',
          permissionMode: 'prompt',
          toolNames: ['source_health'],
          toolIds: ['product__market-intelligence__source-health__v1']
        }],
        toolNames: ['source_health'],
        toolIds: ['product__market-intelligence__source-health__v1']
      }
    })

    expect(settings.runtimeMcpToolNames).toEqual(['mcp__market-intelligence__source_health'])
    expect(settings.runtimeMcpApprovalByName).toEqual({
      'mcp__market-intelligence__source_health': 'prompt'
    })
  })
})
