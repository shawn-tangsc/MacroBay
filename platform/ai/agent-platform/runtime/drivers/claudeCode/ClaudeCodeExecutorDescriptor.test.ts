import { describe, expect, it } from 'vitest'

import { createClaudeCodeExecutorDescriptor } from './ClaudeCodeExecutorDescriptor'
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

describe('Claude Code executor descriptor', () => {
  it('packages SDK-facing options, runtime metadata, hooks, and safe provider metadata into a stable executor descriptor', () => {
    const abortController = new AbortController()
    const query = createClaudeCodeQueryOptionsFromSettings({
      modelId: 'claude-sonnet-4-5',
      settings,
      providerEnv: {
        ANTHROPIC_API_KEY: 'provider-secret',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5'
      },
      abortController
    })
    const toolHooks = createClaudeCodeToolHooks({
      sessionId: 'session-1',
      toolPolicy: query.runtimeMetadata.toolPolicy,
      requestToolApproval: async () => ({
        behavior: 'allow'
      })
    })

    const descriptor = createClaudeCodeExecutorDescriptor({
      query,
      toolHooks,
      signal: abortController.signal,
      providerMetadata: {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        modelId: 'claude-sonnet-4-5',
        modelName: 'Claude Sonnet 4.5',
        protocol: 'messages',
        baseUrl: 'https://anthropic.proxy.test',
        route: 'direct',
        serverWebToolsSupported: true
      }
    })

    expect(descriptor).toMatchObject({
      sdkOptions: {
        model: 'claude-sonnet-4-5',
        cwd: '/tmp/workspace',
        env: {
          FOO: 'bar',
          ANTHROPIC_API_KEY: 'provider-secret',
          ANTHROPIC_MODEL: 'claude-sonnet-4-5'
        },
        permissionMode: 'acceptEdits',
        allowedTools: ['Read'],
        disallowedTools: ['Bash'],
        abortController
      },
      metadata: {
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
        skillContext: ['Enabled skills:', '', '- Code Reader. Declared tools: Read. Source: local.'].join('\n'),
        providerMetadata: {
          providerId: 'anthropic',
          providerName: 'Anthropic',
          modelId: 'claude-sonnet-4-5',
          modelName: 'Claude Sonnet 4.5',
          protocol: 'messages',
          baseUrl: 'https://anthropic.proxy.test'
        },
        toolPolicy: {
          permissionMode: 'acceptEdits',
          allowedTools: ['Read'],
          disallowedTools: ['Bash'],
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
          skillToolIds: ['skill__code-reader__read']
        }
      }
    })
    expect(descriptor.signal).toBe(abortController.signal)
    expect(descriptor.toolHooks).toBe(toolHooks)
    expect(descriptor.sdkOptions).not.toBe(query.sdkOptions)
    expect(descriptor.sdkOptions.env).not.toBe(query.sdkOptions.env)
    expect(descriptor.metadata.mcpServers).not.toBe(query.runtimeMetadata.mcpServers)
    expect(descriptor.metadata.mcpSources).not.toBe(query.runtimeMetadata.mcpSources)
    expect(descriptor.metadata.skills).not.toBe(query.runtimeMetadata.skills)
    expect(descriptor.metadata.toolPolicy).not.toBe(query.runtimeMetadata.toolPolicy)
  })
})
