import { describe, expect, it, vi, type Mock } from 'vitest'

import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '../../agentChatRuntime'
import type { AgentRuntimeComposition } from '../../AgentRuntimeCompositionService'
import type { ToolApprovalDecision } from '../../policy'
import type { AgentRuntimeToolApprovalRequestChunk } from '../../runtimeTypes'
import { DEFAULT_SYSTEM_WORKSPACE_PATH } from '../../../schemas/workspaceSchemas'
import type { ClaudeCodeProviderEnvironmentResult } from './ClaudeCodeProviderEnvironment'
import type { ClaudeCodeRuntimeExecutionInput } from './ClaudeCodeRuntimeDriver'
import { ClaudeCodeRuntimeDriver, type ClaudeCodeRuntimeDriverDependencies } from './ClaudeCodeRuntimeDriver'

const createdAt = '2026-01-01T00:00:00.000Z'

const request: AgentChatRuntimeRequest = {
  agentId: 'agent-1',
  sessionId: 'session-1',
  text: 'Hello',
  runId: 'run-1'
}

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
  environment: {
    FOO: 'bar'
  },
  tools: {
    all: [],
    enabled: [{ id: 'Read', name: 'Read', origin: 'builtin', approval: 'auto' }],
    disabled: [{ id: 'Bash', name: 'Bash', origin: 'builtin', approval: 'prompt' }]
  },
  mcp: {
    sources: [
      {
        serverId: 'mcp-files',
        sourceId: 'mcp:mcp-files',
        toolCount: 1,
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
        description: null,
        author: null,
        namespace: null,
        folderName: 'code-reader',
        source: 'local',
        tags: [],
        tools: ['Read']
      }
    ],
    toolIds: ['skill__code-reader__read']
  }
}

describe('Claude Code runtime driver skeleton', () => {
  it('requires runtime composition from the driver context', async () => {
    const driver = new ClaudeCodeRuntimeDriver({
      executeTurn: vi.fn()
    })

    await expect(driver.sendMessage(request)).rejects.toThrow(
      'Claude Code runtime driver requires AgentRuntimeDriverContext.composition.'
    )
  })

  it('requires a model id before building SDK-facing query options', async () => {
    const driver = new ClaudeCodeRuntimeDriver({
      executeTurn: vi.fn()
    })

    await expect(driver.sendMessage(request, { composition: { ...composition, modelId: null } })).rejects.toThrow(
      'Claude Code runtime driver requires a model id in runtime composition.'
    )
  })

  it('builds settings from composition and passes them to the injected executor', async () => {
    const result = createRuntimeResult()
    const executeTurn = vi.fn(async () => result) as Mock<NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>>
    const driver = new ClaudeCodeRuntimeDriver({
      defaultEnv: {
        ENABLE_TOOL_SEARCH: 'auto'
      },
      executeTurn
    })

    await expect(driver.sendMessage(request, { composition })).resolves.toBe(result)

    expect(executeTurn).toHaveBeenCalledTimes(1)

    const input = executeTurn.mock.calls[0]?.[0]
    expect(input).toMatchObject({
      request,
      composition,
      runId: 'run-1',
      settings: {
        cwd: '/tmp/workspace',
        env: {
          ENABLE_TOOL_SEARCH: 'auto',
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
        skills: [{ skillId: 'skill-1', name: 'Code Reader', folderName: 'code-reader', source: 'local', tools: ['Read'] }],
        skillToolIds: ['skill__code-reader__read'],
        skillContext: ['Enabled skills:', '', '- Code Reader. Declared tools: Read. Source: local.'].join('\n')
      },
      query: {
        sdkOptions: {
          model: 'provider:model-a',
          cwd: '/tmp/workspace',
          env: {
            ENABLE_TOOL_SEARCH: 'auto',
            FOO: 'bar'
          },
          permissionMode: 'acceptEdits',
          allowedTools: ['Read'],
          disallowedTools: ['Bash']
        },
        runtimeMetadata: {
          mcpSources: [
            {
              serverId: 'mcp-files',
              sourceId: 'mcp:mcp-files',
              toolCount: 1,
              isActive: true,
              runtimeState: 'connected',
              lastCheckedAt: 1
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
          toolPolicy: {
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
              }
            ],
            skillToolIds: ['skill__code-reader__read']
          }
        }
      }
    })
    expect(input?.query.sdkOptions.abortController).toBeInstanceOf(AbortController)
    expect(input?.toolHooks).toEqual({
      canUseTool: expect.any(Function),
      preToolUse: expect.any(Function)
    })
    expect(input?.executor).toMatchObject({
      sdkOptions: {
        model: 'provider:model-a',
        cwd: '/tmp/workspace',
        env: {
          ENABLE_TOOL_SEARCH: 'auto',
          FOO: 'bar'
        },
        permissionMode: 'acceptEdits',
        allowedTools: ['Read'],
        disallowedTools: ['Bash']
      },
      metadata: {
        mcpSources: [
          {
            serverId: 'mcp-files',
            sourceId: 'mcp:mcp-files',
            toolCount: 1,
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
        toolPolicy: {
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
            }
          ],
          skillToolIds: ['skill__code-reader__read']
        }
      },
      toolHooks: {
        canUseTool: expect.any(Function),
        preToolUse: expect.any(Function)
      }
    })
    expect(input?.executor.sdkOptions.abortController).toBeInstanceOf(AbortController)
    expect(input?.executor.signal).toBeInstanceOf(AbortSignal)
    expect(input?.requestToolApproval).toEqual(expect.any(Function))
    expect(input?.signal).toBeInstanceOf(AbortSignal)
  })

  it('forwards the previous runtime resume token into Claude query options', async () => {
    const result = createRuntimeResult()
    const executeTurn = vi.fn(async () => result) as Mock<NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>>
    const driver = new ClaudeCodeRuntimeDriver({
      executeTurn
    })

    await expect(
      driver.sendMessage(request, {
        composition,
        lastResumeToken: 'resume:previous-turn'
      })
    ).resolves.toBe(result)

    const input = executeTurn.mock.calls[0]?.[0]
    expect(input?.query.sdkOptions.resume).toBe('resume:previous-turn')
    expect(input?.executor.sdkOptions.resume).toBe('resume:previous-turn')
  })

  it('prewarms a session through the injected prewarm hook without executing a turn', async () => {
    const prewarmSession = vi.fn(async () => ({
      ok: true as const,
      status: 'warmed' as const
    }))
    const executeTurn = vi.fn() as Mock<NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>>
    const driver = new ClaudeCodeRuntimeDriver({
      prewarmSession,
      executeTurn
    })

    await expect(
      driver.prewarmSession(
        {
          agentId: 'agent-1',
          sessionId: 'session-1'
        },
        {
          composition,
          lastResumeToken: 'resume:previous-turn'
        }
      )
    ).resolves.toEqual({
      ok: true,
      status: 'warmed'
    })

    expect(executeTurn).not.toHaveBeenCalled()
    expect(prewarmSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      composition,
      query: expect.objectContaining({
        sdkOptions: expect.objectContaining({
          model: 'provider:model-a',
          cwd: '/tmp/workspace',
          resume: 'resume:previous-turn'
        })
      }),
      executor: expect.objectContaining({
        sdkOptions: expect.objectContaining({
          model: 'provider:model-a',
          cwd: '/tmp/workspace',
          resume: 'resume:previous-turn'
        }),
        toolHooks: {
          canUseTool: expect.any(Function),
          preToolUse: expect.any(Function)
        }
      })
    }))
  })

  it('prepares the workspace before building query options and forwards the prepared cwd to the executor', async () => {
    const result = createRuntimeResult()
    const prepareWorkspace = vi.fn(async () => ({
      cwd: '/tmp/prepared-workspace'
    }))
    const executeTurn = vi.fn(async () => result) as Mock<NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>>
    const driver = new ClaudeCodeRuntimeDriver({
      prepareWorkspace,
      executeTurn
    })

    await expect(driver.sendMessage(request, { composition })).resolves.toBe(result)

    expect(prepareWorkspace).toHaveBeenCalledWith({
      sessionId: 'session-1',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user'
    })
    expect(prepareWorkspace.mock.invocationCallOrder[0]).toBeLessThan(executeTurn.mock.invocationCallOrder[0] ?? Infinity)
    expect(executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          cwd: '/tmp/prepared-workspace'
        }),
        query: expect.objectContaining({
          sdkOptions: expect.objectContaining({
            cwd: '/tmp/prepared-workspace'
          })
        })
      })
    )
  })

  it('fails fast when workspace prepare rejects a missing user workspace', async () => {
    const executeTurn = vi.fn() as Mock<NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>>
    const prepareWorkspace = vi.fn(async () => {
      throw new Error('Claude Code workspace does not exist: /tmp/workspace')
    })
    const driver = new ClaudeCodeRuntimeDriver({
      prepareWorkspace,
      executeTurn
    })

    await expect(driver.sendMessage(request, { composition })).rejects.toThrow(
      'Claude Code workspace does not exist: /tmp/workspace'
    )

    expect(prepareWorkspace).toHaveBeenCalledWith({
      sessionId: 'session-1',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user'
    })
    expect(executeTurn).not.toHaveBeenCalled()
    expect(driver.cancelMessage('run-1')).toBe(false)
  })

  it('uses the managed system workspace placeholder when system composition has no path', async () => {
    const result = createRuntimeResult()
    const prepareWorkspace = vi.fn(async () => ({
      cwd: '/managed/root/session-1'
    }))
    const executeTurn = vi.fn(async () => result) as Mock<NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>>
    const driver = new ClaudeCodeRuntimeDriver({
      prepareWorkspace,
      executeTurn
    })

    await expect(
      driver.sendMessage(request, {
        composition: {
          ...composition,
          workspacePath: null,
          workspaceType: 'system'
        }
      })
    ).resolves.toBe(result)

    expect(prepareWorkspace).toHaveBeenCalledWith({
      sessionId: 'session-1',
      workspacePath: DEFAULT_SYSTEM_WORKSPACE_PATH,
      workspaceType: 'system'
    })
    expect(executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          cwd: '/managed/root/session-1'
        })
      })
    )
  })

  it('fails fast when user runtime composition does not provide a workspace path', async () => {
    const prepareWorkspace = vi.fn()
    const driver = new ClaudeCodeRuntimeDriver({
      prepareWorkspace,
      executeTurn: vi.fn()
    })

    await expect(
      driver.sendMessage(request, {
        composition: {
          ...composition,
          workspacePath: null,
          workspaceType: 'user'
        }
      })
    ).rejects.toThrow('Claude Code runtime driver requires a workspace path in runtime composition.')

    expect(prepareWorkspace).not.toHaveBeenCalled()
  })

  it('forces thinking off when the resolved model declares no reasoning support', async () => {
    const result = createRuntimeResult()
    const executeTurn = vi.fn(async () => result) as Mock<NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>>
    const driver = new ClaudeCodeRuntimeDriver({
      resolveProviderEnvironment: async () => ({
        ok: true,
        modelId: 'plain-chat',
        env: {
          ANTHROPIC_MODEL: 'plain-chat'
        },
        metadata: {
          providerId: 'anthropic',
          providerName: 'Anthropic',
          modelId: 'plain-chat',
          modelName: 'Plain Chat',
          protocol: 'messages',
          baseUrl: 'https://anthropic.proxy.test',
          route: 'direct',
          modelReasoningSupported: false
        },
        compatibility: {
          providerId: 'anthropic',
          modelId: 'plain-chat',
          runtimeId: 'claude-code',
          selectable: true,
          route: 'direct',
          status: 'ready',
          summary: 'Ready'
        }
      }),
      executeTurn
    })

    await driver.sendMessage(request, { composition: { ...composition, effort: 'high' } })

    const input = executeTurn.mock.calls[0]?.[0]
    expect(input?.query.sdkOptions.thinking).toEqual({ type: 'disabled' })
    expect(input?.query.sdkOptions).not.toHaveProperty('effort')
  })

  it('resolves provider env before executing and forwards the resolved model, env, and safe metadata', async () => {
    const result = createRuntimeResult()
    const resolveProviderEnvironment = vi.fn(async (): Promise<ClaudeCodeProviderEnvironmentResult> => ({
      ok: true,
      modelId: 'claude-sonnet-4-5',
      env: {
        ANTHROPIC_API_KEY: 'provider-secret',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5'
      },
      metadata: {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        modelId: 'claude-sonnet-4-5',
        modelName: 'Claude Sonnet 4.5',
        protocol: 'messages',
        baseUrl: 'https://anthropic.proxy.test',
        route: 'direct'
      },
      compatibility: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        runtimeId: 'claude-code',
        selectable: true,
        route: 'direct',
        status: 'ready',
        summary: 'Ready'
      }
    }))
    const executeTurn = vi.fn(async () => result) as Mock<NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>>
    const driver = new ClaudeCodeRuntimeDriver({
      defaultEnv: {
        ENABLE_TOOL_SEARCH: 'auto'
      },
      resolveProviderEnvironment,
      executeTurn
    })

    await expect(driver.sendMessage(request, { composition })).resolves.toBe(result)

    expect(resolveProviderEnvironment).toHaveBeenCalledWith('provider:model-a')
    expect(resolveProviderEnvironment.mock.invocationCallOrder[0]).toBeLessThan(executeTurn.mock.invocationCallOrder[0] ?? Infinity)
    expect(executeTurn).toHaveBeenCalledTimes(1)

    const input = executeTurn.mock.calls[0]?.[0]
    expect(input).toMatchObject({
      request,
      composition,
      runId: 'run-1',
      settings: {
        cwd: '/tmp/workspace',
        env: {
          ENABLE_TOOL_SEARCH: 'auto',
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
        skills: [{ skillId: 'skill-1', name: 'Code Reader', folderName: 'code-reader', source: 'local', tools: ['Read'] }],
        skillToolIds: ['skill__code-reader__read']
      },
      providerMetadata: {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        modelId: 'claude-sonnet-4-5',
        modelName: 'Claude Sonnet 4.5',
        protocol: 'messages',
        baseUrl: 'https://anthropic.proxy.test',
        route: 'direct'
      },
      query: {
        sdkOptions: {
          model: 'claude-sonnet-4-5',
          cwd: '/tmp/workspace',
          env: {
            ENABLE_TOOL_SEARCH: 'auto',
            FOO: 'bar',
            ANTHROPIC_API_KEY: 'provider-secret',
            ANTHROPIC_MODEL: 'claude-sonnet-4-5'
          },
          permissionMode: 'acceptEdits',
          allowedTools: ['Read'],
          disallowedTools: ['Bash']
        },
        runtimeMetadata: {
          mcpSources: [
            {
              serverId: 'mcp-files',
              sourceId: 'mcp:mcp-files',
              toolCount: 1,
              isActive: true,
              runtimeState: 'connected',
              lastCheckedAt: 1
            }
          ],
          skills: [
            { skillId: 'skill-1', name: 'Code Reader', folderName: 'code-reader', source: 'local', tools: ['Read'] }
          ],
          skillToolIds: ['skill__code-reader__read'],
          toolPolicy: {
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
              }
            ],
            skillToolIds: ['skill__code-reader__read']
          }
        }
      }
    })
    expect(input?.query.sdkOptions.abortController).toBeInstanceOf(AbortController)
    expect(input?.toolHooks).toEqual({
      canUseTool: expect.any(Function),
      preToolUse: expect.any(Function)
    })
    expect(input?.executor).toMatchObject({
      sdkOptions: {
        model: 'claude-sonnet-4-5',
        cwd: '/tmp/workspace',
        env: {
          ENABLE_TOOL_SEARCH: 'auto',
          FOO: 'bar',
          ANTHROPIC_API_KEY: 'provider-secret',
          ANTHROPIC_MODEL: 'claude-sonnet-4-5'
        },
        permissionMode: 'acceptEdits',
        allowedTools: ['Read'],
        disallowedTools: ['Bash']
      },
      metadata: {
        providerMetadata: {
          providerId: 'anthropic',
          providerName: 'Anthropic',
          modelId: 'claude-sonnet-4-5',
          modelName: 'Claude Sonnet 4.5',
          protocol: 'messages',
          baseUrl: 'https://anthropic.proxy.test'
        },
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
        ]
      },
      toolHooks: {
        canUseTool: expect.any(Function),
        preToolUse: expect.any(Function)
      }
    })
    expect(input?.executor.sdkOptions.abortController).toBeInstanceOf(AbortController)
    expect(input?.executor.signal).toBeInstanceOf(AbortSignal)
    expect(input?.requestToolApproval).toEqual(expect.any(Function))
    expect(input?.signal).toBeInstanceOf(AbortSignal)
  })

  it('builds SDK-ready tool hooks for the executor from session-bound runtime approval flow', async () => {
    const result = createRuntimeResult()
    const emitChunk = vi.fn()
    const requestToolApproval = vi.fn(
      async (): Promise<ToolApprovalDecision> => ({
        behavior: 'allow',
        updatedInput: { query: 'ethereum' }
      })
    )
    const executeTurn = vi.fn(async (input: ClaudeCodeRuntimeExecutionInput) => {
      await expect(input.toolHooks.canUseTool('Read')).resolves.toEqual({
        behavior: 'allow'
      })
      await expect(
        input.toolHooks.preToolUse({
          toolName: 'WebSearch',
          toolCallId: 'tool-call-99',
          input: { query: 'eth' }
        })
      ).resolves.toEqual({
        behavior: 'allow',
        updatedInput: { query: 'ethereum' }
      })
      return result
    }) as Mock<NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>>
    const driver = new ClaudeCodeRuntimeDriver({
      emitChunk,
      requestToolApproval,
      executeTurn
    })

    await expect(driver.sendMessage(request, { composition })).resolves.toBe(result)

    expect(requestToolApproval).toHaveBeenCalledWith({
      sessionId: 'session-1',
      toolName: 'WebSearch',
      toolCallId: 'tool-call-99',
      approvalId: expect.any(String)
    })
    expect(emitChunk).toHaveBeenCalledWith({
      type: 'tool-approval-request',
      approvalId: expect.any(String),
      sessionId: 'session-1',
      toolCallId: 'tool-call-99',
      providerMetadata: {
        claudeAgent: {
          transport: 'claude-agent',
          toolName: 'WebSearch'
        }
      }
    })
  })

  it('passes a stable runId and bound tool-approval callback into the injected executor', async () => {
    const result = createRuntimeResult()
    const executeTurn = vi.fn(async (_input: ClaudeCodeRuntimeExecutionInput) => result) as Mock<
      NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>
    >
    const requestToolApproval = vi.fn(
      async (): Promise<ToolApprovalDecision> => ({
        behavior: 'allow'
      })
    )
    const driver = new ClaudeCodeRuntimeDriver({
      emitChunk: vi.fn(),
      requestToolApproval,
      executeTurn
    })

    await expect(driver.sendMessage(request, { composition })).resolves.toBe(result)

    expect(executeTurn).toHaveBeenCalledTimes(1)
    const executionInput = executeTurn.mock.calls[0]![0]
    expect(executionInput.runId).toBe('run-1')
    await expect(
      executionInput.requestToolApproval({
        sessionId: 'session-1',
        toolCallId: 'tool-call-3',
        toolName: 'Read'
      })
    ).resolves.toEqual({
      behavior: 'allow'
    })
    expect(requestToolApproval).toHaveBeenCalledWith({
      approvalId: expect.any(String),
      sessionId: 'session-1',
      toolCallId: 'tool-call-3',
      toolName: 'Read'
    })
  })

  it.each([
    {
      errorCode: 'missing-api-key',
      message: 'Claude Code provider is missing an API key.'
    },
    {
      errorCode: 'provider-disabled',
      message: 'Claude Code provider is disabled.'
    },
    {
      errorCode: 'model-not-ready',
      message: 'Claude Code provider is not ready.'
    },
    {
      errorCode: 'unsupported-provider-protocol',
      message: 'Claude Code agents require a compatible Anthropic Messages endpoint and model.'
    }
  ] as const)('fails fast when provider env resolution returns $errorCode', async (failure) => {
    const executeTurn = vi.fn() as Mock<NonNullable<ClaudeCodeRuntimeDriverDependencies['executeTurn']>>
    const resolveProviderEnvironment = vi.fn(async (): Promise<ClaudeCodeProviderEnvironmentResult> => ({
      ok: false,
      errorCode: failure.errorCode,
      message: failure.message
    }))
    const driver = new ClaudeCodeRuntimeDriver({
      resolveProviderEnvironment,
      executeTurn
    })

    await expect(driver.sendMessage(request, { composition })).rejects.toThrow(failure.message)

    expect(resolveProviderEnvironment).toHaveBeenCalledWith('provider:model-a')
    expect(executeTurn).not.toHaveBeenCalled()
    expect(driver.cancelMessage('run-1')).toBe(false)
  })

  it('emits a tool-approval-request chunk and resolves allow decisions through the approval requester', async () => {
    const emitChunk = vi.fn()
    const requestToolApproval = vi.fn(
      async (): Promise<ToolApprovalDecision> => ({
        behavior: 'allow',
        updatedInput: { command: 'mkdir logs' }
      })
    )
    const driver = new ClaudeCodeRuntimeDriver({
      emitChunk,
      requestToolApproval,
      executeTurn: vi.fn()
    })

    await expect(
      driver.requestToolApproval({
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Bash'
      })
    ).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { command: 'mkdir logs' }
    })

    const emittedChunk = emitChunk.mock.calls[0]?.[0] as AgentRuntimeToolApprovalRequestChunk
    expect(emittedChunk).toEqual({
      type: 'tool-approval-request',
      approvalId: expect.any(String),
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      providerMetadata: {
        claudeAgent: {
          transport: 'claude-agent',
          toolName: 'Bash'
        }
      }
    } satisfies AgentRuntimeToolApprovalRequestChunk)
    expect(requestToolApproval).toHaveBeenCalledWith({
      approvalId: emittedChunk.approvalId,
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      toolName: 'Bash'
    })
  })

  it('denies tool approval when no chunk emitter is bound', async () => {
    const requestToolApproval = vi.fn()
    const driver = new ClaudeCodeRuntimeDriver({
      requestToolApproval,
      executeTurn: vi.fn()
    })

    await expect(
      driver.requestToolApproval({
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Bash'
      })
    ).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool approval emitter not ready.'
    })

    expect(requestToolApproval).not.toHaveBeenCalled()
  })

  it('denies tool approval when no approval requester is bound', async () => {
    const emitChunk = vi.fn()
    const driver = new ClaudeCodeRuntimeDriver({
      emitChunk,
      executeTurn: vi.fn()
    })

    await expect(
      driver.requestToolApproval({
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Bash'
      })
    ).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool approval requester not ready.'
    })

    expect(emitChunk).not.toHaveBeenCalled()
  })

  it('passes through deny decisions from the approval requester', async () => {
    const emitChunk = vi.fn()
    const requestToolApproval = vi.fn(
      async (): Promise<ToolApprovalDecision> => ({
        behavior: 'deny',
        message: 'User denied'
      })
    )
    const driver = new ClaudeCodeRuntimeDriver({
      emitChunk,
      requestToolApproval,
      executeTurn: vi.fn()
    })

    await expect(
      driver.requestToolApproval({
        approvalId: 'approval-preseeded',
        sessionId: 'session-1',
        toolCallId: 'tool-call-2',
        toolName: 'Write'
      })
    ).resolves.toEqual({
      behavior: 'deny',
      message: 'User denied'
    })

    expect(emitChunk).toHaveBeenCalledOnce()
    expect(requestToolApproval).toHaveBeenCalledWith({
      approvalId: 'approval-preseeded',
      sessionId: 'session-1',
      toolCallId: 'tool-call-2',
      toolName: 'Write'
    })
  })

  it('does not invoke the executor when the run is cancelled during workspace preparation', async () => {
    const workspacePreparation = createDeferred<{ cwd: string }>()
    const prepareWorkspace = vi.fn(() => workspacePreparation.promise)
    const resolveProviderEnvironment = vi.fn()
    const executeTurn = vi.fn()
    const driver = new ClaudeCodeRuntimeDriver({
      prepareWorkspace,
      resolveProviderEnvironment,
      executeTurn
    })

    const turn = driver.sendMessage(request, { composition })
    await waitUntil(() => prepareWorkspace.mock.calls.length === 1)

    expect(driver.cancelMessage('run-1', {
      kind: 'interrupt',
      message: 'Interrupted by a newer queued turn.'
    })).toBe(true)

    workspacePreparation.resolve({
      cwd: '/tmp/prepared-workspace'
    })

    await expect(turn).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(resolveProviderEnvironment).not.toHaveBeenCalled()
    expect(executeTurn).not.toHaveBeenCalled()
    expect(driver.cancelMessage('run-1')).toBe(false)
  })

  it('does not invoke the executor when the session is cancelled during provider env resolution', async () => {
    const providerEnvironment = createDeferred<ClaudeCodeProviderEnvironmentResult>()
    const prepareWorkspace = vi.fn(async () => ({
      cwd: '/tmp/prepared-workspace'
    }))
    const resolveProviderEnvironment = vi.fn(() => providerEnvironment.promise)
    const executeTurn = vi.fn()
    const driver = new ClaudeCodeRuntimeDriver({
      prepareWorkspace,
      resolveProviderEnvironment,
      executeTurn
    })

    const turn = driver.sendMessage(request, { composition })
    await waitUntil(() => resolveProviderEnvironment.mock.calls.length === 1)

    expect(driver.cancelSession('session-1', {
      kind: 'interrupt',
      message: 'Interrupted by a newer queued turn.'
    })).toBe(true)

    providerEnvironment.resolve({
      ok: true,
      modelId: 'claude-sonnet-4-5',
      env: {
        ANTHROPIC_API_KEY: 'provider-secret',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5'
      },
      metadata: {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        modelId: 'claude-sonnet-4-5',
        modelName: 'Claude Sonnet 4.5',
        protocol: 'messages',
        baseUrl: 'https://anthropic.proxy.test',
        route: 'direct'
      },
      compatibility: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        runtimeId: 'claude-code',
        selectable: true,
        route: 'direct',
        status: 'ready',
        summary: 'Ready'
      }
    })

    await expect(turn).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(prepareWorkspace).toHaveBeenCalledOnce()
    expect(executeTurn).not.toHaveBeenCalled()
    expect(driver.cancelSession('session-1')).toBe(false)
  })

  it('aborts the active run when cancelMessage is called', async () => {
    let signal: AbortSignal | null = null
    const driver = new ClaudeCodeRuntimeDriver({
      executeTurn: ({ signal: nextSignal }) =>
        new Promise<AgentChatRuntimeResult>((resolve, reject) => {
          signal = nextSignal
          nextSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    })

    const turn = driver.sendMessage(request, { composition })
    await waitUntil(() => signal !== null)

    expect(driver.cancelMessage('run-1')).toBe(true)
    await expect(turn).rejects.toThrow('aborted')
    expect(driver.cancelMessage('run-1')).toBe(false)
  })

  it('aborts the active session when cancelSession is called', async () => {
    let signal: AbortSignal | null = null
    const driver = new ClaudeCodeRuntimeDriver({
      executeTurn: ({ signal: nextSignal }) =>
        new Promise<AgentChatRuntimeResult>((resolve, reject) => {
          signal = nextSignal
          nextSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    })

    const turn = driver.sendMessage(request, { composition })
    await waitUntil(() => signal !== null)

    expect(driver.cancelSession('session-1')).toBe(true)
    await expect(turn).rejects.toThrow('aborted')
    expect(driver.cancelSession('session-1')).toBe(false)
  })
})

function createRuntimeResult(): AgentChatRuntimeResult {
  return {
    state: {
      agents: [],
      sessions: [],
      workspaces: [],
      activeAgentId: null,
      activeSessionId: null,
      sessionPins: [],
      messagesBySessionId: {},
      mcpServers: [],
      mcpRuntimeStatusByServerId: {},
      mcpToolsByServerId: {},
      channels: [],
      skills: [],
      agentSkills: [],
      tasks: [],
      taskRunLogs: [],
      channelTaskSubscriptions: []
    },
    userMessage: {
      id: 'user-1',
      sessionId: 'session-1',
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Hello' }] },
      searchableText: 'Hello',
      modelId: null,
      modelSnapshot: null,
      stats: null,
      runtimeResumeToken: null,
      createdAt,
      updatedAt: createdAt
    },
    assistantMessage: {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Hi' }] },
      searchableText: 'Hi',
      modelId: null,
      modelSnapshot: null,
      stats: null,
      runtimeResumeToken: 'resume-1',
      createdAt,
      updatedAt: createdAt
    }
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('Timed out waiting for condition.')
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return {
    promise,
    resolve,
    reject
  }
}
