import { describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { classifyAgentAttachment, supportsVisionAttachments } from './agentAttachmentPolicy'

function provider(input: Partial<SafeModelProvider> & Pick<SafeModelProvider, 'id' | 'name'>): SafeModelProvider {
  return {
    id: input.id,
    name: input.name,
    endpoints: input.endpoints ?? [{ protocol: 'chat-completions', baseUrl: 'https://example.test' }],
    enabled: input.enabled ?? true,
    baseUrl: input.baseUrl ?? 'https://example.test',
    hasApiKey: input.hasApiKey ?? true,
    apiKeyPreview: input.apiKeyPreview ?? 'sk...test',
    isSystem: input.isSystem ?? false,
    websites: input.websites,
    models: input.models ?? [],
    defaultChatModelId: input.defaultChatModelId
  }
}

describe('agentAttachmentPolicy', () => {
  it('detects whether the selected model supports vision attachments', () => {
    const providers = [
      provider({
        id: 'openai',
        name: 'OpenAI',
        models: [
          {
            id: 'gpt-plain',
            name: 'GPT Plain',
            capabilities: { chat: true, vision: false, embedding: false, tools: true }
          },
          {
            id: 'gpt-vision',
            name: 'GPT Vision',
            capabilities: { chat: true, vision: true, embedding: false, tools: true }
          }
        ]
      })
    ]

    expect(supportsVisionAttachments('openai:gpt-plain', providers)).toBe(false)
    expect(supportsVisionAttachments('openai:gpt-vision', providers)).toBe(true)
    expect(supportsVisionAttachments('unknown:model', providers)).toBe(false)
  })

  it('classifies text, document, and image attachments by extension', () => {
    expect(classifyAgentAttachment('/tmp/note.md', false)).toBe('text')
    expect(classifyAgentAttachment('/tmp/report.pdf', false)).toBe('document')
    expect(classifyAgentAttachment('/tmp/chart.png', true)).toBe('image')
  })

  it('rejects image attachments when the current model is not vision-capable', () => {
    expect(classifyAgentAttachment('/tmp/chart.png', false)).toBe('unsupported')
  })

  it('treats extensionless files as text candidates', () => {
    expect(classifyAgentAttachment('/tmp/Dockerfile', false)).toBe('text')
  })
})
