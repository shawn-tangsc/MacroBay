import { describe, expect, it, vi } from 'vitest'

import { createAssistantTextData, type AssistantMessageEntity } from '../schemas/messageSchemas'
import { createDefaultAssistantSettings, type AssistantEntity } from '../schemas/assistantSchemas'
import type { AssistantTopicEntity } from '../schemas/topicSchemas'
import type { AssistantChatRuntimeService } from '../runtime/assistantChatRuntimeTypes'
import {
  ASSISTANT_PROGRAMMATIC_INVOCATION_TIMEOUT_MESSAGE,
  AssistantProgrammaticInvocationService
} from './AssistantProgrammaticInvocationService'

const nowIso = '2026-07-11T00:00:00.000Z'

function createAssistant(id: string): AssistantEntity {
  return {
    id,
    name: 'Chart Indicator Analyst',
    prompt: 'Respond JSON only.',
    icon: '📈',
    description: '',
    settings: createDefaultAssistantSettings(),
    modelId: null,
    modelName: null,
    mcpServerIds: [],
    contextSourceIds: [],
    tags: [],
    orderKey: id,
    createdAt: nowIso,
    updatedAt: nowIso
  }
}

function createTopic(input: {
  id: string
  assistantId: string
  name: string
  groupId?: string
  traceId?: string
}): AssistantTopicEntity {
  return {
    id: input.id,
    assistantId: input.assistantId,
    name: input.name,
    isNameManuallyEdited: false,
    activeNodeId: null,
    groupId: input.groupId,
    traceId: input.traceId,
    orderKey: input.id,
    createdAt: nowIso,
    updatedAt: nowIso
  }
}

function createMessage(input: {
  id: string
  topicId: string
  role: AssistantMessageEntity['role']
  text: string
  status?: AssistantMessageEntity['status']
  parentId?: string | null
  modelId?: string | null
}): AssistantMessageEntity {
  return {
    id: input.id,
    topicId: input.topicId,
    parentId: input.parentId ?? null,
    role: input.role,
    data: createAssistantTextData(input.text),
    searchableText: input.text,
    status: input.status ?? 'success',
    siblingsGroupId: 0,
    modelId: input.modelId ?? null,
    modelSnapshot: input.modelId
      ? {
          id: 'gpt-test',
          name: 'GPT Test',
          provider: 'openai'
        }
      : null,
    stats: null,
    createdAt: nowIso,
    updatedAt: nowIso
  }
}

describe('AssistantProgrammaticInvocationService', () => {
  it('ensures an installed assistant by product template provenance', async () => {
    const assistant = createAssistant('assistant-installed')
    const installTemplate = vi.fn()
    const service = createService({
      library: {
        listTemplates: vi.fn(() => [
          {
            templateId: 'product:sample-product:chart-indicator-analyst',
            sourceKind: 'product',
            sourceProductId: 'sample-product',
            version: 1,
            name: 'Chart Indicator Analyst',
            description: '',
            icon: '📈',
            promptPreview: '',
            groups: ['tools'],
            tags: [],
            installed: true,
            installedAssistantId: assistant.id,
            installPolicy: 'auto-install'
          }
        ]),
        installTemplate
      },
      repos: {
        assistants: { getById: vi.fn(() => assistant) },
        topics: { listByCursor: vi.fn(), create: vi.fn() },
        messages: { getById: vi.fn() }
      },
      runtime: fakeRuntime()
    })

    await expect(
      service.ensureInstalledAssistantByTemplate({
        sourceProductId: 'sample-product',
        templateId: 'chart-indicator-analyst'
      })
    ).resolves.toEqual({ assistantId: assistant.id })
    expect(installTemplate).not.toHaveBeenCalled()
  })

  it('installs a product template when no assistant is installed yet', async () => {
    const assistant = createAssistant('assistant-new')
    const installTemplate = vi.fn(() => ({
      assistant,
      catalogItem: {
        templateId: 'product:sample-product:chart-indicator-analyst',
        installed: true,
        installedAssistantId: assistant.id
      }
    }))
    const service = createService({
      library: {
        listTemplates: vi.fn(() => [
          {
            templateId: 'product:sample-product:chart-indicator-analyst',
            sourceKind: 'product',
            sourceProductId: 'sample-product',
            version: 1,
            name: 'Chart Indicator Analyst',
            description: '',
            icon: '📈',
            promptPreview: '',
            groups: ['tools'],
            tags: [],
            installed: false,
            installPolicy: 'auto-install'
          }
        ]),
        installTemplate
      },
      repos: {
        assistants: { getById: vi.fn(() => null) },
        topics: { listByCursor: vi.fn(), create: vi.fn() },
        messages: { getById: vi.fn() }
      },
      runtime: fakeRuntime()
    })

    await expect(
      service.ensureInstalledAssistantByTemplate({
        sourceProductId: 'sample-product',
        templateId: 'chart-indicator-analyst'
      })
    ).resolves.toEqual({ assistantId: assistant.id })
    expect(installTemplate).toHaveBeenCalledWith(
      { templateId: 'product:sample-product:chart-indicator-analyst' },
      'zh-CN'
    )
  })

  it('reuses a topic by external reference trace id and creates one when missing', async () => {
    const existing = createTopic({
      id: 'topic-existing',
      assistantId: 'assistant-1',
      name: '指标解读 · BTCUSDT · 15m',
      groupId: 'chart-indicator-insight',
      traceId: 'chart:btc:15m'
    })
    const created = createTopic({
      id: 'topic-created',
      assistantId: 'assistant-1',
      name: '指标解读 · ETHUSDT · 1h',
      groupId: 'chart-indicator-insight'
    })
    const createTopicMock = vi.fn(() => created)
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn() },
        topics: {
          listByCursor: vi.fn(() => ({ topics: [existing], nextCursor: null, pinnedIds: [] })),
          create: createTopicMock,
          update: vi.fn()
        },
        messages: { getById: vi.fn() }
      },
      runtime: fakeRuntime()
    })

    await expect(
      service.ensureTopic({
        assistantId: 'assistant-1',
        externalRef: 'chart:btc:15m',
        name: '指标解读 · BTCUSDT · 15m',
        groupId: 'chart-indicator-insight'
      })
    ).resolves.toEqual({ topicId: existing.id })

    await expect(
      service.ensureTopic({
        assistantId: 'assistant-1',
        externalRef: 'chart:eth:1h',
        name: '指标解读 · ETHUSDT · 1h',
        groupId: 'chart-indicator-insight'
      })
    ).resolves.toEqual({ topicId: created.id })
    expect(createTopicMock).toHaveBeenCalledWith({
      assistantId: 'assistant-1',
      name: '指标解读 · ETHUSDT · 1h',
      isNameManuallyEdited: true,
      groupId: 'chart-indicator-insight',
      traceId: 'chart:eth:1h'
    })
  })

  it('updates a reused topic name when the product title changes for the same external ref', async () => {
    const existing = createTopic({
      id: 'topic-existing',
      assistantId: 'assistant-1',
      name: '指标解读 · BTC/USDT · 15m',
      groupId: 'chart-indicator-insight',
      traceId: 'chart:btc:15m'
    })
    const updateTopicMock = vi.fn(() => ({
      ...existing,
      name: '指标解读 · BTC/USDT · 永续 · 15m',
      isNameManuallyEdited: true
    }))
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn() },
        topics: {
          listByCursor: vi.fn(() => ({ topics: [existing], nextCursor: null, pinnedIds: [] })),
          create: vi.fn(),
          update: updateTopicMock
        },
        messages: { getById: vi.fn() }
      },
      runtime: fakeRuntime()
    })

    await expect(
      service.ensureTopic({
        assistantId: 'assistant-1',
        externalRef: 'chart:btc:15m',
        name: '指标解读 · BTC/USDT · 永续 · 15m',
        groupId: 'chart-indicator-insight'
      })
    ).resolves.toEqual({ topicId: existing.id })

    expect(updateTopicMock).toHaveBeenCalledWith(existing.id, {
      name: '指标解读 · BTC/USDT · 永续 · 15m',
      isNameManuallyEdited: true
    })
  })

  it('invokes assistant runtime and returns persisted message refs and text', async () => {
    const assistantMessage = createMessage({
      id: 'assistant-message-1',
      topicId: 'topic-1',
      role: 'assistant',
      text: '{"schemaVersion":1}',
      modelId: 'openai:gpt-test'
    })
    const open = vi.fn(async () => ({
      mode: 'started' as const,
      userMessageId: 'user-message-1',
      placeholderIds: [assistantMessage.id],
      executionIds: ['execution-1']
    }))
    const getById = vi.fn(() => assistantMessage)
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn() },
        topics: { listByCursor: vi.fn(), create: vi.fn() },
        messages: { getById }
      },
      runtime: {
        ...fakeRuntime(),
        open
      },
      pollIntervalMs: 0,
      timeoutMs: 100
    })

    await expect(
      service.invoke({
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        userMessage: 'Return JSON.',
        metadata: {
          productId: 'sample-product',
          feature: 'chart-indicator-insight',
          scopeKey: 'scope-1',
          asOf: '2026-07-11T00:00:00.000Z'
        },
        responseMode: 'complete'
      })
    ).resolves.toMatchObject({
      topicId: 'topic-1',
      userMessageId: 'user-message-1',
      assistantMessageId: assistantMessage.id,
      text: '{"schemaVersion":1}',
      modelId: 'openai:gpt-test',
      modelProviderId: 'openai'
    })
    expect(open).toHaveBeenCalledWith({
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      trigger: 'submit-message',
      contextMode: 'latest-user-only',
      userMessageParts: [
        {
          type: 'text',
          text: 'Return JSON.'
        }
      ]
    })
  })

  it('honors a per-call wait window so a slow generation can still complete', async () => {
    const assistantMessage = createMessage({
      id: 'assistant-message-slow',
      topicId: 'topic-1',
      role: 'assistant',
      text: '{"schemaVersion":1}',
      modelId: 'openai:gpt-test'
    })
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn() },
        topics: { listByCursor: vi.fn(), create: vi.fn() },
        messages: { getById: vi.fn(() => assistantMessage) }
      },
      runtime: {
        ...fakeRuntime(),
        open: vi.fn(async () => ({
          mode: 'started' as const,
          userMessageId: 'user-message-1',
          placeholderIds: [assistantMessage.id],
          executionIds: ['execution-1']
        }))
      },
      pollIntervalMs: 0,
      timeoutMs: 1
    })

    await expect(service.invoke({
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      userMessage: 'Return JSON.',
      responseMode: 'complete',
      timeoutMs: 5_000
    })).resolves.toMatchObject({ text: '{"schemaVersion":1}' })
  })

  it('keeps the configured wait window when a caller passes no override', async () => {
    const assistantMessage = createMessage({
      id: 'assistant-message-pending',
      topicId: 'topic-1',
      role: 'assistant',
      text: '',
      status: 'pending',
      modelId: 'openai:gpt-test'
    })
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn() },
        topics: { listByCursor: vi.fn(), create: vi.fn() },
        messages: { getById: vi.fn(() => assistantMessage) }
      },
      runtime: {
        ...fakeRuntime(),
        open: vi.fn(async () => ({
          mode: 'started' as const,
          userMessageId: 'user-message-1',
          placeholderIds: [assistantMessage.id],
          executionIds: ['execution-1']
        }))
      },
      pollIntervalMs: 1,
      timeoutMs: 30
    })

    await expect(service.invoke({
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      userMessage: 'Return JSON.',
      responseMode: 'complete',
      // An unusable override must fall back to the configured window instead of
      // resolving immediately or waiting forever.
      timeoutMs: -1
    })).rejects.toThrow(ASSISTANT_PROGRAMMATIC_INVOCATION_TIMEOUT_MESSAGE)
  })

  it.each(['provider-configuration-required', 'provider-request-failed'] as const)(
    'preserves the safe %s runtime failure code for programmatic callers',
    async (code) => {
      const assistantMessage = {
        ...createMessage({
          id: 'assistant-message-error',
          topicId: 'topic-1',
          role: 'assistant',
          text: '',
          status: 'error',
          modelId: 'openai:gpt-test'
        }),
        data: { parts: [{ type: 'error' as const, code, message: '' }] }
      }
      const service = createService({
        library: fakeLibrary(),
        repos: {
          assistants: { getById: vi.fn() },
          topics: { listByCursor: vi.fn(), create: vi.fn() },
          messages: { getById: vi.fn(() => assistantMessage) }
        },
        runtime: {
          ...fakeRuntime(),
          open: vi.fn(async () => ({
            mode: 'started' as const,
            userMessageId: 'user-message-1',
            placeholderIds: [assistantMessage.id],
            executionIds: ['execution-1']
          }))
        },
        pollIntervalMs: 0,
        timeoutMs: 100
      })

      await expect(service.invoke({
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        userMessage: 'Return JSON.',
        responseMode: 'complete'
      })).rejects.toThrow(code)
    }
  )

  it('returns transient provider failure evidence without writing it into the assistant message', async () => {
    const assistantMessage = {
      ...createMessage({
        id: 'assistant-message-error-evidence',
        topicId: 'topic-1',
        role: 'assistant',
        text: '',
        status: 'error',
        modelId: 'openai:gpt-test'
      }),
      data: { parts: [{ type: 'error' as const, code: 'provider-request-failed', message: '' }] }
    }
    const runtime = {
      ...fakeRuntime(),
      open: vi.fn(async () => ({
        mode: 'started' as const,
        userMessageId: 'user-message-1',
        placeholderIds: [assistantMessage.id],
        executionIds: ['execution-1']
      })),
      consumeInvocationFailureEvidence: vi.fn(() => ({
        phase: 'response' as const,
        summary: 'HTTP 429',
        providerId: 'openai',
        modelId: 'gpt-test',
        httpStatus: 429,
        body: 'provider body'
      }))
    }
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn() },
        topics: { listByCursor: vi.fn(), create: vi.fn() },
        messages: { getById: vi.fn(() => assistantMessage) }
      },
      runtime: runtime as AssistantChatRuntimeService,
      pollIntervalMs: 0,
      timeoutMs: 100
    })

    await expect(service.invoke({
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      userMessage: 'Return JSON.',
      responseMode: 'complete'
    })).rejects.toMatchObject({
      message: 'provider-request-failed',
      evidence: {
        phase: 'response',
        httpStatus: 429,
        body: 'provider body'
      }
    })
    expect(assistantMessage.data).toEqual({ parts: [{ type: 'error', code: 'provider-request-failed', message: '' }] })
  })

  it('preserves the safe preflight configuration code from the runtime', async () => {
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn() },
        topics: { listByCursor: vi.fn(), create: vi.fn() },
        messages: { getById: vi.fn() }
      },
      runtime: { ...fakeRuntime(), open: vi.fn(async () => { throw new Error('provider-configuration-required') }) }
    })

    await expect(service.invoke({
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      userMessage: 'Return JSON.',
      responseMode: 'complete'
    })).rejects.toThrow('provider-configuration-required')
  })

  it('prunes programmatic topic history to the requested latest turns', async () => {
    const pruneTopicToLatestTurns = vi.fn(() => ({
      topicId: 'topic-1',
      latestTurns: 5,
      activeMessagesBefore: 20,
      activeMessagesAfter: 10,
      deletedMessages: 10,
      activeBytesBefore: 2000,
      activeBytesAfter: 1000,
      durationMs: 2
    }))
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn() },
        topics: { listByCursor: vi.fn(), create: vi.fn() },
        messages: {
          getById: vi.fn(),
          pruneTopicToLatestTurns
        }
      },
      runtime: fakeRuntime(),
      pollIntervalMs: 0,
      timeoutMs: 100
    })

    await expect(service.pruneTopicHistory({ topicId: 'topic-1', latestTurns: 5 })).resolves.toMatchObject({
      topicId: 'topic-1',
      activeMessagesAfter: 10,
      deletedMessages: 10
    })
    expect(pruneTopicToLatestTurns).toHaveBeenCalledWith('topic-1', 5)
  })

  it('lists product-owned assistant topics by template and group for maintenance', async () => {
    const owned = [
      createTopic({
        id: 'topic-session',
        assistantId: 'assistant-1',
        name: '指标解读 · BTCUSDT · 15m',
        groupId: 'chart-indicator-insight'
      }),
      createTopic({
        id: 'topic-orphan',
        assistantId: 'assistant-1',
        name: '指标解读 · ETHUSDT · 1m',
        groupId: 'chart-indicator-insight'
      })
    ]
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn() },
        topics: {
          listByProductTemplateAndGroup: vi.fn(() => owned)
        },
        messages: { getById: vi.fn() }
      },
      runtime: fakeRuntime()
    })

    await expect(
      service.listOwnedTopics({
        sourceProductId: 'sample-product',
        templateId: 'chart-indicator-analyst',
        groupId: 'chart-indicator-insight'
      })
    ).resolves.toEqual([
      { topicId: 'topic-session' },
      { topicId: 'topic-orphan' }
    ])
  })

  it('resolves the assistant model id before invocation for cache compatibility checks', async () => {
    const assistant = {
      ...createAssistant('assistant-1'),
      modelId: 'openai:gpt-test'
    }
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn(() => assistant) },
        topics: { listByCursor: vi.fn(), create: vi.fn() },
        messages: { getById: vi.fn() }
      },
      runtime: fakeRuntime()
    })

    await expect(service.resolveAssistantModelId('assistant-1')).resolves.toBe('openai:gpt-test')
  })

  it('resolves the effective default chat model when the assistant has no explicit model', async () => {
    const assistant = createAssistant('assistant-1')
    const service = createService({
      library: fakeLibrary(),
      repos: {
        assistants: { getById: vi.fn(() => assistant) },
        topics: { listByCursor: vi.fn(), create: vi.fn() },
        messages: { getById: vi.fn() }
      },
      runtime: fakeRuntime(),
      getProviderState: vi.fn(async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            protocol: 'openai-compatible',
            enabled: true,
            baseUrl: 'https://api.openai.test/v1',
            apiKey: 'sk-test',
            defaultChatModelId: 'gpt-default',
            models: [
              {
                id: 'gpt-default',
                name: 'GPT Default',
                capabilities: { chat: true, vision: false, embedding: false, tools: false }
              }
            ]
          }
        ]
      }))
    })

    await expect(service.resolveAssistantModelId('assistant-1')).resolves.toBe('openai:gpt-default')
  })
})

function fakeLibrary() {
  return {
    listTemplates: vi.fn(() => []),
    installTemplate: vi.fn()
  }
}

function createService(deps: unknown): AssistantProgrammaticInvocationService {
  return new AssistantProgrammaticInvocationService(
    deps as ConstructorParameters<typeof AssistantProgrammaticInvocationService>[0]
  )
}

function fakeRuntime(): AssistantChatRuntimeService {
  return {
    open: vi.fn(async () => ({ mode: 'blocked' as const, message: 'not implemented' })),
    attach: vi.fn(() => ({
      snapshot: {
        topicId: 'topic',
        status: 'done' as const,
        activeExecutions: [],
        awaitingApprovalAnchors: [],
        updatedAt: nowIso
      },
      bufferedChunks: []
    })),
    abort: vi.fn(),
    discardTopic: vi.fn(),
    getStatus: vi.fn(() => ({
      topicId: 'topic',
      status: 'done' as const,
      activeExecutions: [],
      awaitingApprovalAnchors: [],
      updatedAt: nowIso
    })),
    reconcileStalePending: vi.fn(() => 0)
  }
}
