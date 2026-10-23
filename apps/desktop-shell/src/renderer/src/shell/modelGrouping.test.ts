import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import { groupModels, resolveModelGroupName } from './modelGrouping'

const capabilities = { chat: true, vision: false, embedding: false, tools: true }

function createModel(model: Partial<ModelDefinition> & Pick<ModelDefinition, 'id'>): ModelDefinition {
  return {
    id: model.id,
    name: model.name ?? model.id,
    group: model.group,
    provider: model.provider,
    capabilities: model.capabilities ?? capabilities
  }
}

describe('model grouping', () => {
  it('uses the explicit model group before inferring a group from the model id', () => {
    expect(resolveModelGroupName(createModel({ id: 'deepseek-ai/DeepSeek-R1', group: 'DeepSeek' }), 'Ungrouped')).toBe('DeepSeek')
  })

  it('infers provider/model groups from slash-separated ids', () => {
    expect(resolveModelGroupName(createModel({ id: 'Qwen/Qwen3-235B-A22B-Instruct-2507' }), 'Ungrouped')).toBe('Qwen')
    expect(resolveModelGroupName(createModel({ id: '/maas/deepseek-ai/DeepSeek-R1-0528' }), 'Ungrouped')).toBe('deepseek-ai')
  })

  it('falls back to a stable ungrouped label for plain custom models', () => {
    expect(resolveModelGroupName(createModel({ id: 'my-custom-model' }), 'Ungrouped')).toBe('Ungrouped')
  })

  it('groups models without reordering models inside each category', () => {
    const groups = groupModels(
      [
        createModel({ id: 'deepseek-ai/DeepSeek-V3.2' }),
        createModel({ id: 'Qwen/Qwen3-235B-A22B', group: 'Qwen' }),
        createModel({ id: 'deepseek-ai/DeepSeek-R1' }),
        createModel({ id: 'local-model' })
      ],
      'Ungrouped'
    )

    expect(groups.map((group) => [group.name, group.models.map((model) => model.id)])).toEqual([
      ['deepseek-ai', ['deepseek-ai/DeepSeek-V3.2', 'deepseek-ai/DeepSeek-R1']],
      ['Qwen', ['Qwen/Qwen3-235B-A22B']],
      ['Ungrouped', ['local-model']]
    ])
  })
})
