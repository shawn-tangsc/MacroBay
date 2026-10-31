import { describe, expect, it, vi } from 'vitest'

import type { ClaudeCodeMcpServerConfig } from './ClaudeCodeMcpServerConfig'
import type { ClaudeCodeCompositionSettings } from './ClaudeCodeSettingsBuilder'
import { createClaudeCodeQueryOptionsFromSettings } from './ClaudeCodeQueryOptions'

const mcpServers: ClaudeCodeMcpServerConfig[] = [
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
]

const baseSettings: ClaudeCodeCompositionSettings = {
  cwd: '/tmp/workspace',
  env: {
    FOO: 'bar'
  },
  permissionMode: 'acceptEdits',
  allowedTools: ['Read', 'Edit'],
  disallowedTools: ['Bash'],
  mcpSources: [{ serverId: 'mcp-files', sourceId: 'mcp:mcp-files', toolCount: 2, isActive: true, runtimeState: 'connected' }],
  mcpServers,
  skills: [
    {
      skillId: 'skill-1',
      name: 'Code Reader',
      description: null,
      author: null,
      namespace: null,
      folderName: 'code-reader',
      source: 'local',
      tags: [],
      tools: ['Read']
    }
  ],
  skillToolIds: ['skill__code-reader__read']
}

describe('Claude Code query options adapter', () => {
  it('maps composition settings into SDK-facing query options and runtime metadata', () => {
    const abortController = new AbortController()

    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings: baseSettings,
      abortController,
      resume: 'resume-1'
    })

    expect(query.sdkOptions).toEqual({
      model: 'claude-sonnet-4-5',
      cwd: '/tmp/workspace',
      env: {
        FOO: 'bar',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000'
      },
      permissionMode: 'acceptEdits',
      allowedTools: ['Read', 'Edit'],
      disallowedTools: ['Bash'],
      abortController,
      resume: 'resume-1'
    })
    expect(query.runtimeMetadata).toEqual({
      mcpSources: [{ serverId: 'mcp-files', sourceId: 'mcp:mcp-files', toolCount: 2, isActive: true, runtimeState: 'connected' }],
      mcpServers,
      skills: [
        {
          skillId: 'skill-1',
          name: 'Code Reader',
          description: null,
          author: null,
          namespace: null,
          folderName: 'code-reader',
          source: 'local',
          tags: [],
          tools: ['Read']
        }
      ],
      skillToolIds: ['skill__code-reader__read'],
      runtimeMcpToolNames: [],
      skillContext: ['Enabled skills:', '', '- Code Reader. Declared tools: Read. Source: local.'].join('\n'),
      outputLimit: { maxOutputTokens: 32000, source: 'safe-default' },
      toolPolicy: expect.objectContaining({
        permissionMode: 'acceptEdits',
        allowedTools: ['Read', 'Edit'],
        disallowedTools: ['Bash'],
        mcpSources: [{ serverId: 'mcp-files', sourceId: 'mcp:mcp-files', toolCount: 2, isActive: true, runtimeState: 'connected' }],
        skillToolIds: ['skill__code-reader__read'],
        runtimeMcpToolNames: [],
        canUseTool: expect.any(Function),
        preToolUse: expect.any(Function),
        toApprovalRequest: expect.any(Function)
      })
    })
  })

  it('merges provider environment after agent environment so provider secrets cannot be overridden by agent config', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings: {
        ...baseSettings,
        env: {
          ...baseSettings.env,
          ANTHROPIC_API_KEY: 'agent-override'
        }
      },
      providerEnv: {
        ANTHROPIC_API_KEY: 'provider-secret',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5'
      }
    })

    expect(query.sdkOptions.env).toEqual({
      FOO: 'bar',
      ANTHROPIC_API_KEY: 'provider-secret',
      ANTHROPIC_MODEL: 'claude-sonnet-4-5',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000'
    })
  })

  it('requires a workspace cwd before SDK options are created', () => {
    expect(() =>
      createClaudeCodeQueryOptionsFromSettings({
        modelId: 'claude-sonnet-4-5',
        settings: {
          ...baseSettings,
          cwd: null
        }
      })
    ).toThrow('Claude Code query options require a workspace cwd.')
  })

  it('lets effectiveResume override the stored resume value', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings: baseSettings,
      resume: 'resume-from-settings',
      effectiveResume: 'resume-from-runtime'
    })

    expect(query.sdkOptions.resume).toBe('resume-from-runtime')
  })

  it('chains stderr collector before the user stderr callback', () => {
    const calls: string[] = []
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings: baseSettings,
      stderr: (data) => calls.push(`user:${data}`),
      stderrCollector: (data) => calls.push(`collector:${data}`)
    })

    query.sdkOptions.stderr?.('warning')

    expect(calls).toEqual(['collector:warning', 'user:warning'])
  })

  it('maps JSON response schema to an SDK-facing output format', () => {
    const schema = {
      type: 'object',
      properties: {
        answer: { type: 'string' }
      }
    }

    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings: baseSettings,
      responseFormat: {
        type: 'json',
        schema
      }
    })

    expect(query.sdkOptions.outputFormat).toEqual({
      type: 'json_schema',
      schema
    })
  })

  it('does not leak platform runtime metadata into SDK options', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings: baseSettings
    })

    expect(query.sdkOptions).not.toHaveProperty('mcpSources')
    expect(query.sdkOptions).not.toHaveProperty('mcpServers')
    expect(query.sdkOptions).not.toHaveProperty('skills')
    expect(query.sdkOptions).not.toHaveProperty('skillToolIds')
    expect(query.sdkOptions).not.toHaveProperty('toolPolicy')
  })

  it('builds a reusable tool policy inside runtime metadata for later Claude SDK hook wiring', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings: baseSettings
    })

    expect(query.runtimeMetadata.toolPolicy.canUseTool('Read')).toEqual({
      kind: 'allow',
      toolName: 'Read'
    })
    expect(query.runtimeMetadata.toolPolicy.canUseTool('Bash')).toEqual({
      kind: 'deny',
      toolName: 'Bash',
      reason: 'tool-disabled'
    })
    expect(query.runtimeMetadata.toolPolicy.canUseTool('WebSearch')).toEqual({
      kind: 'prompt',
      toolName: 'WebSearch'
    })
  })

  it('forwards the configured reasoning effort to the SDK', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings: { ...baseSettings, effort: 'high' }
    })

    expect(query.sdkOptions.effort).toBe('high')
  })

  it('disables thinking when the agent turns reasoning off', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings: { ...baseSettings, effort: 'off' }
    })

    expect(query.sdkOptions.thinking).toEqual({ type: 'disabled' })
    expect(query.sdkOptions).not.toHaveProperty('effort')
  })

  it('keeps the provider effort default when the agent does not choose one', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'deepseek-v4.1-flash-1017',
      settings: baseSettings,
      providerEnv: {
        ANTHROPIC_API_KEY: 'key',
        CLAUDE_CODE_EFFORT_LEVEL: 'max'
      }
    })

    expect(query.sdkOptions.env).toEqual({
      FOO: 'bar',
      ANTHROPIC_API_KEY: 'key',
      CLAUDE_CODE_EFFORT_LEVEL: 'max',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000'
    })
  })

  it('drops the provider effort default when the agent chooses an effort explicitly', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'deepseek-v4.1-flash-1017',
      settings: { ...baseSettings, effort: 'off' },
      providerEnv: {
        ANTHROPIC_API_KEY: 'key',
        CLAUDE_CODE_EFFORT_LEVEL: 'max'
      }
    })

    expect(query.sdkOptions.env).toEqual({
      FOO: 'bar',
      ANTHROPIC_API_KEY: 'key',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000'
    })
    expect(query.sdkOptions.thinking).toEqual({ type: 'disabled' })
  })

  it('forces thinking off when the model declares no reasoning support', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'gpt-4o',
      settings: { ...baseSettings, effort: 'high' },
      providerEnv: {
        ANTHROPIC_API_KEY: 'key',
        CLAUDE_CODE_EFFORT_LEVEL: 'max'
      },
      modelSupportsReasoning: false
    })

    expect(query.sdkOptions.thinking).toEqual({ type: 'disabled' })
    expect(query.sdkOptions).not.toHaveProperty('effort')
    expect(query.sdkOptions.env).toEqual({
      FOO: 'bar',
      ANTHROPIC_API_KEY: 'key',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000'
    })
  })

  it('keeps the configured effort when model reasoning support is not declared', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'deepseek-v4.1-flash-1017',
      settings: { ...baseSettings, effort: 'high' }
    })

    expect(query.sdkOptions.effort).toBe('high')
    expect(query.sdkOptions).not.toHaveProperty('thinking')
  })

  it('requests the model output capability as the single-turn max output tokens', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'deepseek-v4.1-flash-1017',
      settings: baseSettings,
      modelMaxOutputTokens: 65536
    })

    expect(query.sdkOptions.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('65536')
    expect(query.runtimeMetadata.outputLimit).toEqual({
      maxOutputTokens: 65536,
      source: 'model-capability'
    })
  })

  it('falls back to the documented safe default when the model declares no output capability', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'deepseek-v4.1-flash-1017',
      settings: baseSettings
    })

    expect(query.sdkOptions.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('32000')
    expect(query.runtimeMetadata.outputLimit).toEqual({
      maxOutputTokens: 32000,
      source: 'safe-default'
    })
  })

  it('keeps an explicitly configured max output tokens and records it as configured', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'deepseek-v4.1-flash-1017',
      settings: {
        ...baseSettings,
        env: { ...baseSettings.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: '24000' }
      },
      modelMaxOutputTokens: 65536
    })

    expect(query.sdkOptions.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('24000')
    expect(query.runtimeMetadata.outputLimit).toEqual({
      maxOutputTokens: 24000,
      source: 'configured'
    })
  })
})
