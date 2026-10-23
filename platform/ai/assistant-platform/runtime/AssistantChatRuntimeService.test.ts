import { describe, expect, it, vi } from 'vitest'

import { createAssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import { createAssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import { createDefaultAssistantSeed } from '../seeds/defaultAssistantSeed'
import { createAssistantChatRuntimeService } from './AssistantChatRuntimeService'
import { ASSISTANT_INVOCATION_FAILURE_EVIDENCE_V1 } from './assistantInvocationFailureEvidence'

describe('createAssistantChatRuntimeService', () => {
  it('opens a submit-message stream and persists assistant output', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    repos.assistants.create(createDefaultAssistantSeed())
    const topic = repos.topics.create({ assistantId: createDefaultAssistantSeed().id, name: 'New topic' })

    const fetch = vi.fn(async () =>
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
          'data: [DONE]\n\n'
        ].join(''),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    )

    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch,
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' } as const
            ],
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
      })
    })

    const assistant = repos.assistants.getById(createDefaultAssistantSeed().id)!
    repos.assistants.update(assistant.id, { modelId: 'openai:gpt-test' })

    const response = await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Hi there' }]
    })

    expect(response.mode).toBe('started')
    await vi.waitFor(() => {
      const messages = repos.messages.listByTopic(topic.id)
      const assistantMessage = messages.find((item) => item.role === 'assistant')
      expect(assistantMessage?.status).toBe('success')
      expect(assistantMessage?.data.parts[0]).toMatchObject({ type: 'text', text: 'Hello world' })
    })
  })

  it('resolves a vaulted provider key only when executing the selected assistant model', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Runtime key resolution' })
    const runtimeKeyFixture = 'fixture-assistant-runtime-key-1234567890'
    const metadataProvider = {
      ...providerState().providers[0]!,
      apiKey: undefined,
      apiKeyRef: 'provider:6f70656e6169'
    }
    const getProviderState = Object.assign(async () => ({ providers: [metadataProvider] }), {
      resolveRuntimeProvider: vi.fn(async () => ({ ...metadataProvider, apiKey: runtimeKeyFixture }))
    })
    const fetch: typeof globalThis.fetch = vi.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"resolved"}}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } }
    ))
    const runtime = createAssistantChatRuntimeService({ repos, getProviderState, fetch })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Resolve one provider key.' }]
    })

    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')?.status).toBe('success')
    })
    expect(getProviderState.resolveRuntimeProvider).toHaveBeenCalledWith('openai')
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ authorization: `Bearer ${runtimeKeyFixture}` })
    }))
  })

  it('sends an assistant-bound DeepSeek Pro model through the OpenAI-compatible runtime without using the provider default', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'deepseek:deepseek-v4-pro' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Bound DeepSeek Pro' })
    const metadataProvider = {
      ...providerState().providers[0]!,
      id: 'deepseek',
      defaultChatModelId: 'deepseek-v4-flash',
      apiKey: undefined,
      apiKeyRef: 'provider:646565707365656b',
      models: [
        { ...providerState().providers[0]!.models[0]!, id: 'deepseek-v4-flash', name: 'DeepSeek Flash' },
        { ...providerState().providers[0]!.models[0]!, id: 'deepseek-v4-pro', name: 'DeepSeek Pro' }
      ]
    }
    const getProviderState = Object.assign(async () => ({ providers: [metadataProvider] }), {
      resolveRuntimeProvider: vi.fn(async () => ({ ...metadataProvider, apiKey: 'fixture-deepseek-runtime-key' }))
    })
    const requestBodies: unknown[] = []
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      requestBodies.push(init?.body)
      return new Response(
        'data: {"choices":[{"delta":{"content":"pro response"}}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } }
      )
    }
    const runtime = createAssistantChatRuntimeService({ repos, getProviderState, fetch })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Use the bound model.' }]
    })

    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')?.status).toBe('success')
    })
    expect(getProviderState.resolveRuntimeProvider).toHaveBeenCalledWith('deepseek')
    expect(JSON.parse(String(requestBodies[0]))).toMatchObject({ model: 'deepseek-v4-pro' })
  })

  it('fans out to multiple mentioned models', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    repos.assistants.create(createDefaultAssistantSeed())
    const topic = repos.topics.create({ assistantId: createDefaultAssistantSeed().id, name: 'New topic' })

    const fetch = vi.fn(async () =>
      new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
    )

    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch,
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' } as const
            ],
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            models: [
              {
                id: 'gpt-a',
                name: 'GPT A',
                chatProtocol: 'chat-completions' as const,
                capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
              },
              {
                id: 'gpt-b',
                name: 'GPT B',
                chatProtocol: 'chat-completions' as const,
                capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
              }
            ],
            defaultChatModelId: 'gpt-a',
            isSystem: false,
            websites: {}
          }
        ]
      })
    })

    const response = await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      mentionedModelIds: ['openai:gpt-a', 'openai:gpt-b'],
      userMessageParts: [{ type: 'text', text: 'Compare models' }]
    })

    expect(response.mode).toBe('started')
    expect(response.placeholderIds).toHaveLength(2)
    await vi.waitFor(() => {
      const assistants = repos.messages.listByTopic(topic.id).filter((item) => item.role === 'assistant')
      expect(assistants).toHaveLength(2)
      expect(assistants.every((item) => item.status === 'success')).toBe(true)
    })
  })

  it('uses mentioned models before the assistant default model', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({
      ...createDefaultAssistantSeed(),
      modelId: 'openai:gpt-default'
    })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'New topic' })

    const fetch = vi.fn(async () =>
      new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
    )

    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch,
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' } as const
            ],
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            models: [
              {
                id: 'gpt-default',
                name: 'GPT Default',
                chatProtocol: 'chat-completions' as const,
                capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
              },
              {
                id: 'gpt-mentioned',
                name: 'GPT Mentioned',
                chatProtocol: 'chat-completions' as const,
                capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
              }
            ],
            defaultChatModelId: 'gpt-default',
            isSystem: false,
            websites: {}
          }
        ]
      })
    })

    const response = await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      mentionedModelIds: ['openai:gpt-mentioned'],
      userMessageParts: [{ type: 'text', text: 'Use mentioned model' }]
    })

    expect(response.mode).toBe('started')
    await vi.waitFor(() => {
      const assistantMessage = repos.messages.listByTopic(topic.id).find((item) => item.role === 'assistant')
      expect(assistantMessage?.modelId).toBe('openai:gpt-mentioned')
      expect(assistantMessage?.status).toBe('success')
    })
  })

  it('uses the assistant default model when no mentioned model is provided', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({
      ...createDefaultAssistantSeed(),
      modelId: 'openai:gpt-assistant-default'
    })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'New topic' })

    const fetch = vi.fn(async () =>
      new Response('data: {"choices":[{"delta":{"content":"assistant default ok"}}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
    )

    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch,
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' } as const
            ],
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            models: [
              {
                id: 'gpt-platform-default',
                name: 'GPT Platform Default',
                chatProtocol: 'chat-completions' as const,
                capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
              },
              {
                id: 'gpt-assistant-default',
                name: 'GPT Assistant Default',
                chatProtocol: 'chat-completions' as const,
                capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
              }
            ],
            defaultChatModelId: 'gpt-platform-default',
            isSystem: false,
            websites: {}
          }
        ]
      })
    })

    const response = await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Use assistant default' }]
    })

    expect(response.mode).toBe('started')
    await vi.waitFor(() => {
      const assistantMessage = repos.messages.listByTopic(topic.id).find((item) => item.role === 'assistant')
      expect(assistantMessage?.modelId).toBe('openai:gpt-assistant-default')
      expect(assistantMessage?.status).toBe('success')
    })
  })

  it('falls back to the ready provider default chat model when the assistant has no bound model', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    repos.assistants.create(createDefaultAssistantSeed())
    const topic = repos.topics.create({ assistantId: createDefaultAssistantSeed().id, name: 'New topic' })

    const fetch = vi.fn(async () =>
      new Response('data: {"choices":[{"delta":{"content":"fallback ok"}}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' }
      })
    )

    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch,
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' } as const
            ],
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            models: [
              {
                id: 'gpt-default',
                name: 'GPT Default',
                chatProtocol: 'chat-completions' as const,
                capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
              }
            ],
            defaultChatModelId: 'gpt-default',
            isSystem: false,
            websites: {}
          }
        ]
      })
    })

    const response = await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Hi there' }]
    })

    expect(response.mode).toBe('started')
    await vi.waitFor(() => {
      const assistantMessage = repos.messages.listByTopic(topic.id).find((item) => item.role === 'assistant')
      expect(assistantMessage?.modelId).toBe('openai:gpt-default')
      expect(assistantMessage?.status).toBe('success')
    })
  })

  it('does not advertise web search tools when assistant web search is disabled', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create(createDefaultAssistantSeed())
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'New topic' })
    let requestBody: unknown
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      requestBody = init?.body
      return Response.json({ choices: [{ message: { content: 'plain' } }] })
    })

    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch,
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' } as const
            ],
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            models: [
              {
                id: 'gpt-test',
                name: 'GPT Test',
                chatProtocol: 'chat-completions' as const,
                capabilities: { chat: true, vision: false, embedding: false, tools: true, agentRuntimes: {} }
              }
            ],
            defaultChatModelId: 'gpt-test',
            isSystem: false,
            websites: {}
          }
        ]
      })
    })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Hi there' }]
    })

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse(requestBody as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('tools')
  })

  it('supports programmatic latest-user-only context without hydrating topic history', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({
      ...createDefaultAssistantSeed(),
      modelId: 'openai:gpt-test'
    })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Programmatic topic' })

    const root = repos.messages.create(topic.id, {
      parentId: null,
      role: 'user',
      data: { parts: [{ type: 'text', text: 'old structured payload '.repeat(200) }] },
      status: 'success'
    })
    repos.messages.create(topic.id, {
      parentId: root.id,
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'old answer should not be reused' }] },
      status: 'success'
    })
    const originalListByTopic = repos.messages.listByTopic.bind(repos.messages)
    const listByTopic = vi.fn(originalListByTopic)
    repos.messages.listByTopic = listByTopic

    let requestBody: unknown
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      requestBody = init?.body
      return Response.json({ choices: [{ message: { content: 'fresh answer' } }] })
    })

    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch,
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' } as const
            ],
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
      })
    })

    const response = await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      contextMode: 'latest-user-only',
      userMessageParts: [{ type: 'text', text: 'current structured input' }]
    })

    expect(response.mode).toBe('started')
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled()
      expect(repos.messages.getById(response.placeholderIds![0]!)?.status).toBe('success')
    })
    expect(listByTopic).not.toHaveBeenCalled()
    const body = JSON.parse(requestBody as string) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(body.messages.map((message) => message.content)).toEqual([
      createDefaultAssistantSeed().prompt,
      'current structured input'
    ])
    expect(JSON.stringify(body)).not.toContain('old structured payload')
  })

  it('executes web_search when assistant web search is enabled and stores safe message parts', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({
      ...createDefaultAssistantSeed(),
      settings: { ...createDefaultAssistantSeed().settings, enableWebSearch: true }
    })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'New topic' })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'web_search', arguments: '{"query":"docs"}' }
                  }
                ]
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'Answer with citation.' } }] }))
    const webSearchService = {
      searchKeywords: vi.fn(async () => ({
        providerId: 'tavily',
        capability: 'searchKeywords',
        inputs: ['docs'],
        results: [{ title: 'Docs', url: 'https://example.com/docs', content: 'source content', sourceInput: 'docs' }]
      })),
      fetchUrls: vi.fn()
    }

    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch,
      webSearchService: webSearchService as never,
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' } as const
            ],
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            models: [
              {
                id: 'gpt-test',
                name: 'GPT Test',
                chatProtocol: 'chat-completions' as const,
                capabilities: { chat: true, vision: false, embedding: false, tools: true, agentRuntimes: {} }
              }
            ],
            defaultChatModelId: 'gpt-test',
            isSystem: false,
            websites: {}
          }
        ]
      })
    })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Current docs?' }]
    })

    await vi.waitFor(() => {
      const assistantMessage = repos.messages.listByTopic(topic.id).find((item) => item.role === 'assistant')
      expect(assistantMessage?.status).toBe('success')
      expect(assistantMessage?.data.parts).toEqual([
        {
          type: 'web-search',
          toolName: 'web_search',
          status: 'success',
          providerId: 'tavily',
          query: 'docs',
          sources: [{ id: 1, title: 'Docs', url: 'https://example.com/docs', snippet: 'source content' }],
          elapsedMs: expect.any(Number)
        },
        { type: 'text', text: 'Answer with citation.' }
      ])
    })
    expect(webSearchService.searchKeywords).toHaveBeenCalledWith(
      { keywords: ['docs'] },
      expect.objectContaining({ consumer: expect.objectContaining({ kind: 'assistant', id: assistant.id, sessionId: topic.id }) })
    )
  })

  it('stores compact snippets instead of full Web Search source bodies', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({
      ...createDefaultAssistantSeed(),
      settings: { ...createDefaultAssistantSeed().settings, enableWebSearch: true }
    })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'New topic' })
    const longContent = 'Long source body '.repeat(40)
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'web_search', arguments: '{"query":"docs"}' }
                  }
                ]
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'Answer with citation.' } }] }))
    const webSearchService = {
      searchKeywords: vi.fn(async () => ({
        providerId: 'tavily',
        capability: 'searchKeywords',
        inputs: ['docs'],
        results: [{ title: 'Docs', url: 'https://example.com/docs', content: longContent, sourceInput: 'docs' }]
      })),
      fetchUrls: vi.fn()
    }

    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch,
      webSearchService: webSearchService as never,
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' } as const
            ],
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            models: [
              {
                id: 'gpt-test',
                name: 'GPT Test',
                chatProtocol: 'chat-completions' as const,
                capabilities: { chat: true, vision: false, embedding: false, tools: true, agentRuntimes: {} }
              }
            ],
            defaultChatModelId: 'gpt-test',
            isSystem: false,
            websites: {}
          }
        ]
      })
    })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Current docs?' }]
    })

    await vi.waitFor(() => {
      const assistantMessage = repos.messages.listByTopic(topic.id).find((item) => item.role === 'assistant')
      const webSearchPart = assistantMessage?.data.parts.find((part) => part.type === 'web-search')
      expect(webSearchPart).toBeDefined()
      expect(JSON.stringify(webSearchPart)).not.toContain(longContent)
    })
  })

  it('reconciles stale pending messages on startup', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    repos.assistants.create(createDefaultAssistantSeed())
    const topic = repos.topics.create({ assistantId: createDefaultAssistantSeed().id })
    repos.messages.create(topic.id, {
      role: 'assistant',
      data: { parts: [] },
      status: 'pending'
    })

    const runtime = createAssistantChatRuntimeService({
      repos,
      getProviderState: async () => ({ providers: [] })
    })

    expect(runtime.reconcileStalePending()).toBe(1)
    const message = repos.messages.listByTopic(topic.id)[0]
    expect(message?.status).toBe('error')
  })

  it('discards one topic stream without retaining or mutating its late result', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const discardedTopic = repos.topics.create({ assistantId: assistant.id, name: 'Discarded' })
    const retainedTopic = repos.topics.create({ assistantId: assistant.id, name: 'Retained' })
    let resolveStream: (() => void) | undefined
    const fetch = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            resolveStream = () => {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"late"}}]}\n\n'))
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
              controller.close()
            }
          }
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    )
    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch,
      getProviderState: async () => providerState()
    })

    await runtime.open({
      topicId: discardedTopic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Delete this stream' }]
    })
    await vi.waitFor(() => expect(resolveStream).toBeTypeOf('function'))
    runtime.abort(discardedTopic.id)
    runtime.discardTopic(discardedTopic.id)
    resolveStream?.()

    await vi.waitFor(() => expect(runtime.attach(discardedTopic.id).bufferedChunks).toEqual([]))
    expect(repos.messages.listByTopic(discardedTopic.id).find((message) => message.role === 'assistant')?.status).toBe('paused')
    expect(runtime.getStatus(retainedTopic.id).topicId).toBe(retainedTopic.id)
  })

  it('does not persist a provider result that arrives after its topic was aborted', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Aborted' })
    let resolveStream: (() => void) | undefined
    const fetch = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            resolveStream = () => {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"late"}}]}\n\n'))
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
              controller.close()
            }
          }
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    )
    const runtime = createAssistantChatRuntimeService({ repos, fetch, getProviderState: async () => providerState() })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Abort this stream' }]
    })
    await vi.waitFor(() => expect(resolveStream).toBeTypeOf('function'))
    runtime.abort(topic.id)
    resolveStream?.()

    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')?.status).not.toBe('success')
    })
    runtime.discardTopic(topic.id)
  })

  it('marks a manually aborted stream placeholder as paused when its provider honors cancellation', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Stopped' })
    const fetch = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    )
    const runtime = createAssistantChatRuntimeService({ repos, fetch, getProviderState: async () => providerState() })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Stop this stream' }]
    })
    await vi.waitFor(() => expect(runtime.getStatus(topic.id).status).toBe('streaming'))
    expect(runtime.abort(topic.id)).toBe(true)

    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')?.status).toBe('paused')
    })
  })

  it('preserves a persisted partial response when a user stops an active stream', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Stopped with partial output' })
    let releaseTerminalRead: (() => void) | undefined
    let terminalDoneConsumed = false
    let streamPullCount = 0
    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch: vi.fn(async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (streamPullCount++ === 0) {
                controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n'))
                return new Promise<void>((resolve) => {
                  releaseTerminalRead = resolve
                })
              }
              if (streamPullCount === 2) {
                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
                return
              }
              terminalDoneConsumed = true
              controller.close()
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      ),
      getProviderState: async () => providerState()
    })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Stop after the partial' }]
    })
    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')).toMatchObject({
        status: 'pending',
        data: { parts: [{ type: 'text', text: 'partial answer' }] }
      })
    })

    expect(runtime.abort(topic.id)).toBe(true)
    releaseTerminalRead?.()
    // A third pull can only happen after the runtime has consumed the [DONE] event.
    await vi.waitFor(() => expect(terminalDoneConsumed).toBe(true))
    // Yield after stream completion so a late terminal result would attempt its write.
    await new Promise<void>((resolve) => setImmediate(resolve))

    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')).toMatchObject({
        status: 'paused',
        data: { parts: [{ type: 'text', text: 'partial answer' }] }
      })
    })
  })

  it('keeps cancellation presentation localized by persisting an interruption state without English text', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Stopped' })
    const fetch = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    )
    const runtime = createAssistantChatRuntimeService({ repos, fetch, getProviderState: async () => providerState() })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Stop this stream' }]
    })
    await vi.waitFor(() => expect(runtime.getStatus(topic.id).status).toBe('streaming'))
    runtime.abort(topic.id)

    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')).toMatchObject({
        status: 'paused',
        data: { parts: [{ type: 'interruption', message: '' }] }
      })
    })
  })

  it('does not persist a provider error that echoes the runtime key', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Safe provider error' })
    const runtimeKeyFixture = 'fixture-assistant-runtime-key-1234567890'
    const runtime = createAssistantChatRuntimeService({
      repos,
      getProviderState: async () => ({
        providers: [{ ...providerState().providers[0]!, apiKey: runtimeKeyFixture }]
      }),
      fetch: vi.fn(async () => new Response(
        JSON.stringify({ error: { message: `upstream echoed ${runtimeKeyFixture}` } }),
        { status: 401 }
      ))
    })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Keep provider errors safe.' }]
    })

    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')?.status).toBe('error')
    })
    const errorMessage = repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')
    expect(JSON.stringify(errorMessage)).not.toContain(runtimeKeyFixture)
    expect(errorMessage?.data.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', code: 'provider-request-failed', message: '' })
    ]))
    expect(errorMessage?.searchableText).toBe('')
  })

  it('persists the model lifecycle code when the upstream model was retired', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Retired model' })
    const runtime = createAssistantChatRuntimeService({
      repos,
      getProviderState: async () => ({
        providers: [{ ...providerState().providers[0]!, apiKey: 'fixture-assistant-key' }]
      }),
      fetch: vi.fn(async () => new Response(
        JSON.stringify({ error: { message: 'This model has been retired and is no longer available.' } }),
        { status: 404 }
      ))
    })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Use a retired model.' }]
    })

    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')?.status).toBe('error')
    })
    const errorMessage = repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')
    expect(errorMessage?.data.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', code: 'provider-model-retired', message: '' })
    ]))
  })

  it('persists only a configuration failure code when a vaulted runtime key is unavailable', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Missing runtime key' })
    const fixtureRef = 'provider:666978747572652d617373697374616e74'
    const metadataProvider = { ...providerState().providers[0]!, apiKey: undefined, apiKeyRef: fixtureRef }
    const getProviderState = Object.assign(async () => ({ providers: [metadataProvider] }), {
      resolveRuntimeProvider: vi.fn(async () => metadataProvider)
    })
    const fetch = vi.fn()
    const runtime = createAssistantChatRuntimeService({ repos, getProviderState, fetch })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Do not send an empty key.' }]
    })

    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')?.status).toBe('error')
    })
    const errorMessage = repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')
    expect(getProviderState.resolveRuntimeProvider).toHaveBeenCalledWith('openai')
    expect(fetch).not.toHaveBeenCalled()
    expect(errorMessage?.data.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', code: 'provider-configuration-required', message: '' })
    ]))
    expect(JSON.stringify(errorMessage)).not.toContain(fixtureRef)
  })

  it('does not retain ordinary chat failure evidence for a programmatic consumer', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Ordinary failure evidence' })
    const runtime = createAssistantChatRuntimeService({
      repos,
      getProviderState: async () => ({ providers: [{ ...providerState().providers[0]!, apiKey: 'ordinary-key' }] }),
      fetch: vi.fn(async () => new Response('ordinary provider failure', { status: 503 }))
    })

    await runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Ordinary chat failure' }]
    })
    await vi.waitFor(() => {
      expect(repos.messages.listByTopic(topic.id).find((message) => message.role === 'assistant')?.status).toBe('error')
    })
    const message = repos.messages.listByTopic(topic.id).find((item) => item.role === 'assistant')
    expect(message).toBeTruthy()
    expect(runtime.consumeInvocationFailureEvidence?.(message!.id)).toBeUndefined()
  })

  it('bounds transient programmatic failure evidence to the named runtime retention policy', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Bounded evidence' })
    const runtime = createAssistantChatRuntimeService({
      repos,
      getProviderState: async () => ({ providers: [{ ...providerState().providers[0]!, apiKey: 'programmatic-key' }] }),
      fetch: vi.fn(async () => new Response('programmatic provider failure', { status: 503 }))
    })
    const messageIds: string[] = []

    for (let index = 0; index < ASSISTANT_INVOCATION_FAILURE_EVIDENCE_V1.maximumRetainedEntries + 1; index += 1) {
      await runtime.open({
        topicId: topic.id,
        trigger: 'submit-message',
        contextMode: 'latest-user-only',
        userMessageParts: [{ type: 'text', text: `Programmatic failure ${index}` }]
      })
      await vi.waitFor(() => {
        const assistantMessages = repos.messages.listByTopic(topic.id).filter((message) => message.role === 'assistant')
        expect(assistantMessages.at(-1)?.status).toBe('error')
        messageIds.push(assistantMessages.at(-1)!.id)
      })
    }

    expect(runtime.consumeInvocationFailureEvidence?.(messageIds[0]!)).toBeUndefined()
    expect(runtime.consumeInvocationFailureEvidence?.(messageIds.at(-1)!)).toMatchObject({ httpStatus: 503 })
  })

  it.each([
    ['a disabled bound provider', { enabled: false }],
    ['a bound provider without metadata key', { apiKey: undefined, apiKeyRef: undefined }],
    ['a bound provider without an endpoint', { baseUrl: ' ' }]
  ])('returns the safe configuration code before creating placeholders for %s', async (_name, patch) => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:gpt-test' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Invalid bound provider' })
    const runtime = createAssistantChatRuntimeService({
      repos,
      fetch: vi.fn(),
      getProviderState: async () => ({ providers: [{ ...providerState().providers[0]!, ...patch }] })
    })

    await expect(runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Do not create a placeholder.' }]
    })).rejects.toThrow('provider-configuration-required')

    expect(repos.messages.listByTopic(topic.id)).toEqual([])
  })

  it('persists a bound-model failure without falling back to the provider default', async () => {
    const db = createAssistantPlatformDatabase(':memory:')
    const repos = createAssistantPlatformRepositories(db)
    const assistant = repos.assistants.create({ ...createDefaultAssistantSeed(), modelId: 'openai:missing-model' })
    const topic = repos.topics.create({ assistantId: assistant.id, name: 'Missing bound model' })
    const fetch = vi.fn()
    const runtime = createAssistantChatRuntimeService({ repos, fetch, getProviderState: async () => providerState() })

    await expect(runtime.open({
      topicId: topic.id,
      trigger: 'submit-message',
      userMessageParts: [{ type: 'text', text: 'Do not replace the bound model.' }]
    })).rejects.toThrow('assistant-bound-model-not-ready')

    expect(fetch).not.toHaveBeenCalled()
    expect(repos.messages.listByTopic(topic.id)).toEqual([])
  })
})

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
