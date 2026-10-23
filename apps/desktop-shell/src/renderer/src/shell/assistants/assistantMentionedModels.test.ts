import { describe, expect, it } from 'vitest'

import { assistantMentionedModelIds, toggleAssistantMentionedModel } from './assistantMentionedModels'

describe('assistantMentionedModels', () => {
  it('toggles mentioned models and returns ids', () => {
    const model = { value: 'openai:gpt-a', label: 'GPT A', providerId: 'openai', modelId: 'gpt-a' }
    const next = toggleAssistantMentionedModel([], model)
    expect(assistantMentionedModelIds(next)).toEqual(['openai:gpt-a'])
    expect(toggleAssistantMentionedModel(next, model)).toEqual([])
  })
})
