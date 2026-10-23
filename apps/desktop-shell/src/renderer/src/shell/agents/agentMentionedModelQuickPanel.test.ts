import { describe, expect, it } from 'vitest'

import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import {
  buildModelPickerOptions,
  type ModelPickerGroup
} from '../components/ModelPicker/modelPickerOptions'
import { AGENT_MENTION_MODEL_CONSTRAINTS } from './useAgentMentionModels'
import { filterAgentQuickPanelItems } from './agentQuickPanel'
import { buildAgentMentionModelQuickPanelItems } from './agentMentionedModelQuickPanel'
import type { AgentMentionedModel } from './agentMentionedModels'

const text = {
  clearLabel: 'Clear all',
  clearDescription: 'Clear selected mentioned models',
  addLabel: 'Add model...',
  addDescription: 'Open model service settings',
  pinnedSectionLabel: 'Pinned'
}

function option(
  providerId: string,
  providerName: string,
  modelId: string,
  modelName: string
): ModelPickerGroup['options'][number] {
  return {
    value: `${providerId}:${modelId}`,
    providerId,
    providerName,
    modelId,
    modelName,
    categories: [],
    priceTag: null,
    protocols: ['messages'],
    searchText: `${modelName} ${modelId} ${providerName} ${providerId}`.toLowerCase()
  }
}

const groups: ModelPickerGroup[] = [
  {
    providerId: 'anthropic',
    providerName: 'Anthropic',
    options: [option('anthropic', 'Anthropic', 'claude-sonnet-4', 'Claude Sonnet 4')]
  },
  {
    providerId: 'openai',
    providerName: 'OpenAI',
    options: [option('openai', 'OpenAI', 'gpt-5', 'GPT-5')]
  }
]

const selected: AgentMentionedModel[] = [
  {
    value: 'anthropic:claude-sonnet-4',
    label: 'Claude Sonnet 4',
    providerId: 'anthropic',
    providerName: 'Anthropic'
  }
]

describe('buildAgentMentionModelQuickPanelItems', () => {
  it('includes clear and add actions around the model list', () => {
    const items = buildAgentMentionModelQuickPanelItems(groups, selected, text)

    expect(items.map((item) => item.id)).toEqual([
      'action:clear-mentioned-models',
      'mention:anthropic:claude-sonnet-4',
      'mention:openai:gpt-5',
      'action:open-model-service'
    ])
  })

  it('marks selected models while keeping actions unselected', () => {
    const items = buildAgentMentionModelQuickPanelItems(groups, selected, text)

    expect(items[0].selected).toBeFalsy()
    expect(items[1].selected).toBe(true)
    expect(items[2].selected).toBeFalsy()
    expect(items[3].selected).toBeFalsy()
  })

  it('places pinned models before regular provider-ordered models without duplicating them', () => {
    const items = buildAgentMentionModelQuickPanelItems(groups, selected, text, ['openai:gpt-5'])

    expect(items.map((item) => item.id)).toEqual([
      'action:clear-mentioned-models',
      'mention:openai:gpt-5',
      'mention:anthropic:claude-sonnet-4',
      'action:open-model-service'
    ])
    expect(items[1].sectionKey).toBe('pinned')
  })

  it('groups models by the provider display name', () => {
    const items = buildAgentMentionModelQuickPanelItems(groups, [], text)
    const sections = items
      .filter((item) => item.group === 'models')
      .map((item) => [item.sectionKey, item.sectionLabel])

    expect(sections).toEqual([
      ['provider:anthropic', 'Anthropic'],
      ['provider:openai', 'OpenAI']
    ])
  })

  it('keeps the action items visible when a keyword matches no model', () => {
    const items = buildAgentMentionModelQuickPanelItems(groups, [], text)
    const filtered = filterAgentQuickPanelItems(items, 'zzz')

    // 「清空」是 alwaysVisible，其余项按关键字过滤（原有行为不变）。
    expect(filtered.map((item) => item.id)).toEqual(['action:clear-mentioned-models'])
  })
})

describe('@ panel shares the model picker data layer', () => {
  const provider = (id: string, name: string, models: ModelDefinition[]): SafeModelProvider => ({
    id,
    name,
    endpoints: [{ protocol: 'messages', baseUrl: `https://${id}.example.test` }],
    enabled: true,
    baseUrl: `https://${id}.example.test`,
    hasApiKey: true,
    apiKeyPreview: 'sk-**********test',
    isSystem: false,
    models
  })

  const silicon = provider('silicon', 'Silicon', [
    {
      id: 'deepseek-ai/DeepSeek-V3',
      name: 'DeepSeek-V3',
      capabilities: { chat: true },
      chatProtocol: 'messages'
    },
    {
      id: 'retired-messages',
      name: 'Retired Messages',
      capabilities: { chat: true },
      chatProtocol: 'messages',
      probeReason: 'model_retired'
    }
  ])
  const siliconAlias = provider('silicon-alias', 'Silicon Alias', [
    {
      id: 'deepseek-ai/DeepSeek-V3',
      name: 'DeepSeek-V3',
      capabilities: { chat: true },
      chatProtocol: 'messages'
    }
  ])
  const providers = [silicon, siliconAlias]
  const candidates = providers.flatMap((entry) =>
    entry.models.map((model) => ({ providerId: entry.id, model }))
  )
  const buildGroups = (): ModelPickerGroup[] =>
    buildModelPickerOptions(candidates, providers, AGENT_MENTION_MODEL_CONSTRAINTS, {
      providerNames: { silicon: 'SiliconFlow' }
    }).groups

  it('filters retired models out and keeps two same-name models with different values', () => {
    const items = buildAgentMentionModelQuickPanelItems(buildGroups(), [], text)
    const modelItemIds = items.filter((item) => item.group === 'models').map((item) => item.id)

    expect(modelItemIds).toEqual([
      'mention:silicon:deepseek-ai/DeepSeek-V3',
      'mention:silicon-alias:deepseek-ai/DeepSeek-V3'
    ])
    expect(modelItemIds).not.toContain('mention:silicon:retired-messages')
  })

  it('matches dsv3 inside the panel and shows the provider display name as the section', () => {
    const items = buildAgentMentionModelQuickPanelItems(buildGroups(), [], text)
    const filtered = filterAgentQuickPanelItems(items, 'dsv3')
    const modelItems = filtered.filter((item) => item.group === 'models')

    expect(modelItems.map((item) => item.id)).toEqual([
      'mention:silicon:deepseek-ai/DeepSeek-V3',
      'mention:silicon-alias:deepseek-ai/DeepSeek-V3'
    ])
    expect(modelItems[0].sectionLabel).toBe('SiliconFlow')
  })
})
