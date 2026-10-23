import { describe, expect, it, vi } from 'vitest'

import { createAssistantPlatformDatabase } from '../../ai/assistant-platform/db/createAssistantPlatformDatabase'
import { createAssistantPlatformRepositories } from '../../ai/assistant-platform/repositories/createAssistantPlatformRepositories'
import { createAssistantChatRuntimeService } from '../../ai/assistant-platform/runtime/AssistantChatRuntimeService'
import { createDefaultAssistantSeed } from '../../ai/assistant-platform/seeds/defaultAssistantSeed'
import { AssistantTemplateRegistry } from '../../ai/assistant-platform/library/AssistantTemplateRegistry'
import { AssistantLibraryService } from '../../ai/assistant-platform/library/AssistantLibraryService'
import { createAssistantIpcHandlers } from './assistantIpcHandlers'

describe('createAssistantIpcHandlers', () => {
  it('lists assistants and creates topics through IPC handlers', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    repos.assistants.create(createDefaultAssistantSeed())
    const runtime = createAssistantChatRuntimeService({
      repos,
      getProviderState: async () => ({ providers: [] })
    })
    const handlers = createAssistantIpcHandlers(repos, runtime, createLibraryService(repos))

    expect(handlers.listAssistants()).toHaveLength(1)
    const topic = handlers.createTopic({ assistantId: createDefaultAssistantSeed().id, name: 'Topic A' })
    expect(topic.name).toBe('Topic A')
    expect(handlers.listTopics({ assistantId: createDefaultAssistantSeed().id }).topics).toHaveLength(1)
  })

  it('exposes assistant library handlers without dropping chat stream handlers', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const runtime = createAssistantChatRuntimeService({
      repos,
      getProviderState: async () => ({ providers: [] })
    })
    const handlers = createAssistantIpcHandlers(repos, runtime, createLibraryService(repos))

    expect(handlers.streamOpen).toBeTypeOf('function')
    expect(handlers.editAndResendUserMessage).toBeTypeOf('function')
    expect(handlers.listAssistantTemplates({ search: 'default' }, 'en-US')).toHaveLength(1)
    const installed = handlers.installAssistantTemplate({ templateId: 'platform:default-assistant' }, 'en-US')

    expect(installed.assistant.name).toBe('Default Assistant')
    await expect(handlers.createAssistantFromLibrary({ name: 'Manual', prompt: 'Help.' })).resolves.toMatchObject({
      name: 'Manual'
    })
  })

  it('aborts then discards only the message topic around a delete mutation', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create(createDefaultAssistantSeed())
    const targetTopic = repos.topics.create({ assistantId: assistant.id, name: 'Target' })
    const otherTopic = repos.topics.create({ assistantId: assistant.id, name: 'Other' })
    const message = repos.messages.create(targetTopic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Delete me' }] },
      status: 'success'
    })
    const runtime = {
      open: vi.fn(),
      attach: vi.fn(),
      abort: vi.fn(),
      discardTopic: vi.fn(),
      getStatus: vi.fn(),
      reconcileStalePending: vi.fn()
    }
    const handlers = createAssistantIpcHandlers(repos, runtime, createLibraryService(repos))

    expect(handlers.deleteMessage(message.id)).toBe(true)
    expect(runtime.abort).toHaveBeenCalledWith(targetTopic.id)
    expect(runtime.discardTopic).toHaveBeenCalledWith(targetTopic.id)
    expect(runtime.abort).not.toHaveBeenCalledWith(otherTopic.id)
    expect(repos.messages.getById(message.id)).toBeNull()
  })

  it('does not abort or discard a topic when the target message or topic is absent', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const runtime = {
      open: vi.fn(),
      attach: vi.fn(),
      abort: vi.fn(),
      discardTopic: vi.fn(),
      getStatus: vi.fn(),
      reconcileStalePending: vi.fn()
    }
    const handlers = createAssistantIpcHandlers(repos, runtime, createLibraryService(repos))

    expect(handlers.deleteMessage('missing-message')).toBe(false)
    expect(handlers.deleteTopic('missing-topic')).toBe(false)
    expect(handlers.clearTopicMessages('missing-topic')).toBe(0)
    expect(runtime.abort).not.toHaveBeenCalled()
    expect(runtime.discardTopic).not.toHaveBeenCalled()
  })

  it('aborts and discards the exact topic before deleting a conversation or clearing its messages', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create(createDefaultAssistantSeed())
    const deletedTopic = repos.topics.create({ assistantId: assistant.id, name: 'Deleted' })
    const clearedTopic = repos.topics.create({ assistantId: assistant.id, name: 'Cleared' })
    repos.messages.create(clearedTopic.id, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Clear me' }] },
      status: 'success'
    })
    const runtime = {
      open: vi.fn(),
      attach: vi.fn(),
      abort: vi.fn(),
      discardTopic: vi.fn(),
      getStatus: vi.fn(),
      reconcileStalePending: vi.fn()
    }
    const handlers = createAssistantIpcHandlers(repos, runtime, createLibraryService(repos))

    expect(handlers.deleteTopic(deletedTopic.id)).toBe(true)
    expect(handlers.clearTopicMessages(clearedTopic.id)).toBe(1)
    expect(runtime.abort).toHaveBeenNthCalledWith(1, deletedTopic.id)
    expect(runtime.discardTopic).toHaveBeenNthCalledWith(1, deletedTopic.id)
    expect(runtime.abort).toHaveBeenNthCalledWith(2, clearedTopic.id)
    expect(runtime.discardTopic).toHaveBeenNthCalledWith(2, clearedTopic.id)
    expect(repos.topics.getById(deletedTopic.id)).toBeNull()
    expect(repos.messages.listByTopic(clearedTopic.id)).toEqual([])
  })

  it('does not recreate messages or buffered chunks when a late stream result arrives after a topic clear', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Cleared while streaming' })
    let resolveStream: (() => void) | undefined
    let lateDeltaProcessed = false
    let streamPullCount = 0
    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch: vi.fn(async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (streamPullCount++ === 0) {
                return new Promise<void>((resolve) => {
                  resolveStream = () => {
                    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"late"}}]}\n\n'))
                    resolve()
                  }
                })
              }
              lateDeltaProcessed = true
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
              controller.close()
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      ),
      getProviderState: async () => providerState()
    })
    const handlers = createAssistantIpcHandlers(repos, runtime, createLibraryService(repos))

    await handlers.streamOpen({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Clear this stream' }]
    })
    await vi.waitFor(() => expect(resolveStream).toBeTypeOf('function'))
    expect(handlers.clearTopicMessages(topic.id)).toBe(2)

    resolveStream?.()
    // A second pull occurs only after the runtime has handled the late delta.
    await vi.waitFor(() => expect(lateDeltaProcessed).toBe(true))
    await vi.waitFor(() => expect(runtime.attach(topic.id).bufferedChunks).toEqual([]))
    expect(repos.messages.listByTopic(topic.id)).toEqual([])
  })
})

function createLibraryService(repos: ReturnType<typeof createAssistantPlatformRepositories>): AssistantLibraryService {
  const registry = new AssistantTemplateRegistry()
  registry.register({
    templateId: 'default-assistant',
    sourceKind: 'platform',
    version: 1,
    name: { 'zh-CN': '默认助手', 'en-US': 'Default Assistant' },
    prompt: { 'zh-CN': '帮助用户。', 'en-US': 'Help the user.' },
    groups: ['general']
  })
  return new AssistantLibraryService({ registry, repos })
}

function providerState() {
  return {
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' } as const],
        enabled: true,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        models: [
          {
            id: 'gpt-test',
            name: 'GPT Test',
            chatProtocol: 'chat-completions' as const,
            capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
          }
        ],
        defaultChatModelId: 'gpt-test',
        isSystem: false,
        websites: {}
      }
    ]
  }
}
