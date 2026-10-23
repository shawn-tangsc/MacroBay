// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { buildInitialAgentFormState } from '@platform/ai/agent-platform/agents/agentConfigDescriptor'
import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { AgentTextProvider } from '../../agentTextProvider'
import BasicSection from './BasicSection'

/**
 * 智能体配置页三个模型字段统一用 `ModelPicker`，并且只列 messages 能力模型
 * （运行时走 Anthropic `/v1/messages`）；旧值不满足时仍回显。
 */
const provider: SafeModelProvider = {
  id: 'four-protocols',
  name: 'Four Protocols',
  endpoints: [
    { protocol: 'messages', baseUrl: 'https://four.example.test' },
    { protocol: 'chat-completions', baseUrl: 'https://four.example.test/v1' }
  ],
  enabled: true,
  baseUrl: 'https://four.example.test',
  hasApiKey: true,
  apiKeyPreview: 'sk-**********test',
  isSystem: false,
  models: [
    model('m-messages', 'Messages Model', 'messages'),
    model('m-responses', 'Responses Model', 'responses'),
    model('m-gemini', 'Gemini Model', 'gemini'),
    model('m-chat', 'Chat Model', 'chat-completions')
  ]
}

function model(id: string, name: string, chatProtocol: ModelDefinition['chatProtocol']): ModelDefinition {
  return {
    id,
    name,
    chatProtocol,
    capabilities: { chat: true, agentRuntimes: { claudeCode: true } }
  }
}

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mountSection(modelValue: string): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <AgentTextProvider language="zh-CN">
        <BasicSection
          form={{ ...buildInitialAgentFormState(), model: modelValue }}
          providers={[provider]}
          onChange={() => undefined}
        />
      </AgentTextProvider>
    )
  })
  return container
}

describe('agent editor model pickers', () => {
  it('renders pickers for the main, plan and small model fields', async () => {
    const container = await mountSection('')

    const pickers = [...container.querySelectorAll('[data-model-picker]')]
      .map((entry) => entry.getAttribute('data-model-picker'))
    expect(pickers).toEqual(['agent-main-model', 'agent-plan-model', 'agent-small-model'])
  })

  it('only offers messages-capable models to the main model picker', async () => {
    const container = await mountSection('')
    await act(async () => {
      container.querySelector<HTMLElement>('[data-model-picker="agent-main-model"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })

    expect(
      [...document.querySelectorAll<HTMLElement>('[data-model-picker-option]')]
        .map((option) => option.getAttribute('data-model-picker-option'))
    ).toEqual(['four-protocols:m-messages'])
  })

  it('keeps a saved non-messages value visible with a hint instead of clearing it', async () => {
    const container = await mountSection('four-protocols:m-chat')
    const trigger = container.querySelector('[data-model-picker="agent-main-model"]')

    expect(trigger?.textContent).toContain('Chat Model')
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(document.querySelector('[data-model-picker-notice]')?.textContent)
      .toContain('不支持 Messages')
  })
})
