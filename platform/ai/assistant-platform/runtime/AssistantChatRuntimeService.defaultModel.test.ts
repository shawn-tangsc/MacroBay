import { describe, expect, it, vi } from 'vitest'

import { createAssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import { createAssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import { createDefaultAssistantSeed } from '../seeds/defaultAssistantSeed'
import { createAssistantChatRuntimeService } from './AssistantChatRuntimeService'

function chatProvider(input: { id: string; baseUrl: string; modelId: string; defaultModelId?: string }) {
  return {
    id: input.id,
    name: input.id.toUpperCase(),
    endpoints: [{ protocol: 'chat-completions', baseUrl: input.baseUrl } as const],
    enabled: true,
    baseUrl: input.baseUrl,
    apiKey: 'test-key',
    models: [
      {
        id: input.modelId,
        name: `Model ${input.modelId}`,
        chatProtocol: 'chat-completions' as const,
        capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
      }
    ],
    defaultChatModelId: input.defaultModelId ?? input.modelId,
    isSystem: false,
    websites: {}
  }
}

/** 两个供应商：`first` 排在前面（旧行为会选它），`second` 才是用户设置的默认。 */
function twoProviders() {
  return {
    providers: [
      chatProvider({ id: 'first', baseUrl: 'https://first.test/v1', modelId: 'first-model' }),
      chatProvider({ id: 'second', baseUrl: 'https://second.test/v1', modelId: 'second-model' })
    ]
  }
}

function streamingFetch() {
  return vi.fn<typeof fetch>(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' }
    })
  )
}

async function openAndReadModelId(input: {
  assistantModelId?: string | null
  configuredDefault?: string
  providers?: ReturnType<typeof twoProviders>
}) {
  const db = createAssistantPlatformDatabase(':memory:')
  const repos = createAssistantPlatformRepositories(db)
  const seed = createDefaultAssistantSeed()
  const assistant = repos.assistants.create({ ...seed, modelId: input.assistantModelId ?? null })
  const topic = repos.topics.create({ assistantId: assistant.id, name: 'Topic' })
  const fetch = streamingFetch()
  const runtime = createAssistantChatRuntimeService({
    repos,
    fetch,
    getProviderState: async () => input.providers ?? twoProviders(),
    getDefaultAssistantModelId: () => input.configuredDefault ?? ''
  })

  const response = await runtime.open({
    topicId: topic.id,
    trigger: 'submit-message',
    userMessageParts: [{ type: 'text', text: 'hi' }]
  })
  if (response.mode !== 'started') throw new Error(`unexpected mode: ${response.mode}`)

  await vi.waitFor(() => {
    const message = repos.messages.listByTopic(topic.id).find((item) => item.role === 'assistant')
    expect(message?.status).toBe('success')
  })
  const message = repos.messages.listByTopic(topic.id).find((item) => item.role === 'assistant')
  return { modelId: message?.modelId ?? null, fetch }
}

describe('assistant default model wiring', () => {
  it('uses the configured default assistant model when the assistant has none', async () => {
    const { modelId, fetch } = await openAndReadModelId({ configuredDefault: 'second:second-model' })

    expect(modelId).toBe('second:second-model')
    expect(String(fetch.mock.calls[0]?.[0])).toContain('second.test')
  })

  it('keeps an explicitly bound assistant model ahead of the configured default', async () => {
    const { modelId } = await openAndReadModelId({
      assistantModelId: 'first:first-model',
      configuredDefault: 'second:second-model'
    })

    expect(modelId).toBe('first:first-model')
  })

  it('falls back to the provider default when the configured default is not usable', async () => {
    const { modelId, fetch } = await openAndReadModelId({ configuredDefault: 'second:retired-model' })

    expect(modelId).toBe('first:first-model')
    expect(String(fetch.mock.calls[0]?.[0])).toContain('first.test')
  })

  it('falls back to the provider default when no default is configured', async () => {
    const { modelId } = await openAndReadModelId({})

    expect(modelId).toBe('first:first-model')
  })
})
