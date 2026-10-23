import { describe, expect, it } from 'vitest'

import type { ModelDefinition, ModelProvider } from '../../providers/modelProviderTypes'
import type { AgentEntity } from '../schemas/agentSchemas'
import { resolveEffectiveAgentModel } from './effectiveAgentModel'

function agent(overrides: Partial<AgentEntity> & { id?: string } = {}): AgentEntity {
  const entity = {
    type: 'claude-code',
    name: 'Agent',
    model: 'anthropic:claude-sonnet' as AgentEntity['model'],
    modelName: 'Claude Sonnet',
    description: '',
    instructions: '',
    ...overrides
  } as AgentEntity
  entity.id = overrides.id ?? 'agent-1'
  return entity
}

function messagesModel(id: string, overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id,
    name: `Model ${id}`,
    messagesSupport: 'yes' as const,
    capabilities: { chat: true, agentRuntimes: { claudeCode: true } },
    ...overrides
  }
}

function provider(overrides: Partial<ModelProvider> & { id: string }): ModelProvider {
  return {
    name: overrides.id,
    enabled: true,
    baseUrl: 'https://api.test',
    apiKey: 'sk-test',
    endpoints: [
      { protocol: 'messages', baseUrl: 'https://api.test' },
      { protocol: 'chat-completions', baseUrl: 'https://api.test/v1' }
    ],
    models: [messagesModel('claude-sonnet')],
    ...overrides,
    id: overrides.id
  } as ModelProvider
}

function providerState(providers: ModelProvider[]) {
  return async () => ({ providers })
}

describe('resolveEffectiveAgentModel', () => {
  it('keeps an explicitly bound model ahead of the configured default', async () => {
    const resolved = await resolveEffectiveAgentModel({
      agent: agent({ model: 'anthropic:claude-sonnet' as AgentEntity['model'] }),
      getProviderState: providerState([provider({ id: 'anthropic' }), provider({ id: 'other' })]),
      getConfiguredDefaultModelId: () => 'other:claude-sonnet'
    })

    expect(resolved).toEqual({ model: 'anthropic:claude-sonnet', modelName: 'Claude Sonnet' })
  })

  it('uses the configured default when the agent model is unconfigured', async () => {
    const resolved = await resolveEffectiveAgentModel({
      agent: agent({ model: 'unconfigured:default-chat-model' as AgentEntity['model'], modelName: '未选择模型' }),
      getProviderState: providerState([provider({ id: 'anthropic', name: 'Anthropic' })]),
      getConfiguredDefaultModelId: () => 'anthropic:claude-sonnet'
    })

    expect(resolved).toEqual({ model: 'anthropic:claude-sonnet', modelName: 'Anthropic / Model claude-sonnet' })
  })

  it('resolves the default on a vault-backed provider without a plaintext key', async () => {
    const resolved = await resolveEffectiveAgentModel({
      agent: agent({ model: 'unconfigured:default-chat-model' as AgentEntity['model'] }),
      getProviderState: providerState([provider({ id: 'anthropic', apiKey: undefined, apiKeyRef: 'provider:616e7468726f706963' })]),
      getConfiguredDefaultModelId: () => 'anthropic:claude-sonnet'
    })

    expect(resolved).toEqual({ model: 'anthropic:claude-sonnet', modelName: 'anthropic / Model claude-sonnet' })
  })

  it('returns null when the configured default is not usable', async () => {
    const disabled = await resolveEffectiveAgentModel({
      agent: agent({ model: '' as AgentEntity['model'] }),
      getProviderState: providerState([provider({ id: 'anthropic', enabled: false })]),
      getConfiguredDefaultModelId: () => 'anthropic:claude-sonnet'
    })
    const missing = await resolveEffectiveAgentModel({
      agent: agent({ model: '' as AgentEntity['model'] }),
      getProviderState: providerState([provider({ id: 'anthropic' })]),
      getConfiguredDefaultModelId: () => 'anthropic:retired'
    })
    const incompatible = await resolveEffectiveAgentModel({
      agent: agent({ model: '' as AgentEntity['model'] }),
      getProviderState: providerState([
        provider({
          id: 'anthropic',
          models: [messagesModel('claude-sonnet', { messagesSupport: 'no', capabilities: { chat: true } })]
        })
      ]),
      getConfiguredDefaultModelId: () => 'anthropic:claude-sonnet'
    })

    expect(disabled).toBeNull()
    expect(missing).toBeNull()
    expect(incompatible).toBeNull()
  })

  it('returns null when no default is configured', async () => {
    const resolved = await resolveEffectiveAgentModel({
      agent: agent({ model: '' as AgentEntity['model'] }),
      getProviderState: providerState([provider({ id: 'anthropic' })])
    })

    expect(resolved).toBeNull()
  })
})
