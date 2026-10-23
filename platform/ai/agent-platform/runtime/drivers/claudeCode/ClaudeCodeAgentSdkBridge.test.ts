import { describe, expect, it, vi } from 'vitest'

import { createClaudeCodeExecutorDescriptor } from './ClaudeCodeExecutorDescriptor'
import {
  createClaudeCodeAgentSdkOptions,
  createClaudeCodeAgentSdkQueryRequest,
  createClaudeCodeAgentSdkStartupRequest
} from './ClaudeCodeAgentSdkBridge'
import type { ClaudeCodeCompositionSettings } from './ClaudeCodeSettingsBuilder'
import { createClaudeCodeQueryOptionsFromSettings } from './ClaudeCodeQueryOptions'
import { createClaudeCodeToolHooks } from './ClaudeCodeToolHooks'

const settings: ClaudeCodeCompositionSettings = {
  cwd: '/tmp/workspace',
  env: {
    FOO: 'bar'
  },
  permissionMode: 'acceptEdits',
  allowedTools: ['Read'],
  disallowedTools: ['Bash'],
  mcpSources: [
    {
      serverId: 'mcp-files',
      sourceId: 'mcp:mcp-files',
      toolCount: 1,
      isActive: true,
      runtimeState: 'connected',
      lastCheckedAt: 1
    },
    {
      serverId: 'mcp-remote',
      sourceId: 'mcp:mcp-remote',
      toolCount: 1,
      isActive: true,
      runtimeState: 'connected',
      lastCheckedAt: 2
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
    },
    {
      serverId: 'mcp-remote',
      serverName: 'RemoteSearch',
      transport: 'streamableHttp',
      url: 'https://mcp.example.com/search',
      headers: {
        authorization: 'Bearer token'
      }
    }
  ],
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
  skillContext: ['Enabled skills:', '', '- Code Reader. Declared tools: Read. Source: local.'].join('\n')
}

describe('Claude Code Agent SDK bridge', () => {
  it('maps executor descriptor state into official query/startup option shapes', () => {
    const abortController = new AbortController()
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings,
      abortController,
      resume: 'resume-1',
      responseFormat: {
        type: 'json',
        schema: {
          type: 'object',
          properties: {
            answer: { type: 'string' }
          }
        }
      },
      stderr: vi.fn()
    })
    const toolHooks = createClaudeCodeToolHooks({
      sessionId: 'session-1',
      toolPolicy: query.runtimeMetadata.toolPolicy,
      requestToolApproval: async () => ({
        behavior: 'allow'
      })
    })
    const executor = createClaudeCodeExecutorDescriptor({
      query,
      toolHooks,
      signal: abortController.signal
    })

    const options = createClaudeCodeAgentSdkOptions(executor)
    const queryRequest = createClaudeCodeAgentSdkQueryRequest({
      prompt: 'Inspect this repository',
      executor
    })
    const startupRequest = createClaudeCodeAgentSdkStartupRequest(executor)

    expect(options).toMatchObject({
      model: 'claude-sonnet-4-5',
      cwd: '/tmp/workspace',
      permissionMode: 'acceptEdits',
      allowedTools: ['Read', 'skill__code-reader__read'],
      disallowedTools: ['Bash'],
      resume: 'resume-1',
      strictMcpConfig: true,
      mcpServers: {
        Filesystem: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          env: {
            ROOT: '/tmp/workspace'
          }
        },
        RemoteSearch: {
          type: 'http',
          url: 'https://mcp.example.com/search',
          headers: {
            authorization: 'Bearer token'
          }
        }
      },
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            answer: { type: 'string' }
          }
        }
      },
      abortController
    })
    expect(typeof options.canUseTool).toBe('function')
    expect(options.hooks).toMatchObject({
      PreToolUse: [
        {
          matcher: '*',
          hooks: [expect.any(Function)]
        }
      ]
    })
    expect(queryRequest.prompt).toBe('Inspect this repository')
    expect(queryRequest.options.model).toBe(options.model)
    expect(queryRequest.options.cwd).toBe(options.cwd)
    expect(queryRequest.options.resume).toBe(options.resume)
    expect(queryRequest.options.allowedTools).toEqual(options.allowedTools)
    expect(queryRequest.options.disallowedTools).toEqual(options.disallowedTools)
    expect(queryRequest.options.mcpServers).toEqual(options.mcpServers)
    expect(queryRequest.options.strictMcpConfig).toBe(true)
    expect(typeof queryRequest.options.canUseTool).toBe('function')
    expect(queryRequest.options.hooks?.PreToolUse).toHaveLength(1)

    expect(startupRequest.options.model).toBe(options.model)
    expect(startupRequest.options.cwd).toBe(options.cwd)
    expect(startupRequest.options.resume).toBe(options.resume)
    expect(startupRequest.options.mcpServers).toEqual(options.mcpServers)
    expect(startupRequest.options.strictMcpConfig).toBe(true)
  })

  it('forwards thinking and effort selections to the SDK options', () => {
    const optionsFor = (effort: 'off' | 'low' | 'high' | 'max') => {
      const query = createClaudeCodeQueryOptionsFromSettings({
        modelId: 'deepseek-v4.1-flash-1017',
        settings: { ...settings, effort }
      })
      const toolHooks = createClaudeCodeToolHooks({
        sessionId: 'session-1',
        toolPolicy: query.runtimeMetadata.toolPolicy,
        requestToolApproval: async () => ({
          behavior: 'allow'
        })
      })
      const executor = createClaudeCodeExecutorDescriptor({
        query,
        toolHooks,
        signal: new AbortController().signal
      })
      return createClaudeCodeAgentSdkOptions(executor)
    }

    const off = optionsFor('off')
    expect(off.thinking).toEqual({ type: 'disabled' })
    expect(off).not.toHaveProperty('effort')

    expect(optionsFor('low')).toMatchObject({ effort: 'low' })
    expect(optionsFor('high')).toMatchObject({ effort: 'high' })
    expect(optionsFor('max')).toMatchObject({ effort: 'max' })
    expect(optionsFor('high')).not.toHaveProperty('thinking')
  })

  it('bridges canUseTool and PreToolUse hook callbacks through platform tool approvals', async () => {
    const abortController = new AbortController()
    const requestToolApproval = vi.fn(async ({ toolName }: { toolName: string }) => {
      if (toolName === 'WebSearch') {
        return {
          behavior: 'allow' as const,
          updatedInput: { query: 'ethereum' }
        }
      }

      return {
        behavior: 'deny' as const,
        message: 'Tool denied'
      }
    })
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings,
      abortController
    })
    const toolHooks = createClaudeCodeToolHooks({
      sessionId: 'session-1',
      toolPolicy: query.runtimeMetadata.toolPolicy,
      requestToolApproval
    })
    const executor = createClaudeCodeExecutorDescriptor({
      query,
      toolHooks,
      signal: abortController.signal
    })

    const options = createClaudeCodeAgentSdkOptions(executor)
    const preToolUse = options.hooks?.PreToolUse?.[0]?.hooks[0]

    await expect(
      options.canUseTool?.('WebSearch', { query: 'btc' }, {
        signal: abortController.signal,
        toolUseID: 'tool-use-1',
        requestId: 'request-1'
      })
    ).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { query: 'btc' },
      toolUseID: 'tool-use-1'
    })

    await expect(
      preToolUse?.(
        {
          hook_event_name: 'PreToolUse',
          session_id: 'session-1',
          transcript_path: '/tmp/transcript.jsonl',
          cwd: '/tmp/workspace',
          tool_name: 'WebSearch',
          tool_input: { query: 'btc' },
          tool_use_id: 'tool-call-42'
        },
        'tool-call-42',
        {
          signal: abortController.signal
        }
      )
    ).resolves.toEqual({
      continue: true,
      decision: 'approve',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: {
          query: 'ethereum'
        }
      }
    })

    await expect(
      preToolUse?.(
        {
          hook_event_name: 'PreToolUse',
          session_id: 'session-1',
          transcript_path: '/tmp/transcript.jsonl',
          cwd: '/tmp/workspace',
          tool_name: 'Bash',
          tool_input: { command: 'rm -rf .' },
          tool_use_id: 'tool-call-43'
        },
        'tool-call-43',
        {
          signal: abortController.signal
        }
      )
    ).resolves.toEqual({
      continue: false,
      decision: 'block',
      reason: 'Tool "Bash" is disabled for this agent.',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Tool "Bash" is disabled for this agent.'
      }
    })

    expect(requestToolApproval).toHaveBeenCalledWith({
      sessionId: 'session-1',
      toolName: 'WebSearch',
      toolCallId: 'tool-call-42'
    })
  })

  it('enables allowDangerouslySkipPermissions when the platform permission mode is bypassPermissions', () => {
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings: {
        ...settings,
        permissionMode: 'bypassPermissions'
      }
    })
    const toolHooks = createClaudeCodeToolHooks({
      sessionId: 'session-1',
      toolPolicy: query.runtimeMetadata.toolPolicy,
      requestToolApproval: async () => ({
        behavior: 'allow'
      })
    })
    const executor = createClaudeCodeExecutorDescriptor({
      query,
      toolHooks,
      signal: new AbortController().signal
    })

    expect(createClaudeCodeAgentSdkOptions(executor).allowDangerouslySkipPermissions).toBe(true)
  })
})
