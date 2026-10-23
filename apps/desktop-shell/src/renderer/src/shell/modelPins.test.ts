import { describe, expect, it } from 'vitest'

import { parsePinnedModelIds, togglePinnedModelId } from './modelPins'

describe('modelPins', () => {
  it('parses a valid pinned-model list and ignores invalid payloads', () => {
    expect(parsePinnedModelIds('["openai:gpt-5","anthropic:claude-sonnet-4"]')).toEqual([
      'openai:gpt-5',
      'anthropic:claude-sonnet-4'
    ])
    expect(parsePinnedModelIds('{"nope":true}')).toEqual([])
    expect(parsePinnedModelIds('not-json')).toEqual([])
  })

  it('toggles pinned model ids while preserving insertion order', () => {
    expect(togglePinnedModelId([], 'openai:gpt-5')).toEqual(['openai:gpt-5'])
    expect(togglePinnedModelId(['openai:gpt-5'], 'anthropic:claude-sonnet-4')).toEqual([
      'openai:gpt-5',
      'anthropic:claude-sonnet-4'
    ])
    expect(togglePinnedModelId(['openai:gpt-5', 'anthropic:claude-sonnet-4'], 'openai:gpt-5')).toEqual([
      'anthropic:claude-sonnet-4'
    ])
  })
})
