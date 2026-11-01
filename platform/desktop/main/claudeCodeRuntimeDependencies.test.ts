import { describe, expect, it, vi } from 'vitest'

import type { AgentChatRuntimeRequest } from '../../ai/agent-platform/runtime/agentChatRuntime'
import type { AgentRuntimeComposition } from '../../ai/agent-platform/runtime/AgentRuntimeCompositionService'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import type { ProviderState } from '../../ai/providers/modelProviderTypes'
import type { ProviderRuntimeCheckReport } from '../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import type { AgentRuntimeProbeSnapshot } from '../../ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { AgentModelGatewayService } from './agentModelGateway/AgentModelGatewayService'
import type { AgentRuntimeProbeSnapshotStore } from './agentModelCompatibility/AgentRuntimeProbeSnapshotStore'
import type { InstalledSkill } from '../../ai/agent-platform/schemas/skillSchemas'
import { createClaudeCodeExecutorDescriptor } from '../../ai/agent-platform/runtime/drivers/claudeCode'
import { createClaudeCodeToolHooks } from '../../ai/agent-platform/runtime/drivers/claudeCode'
import type { ClaudeCodeQueryOptions } from '../../ai/agent-platform/runtime/drivers/claudeCode'
import type { ClaudeCodeRuntimeExecutionInput } from '../../ai/agent-platform/runtime/drivers/claudeCode/ClaudeCodeRuntimeDriver'
import type { ToolApproval } from '../../ai/agent-platform/schemas/toolSchemas'
import { SkillsRuntimeService } from '../../ai/agent-platform/skills/SkillsRuntimeService'
import type { TaskManagementToolRuntimeService } from '../../ai/agent-platform/runtime/tasks/TaskManagementToolRuntimeService'
import {
  createClaudeAgentSdkExecutor,
  createClaudeAgentSdkRuntime,
  createClaudeSdkPreferredExecutor,
  createClaudeCodeSdkModuleLoader,
  createClaudeCodeProviderEnvironmentResolver,
  createClaudeCodeRuntimeDriverDependencies,
  createClaudeCodeWorkspacePreparer
} from './claudeCodeRuntimeDependencies'

const composition = {
  agentId: 'agent-1',
  sessionId: 'session-1',
  agentType: 'claude-code',
  instructions: 'Act like a careful coding assistant.',
  modelId: 'anthropic:claude-sonnet-4-5',
  modelName: 'Claude Sonnet 4.5',
  permissionMode: 'acceptEdits',
  workspacePath: '/Users/example/project',
  workspaceType: 'user',
  environment: {},
  tools: {
    all: [],
    enabled: [],
    disabled: []
  },
  mcp: {
    sources: [],
    servers: []
  },
  skills: {
    agentId: 'agent-1',
    skills: [],
    toolIds: []
  }
} satisfies AgentRuntimeComposition

describe('claude code runtime dependency helpers', () => {
  it('resolves provider environment from the latest provider state snapshot', async () => {
    const providerState: ProviderState = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          enabled: true,
          apiKey: 'secret',
          baseUrl: 'https://api.anthropic.test',

          endpoints: [
            { protocol: 'messages', baseUrl: 'https://proxy.anthropic.test' } as const
          ],
          models: [
            {
              id: 'claude-sonnet-4-5',
              name: 'Claude Sonnet 4.5',
              capabilities: {
                chat: true,
                vision: true,
                embedding: false,
                tools: true,
                agentRuntimes: {
                  claudeCode: true
                }
              }
            }
          ],
          defaultChatModelId: 'claude-sonnet-4-5'
        }
      ]
    }
    const getProviderState = vi.fn(async () => providerState)

    const resolveProviderEnvironment = createClaudeCodeProviderEnvironmentResolver({
      getProviderState
    })
    const resolved = await resolveProviderEnvironment('anthropic:claude-sonnet-4-5')

    expect(getProviderState).toHaveBeenCalledOnce()
    expect(resolved).toEqual({
      ok: true,
      modelId: 'claude-sonnet-4-5',
      env: {
        ANTHROPIC_API_KEY: 'secret',
        ANTHROPIC_BASE_URL: 'https://proxy.anthropic.test',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-5',
        CLAUDE_CODE_USE_BEDROCK: '0'
      },
      metadata: {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        modelId: 'claude-sonnet-4-5',
        modelName: 'Claude Sonnet 4.5',
        protocol: 'messages',
        baseUrl: 'https://proxy.anthropic.test',
        route: 'direct',
        serverWebToolsSupported: false
      },
      compatibility: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        runtimeId: 'claude-code',
        selectable: true,
        route: 'direct',
        status: 'ready',
        summary: 'Model is configured for direct Claude Code runtime.'
      }
    })
  })

  it('does not create a Claude Code environment from vaulted metadata without a runtime key', async () => {
    const metadataState: ProviderState = {
      providers: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          enabled: true,
          apiKeyRef: 'provider:616e7468726f706963',
          baseUrl: 'https://api.anthropic.test',

          endpoints: [
            { protocol: 'messages', baseUrl: 'https://proxy.anthropic.test' } as const
          ],
          models: [
            {
              id: 'claude-sonnet-4-5',
              name: 'Claude Sonnet 4.5',
              capabilities: {
                chat: true,
                vision: true,
                embedding: false,
                tools: true,
                agentRuntimes: { claudeCode: true }
              }
            }
          ],
          defaultChatModelId: 'claude-sonnet-4-5'
        }
      ]
    }
    const getProviderState = Object.assign(async () => metadataState, {
      resolveRuntimeProvider: vi.fn(async () => metadataState.providers[0])
    })
    const resolveProviderEnvironment = createClaudeCodeProviderEnvironmentResolver({ getProviderState })

    const resolved = await resolveProviderEnvironment('anthropic:claude-sonnet-4-5')

    expect(getProviderState.resolveRuntimeProvider).toHaveBeenCalledWith('anthropic')
    expect(resolved).toMatchObject({ ok: false, errorCode: 'missing-api-key' })
    expect(JSON.stringify(resolved)).not.toContain('apiKeyRef')
  })

  it('resolves relay provider agent models through the running gateway route', async () => {
    const providerState: ProviderState = {
      providers: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          enabled: true,
          apiKey: 'secret',
          baseUrl: 'https://api.deepseek.com',

          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
            { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' } as const
          ],
          models: [
            {
              id: 'deepseek-v4-pro',
              name: 'DeepSeek V4 Pro',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: {
                  claudeCode: true
                }
              }
            }
          ],
          defaultChatModelId: 'deepseek-v4-pro'
        }
      ]
    }
    const gatewayProbe: AgentRuntimeProbeSnapshot = {
      route: 'gateway',
      status: 'ready',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      runtimeId: 'claude-code',
      signature: 'gateway-ready',
      checkedAt: new Date().toISOString(),
      message: 'Agent gateway runtime probe passed.'
    }
    const runtimeReport: ProviderRuntimeCheckReport = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      runtimeId: 'claude-code',
      ordinaryChat: {
        lane: 'ordinary-chat',
        status: 'ready',
        summary: 'Ordinary chat ready.'
      },
      direct: {
        lane: 'claude-code-direct',
        status: 'auth-failed',
        summary: 'Direct route failed.',
        route: 'direct',
        checkedAt: new Date().toISOString()
      },
      gateway: {
        lane: 'claude-code-gateway',
        status: 'ready',
        summary: 'Gateway route ready.',
        route: 'gateway',
        checkedAt: gatewayProbe.checkedAt
      },
      finalCompatibility: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
        runtimeId: 'claude-code',
        selectable: true,
        route: 'gateway',
        status: 'ready',
        summary: 'Agent gateway runtime probe passed.',
        checkedAt: gatewayProbe.checkedAt
      },
      updatedAt: new Date().toISOString(),
      signature: 'runtime-report'
    }
    const syncProviderConfig = vi.fn()
    const resolveProviderEnvironment = createClaudeCodeProviderEnvironmentResolver({
      getProviderState: async () => providerState,
      gatewayService: {
        getSnapshot: () => ({
          enabled: true,
          state: 'running',
          port: 18779,
          baseUrl: 'http://127.0.0.1:18779/anthropic',
          updatedAt: new Date().toISOString()
        }),
        getAuthToken: () => 'local-gateway-token',
        isSyncedFor: () => true,
        syncProviderConfig
      } as unknown as AgentModelGatewayService,
      snapshotStore: {
        getReport: vi.fn(async () => runtimeReport)
      } as unknown as AgentRuntimeProbeSnapshotStore
    })

    const resolved = await resolveProviderEnvironment('deepseek:deepseek-v4-pro')

    expect(syncProviderConfig).not.toHaveBeenCalled()
    expect(resolved).toMatchObject({
      ok: true,
      env: {
        ANTHROPIC_API_KEY: 'local-gateway-token',
        ANTHROPIC_AUTH_TOKEN: 'local-gateway-token',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:18779/anthropic',
        ANTHROPIC_MODEL: 'deepseek-v4-pro'
      },
      metadata: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
        route: 'gateway',
        baseUrl: 'http://127.0.0.1:18779/anthropic'
      },
      compatibility: {
        selectable: true,
        route: 'gateway',
        status: 'ready'
      }
    })
  })

  it('reuses stored direct runtime evidence for Anthropic-shaped relay providers', async () => {
    const providerState: ProviderState = {
      providers: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          enabled: true,
          apiKey: 'secret',
          baseUrl: 'https://api.deepseek.com',

          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
            { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' } as const
          ],
          models: [
            {
              id: 'deepseek-v4-pro',
              name: 'DeepSeek V4 Pro',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: {
                  claudeCode: true
                }
              }
            },
            {
              id: 'deepseek-v4-flash',
              name: 'DeepSeek V4 Flash',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: {
                  claudeCode: true
                }
              }
            }
          ],
          defaultChatModelId: 'deepseek-v4-pro'
        }
      ]
    }
    const now = new Date().toISOString()
    const runtimeReport: ProviderRuntimeCheckReport = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      runtimeId: 'claude-code',
      ordinaryChat: {
        lane: 'ordinary-chat',
        status: 'ready',
        summary: 'Ordinary chat ready.'
      },
      direct: {
        lane: 'claude-code-direct',
        status: 'ready',
        summary: 'Direct route ready.',
        route: 'direct',
        checkedAt: now
      },
      gateway: {
        lane: 'claude-code-gateway',
        status: 'idle',
        summary: 'Gateway not checked.',
        route: 'gateway'
      },
      finalCompatibility: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
        runtimeId: 'claude-code',
        selectable: true,
        route: 'direct',
        status: 'ready',
        summary: 'Direct route ready.',
        checkedAt: now
      },
      updatedAt: now,
      signature: 'direct-runtime-report'
    }
    const resolveProviderEnvironment = createClaudeCodeProviderEnvironmentResolver({
      getProviderState: async () => providerState,
      gatewayService: {
        getSnapshot: () => ({
          enabled: false,
          state: 'disabled',
          port: 18779,
          updatedAt: now
        }),
        getAuthToken: () => '',
        isSyncedFor: () => false,
        syncProviderConfig: vi.fn()
      } as unknown as AgentModelGatewayService,
      snapshotStore: {
        getReport: vi.fn(async () => runtimeReport)
      } as unknown as AgentRuntimeProbeSnapshotStore
    })

    const resolved = await resolveProviderEnvironment('deepseek:deepseek-v4-pro')

    expect(resolved).toMatchObject({
      ok: true,
      env: {
        ANTHROPIC_API_KEY: 'secret',
        ANTHROPIC_AUTH_TOKEN: 'secret',
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash'
      },
      metadata: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-pro',
        route: 'direct',
        baseUrl: 'https://api.deepseek.com/anthropic'
      },
      compatibility: {
        selectable: true,
        route: 'direct',
        status: 'ready'
      }
    })
  })

  it('uses the last known direct route immediately and refreshes an expired report in the background', async () => {
    const providerState: ProviderState = {
      providers: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          enabled: true,
          apiKey: 'secret',
          baseUrl: 'https://api.deepseek.com',

          endpoints: [
            { protocol: 'chat-completions', baseUrl: 'https://api.deepseek.com' } as const,
            { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' } as const
          ],
          models: [
            {
              id: 'deepseek-v4-flash',
              name: 'DeepSeek V4 Flash',
              capabilities: {
                chat: true,
                vision: false,
                embedding: false,
                tools: true,
                agentRuntimes: { claudeCode: true }
              }
            }
          ],
          defaultChatModelId: 'deepseek-v4-flash'
        }
      ]
    }
    // Relative timestamps: a hardcoded date would rot once REPORT_STALE_MS (15 min) elapses.
    const freshCheckedAt = new Date().toISOString()
    const expiredCheckedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const staleReport: ProviderRuntimeCheckReport = {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      runtimeId: 'claude-code',
      ordinaryChat: { lane: 'ordinary-chat', status: 'ready', summary: 'ready' },
      direct: { lane: 'claude-code-direct', status: 'ready', summary: 'expired direct result', route: 'direct', checkedAt: expiredCheckedAt },
      gateway: { lane: 'claude-code-gateway', status: 'idle', summary: 'disabled' },
      finalCompatibility: {
        providerId: 'deepseek', modelId: 'deepseek-v4-flash', runtimeId: 'claude-code',
        selectable: true, route: 'direct', status: 'ready', summary: 'expired direct result'
      },
      updatedAt: expiredCheckedAt,
      signature: 'expired-report'
    }
    // This promise never settles: the turn must not wait for the age-based refresh.
    const refreshRuntimeCheck = vi.fn(() => new Promise<ProviderRuntimeCheckReport>(() => undefined))
    const resolved = await createClaudeCodeProviderEnvironmentResolver({
      getProviderState: async () => providerState,
      gatewayService: {
        getSnapshot: () => ({ enabled: false, state: 'disabled', port: 18779, updatedAt: freshCheckedAt }),
        getAuthToken: () => '',
        isSyncedFor: () => false,
        syncProviderConfig: vi.fn()
      } as unknown as AgentModelGatewayService,
      snapshotStore: { getReport: vi.fn(async () => staleReport) } as unknown as AgentRuntimeProbeSnapshotStore,
      refreshRuntimeCheck
    })('deepseek:deepseek-v4-flash')

    expect(refreshRuntimeCheck).toHaveBeenCalledWith('deepseek', 'deepseek-v4-flash', false)
    expect(resolved).toMatchObject({ ok: true, metadata: { route: 'direct' } })
  })

  it('keeps user workspaces on their existing directory path', async () => {
    const ensureDirectory = vi.fn()
    const getPathInfo = vi.fn(async () => ({
      exists: true,
      isDirectory: true
    }))
    const getRealPath = vi.fn(async (path: string) => path)
    const prepareWorkspace = createClaudeCodeWorkspacePreparer({
      systemWorkspaceRoot: '/managed/root',
      ensureDirectory,
      getPathInfo,
      getRealPath
    })

    await expect(
      prepareWorkspace({
        sessionId: 'session-1',
        workspacePath: '/Users/example/project',
        workspaceType: 'user'
      })
    ).resolves.toEqual({
      cwd: '/Users/example/project'
    })

    expect(getPathInfo).toHaveBeenCalledWith('/Users/example/project')
    expect(ensureDirectory).not.toHaveBeenCalled()
  })

  it('rejects missing user workspaces before the driver starts a turn', async () => {
    const prepareWorkspace = createClaudeCodeWorkspacePreparer({
      systemWorkspaceRoot: '/managed/root',
      getPathInfo: vi.fn(async () => ({
        exists: false,
        isDirectory: false
      })),
      getRealPath: vi.fn(async (path: string) => path)
    })

    await expect(
      prepareWorkspace({
        sessionId: 'session-1',
        workspacePath: '/Users/example/missing',
        workspaceType: 'user'
      })
    ).rejects.toThrow('Claude Code workspace does not exist: /Users/example/missing')
  })

  // POSIX-shaped fixtures: the preparer runs them through node:path, so on Windows the same
  // inputs resolve to D:\managed\root\... and the assertion would be testing path.resolve
  // rather than the managed-root containment rule. The rule itself is covered by the
  // macOS/Linux verify job.
  it.skipIf(process.platform === 'win32')('maps placeholder system workspaces into the managed root and creates the directory', async () => {
    const ensureDirectory = vi.fn()
    const getRealPath = vi.fn(async (path: string) => {
      if (path === '/managed/root') return '/managed/root'
      if (path === '/managed/root/session-1') return '/managed/root/session-1'
      return path
    })
    const prepareWorkspace = createClaudeCodeWorkspacePreparer({
      systemWorkspaceRoot: '/managed/root',
      ensureDirectory,
      getPathInfo: vi.fn(),
      getRealPath
    })

    await expect(
      prepareWorkspace({
        sessionId: 'session-1',
        workspacePath: '/tmp/agent-system-workspace',
        workspaceType: 'system'
      })
    ).resolves.toEqual({
      cwd: '/managed/root/session-1'
    })

    expect(ensureDirectory).toHaveBeenCalledWith('/managed/root/session-1')
  })

  // Same POSIX-fixture caveat as above: Windows resolves these paths against the current drive.
  it.skipIf(process.platform === 'win32')('rejects system workspaces that escape the managed root after canonicalization', async () => {
    const ensureDirectory = vi.fn()
    const getRealPath = vi.fn(async (path: string) => {
      if (path === '/managed/root') return '/managed/root'
      if (path === '/managed/root/session-1') return '/outside/root/session-1'
      return path
    })
    const prepareWorkspace = createClaudeCodeWorkspacePreparer({
      systemWorkspaceRoot: '/managed/root',
      ensureDirectory,
      getPathInfo: vi.fn(),
      getRealPath
    })

    await expect(
      prepareWorkspace({
        sessionId: 'session-1',
        workspacePath: '/managed/root/session-1',
        workspaceType: 'system'
      })
    ).rejects.toThrow('Claude Code system workspace escaped managed root: /outside/root/session-1')
  })

  it('packages the provider resolver and workspace preparer into driver dependencies', async () => {
    const dependencies = createClaudeCodeRuntimeDriverDependencies({
      getProviderState: async () => ({
        providers: []
      }),
      systemWorkspaceRoot: '/managed/root',
      getPathInfo: vi.fn(async () => ({
        exists: true,
        isDirectory: true
      })),
      getRealPath: vi.fn(async (path: string) => path)
    })

    expect(typeof dependencies.resolveProviderEnvironment).toBe('function')
    expect(typeof dependencies.prepareWorkspace).toBe('function')
    expect(typeof dependencies.loadClaudeSdkModule).toBe('function')
  })

  it('loads the Claude SDK module through an injected importer', async () => {
    const module = {
      query: vi.fn(),
      startup: vi.fn()
    }
    const importer = vi.fn(async () => module)
    const loadClaudeSdkModule = createClaudeCodeSdkModuleLoader({
      importer
    })

    await expect(loadClaudeSdkModule()).resolves.toEqual({
      ok: true,
      module,
      source: 'claude-agent-sdk'
    })
    expect(importer).toHaveBeenCalledOnce()
  })

  it('falls back to the legacy Claude SDK package name when the primary package is unavailable', async () => {
    const module = {
      query: vi.fn(),
      startup: vi.fn()
    }
    const primaryImporter = vi.fn(async () => {
      const error = new Error("Cannot find package '@anthropic-ai/claude-agent-sdk'") as Error & {
        code?: string
      }
      error.code = 'ERR_MODULE_NOT_FOUND'
      throw error
    })
    const legacyImporter = vi.fn(async () => module)
    const loadClaudeSdkModule = createClaudeCodeSdkModuleLoader({
      importers: [primaryImporter, legacyImporter]
    })

    await expect(loadClaudeSdkModule()).resolves.toEqual({
      ok: true,
      module,
      source: 'claude-code-fallback'
    })
    expect(primaryImporter).toHaveBeenCalledOnce()
    expect(legacyImporter).toHaveBeenCalledOnce()
  })

  it('returns a clear unavailable result when the Claude SDK package is not installed', async () => {
    const importers = [
      vi.fn(async () => {
        const error = new Error("Cannot find package '@anthropic-ai/claude-agent-sdk'") as Error & {
          code?: string
        }
        error.code = 'ERR_MODULE_NOT_FOUND'
        throw error
      }),
      vi.fn(async () => {
        const error = new Error("Cannot find package '@anthropic-ai/claude-code'") as Error & {
          code?: string
        }
        error.code = 'ERR_MODULE_NOT_FOUND'
        throw error
      })
    ]
    const loadClaudeSdkModule = createClaudeCodeSdkModuleLoader({
      importers
    })

    await expect(loadClaudeSdkModule()).resolves.toEqual({
      ok: false,
      reason: 'module-not-installed',
      message: 'Claude Code SDK package is not installed in the desktop main process runtime.'
    })
  })

  it('rethrows unexpected failures from the legacy fallback importer', async () => {
    const primaryImporter = vi.fn(async () => {
      const error = new Error("Cannot find package '@anthropic-ai/claude-agent-sdk'") as Error & {
        code?: string
      }
      error.code = 'ERR_MODULE_NOT_FOUND'
      throw error
    })
    const legacyImporter = vi.fn(async () => {
      throw new Error('legacy importer exploded')
    })
    const loadClaudeSdkModule = createClaudeCodeSdkModuleLoader({
      importers: [primaryImporter, legacyImporter]
    })

    await expect(loadClaudeSdkModule()).rejects.toThrow('legacy importer exploded')
  })

  it('rethrows unexpected loader failures instead of masking them as install issues', async () => {
    const importer = vi.fn(async () => {
      throw new Error('syntax exploded')
    })
    const loadClaudeSdkModule = createClaudeCodeSdkModuleLoader({
      importer
    })

    await expect(loadClaudeSdkModule()).rejects.toThrow('syntax exploded')
  })

  it('calls the official Claude Agent SDK query path and returns a platform turn result', async () => {
    const queryMessages = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'First part. ' }, { type: 'text', text: 'Second part.' }]
        },
        uuid: 'assistant-uuid-1',
        session_id: 'sdk-session-1',
        parent_tool_use_id: null
      },
      {
        type: 'result',
        subtype: 'success',
        duration_ms: 42,
        duration_api_ms: 21,
        is_error: false,
        num_turns: 1,
        result: 'First part. Second part.',
        stop_reason: 'end_turn',
        total_cost_usd: 0,
        usage: {
          input_tokens: 12,
          output_tokens: 9,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        },
        modelUsage: {},
        permission_denials: [],
        uuid: 'result-uuid-1',
        session_id: 'sdk-session-1'
      }
    ]
    const query = vi.fn(() => createAsyncIterable(queryMessages))
    const loadClaudeSdkModule = vi.fn(async () => ({
      ok: true as const,
      module: { query }
    }))
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule,
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(createExecutionInput())

    expect(loadClaudeSdkModule).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith({
      prompt: 'Inspect this repository',
      options: expect.objectContaining({
        model: 'anthropic:claude-sonnet-4-5',
        cwd: '/Users/example/project',
        resume: 'resume-1',
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: 'Act like a careful coding assistant.'
        }
      })
    })
    expect(result.assistantMessage.searchableText).toBe('First part. Second part.')
    expect(result.assistantMessage.status).toBe('success')
    expect(result.assistantMessage.runtimeResumeToken).toBe('sdk-session-1')
    expect(result.assistantMessage.modelSnapshot).toEqual({
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      provider: 'anthropic'
    })
    expect(result.assistantMessage.stats).toEqual({
      promptTokens: 12,
      completionTokens: 9,
      totalTokens: 21
    })
  })

  it('fails an output-truncated turn explicitly and keeps the generated text for diagnosis', async () => {
    const partialOutput = '{"stage":"write","lead":"The market'
    const queryMessages = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: partialOutput }]
        },
        uuid: 'assistant-uuid-1',
        session_id: 'sdk-session-1',
        parent_tool_use_id: null
      },
      {
        type: 'result',
        subtype: 'success',
        duration_ms: 42,
        duration_api_ms: 21,
        is_error: false,
        num_turns: 1,
        result: partialOutput,
        stop_reason: 'max_tokens',
        total_cost_usd: 0,
        usage: {
          input_tokens: 1200,
          output_tokens: 15137,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        },
        modelUsage: {},
        permission_denials: [],
        uuid: 'result-uuid-1',
        session_id: 'sdk-session-1'
      }
    ]
    const query = vi.fn(() => createAsyncIterable(queryMessages))
    const loadClaudeSdkModule = vi.fn(async () => ({
      ok: true as const,
      module: { query }
    }))
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule,
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(createExecutionInput())

    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.searchableText).toContain(partialOutput)
    expect(result.assistantMessage.searchableText).toContain('输出被截断')
    expect(result.assistantMessage.searchableText).toContain('stop_reason=max_tokens')
    expect(result.assistantMessage.searchableText).toContain('已生成 15137 tokens')
    expect(result.assistantMessage.searchableText).toContain('日报')
    expect(result.assistantMessage.stats).toEqual({ completionTokens: 15137 })
  })

  it('keeps a turn successful when the CLI recovered from an output-limit hit and finished normally', async () => {
    const queryMessages = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: '{"a":' }],
          stop_reason: 'max_tokens'
        },
        error: 'max_output_tokens',
        uuid: 'assistant-uuid-1',
        session_id: 'sdk-session-1',
        parent_tool_use_id: null
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: '{"a":1}' }],
          stop_reason: 'end_turn'
        },
        uuid: 'assistant-uuid-2',
        session_id: 'sdk-session-1',
        parent_tool_use_id: null
      },
      {
        type: 'result',
        subtype: 'success',
        duration_ms: 42,
        duration_api_ms: 21,
        is_error: false,
        num_turns: 2,
        result: '{"a":1}',
        stop_reason: 'end_turn',
        total_cost_usd: 0,
        usage: { input_tokens: 10, output_tokens: 20 },
        modelUsage: {},
        permission_denials: [],
        uuid: 'result-uuid-1',
        session_id: 'sdk-session-1'
      }
    ]
    const query = vi.fn(() => createAsyncIterable(queryMessages))
    const loadClaudeSdkModule = vi.fn(async () => ({ ok: true as const, module: { query } }))
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule,
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(createExecutionInput())

    expect(result.assistantMessage.status).toBe('success')
    expect(result.assistantMessage.searchableText).toBe('{"a":1}')
  })

  it('fails a turn when the SDK reports max output tokens and the stream ends without a result', async () => {
    const partialOutput = '{"stage":"write","lead":"cut'
    const queryMessages = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: partialOutput }],
          stop_reason: 'max_tokens'
        },
        error: 'max_output_tokens',
        uuid: 'assistant-uuid-1',
        session_id: 'sdk-session-1',
        parent_tool_use_id: null
      }
    ]
    const query = vi.fn(() => createAsyncIterable(queryMessages))
    const loadClaudeSdkModule = vi.fn(async () => ({ ok: true as const, module: { query } }))
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule,
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(createExecutionInput())

    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.searchableText).toContain(partialOutput)
    expect(result.assistantMessage.searchableText).toContain('输出被截断')
    expect(result.assistantMessage.searchableText).toContain('stop_reason=max_output_tokens')
  })

  it('fails closed when startup() returns the same WarmQuery object identity for a second turn', async () => {
    let state = createAgentStateForSdkExecutor()
    const auditEntries: Array<{ event: string; handleSequence: number; origin: string }> = []
    const ordering: string[] = []
    let queried = false
    const warmQuery = {
      query: vi.fn((prompt: string) => {
        if (queried) {
          throw new Error('WarmQuery.query() can only be called once')
        }
        queried = true
        ordering.push('sdk-query')
        return createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} done.`,
            session_id: 'sdk-session-warm'
          }
        ])
      }),
      close: vi.fn()
    }
    // Same object identity from both startup() calls: the WQ-2 hypothesis the fence must reject.
    const startup = vi.fn(async () => warmQuery)
    const query = vi.fn(() => createAsyncIterable([]))
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query, startup }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      },
      warmQueryAuditSink: (entry) => {
        ordering.push(`claim:${entry.event}`)
        auditEntries.push({
          event: entry.event,
          handleSequence: entry.handleSequence,
          origin: entry.origin
        })
      }
    })
    const firstInput = createExecutionInput()
    firstInput.request = {
      ...firstInput.request,
      text: 'First prompt'
    }
    const secondInput = createExecutionInput()
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.runId = 'claude-run-2'
    secondInput.query = {
      ...secondInput.query,
      sdkOptions: {
        ...secondInput.query.sdkOptions,
        resume: 'resume-2'
      }
    }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    const firstResult = await executeTurn(firstInput)
    const secondResult = await executeTurn(secondInput)

    expect(startup).toHaveBeenCalledTimes(2)
    expect(query).not.toHaveBeenCalled()
    // The SDK handle is queried exactly once: the second claim fails before `query()` runs.
    expect(warmQuery.query).toHaveBeenCalledExactlyOnceWith('First prompt')
    // Seam 4: the claim is granted synchronously, strictly before the SDK call is created.
    expect(ordering.indexOf('claim:claim-granted')).toBeGreaterThanOrEqual(0)
    expect(ordering.indexOf('claim:claim-granted')).toBeLessThan(ordering.indexOf('sdk-query'))
    expect(warmQuery.close).toHaveBeenCalledOnce()
    expect(firstResult.assistantMessage.searchableText).toBe('First prompt done.')
    expect(secondResult.assistantMessage.status).toBe('error')
    expect(secondResult.assistantMessage.searchableText).toContain(
      'warm-query-identity-reused-on-register'
    )
    // Audit proves the rejected identity and the handle sequence, nothing else.
    const rejections = auditEntries.filter((entry) => entry.event === 'claim-rejected')
    expect(rejections).toHaveLength(1)
    expect(rejections[0]).toMatchObject({ handleSequence: 1 })
    expect(auditEntries.filter((entry) => entry.event === 'handle-created')).toHaveLength(1)
    const auditPayload = JSON.stringify(auditEntries)
    expect(auditPayload).not.toContain('First prompt')
    expect(auditPayload).not.toContain('Second prompt')
    expect(auditPayload).not.toContain('/')
  })

  it('passes the SDK query failure through unchanged and keeps its details out of the audit', async () => {
    let state = createAgentStateForSdkExecutor()
    const auditEntries: unknown[] = []
    const secret = 'PROMPT-SECRET-9f3a17'
    const sdkFailure = new Error(`upstream rejected ${secret} at /Users/fixture-user/.claude/sdk.js`)
    const warmQuery = {
      query: vi.fn(() => {
        throw sdkFailure
      }),
      close: vi.fn()
    }
    const startup = vi.fn(async () => warmQuery)
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query: vi.fn(() => createAsyncIterable([])), startup }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      },
      warmQueryAuditSink: (entry) => auditEntries.push(entry)
    })
    const input = createExecutionInput()
    input.request = {
      ...input.request,
      text: 'First prompt'
    }

    const result = await executeTurn(input)

    // Existing generic turn failure handling is preserved: no wrapping, no retry.
    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.searchableText).toContain(secret)
    expect(warmQuery.query).toHaveBeenCalledOnce()
    expect(warmQuery.close).toHaveBeenCalledOnce()
    // Diagnostics never carry the prompt, credential, path or stack of that failure.
    const auditPayload = JSON.stringify(auditEntries)
    expect(auditPayload).not.toContain(secret)
    expect(auditPayload).not.toContain('/Users')
    expect(auditPayload).not.toContain('sdk.js')
    expect(auditEntries.map((entry) => (entry as { event: string }).event)).toContain('claim-granted')
  })

  it('recreates the WarmQuery handle when the runtime resume token changes across turns', async () => {
    let state = createAgentStateForSdkExecutor()
    const warmQueryOne = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} via warm-1`,
            session_id: 'sdk-session-warm-1'
          }
        ])
      ),
      close: vi.fn()
    }
    const warmQueryTwo = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} via warm-2`,
            session_id: 'sdk-session-warm-2'
          }
        ])
      ),
      close: vi.fn()
    }
    const startup = vi
      .fn()
      .mockResolvedValueOnce(warmQueryOne)
      .mockResolvedValueOnce(warmQueryTwo)
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const firstInput = createExecutionInput()
    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.query = {
      ...secondInput.query,
      sdkOptions: {
        ...secondInput.query.sdkOptions,
        resume: 'resume-2'
      }
    }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    const firstResult = await executeTurn(firstInput)
    const secondResult = await executeTurn(secondInput)

    expect(startup).toHaveBeenCalledTimes(2)
    expect(warmQueryOne.close).toHaveBeenCalledOnce()
    expect(warmQueryOne.query).toHaveBeenCalledWith('Inspect this repository')
    expect(warmQueryTwo.query).toHaveBeenCalledWith('Second prompt')
    expect(firstResult.assistantMessage.runtimeResumeToken).toBe('sdk-session-warm-1')
    expect(secondResult.assistantMessage.runtimeResumeToken).toBe('sdk-session-warm-2')
  })

  it('creates a fresh one-shot WarmQuery for each resumed turn after observing the SDK session id', async () => {
    let state = createAgentStateForSdkExecutor()
    const createOneShotWarmQuery = () => {
      let queried = false
      return {
        query: vi.fn((prompt: string) => {
          if (queried) {
            throw new Error('WarmQuery.query() can only be called once')
          }
          queried = true
          return createAsyncIterable([
            {
              type: 'result',
              result: `${prompt} via one-shot warm query`,
              session_id: 'sdk-session-sticky'
            }
          ])
        }),
        close: vi.fn()
      }
    }
    const firstWarmQuery = createOneShotWarmQuery()
    const secondWarmQuery = createOneShotWarmQuery()
    const startup = vi.fn()
      .mockResolvedValueOnce(firstWarmQuery)
      .mockResolvedValueOnce(secondWarmQuery)
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const firstInput = createExecutionInput()
    firstInput.request = {
      ...firstInput.request,
      text: 'First prompt'
    }

    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.query = {
      ...secondInput.query,
      sdkOptions: {
        ...secondInput.query.sdkOptions,
        resume: 'sdk-session-sticky'
      }
    }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    const firstResult = await executeTurn(firstInput)
    const secondResult = await executeTurn(secondInput)

    expect(startup).toHaveBeenCalledTimes(2)
    expect(startup).toHaveBeenNthCalledWith(2, {
      options: expect.objectContaining({ resume: 'sdk-session-sticky' })
    })
    expect(firstWarmQuery.query).toHaveBeenCalledWith('First prompt')
    expect(secondWarmQuery.query).toHaveBeenCalledWith('Second prompt')
    expect(firstWarmQuery.close).toHaveBeenCalledOnce()
    expect(secondWarmQuery.close).toHaveBeenCalledOnce()
    expect(firstResult.assistantMessage.status).toBe('success')
    expect(secondResult.assistantMessage.status).toBe('success')
    expect(firstResult.assistantMessage.runtimeResumeToken).toBe('sdk-session-sticky')
    expect(secondResult.assistantMessage.runtimeResumeToken).toBe('sdk-session-sticky')
  })

  it('closes and evicts a failing WarmQuery handle so the next turn recreates it from startup()', async () => {
    let state = createAgentStateForSdkExecutor()
    const warmQueryOne = {
      query: vi.fn(() => {
        throw new Error('warm query exploded')
      }),
      close: vi.fn()
    }
    const warmQueryTwo = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} recovered`,
            session_id: 'sdk-session-recovered'
          }
        ])
      ),
      close: vi.fn()
    }
    const startup = vi
      .fn()
      .mockResolvedValueOnce(warmQueryOne)
      .mockResolvedValueOnce(warmQueryTwo)
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const firstInput = createExecutionInput()
    firstInput.request = {
      ...firstInput.request,
      text: 'First prompt'
    }

    const firstResult = await executeTurn(firstInput)

    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.query = {
      ...secondInput.query,
      sdkOptions: {
        ...secondInput.query.sdkOptions,
        resume: 'resume-1'
      }
    }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    const secondResult = await executeTurn(secondInput)

    expect(startup).toHaveBeenCalledTimes(2)
    expect(warmQueryOne.close).toHaveBeenCalledOnce()
    expect(firstResult.assistantMessage.status).toBe('error')
    expect(firstResult.assistantMessage.searchableText).toBe('warm query exploded')
    expect(secondResult.assistantMessage.status).toBe('success')
    expect(secondResult.assistantMessage.searchableText).toBe('Second prompt recovered')
  })

  it('closes a WarmQuery when its stream fails and does not reuse it on the next turn', async () => {
    let state = createAgentStateForSdkExecutor()
    const failingWarmQuery = {
      query: vi.fn(() => createAsyncIterableThatThrows(new Error('warm stream failed'))),
      close: vi.fn()
    }
    const recoveredWarmQuery = {
      query: vi.fn((prompt: string) => createAsyncIterable([
        { type: 'result', result: `${prompt} recovered`, session_id: 'sdk-session-recovered-after-stream-failure' }
      ])),
      close: vi.fn()
    }
    const startup = vi.fn()
      .mockResolvedValueOnce(failingWarmQuery)
      .mockResolvedValueOnce(recoveredWarmQuery)
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({ ok: true, module: { startup, query: vi.fn() } }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const failedResult = await executeTurn(createExecutionInput())
    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = { ...secondInput.request, text: 'Second prompt', runId: 'claude-run-2' }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })
    const recoveredResult = await executeTurn(secondInput)

    expect(failedResult.assistantMessage.status).toBe('error')
    expect(failingWarmQuery.close).toHaveBeenCalledOnce()
    expect(startup).toHaveBeenCalledTimes(2)
    expect(recoveredWarmQuery.query).toHaveBeenCalledWith('Second prompt')
    expect(recoveredWarmQuery.close).toHaveBeenCalledOnce()
    expect(recoveredResult.assistantMessage.status).toBe('success')
  })

  it('closes an interrupted WarmQuery and resumes the next turn with a fresh handle', async () => {
    let state = createAgentStateForSdkExecutor()
    let releaseInterruptedQuery!: () => void
    const interruptController = new AbortController()
    const interruptedWarmQuery = {
      query: vi.fn(() =>
        createAsyncIterableWithGateAndError(
          [{ type: 'system', subtype: 'init', session_id: 'sdk-session-interrupted' }],
          (release) => {
            releaseInterruptedQuery = release
          },
          () => {
            if (interruptController.signal.aborted) {
              throw new Error('interrupt aborted active query')
            }
          }
        )
      ),
      close: vi.fn()
    }
    const resumedWarmQuery = {
      query: vi.fn((prompt: string) => createAsyncIterable([
        {
          type: 'result',
          result: `${prompt} resumed after interrupt`,
          session_id: 'sdk-session-resumed-after-interrupt'
        }
      ])),
      close: vi.fn()
    }
    const startup = vi.fn()
      .mockResolvedValueOnce(interruptedWarmQuery)
      .mockResolvedValueOnce(resumedWarmQuery)
    const runtime = createClaudeAgentSdkRuntime({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const firstInput = createExecutionInput()
    firstInput.signal = interruptController.signal

    const interruptedTurn = runtime.executeTurn(firstInput)
    await vi.waitFor(() => {
      expect(interruptedWarmQuery.query).toHaveBeenCalledTimes(1)
    })

    interruptController.abort('interrupt')
    releaseInterruptedQuery()

    const interruptedResult = await interruptedTurn

    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.query = {
      ...secondInput.query,
      sdkOptions: {
        ...secondInput.query.sdkOptions,
        resume: 'sdk-session-interrupted'
      }
    }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    const secondResult = await runtime.executeTurn(secondInput)

    expect(interruptedResult.assistantMessage.status).toBe('paused')
    expect(interruptedResult.assistantMessage.searchableText).toBe('已停止。')
    expect(interruptedResult.assistantMessage.runtimeResumeToken).toBe('sdk-session-interrupted')
    expect(interruptedWarmQuery.close).toHaveBeenCalledOnce()
    expect(startup).toHaveBeenCalledTimes(2)
    expect(startup).toHaveBeenNthCalledWith(2, {
      options: expect.objectContaining({ resume: 'sdk-session-interrupted' })
    })
    expect(resumedWarmQuery.query).toHaveBeenCalledWith('Second prompt')
    expect(resumedWarmQuery.close).toHaveBeenCalledOnce()
    expect(secondResult.assistantMessage.status).toBe('success')
    expect(secondResult.assistantMessage.searchableText).toBe('Second prompt resumed after interrupt')
  })

  it('returns paused and recreates startup WarmQuery handles when interrupt lands during session-open startup', async () => {
    let state = createAgentStateForSdkExecutor()
    const startupWarmQuery = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} should not run after startup interrupt`,
            session_id: 'sdk-session-should-not-run'
          }
        ])
      ),
      close: vi.fn()
    }
    const recoveredWarmQuery = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} recovered after startup interrupt`,
            session_id: 'sdk-session-recovered-after-startup-interrupt'
          }
        ])
      ),
      close: vi.fn()
    }
    const deferredStartup = createDeferred<typeof startupWarmQuery>()
    const startup = vi
      .fn()
      .mockImplementationOnce(() => deferredStartup.promise)
      .mockResolvedValueOnce(recoveredWarmQuery)
    const runtime = createClaudeAgentSdkRuntime({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const interruptController = new AbortController()
    const firstInput = createExecutionInput()
    firstInput.signal = interruptController.signal

    const interruptedTurn = runtime.executeTurn(firstInput)
    await vi.waitFor(() => expect(startup).toHaveBeenCalledTimes(1))

    interruptController.abort('interrupt')
    deferredStartup.resolve(startupWarmQuery)

    const interruptedResult = await interruptedTurn

    expect(interruptedResult.assistantMessage.status).toBe('paused')
    expect(interruptedResult.assistantMessage.searchableText).toBe('已停止。')
    expect(startupWarmQuery.query).not.toHaveBeenCalled()
    expect(startupWarmQuery.close).toHaveBeenCalledOnce()
    expect(state.messagesBySessionId['session-1']?.at(-1)).toMatchObject({
      status: 'paused',
      searchableText: '已停止。'
    })

    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    const secondResult = await runtime.executeTurn(secondInput)

    expect(startup).toHaveBeenCalledTimes(2)
    expect(recoveredWarmQuery.query).toHaveBeenCalledWith('Second prompt')
    expect(secondResult.assistantMessage.status).toBe('success')
    expect(secondResult.assistantMessage.searchableText).toBe('Second prompt recovered after startup interrupt')
  })

  it('persists the observed SDK session id on an interrupted turn for later resume recovery', async () => {
    let state = createAgentStateForSdkExecutor()
    let releaseInterruptedQuery!: () => void
    const interruptController = new AbortController()
    const warmQuery = {
      query: vi.fn(() =>
        createAsyncIterableWithGateAndError(
          [
            {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: 'Partial reply before interrupt.' }]
              },
              uuid: 'assistant-uuid-interrupt',
              session_id: 'sdk-session-interrupted',
              parent_tool_use_id: null
            }
          ],
          (release) => {
            releaseInterruptedQuery = release
          },
          () => {
            if (interruptController.signal.aborted) {
              throw new Error('interrupt aborted active query')
            }
          }
        )
      ),
      close: vi.fn()
    }
    const startup = vi.fn(async () => warmQuery)
    const runtime = createClaudeAgentSdkRuntime({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const input = createExecutionInput()
    input.signal = interruptController.signal

    const turn = runtime.executeTurn(input)
    await vi.waitFor(() => {
      expect(warmQuery.query).toHaveBeenCalledTimes(1)
    })

    interruptController.abort('interrupt')
    releaseInterruptedQuery()

    const result = await turn

    expect(result.assistantMessage.status).toBe('paused')
    expect(result.assistantMessage.runtimeResumeToken).toBe('sdk-session-interrupted')
    expect(state.messagesBySessionId['session-1']?.at(-1)?.runtimeResumeToken).toBe('sdk-session-interrupted')
  })

  it('closes idle unconsumed prewarmed WarmQuery handles before the next turn', async () => {
    vi.useFakeTimers()
    try {
      let state = createAgentStateForSdkExecutor()
      const warmQueryOne = {
        query: vi.fn((prompt: string) =>
          createAsyncIterable([
            {
              type: 'result',
              result: `${prompt} via idle-1`,
              session_id: 'sdk-session-idle-1'
            }
          ])
        ),
        close: vi.fn()
      }
      const warmQueryTwo = {
        query: vi.fn((prompt: string) =>
          createAsyncIterable([
            {
              type: 'result',
              result: `${prompt} via idle-2`,
              session_id: 'sdk-session-idle-2'
            }
          ])
        ),
        close: vi.fn()
      }
      const startup = vi
        .fn()
        .mockResolvedValueOnce(warmQueryOne)
        .mockResolvedValueOnce(warmQueryTwo)
      const runtime = createClaudeAgentSdkRuntime({
        loadClaudeSdkModule: async () => ({
          ok: true,
          module: { startup, query: vi.fn() }
        }),
        getProviderState: async () => createProviderStateForSdkExecutor(),
        getAgentState: async () => state,
        saveAgentState: async (next, options) => {
          state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
        },
        warmQueryIdleTimeoutMs: 1000
      })

      const firstInput = createExecutionInput()
      await runtime.prewarmSession({
        sessionId: firstInput.request.sessionId,
        composition: firstInput.composition,
        query: firstInput.query,
        executor: firstInput.executor
      })
      expect(warmQueryOne.close).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1000)

      expect(warmQueryOne.close).toHaveBeenCalledOnce()

      const result = await runtime.executeTurn(firstInput)

      expect(startup).toHaveBeenCalledTimes(2)
      expect(warmQueryTwo.query).toHaveBeenCalledWith('Inspect this repository')
      expect(result.assistantMessage.runtimeResumeToken).toBe('sdk-session-idle-2')
    } finally {
      vi.useRealTimers()
    }
  })

  it('replaces a signature-mismatched unconsumed prewarm without ever querying the stale handle', async () => {
    let state = createAgentStateForSdkExecutor()
    const stalePrewarm = {
      query: vi.fn(),
      close: vi.fn()
    }
    const replacementPrewarm = {
      query: vi.fn(),
      close: vi.fn()
    }
    const startup = vi.fn()
      .mockResolvedValueOnce(stalePrewarm)
      .mockResolvedValueOnce(replacementPrewarm)
    const runtime = createClaudeAgentSdkRuntime({
      loadClaudeSdkModule: async () => ({ ok: true, module: { startup, query: vi.fn() } }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })
    const input = createExecutionInput()

    await runtime.prewarmSession({
      sessionId: input.request.sessionId,
      composition: input.composition,
      query: input.query,
      executor: input.executor
    })

    const changedInput = createExecutionInput()
    changedInput.query = {
      ...changedInput.query,
      sdkOptions: {
        ...changedInput.query.sdkOptions,
        model: 'anthropic:claude-opus-4-1'
      }
    }
    changedInput.executor = createClaudeCodeExecutorDescriptor({
      query: changedInput.query,
      toolHooks: changedInput.toolHooks,
      signal: changedInput.signal
    })

    await runtime.prewarmSession({
      sessionId: changedInput.request.sessionId,
      composition: changedInput.composition,
      query: changedInput.query,
      executor: changedInput.executor
    })

    expect(startup).toHaveBeenCalledTimes(2)
    expect(stalePrewarm.query).not.toHaveBeenCalled()
    expect(stalePrewarm.close).toHaveBeenCalledOnce()
    expect(replacementPrewarm.close).not.toHaveBeenCalled()
  })

  it('does not close WarmQuery handles while a query is still streaming', async () => {
    vi.useFakeTimers()
    try {
      let state = createAgentStateForSdkExecutor()
      let releaseResult!: () => void
      const warmQuery = {
        query: vi.fn(() =>
          createAsyncIterableWithGate(
            [
              {
                type: 'system',
                subtype: 'init',
                session_id: 'sdk-session-active-stream'
              },
              {
                type: 'result',
                result: 'Done.',
                session_id: 'sdk-session-active-stream'
              }
            ],
            (release) => {
              releaseResult = release
            }
          )
        ),
        close: vi.fn()
      }
      const startup = vi.fn(async () => warmQuery)
      const executeTurn = createClaudeAgentSdkExecutor({
        loadClaudeSdkModule: async () => ({
          ok: true,
          module: { startup, query: vi.fn() }
        }),
        getProviderState: async () => createProviderStateForSdkExecutor(),
        getAgentState: async () => state,
        saveAgentState: async (next, options) => {
          state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
        },
        warmQueryIdleTimeoutMs: 1000
      })

      const turn = executeTurn(createExecutionInput())
      await vi.waitFor(() => {
        expect(warmQuery.query).toHaveBeenCalledOnce()
      })

      await vi.advanceTimersByTimeAsync(1000)

      expect(warmQuery.close).not.toHaveBeenCalled()

      releaseResult()
      await turn

      await vi.advanceTimersByTimeAsync(1000)

      expect(warmQuery.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('consumes a prewarmed one-shot WarmQuery once and creates a resumed handle for the next turn', async () => {
    let state = createAgentStateForSdkExecutor()
    const createOneShotWarmQuery = (sessionId: string) => {
      let queried = false
      return {
        query: vi.fn((prompt: string) => {
          if (queried) {
            throw new Error('WarmQuery.query() can only be called once')
          }
          queried = true
          return createAsyncIterable([
            {
              type: 'result',
              result: `${prompt} from ${sessionId}`,
              session_id: sessionId
            }
          ])
        }),
        close: vi.fn()
      }
    }
    const prewarmedQuery = createOneShotWarmQuery('sdk-session-prewarmed')
    const resumedQuery = createOneShotWarmQuery('sdk-session-resumed')
    const startup = vi.fn()
      .mockResolvedValueOnce(prewarmedQuery)
      .mockResolvedValueOnce(resumedQuery)
    const saveAgentState = vi.fn(async (next: AgentStoreState, options?: { mergeSessionId?: string }) => {
      state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
    })
    const runtime = createClaudeAgentSdkRuntime({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState
    })
    const input = createExecutionInput()

    await expect(
      runtime.prewarmSession({
        sessionId: input.request.sessionId,
        composition: input.composition,
        query: input.query,
        executor: input.executor
      })
    ).resolves.toEqual({
      ok: true,
      status: 'warmed'
    })

    expect(startup).toHaveBeenCalledOnce()
    expect(startup).toHaveBeenCalledWith({
      options: expect.objectContaining({
        model: 'anthropic:claude-sonnet-4-5',
        cwd: '/Users/example/project',
        resume: 'resume-1',
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: 'Act like a careful coding assistant.'
        }
      })
    })
    expect(saveAgentState).not.toHaveBeenCalled()

    const result = await runtime.executeTurn(input)

    expect(startup).toHaveBeenCalledOnce()
    expect(prewarmedQuery.query).toHaveBeenCalledWith('Inspect this repository')
    expect(prewarmedQuery.close).toHaveBeenCalledOnce()
    expect(result.assistantMessage.searchableText).toBe('Inspect this repository from sdk-session-prewarmed')

    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.query = {
      ...secondInput.query,
      sdkOptions: {
        ...secondInput.query.sdkOptions,
        resume: 'sdk-session-prewarmed'
      }
    }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    const secondResult = await runtime.executeTurn(secondInput)

    expect(startup).toHaveBeenCalledTimes(2)
    expect(startup).toHaveBeenNthCalledWith(2, {
      options: expect.objectContaining({ resume: 'sdk-session-prewarmed' })
    })
    expect(resumedQuery.query).toHaveBeenCalledWith('Second prompt')
    expect(resumedQuery.close).toHaveBeenCalledOnce()
    expect(secondResult.assistantMessage.searchableText).toBe('Second prompt from sdk-session-resumed')
  })

  it('prewarms WarmQuery handles with enabled skill MCP servers before reuse', async () => {
    let state: AgentStoreState = {
      ...createAgentStateForSdkExecutor(),
      skills: [
        {
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
      ],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
    }
    const skillRuntime = new SkillsRuntimeService({
      getSkillTools: () => ['Read Docs'],
      invokeSkillTool: () => ({ output: 'skill invoked' })
    })
    const loadSdkHelpers = vi.fn(async () => ({
      tool: vi.fn(
        (
          name: string,
          description: string,
          schema: unknown,
          handler: (args: Record<string, unknown>) => Promise<unknown>
        ) => ({ name, description, schema, handler })
      ),
      createSdkMcpServer: vi.fn((input: { name: string; tools: unknown[] }) => ({
        server: input.name,
        tools: input.tools
      }))
    }))
    const warmQuery = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} from prewarmed skill session`,
            session_id: 'sdk-session-prewarmed-skills'
          }
        ])
      ),
      close: vi.fn()
    }
    const startup = vi.fn(async () => warmQuery)
    const runtime = createClaudeAgentSdkRuntime({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      },
      skillToolBridge: {
        runtime: skillRuntime,
        getAgentState: async () => state,
        loadSdkHelpers
      }
    })
    const input = createExecutionInput()
    input.composition = {
      ...input.composition,
      skills: skillRuntime.getAgentRuntime(state, 'agent-1')
    }
    input.query = {
      ...input.query,
      runtimeMetadata: {
        ...input.query.runtimeMetadata,
        skills: input.composition.skills.skills,
        skillToolIds: input.composition.skills.toolIds
      }
    }
    input.executor = createClaudeCodeExecutorDescriptor({
      query: input.query,
      toolHooks: input.toolHooks,
      signal: input.signal
    })

    await expect(
      runtime.prewarmSession({
        sessionId: input.request.sessionId,
        composition: input.composition,
        query: input.query,
        executor: input.executor
      })
    ).resolves.toEqual({
      ok: true,
      status: 'warmed'
    })

    expect(startup).toHaveBeenCalledWith({
      options: expect.objectContaining({
        allowedTools: ['skill__code-reader__read-docs'],
        mcpServers: {
          'agent-skills': {
            server: 'agent-skills',
            tools: [
              expect.objectContaining({
                name: 'skill__code-reader__read-docs'
              })
            ]
          }
        }
      })
    })

    const result = await runtime.executeTurn(input)

    expect(startup).toHaveBeenCalledTimes(1)
    expect(loadSdkHelpers).toHaveBeenCalledTimes(2)
    expect(warmQuery.query).toHaveBeenCalledWith('Inspect this repository')
    expect(result.assistantMessage.searchableText).toBe('Inspect this repository from prewarmed skill session')
  })

  it('treats prewarm as a safe no-op when the loaded SDK has no startup function', async () => {
    const query = vi.fn()
    const saveAgentState = vi.fn()
    const runtime = createClaudeAgentSdkRuntime({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => createAgentStateForSdkExecutor(),
      saveAgentState
    })
    const input = createExecutionInput()

    await expect(
      runtime.prewarmSession({
        sessionId: input.request.sessionId,
        composition: input.composition,
        query: input.query,
        executor: input.executor
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'startup-unavailable',
      message: 'Claude Agent SDK startup() is not available from the loaded SDK module.'
    })

    expect(query).not.toHaveBeenCalled()
    expect(saveAgentState).not.toHaveBeenCalled()
  })

  it('appends richer enabled skill context into the Claude SDK system prompt', async () => {
    const query = vi.fn(() =>
      createAsyncIterable([
        {
          type: 'result',
          result: 'Done.',
          session_id: 'sdk-session-skills'
        }
      ])
    )
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })
    const input = createExecutionInput()
    input.query = {
      ...input.query,
      runtimeMetadata: {
        ...input.query.runtimeMetadata,
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
        ]
      }
    }
    input.executor = createClaudeCodeExecutorDescriptor({
      query: input.query,
      toolHooks: input.toolHooks,
      signal: input.signal
    })

    await executeTurn(input)

    expect(query).toHaveBeenCalledWith({
      prompt: 'Inspect this repository',
      options: expect.objectContaining({
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: [
            'Act like a careful coding assistant.',
            'Enabled skills:',
            '- Code Reader: Reads and analyzes code. Declared tools: Read, Grep. Tags: code, analysis. Author: OpenAI. Source: local.'
          ].join('\n\n')
        }
      })
    })
  })

  it('merges enabled skill runtime tools into Claude SDK MCP servers', async () => {
    const query = vi.fn(() =>
      createAsyncIterable([
        {
          type: 'result',
          result: 'Done.',
          session_id: 'sdk-session-skill-tools'
        }
      ])
    )
    const loadSdkHelpers = vi.fn(async () => ({
      tool: vi.fn(
        (
          name: string,
          description: string,
          schema: unknown,
          handler: (args: Record<string, unknown>) => Promise<unknown>
        ) => ({ name, description, schema, handler })
      ),
      createSdkMcpServer: vi.fn((input: { name: string; tools: unknown[] }) => ({
        server: input.name,
        tools: input.tools
      }))
    }))
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
    const skillRuntime = new SkillsRuntimeService({
      getSkillTools: () => ['Read Docs'],
      invokeSkillTool: () => ({ output: 'skill invoked' })
    })
    let state: AgentStoreState = {
      ...createAgentStateForSdkExecutor(),
      skills: [skill],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
    }
    const input = createExecutionInput()
    input.composition = {
      ...input.composition,
      skills: skillRuntime.getAgentRuntime(state, 'agent-1')
    }
    input.query = {
      ...input.query,
      runtimeMetadata: {
        ...input.query.runtimeMetadata,
        skills: input.composition.skills.skills,
        skillToolIds: input.composition.skills.toolIds
      }
    }
    input.executor = createClaudeCodeExecutorDescriptor({
      query: input.query,
      toolHooks: input.toolHooks,
      signal: input.signal
    })
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      },
      skillToolBridge: {
        runtime: skillRuntime,
        getAgentState: async () => state,
        loadSdkHelpers
      }
    })

    await executeTurn(input)

    expect(loadSdkHelpers).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledWith({
      prompt: 'Inspect this repository',
      options: expect.objectContaining({
        mcpServers: {
          'agent-skills': {
            server: 'agent-skills',
            tools: [
              expect.objectContaining({
                name: 'skill__code-reader__read-docs',
                description: expect.stringContaining('Code Reader skill tool: Read Docs'),
                schema: expect.anything()
              })
            ]
          }
        },
        allowedTools: ['skill__code-reader__read-docs']
      })
    })
  })

  it('composes Task 7 host-backed cancellation into the Claude SDK MCP and auto policy', async () => {
    const query = vi.fn(() => createAsyncIterable([{ type: 'result', result: 'Done.' }]))
    const loadSdkHelpers = vi.fn(async () => ({
      tool: vi.fn((name: string, description: string, schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => ({ name, description, schema, handler })),
      createSdkMcpServer: vi.fn((input: { name: string; tools: unknown[] }) => ({ server: input.name, tools: input.tools }))
    }))
    let state = createAgentStateForSdkExecutor()
    state.agents[0] = { ...state.agents[0]!, configuration: { permission_mode: 'bypassPermissions' } }
    const invoke = vi.fn(async () => ({ tasks: [], total: 0, channels: [] }))
    const prepareCancelRun = vi.fn()
    const recordCancelRunOutcome = vi.fn()
    const cancelTaskRun = vi.fn(async () => ({ cancelled: true }))
    const input = createExecutionInput()
    input.composition = {
      ...input.composition,
      taskManagement: {
        agentId: 'agent-1',
        toolNames: ['scheduled_task_list'],
        tools: [{
          name: 'scheduled_task_list',
          description: 'List tasks',
          approval: 'auto',
          mutating: false,
          inputSchema: { type: 'object' }
        }]
      }
    }
    input.query = withProductToolPolicy(input.query, 'scheduled_task_list', 'auto')
    input.executor = createClaudeCodeExecutorDescriptor({
      query: input.query,
      toolHooks: input.toolHooks,
      signal: input.signal
    })
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({ ok: true, module: { query } }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      },
      taskManagementToolBridge: {
        runtime: { invoke } as Pick<TaskManagementToolRuntimeService, 'invoke'>,
        commands: { prepareCancelRun, recordCancelRunOutcome },
        getAgentState: async () => state,
        getTaskRunController: () => ({ cancelTaskRun }),
        loadSdkHelpers
      }
    })

    await executeTurn(input)

    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        allowedTools: expect.arrayContaining(['scheduled_task_list', 'scheduled_task_cancel_run']),
        mcpServers: expect.objectContaining({
          'agent-task-management': expect.objectContaining({ server: 'agent-task-management' })
        })
      })
    }))
    expect(loadSdkHelpers).toHaveBeenCalledOnce()
    await expect(input.executor.toolHooks.canUseTool('scheduled_task_cancel_run')).resolves.toEqual({ behavior: 'allow' })
    expect(input.executor.metadata.runtimeMcpToolNames).not.toContain('scheduled_task_cancel_run')
  })

  it('recreates the WarmQuery handle when the skill context changes under the same resume token', async () => {
    let state = createAgentStateForSdkExecutor()
    const warmQueryOne = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} via skill-a`,
            session_id: 'sdk-session-skill-a'
          }
        ])
      ),
      close: vi.fn()
    }
    const warmQueryTwo = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} via skill-b`,
            session_id: 'sdk-session-skill-b'
          }
        ])
      ),
      close: vi.fn()
    }
    const startup = vi
      .fn()
      .mockResolvedValueOnce(warmQueryOne)
      .mockResolvedValueOnce(warmQueryTwo)
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const firstInput = createExecutionInput()
    firstInput.query = {
      ...firstInput.query,
      runtimeMetadata: {
        ...firstInput.query.runtimeMetadata,
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
            tools: ['Read']
          }
        ]
      }
    }
    firstInput.executor = createClaudeCodeExecutorDescriptor({
      query: firstInput.query,
      toolHooks: firstInput.toolHooks,
      signal: firstInput.signal
    })

    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.query = {
      ...secondInput.query,
      sdkOptions: {
        ...secondInput.query.sdkOptions,
        resume: 'resume-1'
      },
      runtimeMetadata: {
        ...secondInput.query.runtimeMetadata,
        skills: [
          {
            skillId: 'skill-2',
            name: 'Refactor Helper',
            description: 'Suggests focused refactors',
            author: 'OpenAI',
            namespace: null,
            folderName: 'refactor-helper',
            source: 'local',
            tags: ['refactor'],
            tools: ['Edit']
          }
        ]
      }
    }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    const firstResult = await executeTurn(firstInput)
    const secondResult = await executeTurn(secondInput)

    expect(startup).toHaveBeenCalledTimes(2)
    expect(warmQueryOne.close).toHaveBeenCalledOnce()
    expect(firstResult.assistantMessage.runtimeResumeToken).toBe('sdk-session-skill-a')
    expect(secondResult.assistantMessage.runtimeResumeToken).toBe('sdk-session-skill-b')
  })

  it('recreates the WarmQuery handle when live runtime policy or environment changes under the same resume token', async () => {
    let state = createAgentStateForSdkExecutor()
    const warmQueryOne = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} via old policy`,
            session_id: 'resume-1'
          }
        ])
      ),
      close: vi.fn()
    }
    const warmQueryTwo = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} via new policy`,
            session_id: 'sdk-session-policy-b'
          }
        ])
      ),
      close: vi.fn()
    }
    const startup = vi
      .fn()
      .mockResolvedValueOnce(warmQueryOne)
      .mockResolvedValueOnce(warmQueryTwo)
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const firstInput = createExecutionInput()
    firstInput.request = {
      ...firstInput.request,
      text: 'First prompt'
    }
    firstInput.query = {
      ...firstInput.query,
      runtimeMetadata: {
        ...firstInput.query.runtimeMetadata,
        mcpServers: [
          {
            serverId: 'mcp-files',
            serverName: 'Filesystem',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/example/project'],
            env: {
              ROOT: '/Users/example/project'
            }
          }
        ]
      }
    }
    firstInput.executor = createClaudeCodeExecutorDescriptor({
      query: firstInput.query,
      toolHooks: firstInput.toolHooks,
      signal: firstInput.signal
    })

    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.query = {
      ...secondInput.query,
      sdkOptions: {
        ...secondInput.query.sdkOptions,
        model: 'anthropic:claude-opus-4-1',
        cwd: '/Users/example/other-project',
        env: {
          WORKSPACE_PROFILE: 'strict'
        },
        permissionMode: 'bypassPermissions',
        disallowedTools: ['Bash'],
        resume: 'resume-1'
      },
      runtimeMetadata: {
        ...secondInput.query.runtimeMetadata,
        mcpServers: [
          {
            serverId: 'mcp-files',
            serverName: 'Filesystem',
            transport: 'stdio',
            command: 'node',
            args: ['server.js', '/Users/example/other-project'],
            env: {
              ROOT: '/Users/example/other-project'
            }
          }
        ],
        toolPolicy: {
          ...secondInput.query.runtimeMetadata.toolPolicy,
          permissionMode: 'bypassPermissions',
          disallowedTools: ['Bash']
        }
      }
    }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    const firstResult = await executeTurn(firstInput)
    const secondResult = await executeTurn(secondInput)

    expect(startup).toHaveBeenCalledTimes(2)
    expect(warmQueryOne.close).toHaveBeenCalledOnce()
    expect(warmQueryOne.query).toHaveBeenCalledWith('First prompt')
    expect(warmQueryTwo.query).toHaveBeenCalledWith('Second prompt')
    expect(startup).toHaveBeenNthCalledWith(2, {
      options: expect.objectContaining({
        model: 'anthropic:claude-opus-4-1',
        cwd: '/Users/example/other-project',
        env: {
          WORKSPACE_PROFILE: 'strict'
        },
        permissionMode: 'bypassPermissions',
        disallowedTools: ['Bash'],
        mcpServers: {
          Filesystem: {
            type: 'stdio',
            command: 'node',
            args: ['server.js', '/Users/example/other-project'],
            env: {
              ROOT: '/Users/example/other-project'
            }
          }
        }
      })
    })
    expect(firstResult.assistantMessage.runtimeResumeToken).toBe('resume-1')
    expect(secondResult.assistantMessage.runtimeResumeToken).toBe('sdk-session-policy-b')
  })

  it('recreates the WarmQuery handle when the agent reasoning effort changes under the same resume token', async () => {
    let state = createAgentStateForSdkExecutor()
    const warmQueryOne = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} with high effort`,
            session_id: 'resume-1'
          }
        ])
      ),
      close: vi.fn()
    }
    const warmQueryTwo = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} with reasoning off`,
            session_id: 'resume-1'
          }
        ])
      ),
      close: vi.fn()
    }
    const startup = vi
      .fn()
      .mockResolvedValueOnce(warmQueryOne)
      .mockResolvedValueOnce(warmQueryTwo)
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const firstInput = createExecutionInput()
    firstInput.query = {
      ...firstInput.query,
      sdkOptions: { ...firstInput.query.sdkOptions, effort: 'high' }
    }
    firstInput.executor = createClaudeCodeExecutorDescriptor({
      query: firstInput.query,
      toolHooks: firstInput.toolHooks,
      signal: firstInput.signal
    })

    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.query = {
      ...secondInput.query,
      sdkOptions: { ...secondInput.query.sdkOptions, thinking: { type: 'disabled' } }
    }
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    await executeTurn(firstInput)
    await executeTurn(secondInput)

    expect(startup).toHaveBeenCalledTimes(2)
    expect(warmQueryOne.close).toHaveBeenCalledOnce()
    expect(startup).toHaveBeenNthCalledWith(1, {
      options: expect.objectContaining({ effort: 'high', resume: 'resume-1' })
    })
    expect(startup).toHaveBeenNthCalledWith(2, {
      options: expect.objectContaining({ thinking: { type: 'disabled' }, resume: 'resume-1' })
    })
  })

  it('recreates the WarmQuery handle when tool approval policy changes without changing SDK tool names', async () => {
    let state = createAgentStateForSdkExecutor()
    const toolName = 'product__demo__lookup'
    const warmQueryOne = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} with auto approval`,
            session_id: 'resume-1'
          }
        ])
      ),
      close: vi.fn()
    }
    const warmQueryTwo = {
      query: vi.fn((prompt: string) =>
        createAsyncIterable([
          {
            type: 'result',
            result: `${prompt} with prompt approval`,
            session_id: 'sdk-session-approval-policy-b'
          }
        ])
      ),
      close: vi.fn()
    }
    const startup = vi
      .fn()
      .mockResolvedValueOnce(warmQueryOne)
      .mockResolvedValueOnce(warmQueryTwo)
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { startup, query: vi.fn() }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const firstInput = createExecutionInput()
    firstInput.request = {
      ...firstInput.request,
      text: 'First prompt'
    }
    firstInput.query = withProductToolPolicy(firstInput.query, toolName, 'auto')
    firstInput.executor = createClaudeCodeExecutorDescriptor({
      query: firstInput.query,
      toolHooks: firstInput.toolHooks,
      signal: firstInput.signal
    })

    const secondInput = createExecutionInput()
    secondInput.runId = 'claude-run-2'
    secondInput.request = {
      ...secondInput.request,
      text: 'Second prompt',
      runId: 'claude-run-2'
    }
    secondInput.query = withProductToolPolicy(
      {
        ...secondInput.query,
        sdkOptions: {
          ...secondInput.query.sdkOptions,
          resume: 'resume-1'
        }
      },
      toolName,
      'prompt'
    )
    secondInput.executor = createClaudeCodeExecutorDescriptor({
      query: secondInput.query,
      toolHooks: secondInput.toolHooks,
      signal: secondInput.signal
    })

    const firstResult = await executeTurn(firstInput)
    const secondResult = await executeTurn(secondInput)

    expect(startup).toHaveBeenCalledTimes(2)
    expect(warmQueryOne.close).toHaveBeenCalledOnce()
    expect(startup).toHaveBeenNthCalledWith(1, {
      options: expect.objectContaining({
        allowedTools: [toolName]
      })
    })
    expect(startup).toHaveBeenNthCalledWith(2, {
      options: expect.objectContaining({
        allowedTools: [toolName]
      })
    })
    expect(firstResult.assistantMessage.runtimeResumeToken).toBe('resume-1')
    expect(secondResult.assistantMessage.runtimeResumeToken).toBe('sdk-session-approval-policy-b')
  })

  it('captures session ids from system init messages before the final result arrives', async () => {
    const query = vi.fn(() =>
      createAsyncIterable([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-session-init'
        },
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Partial output' }]
          }
        },
        {
          type: 'result',
          result: 'Partial output'
        }
      ])
    )
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(createExecutionInput())

    expect(result.assistantMessage.runtimeResumeToken).toBe('sdk-session-init')
  })

  it('persists session ids from system init into the pending assistant message before turn completion', async () => {
    let releaseResult!: () => void
    const query = vi.fn(() =>
      createAsyncIterableWithGate(
        [
          {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-session-live'
          },
          {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Partial output' }]
            }
          },
          {
            type: 'result',
            result: 'Partial output',
            session_id: 'sdk-session-live'
          }
        ],
        (release) => {
          releaseResult = release
        }
      )
    )
    let state = createAgentStateForSdkExecutor()
    const runtime = createClaudeAgentSdkRuntime({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const turn = runtime.executeTurn(createExecutionInput())

    await vi.waitFor(() =>
      expect(state.messagesBySessionId['session-1']?.at(-1)).toMatchObject({
        status: 'pending',
        runtimeResumeToken: 'sdk-session-live'
      })
    )

    releaseResult()

    const result = await turn

    expect(result.assistantMessage.runtimeResumeToken).toBe('sdk-session-live')
  })

  it('emits platform runtime tool chunks for streamed tool use and tool results', async () => {
    const emittedChunks: Array<unknown> = []
    const query = vi.fn(() =>
      createAsyncIterable([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-session-tools'
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-tools',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'tool-1',
              name: 'WebSearch',
              input: {}
            }
          }
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-tools',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'input_json_delta',
              partial_json: '{"query":"btc"}'
            }
          }
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-tools',
          event: {
            type: 'content_block_stop',
            index: 0
          }
        },
        {
          type: 'user',
          session_id: 'sdk-session-tools',
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-1',
                content: [{ type: 'text', text: 'Human readable result' }],
                structuredContent: { ok: true, count: 2 },
                is_error: false
              }
            ]
          }
        },
        {
          type: 'result',
          result: 'Done.',
          session_id: 'sdk-session-tools'
        }
      ])
    )
    let state = createAgentStateForSdkExecutor()
    const input = createExecutionInput()
    input.emitChunk = (chunk) => {
      emittedChunks.push(chunk)
    }
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(input)

    expect(emittedChunks).toEqual([
      {
        type: 'tool-input-start',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        toolName: 'WebSearch'
      },
      {
        type: 'tool-input-delta',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        inputTextDelta: '{"query":"btc"}'
      },
      {
        type: 'tool-input-available',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        toolName: 'WebSearch',
        input: { query: 'btc' }
      },
      {
        type: 'tool-output-available',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        output: { ok: true, count: 2 }
      }
    ])
    expect(result.assistantMessage.searchableText).toBe('Done.')
    expect(result.assistantMessage.data.parts).toEqual([
      { type: 'text', text: 'Done.' },
      {
        type: 'claude-sdk-tool-call',
        source: 'claude-agent-sdk',
        toolCallId: 'tool-1',
        toolName: 'WebSearch',
        input: { query: 'btc' }
      },
      {
        type: 'claude-sdk-tool-result',
        source: 'claude-agent-sdk',
        toolCallId: 'tool-1',
        output: { ok: true, count: 2 },
        content: [{ type: 'text', text: 'Human readable result' }],
        structuredContent: { ok: true, count: 2 },
        isError: false
      }
    ])
  })

  it('emits reasoning chunks for Claude SDK thinking stream events', async () => {
    const emittedChunks: Array<unknown> = []
    const query = vi.fn(() =>
      createAsyncIterable([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-session-thinking'
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-thinking',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'thinking',
              thinking: ''
            }
          }
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-thinking',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'thinking_delta',
              thinking: 'plan '
            }
          }
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-thinking',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'thinking_delta',
              thinking: 'first'
            }
          }
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-thinking',
          event: {
            type: 'content_block_stop',
            index: 0
          }
        },
        {
          type: 'result',
          result: 'Done.',
          session_id: 'sdk-session-thinking'
        }
      ])
    )
    let state = createAgentStateForSdkExecutor()
    const input = createExecutionInput()
    input.emitChunk = (chunk) => {
      emittedChunks.push(chunk)
    }
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(input)

    expect(emittedChunks).toEqual([
      {
        type: 'reasoning-start',
        sessionId: 'session-1',
        runId: 'claude-run-1',
        partId: 'reasoning-claude-run-1-0'
      },
      {
        type: 'reasoning-delta',
        sessionId: 'session-1',
        runId: 'claude-run-1',
        partId: 'reasoning-claude-run-1-0',
        delta: 'plan first'
      },
      {
        type: 'reasoning-end',
        sessionId: 'session-1',
        runId: 'claude-run-1',
        partId: 'reasoning-claude-run-1-0'
      }
    ])
    expect(result.assistantMessage.searchableText).toBe('Done.')
    expect(result.assistantMessage.data.parts).toEqual([
      { type: 'text', text: 'Done.' },
      {
        type: 'claude-sdk-reasoning',
        source: 'claude-agent-sdk',
        partId: 'reasoning-claude-run-1-0',
        text: 'plan first'
      }
    ])
  })

  it('emits runtime control chunks for non-init Claude SDK system messages', async () => {
    const emittedChunks: Array<unknown> = []
    const query = vi.fn(() =>
      createAsyncIterable([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-session-control'
        },
        {
          type: 'system',
          subtype: 'thinking_tokens',
          session_id: 'sdk-session-control'
        },
        {
          type: 'system',
          subtype: 'thinking_tokens',
          session_id: 'sdk-session-control'
        },
        {
          type: 'system',
          subtype: 'compact_boundary',
          session_id: 'sdk-session-control'
        },
        {
          type: 'system',
          subtype: 'api_retry',
          session_id: 'sdk-session-control',
          message: 'Retrying after rate limit'
        },
        {
          type: 'result',
          result: 'Done.',
          session_id: 'sdk-session-control'
        }
      ])
    )
    let state = createAgentStateForSdkExecutor()
    const input = createExecutionInput()
    input.emitChunk = (chunk) => {
      emittedChunks.push(chunk)
    }
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(input)

    expect(emittedChunks).toContainEqual({
      type: 'runtime-control',
      sessionId: 'session-1',
      runId: 'claude-run-1',
      source: 'claude-agent-sdk',
      subtype: 'compact_boundary'
    })
    expect(emittedChunks).toContainEqual({
      type: 'runtime-control',
      sessionId: 'session-1',
      runId: 'claude-run-1',
      source: 'claude-agent-sdk',
      subtype: 'api_retry',
      message: 'Retrying after rate limit'
    })
    expect(emittedChunks).not.toContainEqual(
      expect.objectContaining({
        type: 'runtime-control',
        subtype: 'init'
      })
    )
    expect(emittedChunks).not.toContainEqual(
      expect.objectContaining({
        type: 'runtime-control',
        subtype: 'thinking_tokens'
      })
    )
    expect(result.assistantMessage.data.parts).toEqual([
      { type: 'text', text: 'Done.' },
      {
        type: 'claude-sdk-runtime-control',
        source: 'claude-agent-sdk',
        subtype: 'compact_boundary'
      },
      {
        type: 'claude-sdk-runtime-control',
        source: 'claude-agent-sdk',
        subtype: 'api_retry',
        message: 'Retrying after rate limit'
      }
    ])
  })

  it('finalizes open reasoning and tool chunks when the Claude SDK stream ends without stop events', async () => {
    const emittedChunks: Array<unknown> = []
    const query = vi.fn(() =>
      createAsyncIterable([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-session-finalize'
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-finalize',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'thinking',
              thinking: ''
            }
          }
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-finalize',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'thinking_delta',
              thinking: 'still open'
            }
          }
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-finalize',
          event: {
            type: 'content_block_start',
            index: 1,
            content_block: {
              type: 'tool_use',
              id: 'tool-open',
              name: 'Read',
              input: {}
            }
          }
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-finalize',
          event: {
            type: 'content_block_delta',
            index: 1,
            delta: {
              type: 'input_json_delta',
              partial_json: '{"file_path":"README.md"}'
            }
          }
        },
        {
          type: 'result',
          result: 'Done.',
          session_id: 'sdk-session-finalize'
        }
      ])
    )
    let state = createAgentStateForSdkExecutor()
    const input = createExecutionInput()
    input.emitChunk = (chunk) => {
      emittedChunks.push(chunk)
    }
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    await executeTurn(input)

    expect(emittedChunks).toContainEqual({
      type: 'reasoning-end',
      sessionId: 'session-1',
      runId: 'claude-run-1',
      partId: 'reasoning-claude-run-1-0'
    })
    expect(emittedChunks).toContainEqual({
      type: 'tool-input-available',
      sessionId: 'session-1',
      toolCallId: 'tool-open',
      toolName: 'Read',
      input: { file_path: 'README.md' }
    })
  })

  it('emits assistant-text-update chunks for streamed assistant text deltas', async () => {
    const emittedChunks: Array<unknown> = []
    const query = vi.fn(() =>
      createAsyncIterable([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-session-text'
        },
        {
          type: 'assistant',
          session_id: 'sdk-session-text',
          message: {
            content: [{ type: 'text', text: 'Hello' }]
          }
        },
        {
          type: 'assistant',
          session_id: 'sdk-session-text',
          message: {
            content: [{ type: 'text', text: 'Hello world' }]
          }
        },
        {
          type: 'result',
          result: 'Hello world',
          session_id: 'sdk-session-text'
        }
      ])
    )
    let state = createAgentStateForSdkExecutor()
    const input = createExecutionInput()
    input.emitChunk = (chunk) => {
      emittedChunks.push(chunk)
    }
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    await executeTurn(input)

    expect(emittedChunks).toContainEqual({
      type: 'assistant-text-update',
      sessionId: 'session-1',
      runId: 'claude-run-1',
      text: 'Hello',
      textDelta: 'Hello',
      mode: 'append'
    })
    expect(emittedChunks).toContainEqual({
      type: 'assistant-text-update',
      sessionId: 'session-1',
      runId: 'claude-run-1',
      text: 'Hello world',
      textDelta: ' world',
      mode: 'append'
    })
  })

  it('emits assistant-text-update chunks directly from Claude SDK text delta stream events before the assistant snapshot arrives', async () => {
    const emittedChunks: Array<unknown> = []
    const query = vi.fn(() =>
      createAsyncIterable([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-session-stream-text'
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-stream-text',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'text',
              text: ''
            }
          }
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-stream-text',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'text_delta',
              text: 'Hello'
            }
          }
        },
        {
          type: 'stream_event',
          session_id: 'sdk-session-stream-text',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'text_delta',
              text: ' world'
            }
          }
        },
        {
          type: 'assistant',
          session_id: 'sdk-session-stream-text',
          message: {
            content: [{ type: 'text', text: 'Hello world' }]
          }
        },
        {
          type: 'result',
          result: 'Hello world',
          session_id: 'sdk-session-stream-text'
        }
      ])
    )
    let state = createAgentStateForSdkExecutor()
    const input = createExecutionInput()
    input.emitChunk = (chunk) => {
      emittedChunks.push(chunk)
    }
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    await executeTurn(input)

    expect(emittedChunks).toContainEqual({
      type: 'assistant-text-update',
      sessionId: 'session-1',
      runId: 'claude-run-1',
      text: 'Hello',
      textDelta: 'Hello',
      mode: 'append'
    })
    expect(emittedChunks).toContainEqual({
      type: 'assistant-text-update',
      sessionId: 'session-1',
      runId: 'claude-run-1',
      text: 'Hello world',
      textDelta: ' world',
      mode: 'append'
    })
    expect(
      emittedChunks.filter(
        (chunk) =>
          typeof chunk === 'object' &&
          chunk !== null &&
          'type' in chunk &&
          chunk.type === 'assistant-text-update'
      )
    ).toHaveLength(2)
  })

  it('emits tool-output-denied chunks when PreToolUse denies the tool before execution', async () => {
    const emittedChunks: Array<unknown> = []
    const query = vi.fn(async (input: { options?: { hooks?: { PreToolUse?: Array<{ hooks: Array<(...args: unknown[]) => Promise<unknown>> }> } } }) => {
      const preToolUse = input.options?.hooks?.PreToolUse?.[0]?.hooks[0]
      if (preToolUse) {
        await preToolUse(
          {
            hook_event_name: 'PreToolUse',
            session_id: 'sdk-session-tools',
            transcript_path: '/tmp/transcript.jsonl',
            cwd: '/Users/example/project',
            tool_name: 'Bash',
            tool_input: { command: 'rm -rf .' },
            tool_use_id: 'tool-call-denied'
          },
          {}
        )
      }

      return createAsyncIterable([
        {
          type: 'result',
          result: 'Done.',
          session_id: 'sdk-session-tools'
        }
      ])
    })
    let state = createAgentStateForSdkExecutor()
    const input = createExecutionInput()
    input.emitChunk = (chunk) => {
      emittedChunks.push(chunk)
    }
    input.requestToolApproval = vi.fn(async () => ({
      behavior: 'allow' as const
    }))
    input.query = {
      ...input.query,
      runtimeMetadata: {
        ...input.query.runtimeMetadata,
        toolPolicy: {
          ...input.query.runtimeMetadata.toolPolicy,
          canUseTool: (toolName: string) =>
            toolName === 'Bash'
              ? ({ kind: 'deny' as const, toolName, reason: 'tool-disabled' as const })
              : ({ kind: 'allow' as const, toolName }),
          preToolUse: ({ toolName }: { toolName: string }) =>
            toolName === 'Bash'
              ? ({ kind: 'deny' as const, toolName, reason: 'tool-disabled' as const })
              : ({ kind: 'allow' as const, toolName })
        }
      }
    }
    input.toolHooks = createRuntimeTestToolHooks(input)
    input.executor = createClaudeCodeExecutorDescriptor({
      query: input.query,
      toolHooks: input.toolHooks,
      signal: input.signal
    })
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    await executeTurn(input)

    expect(emittedChunks).toContainEqual({
      type: 'tool-output-denied',
      sessionId: 'session-1',
      toolCallId: 'tool-call-denied',
      message: 'Tool "Bash" is disabled for this agent.'
    })
  })

  it('forwards mentioned models into both persisted user messages and the Claude SDK prompt', async () => {
    const query = vi.fn(() =>
      createAsyncIterable([
        {
          type: 'result',
          result: 'Done.',
          session_id: 'sdk-session-2'
        }
      ])
    )
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: { query }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })
    const input = createExecutionInput()
    input.request = {
      ...input.request,
      text: 'Compare these models for this task.',
      mentionedModels: [
        'openai:gpt-5',
        {
          id: 'anthropic:claude-sonnet-4-5',
          label: 'Claude Sonnet 4.5',
          providerName: 'Anthropic'
        }
      ]
    } satisfies AgentChatRuntimeRequest

    const result = await executeTurn(input)

    expect(query).toHaveBeenCalledWith({
      prompt: [
        'Mentioned models:',
        '- GPT-5 (OpenAI) [openai:gpt-5]',
        '- Claude Sonnet 4.5 (Anthropic) [anthropic:claude-sonnet-4-5]',
        '',
        'Compare these models for this task.'
      ].join('\n'),
      options: expect.any(Object)
    })
    expect(result.userMessage.data.parts).toEqual([
      {
        type: 'agent-mentioned-models',
        modelIds: ['openai:gpt-5', 'anthropic:claude-sonnet-4-5'],
        models: [
          {
            id: 'openai:gpt-5',
            label: 'GPT-5',
            providerName: 'OpenAI'
          },
          {
            id: 'anthropic:claude-sonnet-4-5',
            label: 'Claude Sonnet 4.5',
            providerName: 'Anthropic'
          }
        ]
      },
      {
        type: 'text',
        text: 'Compare these models for this task.'
      }
    ])
  })

  it('returns a platform error turn when the official Claude Agent SDK query function is unavailable', async () => {
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: {}
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(createExecutionInput())

    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.searchableText).toBe(
      'Claude Agent SDK query() is not available from the loaded SDK module.'
    )
  })

  it('returns a platform error turn when the Claude Agent SDK package is not installed', async () => {
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeAgentSdkExecutor({
      loadClaudeSdkModule: async () => ({
        ok: false,
        reason: 'module-not-installed',
        message: 'Claude Code SDK package is not installed in the desktop main process runtime.'
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(createExecutionInput())

    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.searchableText).toBe(
      'Claude Code SDK package is not installed in the desktop main process runtime.'
    )
  })

  it('returns a platform error turn when the Claude Agent SDK package is unavailable', async () => {
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeSdkPreferredExecutor({
      loadClaudeSdkModule: async () => ({
        ok: false,
        reason: 'module-not-installed',
        message: 'Claude Code SDK package is not installed in the desktop main process runtime.'
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(createExecutionInput())

    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.searchableText).toBe(
      'Claude Code SDK package is not installed in the desktop main process runtime.'
    )
  })

  it('does not fall back when the Claude SDK starts but fails during execution', async () => {
    let state = createAgentStateForSdkExecutor()
    const executeTurn = createClaudeSdkPreferredExecutor({
      loadClaudeSdkModule: async () => ({
        ok: true,
        module: {
          query: () =>
            createAsyncIterable([
              {
                type: 'result',
                is_error: true,
                result: 'SDK execution failed.'
              }
            ])
        }
      }),
      getProviderState: async () => createProviderStateForSdkExecutor(),
      getAgentState: async () => state,
      saveAgentState: async (next, options) => {
        state = options?.mergeSessionId ? mergeSessionMessagesState(state, next, options.mergeSessionId) : next
      }
    })

    const result = await executeTurn(createExecutionInput())

    expect(result.assistantMessage.status).toBe('error')
    expect(result.assistantMessage.searchableText).toBe('SDK execution failed.')
  })
})

function createExecutionInput(): ClaudeCodeRuntimeExecutionInput {
  return {
    request: {
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'Inspect this repository',
      runId: 'claude-run-1'
    },
    composition,
    runId: 'claude-run-1',
    settings: {
      cwd: '/Users/example/project',
      env: {},
      permissionMode: 'acceptEdits' as const,
      allowedTools: [],
      disallowedTools: [],
      mcpSources: [],
      mcpServers: [],
      skills: [],
      skillToolIds: []
    },
    query: {
      sdkOptions: {
        model: 'anthropic:claude-sonnet-4-5',
        cwd: '/Users/example/project',
        env: {},
        permissionMode: 'acceptEdits' as const,
        allowedTools: [],
        disallowedTools: [],
        abortController: new AbortController(),
        resume: 'resume-1'
      },
      runtimeMetadata: {
        mcpSources: [],
        mcpServers: [],
        skills: [],
        skillToolIds: [],
        toolPolicy: {
          permissionMode: 'acceptEdits' as const,
          allowedTools: [],
          disallowedTools: [],
          mcpSources: [],
          skillToolIds: [],
          canUseTool: () => ({ kind: 'allow' as const, toolName: 'Read' }),
          preToolUse: () => ({ kind: 'allow' as const, toolName: 'Read' }),
          toApprovalRequest: () => ({ toolName: 'Read', toolCallId: 'tool-call-read' })
        }
      }
    },
    executor: createClaudeCodeExecutorDescriptor({
      query: {
        sdkOptions: {
          model: 'anthropic:claude-sonnet-4-5',
          cwd: '/Users/example/project',
          env: {},
          permissionMode: 'acceptEdits' as const,
          allowedTools: [],
          disallowedTools: [],
          abortController: new AbortController(),
          resume: 'resume-1'
        },
        runtimeMetadata: {
          mcpSources: [],
          mcpServers: [],
          skills: [],
          skillToolIds: [],
          toolPolicy: {
            permissionMode: 'acceptEdits' as const,
            allowedTools: [],
            disallowedTools: [],
            mcpSources: [],
            skillToolIds: [],
            canUseTool: () => ({ kind: 'allow' as const, toolName: 'Read' }),
            preToolUse: () => ({ kind: 'allow' as const, toolName: 'Read' }),
            toApprovalRequest: () => ({ toolName: 'Read', toolCallId: 'tool-call-read' })
          }
        }
      },
      toolHooks: {
        canUseTool: async () => ({ behavior: 'allow' }),
        preToolUse: async () => ({ behavior: 'allow' })
      },
      signal: new AbortController().signal
    }),
    toolHooks: {
      canUseTool: async () => ({ behavior: 'allow' as const }),
      preToolUse: async () => ({ behavior: 'allow' as const })
    },
    requestToolApproval: vi.fn(),
    emitChunk: vi.fn(),
    signal: new AbortController().signal
  }
}

function withProductToolPolicy(
  query: ClaudeCodeQueryOptions,
  toolName: string,
  approval: ToolApproval
): ClaudeCodeQueryOptions {
  const runtimeMcpToolNames = [toolName]
  const runtimeMcpApprovalByName = {
    [toolName]: approval
  }

  return {
    ...query,
    runtimeMetadata: {
      ...query.runtimeMetadata,
      runtimeMcpToolNames,
      toolPolicy: {
        ...query.runtimeMetadata.toolPolicy,
        runtimeMcpToolNames,
        runtimeMcpApprovalByName
      }
    }
  }
}

function createAgentStateForSdkExecutor(): AgentStoreState {
  return {
    agents: [
      {
        id: 'agent-1',
        type: 'claude-code',
        name: 'Agent',
        instructions: 'Act like a careful coding assistant.',
        model: 'anthropic:claude-sonnet-4-5',
        modelName: 'Claude Sonnet 4.5',
        orderKey: '0001',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    sessions: [
      {
        id: 'session-1',
        agentId: 'agent-1',
        name: 'Session',
        workspaceId: 'workspace-1',
        workspace: {
          id: 'workspace-1',
          name: 'Workspace',
          path: '/Users/example/project',
          type: 'user',
          orderKey: '0001',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        },
        orderKey: '0001',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/Users/example/project',
        type: 'user',
        orderKey: '0001',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    activeAgentId: 'agent-1',
    activeSessionId: 'session-1',
    sessionPins: [],
    messagesBySessionId: {
      'session-1': [
        {
          id: 'message-history-user',
          sessionId: 'session-1',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'Previous question' }] },
          searchableText: 'Previous question',
          status: 'success',
          modelId: null,
          modelSnapshot: null,
          stats: null,
          runtimeResumeToken: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    },
    mcpServers: [],
    mcpRuntimeStatusByServerId: {},
    mcpToolsByServerId: {},
    channels: [],
    skills: [],
    agentSkills: [],
    tasks: [],
    taskRunLogs: [],
    channelTaskSubscriptions: []
  }
}

function createProviderStateForSdkExecutor(): ProviderState {
  return {
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        enabled: true,
        apiKey: 'secret',
        baseUrl: 'https://api.anthropic.test',

        endpoints: [
          { protocol: 'messages', baseUrl: 'https://proxy.anthropic.test' } as const
        ],
        models: [
          {
            id: 'claude-sonnet-4-5',
            name: 'Claude Sonnet 4.5',
            capabilities: {
              chat: true,
              vision: true,
              embedding: false,
              tools: true
            }
          }
        ],
        defaultChatModelId: 'claude-sonnet-4-5'
      },
      {
        id: 'openai',
        name: 'OpenAI',
        enabled: true,
        apiKey: 'secret',
        baseUrl: 'https://api.openai.test',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.openai.test' } as const
        ],
        models: [
          {
            id: 'gpt-5',
            name: 'GPT-5',
            capabilities: {
              chat: true,
              vision: true,
              embedding: false,
              tools: true
            }
          }
        ],
        defaultChatModelId: 'gpt-5'
      }
    ]
  }
}

function mergeSessionMessagesState(
  current: AgentStoreState,
  next: AgentStoreState,
  sessionId: string
): AgentStoreState {
  return {
    ...current,
    ...next,
    messagesBySessionId: {
      ...current.messagesBySessionId,
      [sessionId]: next.messagesBySessionId[sessionId] ?? current.messagesBySessionId[sessionId] ?? []
    }
  }
}

async function* createAsyncIterable(items: readonly unknown[]) {
  for (const item of items) {
    yield item
  }
}

async function* createAsyncIterableThatThrows(error: Error) {
  throw error
}

async function* createAsyncIterableWithGate(
  items: readonly unknown[],
  captureRelease: (release: () => void) => void
) {
  if (items.length === 0) return
  yield items[0]
  await new Promise<void>((resolve) => {
    captureRelease(resolve)
  })
  for (const item of items.slice(1)) {
    yield item
  }
}

async function* createAsyncIterableWithGateAndError(
  items: readonly unknown[],
  captureRelease: (release: () => void) => void,
  maybeThrow: () => void
) {
  if (items.length === 0) return
  yield items[0]
  await new Promise<void>((resolve) => {
    captureRelease(resolve)
  })
  maybeThrow()
  for (const item of items.slice(1)) {
    yield item
  }
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

function createRuntimeTestToolHooks(
  input: ClaudeCodeRuntimeExecutionInput
): ClaudeCodeRuntimeExecutionInput['toolHooks'] {
  return createClaudeCodeToolHooks({
    sessionId: input.request.sessionId,
    toolPolicy: input.query.runtimeMetadata.toolPolicy,
    requestToolApproval: input.requestToolApproval,
    onDecision: ({ toolCallId }, decision) => {
      if (decision.behavior !== 'deny' || !toolCallId) return
      input.emitChunk({
        type: 'tool-output-denied',
        sessionId: input.request.sessionId,
        toolCallId,
        message: decision.message
      })
    }
  })
}
