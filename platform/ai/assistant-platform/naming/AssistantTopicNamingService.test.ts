import { describe, expect, it, vi } from 'vitest'

import { AssistantTopicNamingService } from './AssistantTopicNamingService'

describe('AssistantTopicNamingService', () => {
  it('skips naming when preference is disabled', async () => {
    const service = new AssistantTopicNamingService({
      isEnabled: async () => false,
      getLanguage: async () => 'en-US',
      getNamingModelId: async () => 'openai:gpt-test',
      getProviderState: async () => ({ providers: [] }),
      renameTopic: vi.fn()
    })

    const result = await service.maybeRenameAfterTurn({
      topicId: 'topic-1',
      topicName: 'New topic',
      isNameManuallyEdited: false,
      userText: 'hello',
      assistantText: 'hi',
      modelId: 'openai:gpt-test'
    })

    expect(result).toEqual({ renamed: false, reason: 'disabled' })
  })

  it('skips naming for manually edited topics', async () => {
    const service = new AssistantTopicNamingService({
      isEnabled: async () => true,
      getLanguage: async () => 'en-US',
      getNamingModelId: async () => 'openai:gpt-test',
      getProviderState: async () => ({ providers: [] }),
      renameTopic: vi.fn()
    })

    const result = await service.maybeRenameAfterTurn({
      topicId: 'topic-1',
      topicName: 'Custom title',
      isNameManuallyEdited: true,
      userText: 'hello',
      assistantText: 'hi',
      modelId: 'openai:gpt-test'
    })

    expect(result).toEqual({ renamed: false, reason: 'manual-name' })
  })

  it('renames topic after successful AI title generation', async () => {
    const renameTopic = vi.fn()
    const service = new AssistantTopicNamingService({
      isEnabled: async () => true,
      getLanguage: async () => 'zh-CN',
      getNamingModelId: async () => 'openai:gpt-test',
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' }
            ],
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            models: [
              {
                id: 'gpt-test',
                name: 'GPT Test',
                capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
              }
            ],
            defaultChatModelId: 'gpt-test',
            isSystem: false,
            websites: {}
          }
        ]
      }),
      renameTopic,
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'Market Review Plan' } }] }),
          { headers: { 'content-type': 'application/json' } }
        )
      )
    })

    const result = await service.maybeRenameAfterTurn({
      topicId: 'topic-1',
      topicName: 'New topic',
      isNameManuallyEdited: false,
      userText: 'Review BTC market',
      assistantText: 'Here is a plan',
      modelId: 'openai:gpt-test'
    })

    expect(result.renamed).toBe(true)
    expect(renameTopic).toHaveBeenCalledWith('topic-1', 'Market Review Plan')
  })

  it('suppresses repeated naming within TTL after a successful rename', async () => {
    const renameTopic = vi.fn()
    const service = new AssistantTopicNamingService({
      isEnabled: async () => true,
      getLanguage: async () => 'en-US',
      getNamingModelId: async () => 'openai:gpt-test',
      getProviderState: async () => ({
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            endpoints: [
              { protocol: 'chat-completions', baseUrl: 'https://api.openai.com/v1' }
            ],
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            models: [
              {
                id: 'gpt-test',
                name: 'GPT Test',
                capabilities: { chat: true, vision: false, embedding: false, tools: false, agentRuntimes: {} }
              }
            ],
            defaultChatModelId: 'gpt-test',
            isSystem: false,
            websites: {}
          }
        ]
      }),
      renameTopic,
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'Title A' } }] }), {
          headers: { 'content-type': 'application/json' }
        })
      ),
      now: () => 1_000
    })

    await service.maybeRenameAfterTurn({
      topicId: 'topic-1',
      topicName: 'New topic',
      isNameManuallyEdited: false,
      userText: 'hello',
      assistantText: 'hi',
      modelId: 'openai:gpt-test'
    })

    const second = await service.maybeRenameAfterTurn({
      topicId: 'topic-1',
      topicName: 'New topic',
      isNameManuallyEdited: false,
      userText: 'hello again',
      assistantText: 'hi again',
      modelId: 'openai:gpt-test'
    })

    expect(second).toEqual({ renamed: false, reason: 'already-named' })
  })
})
