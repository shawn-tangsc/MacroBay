import { describe, expect, it } from 'vitest'

import { removeAgentMentionedModelToken, toggleAgentMentionedModel, type AgentMentionedModel } from './agentMentionedModels'

const claude: AgentMentionedModel = {
  value: 'anthropic:claude-sonnet-4',
  label: 'Claude Sonnet 4',
  providerId: 'anthropic',
  providerName: 'Anthropic'
}

const gpt: AgentMentionedModel = {
  value: 'openai:gpt-5',
  label: 'GPT-5',
  providerId: 'openai',
  providerName: 'OpenAI'
}

describe('toggleAgentMentionedModel', () => {
  it('adds a model when it was not selected yet', () => {
    expect(toggleAgentMentionedModel([], claude)).toEqual([claude])
  })

  it('removes a model when it was already selected', () => {
    expect(toggleAgentMentionedModel([claude, gpt], claude)).toEqual([gpt])
  })
})

describe('removeAgentMentionedModelToken', () => {
  it('removes the active @ token from the draft', () => {
    expect(removeAgentMentionedModelToken('ask @cla', 8)).toBe('ask ')
  })

  it('falls back to the original trigger position when the caret moved', () => {
    expect(removeAgentMentionedModelToken('ask @cla more', 12, 4)).toBe('ask  more')
  })
})
