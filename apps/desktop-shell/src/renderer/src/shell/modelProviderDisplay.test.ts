import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import { groupModelsForDisplay } from './modelProviderDisplay'

const capabilities = { chat: true, vision: false, embedding: false, tools: true }

function createModel(input: Partial<ModelDefinition> & Pick<ModelDefinition, 'id'>): ModelDefinition {
  return {
    id: input.id,
    name: input.name ?? input.id,
    group: input.group,
    provider: input.provider,
    capabilities: input.capabilities ?? capabilities
  }
}

describe('model provider display helpers', () => {
  it('keeps provider model order stable while promoting pinned models inside their original group', () => {
    const groups = groupModelsForDisplay(
      [
        createModel({ id: 'deepseek-ai/DeepSeek-V3.2' }),
        createModel({ id: 'Qwen/Qwen3-235B-A22B', group: 'Qwen' }),
        createModel({ id: 'deepseek-ai/DeepSeek-R1' }),
        createModel({ id: 'deepseek-ai/DeepSeek-V4-Pro' })
      ],
      'Ungrouped',
      ['silicon:deepseek-ai/DeepSeek-V4-Pro', 'silicon:deepseek-ai/DeepSeek-R1'],
      'silicon'
    )

    expect(groups.map((group) => [group.name, group.models.map((model) => model.id)])).toEqual([
      ['deepseek-ai', ['deepseek-ai/DeepSeek-V4-Pro', 'deepseek-ai/DeepSeek-R1', 'deepseek-ai/DeepSeek-V3.2']],
      ['Qwen', ['Qwen/Qwen3-235B-A22B']]
    ])
  })
})
