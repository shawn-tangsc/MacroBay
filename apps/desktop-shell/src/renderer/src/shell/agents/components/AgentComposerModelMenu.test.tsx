import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { AgentTextProvider } from '../agentTextProvider'
import AgentComposerModelMenu from './AgentComposerModelMenu'

const agent: AgentEntity = {
  id: 'agent-1',
  type: 'claude-code',
  name: 'test助手',
  description: 'A test agent',
  instructions: 'Help',
  model: 'tokenrhythm:deepseek-v4.1-flash-1017',
  modelName: 'deepseek-v4.1-flash-1017',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  orderKey: 'agent-1',
  configuration: { effort: 'high' }
}

const provider: SafeModelProvider = {
  id: 'tokenrhythm',
  name: '基元律动',
  endpoints: [{ protocol: 'messages', baseUrl: 'https://api.tokenrhythm.example' }],
  enabled: true,
  baseUrl: 'https://api.tokenrhythm.example',
  hasApiKey: true,
  apiKeyPreview: 'sk-t**********1234',
  models: [
    {
      id: 'deepseek-v4.1-flash-1017',
      name: 'deepseek-v4.1-flash-1017',
      messagesSupport: 'yes',
      capabilities: { chat: true, agentRuntimes: { claudeCode: true } }
    }
  ]
}

describe('AgentComposerModelMenu', () => {
  it('shows the selected model and reasoning level on one composer trigger', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentComposerModelMenu
          agent={agent}
          providers={[provider]}
          onStateChange={(updater) => updater({} as never)}
        />
      </AgentTextProvider>
    )

    expect(markup).toContain('agent-composer-model-trigger')
    expect(markup).toContain('deepseek-v4.1-flash-1017')
    expect(markup).toContain('>高<')
  })

  it('hides the reasoning level when the model declares no reasoning support', () => {
    const nonReasoningProvider: SafeModelProvider = {
      ...provider,
      models: [
        {
          ...provider.models[0]!,
          capabilities: { chat: true, reasoning: false, agentRuntimes: { claudeCode: true } }
        }
      ]
    }

    const markup = renderToStaticMarkup(
      <AgentTextProvider language="zh-CN">
        <AgentComposerModelMenu
          agent={agent}
          providers={[nonReasoningProvider]}
          onStateChange={(updater) => updater({} as never)}
        />
      </AgentTextProvider>
    )

    expect(markup).toContain('deepseek-v4.1-flash-1017')
    expect(markup).not.toContain('>高<')
  })
})
