import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import {
  applyModelTypeCapabilities,
  createModelCapabilitySections,
  getSelectedModelTypeCapabilities,
  listEnabledAgentRuntimeTags
} from './modelCapabilityDisplay'

describe('model capability display helpers', () => {
  it('separates model type capabilities from agent runtime protocol support', () => {
    expect(createModelCapabilitySections()).toEqual({
      modelTypes: [
        { value: 'chat', labelKey: 'chat' },
        { value: 'tools', labelKey: 'tools' },
        { value: 'vision', labelKey: 'vision' },
        { value: 'reasoning', labelKey: 'reasoning' },
        { value: 'embedding', labelKey: 'embedding' },
        { value: 'rerank', labelKey: 'rerank' },
        { value: 'imageGeneration', labelKey: 'imageGeneration' },
        { value: 'videoGeneration', labelKey: 'videoGeneration' },
        { value: 'speech', labelKey: 'speech' },
        { value: 'transcription', labelKey: 'transcription' },
        { value: 'ocr', labelKey: 'ocr' }
      ],
      agentProtocols: [
        { value: 'claudeCode', labelKey: 'claudeCodeAgent' },
        { value: 'openaiAgents', labelKey: 'openaiAgents' }
      ]
    })
  })

  it('updates model type capabilities without rewriting agent runtime protocol flags', () => {
    expect(
      applyModelTypeCapabilities(
        {
          chat: true,
          vision: false,
          embedding: false,
          tools: true,
          agentRuntimes: { claudeCode: true, openaiAgents: false }
        },
        ['chat', 'vision']
      )
    ).toEqual({
      chat: true,
      vision: true,
      agentRuntimes: { claudeCode: true, openaiAgents: false }
    })
  })

  it('lists only enabled agent runtime tags for read-only model rows', () => {
    const model: ModelDefinition = {
      id: 'deepseek-ai/DeepSeek-V3.2',
      name: 'DeepSeek V3.2',
      capabilities: {
        chat: true,
        vision: false,
        embedding: false,
        tools: true,
        agentRuntimes: { claudeCode: true, openaiAgents: false }
      }
    }

    expect(getSelectedModelTypeCapabilities(model.capabilities)).toEqual(['chat', 'tools'])
    expect(listEnabledAgentRuntimeTags(model)).toEqual([{ value: 'claudeCode', labelKey: 'claudeCodeAgent' }])
  })
})
