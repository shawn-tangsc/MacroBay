import { describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { buildAgentModelOptions, isAgentCompatibleModel } from './agentModelOptions'
import {
  agentCapabilities,
  chatCapabilities as capabilities,
  optionValues as values,
  testProvider as provider
} from './agentModelOptionsFixture'

/**
 * PLAT-70：智能体模型下拉的候选 = **带智能体标记**的模型（按 agentType 各自的标记），
 * 并且**不允许整列表为空**：
 *  - 有证据且通过 ⇒ 正常可选；
 *  - 没有证据 / 证据过期 ⇒ 可选，但标注「未验证，可能失败」；
 *  - 明确不可用（供应商停用 / 缺 Key / 无 Anthropic 端点）⇒ 出现但置灰 + 原因。
 */
describe('agent model options', () => {
  it('filters non-agent models out of the shared model picker', () => {
    const models = [
      { id: 'claude-sonnet', name: 'Claude Sonnet', capabilities: agentCapabilities },
      { id: 'gpt-5', name: 'GPT-5', capabilities },
      { id: 'embedding-model', name: 'Embedding Model', capabilities: { chat: false, vision: false, embedding: true, tools: false } },
      { id: 'rerank-model', name: 'Rerank Model', capabilities: { chat: false, vision: false, embedding: false, tools: false } },
      { id: 'image-model', name: 'Image Model', capabilities: { chat: false, vision: true, embedding: false, tools: false } }
    ]

    expect(
      models
        .filter((model) => isAgentCompatibleModel(provider({
          id: 'anthropic',
          name: 'Anthropic',
          endpoints: [{ protocol: 'messages', baseUrl: 'https://api.anthropic.com' }]
        }), model))
        .map((model) => model.id)
    ).toEqual(['claude-sonnet'])
  })

  it('shows configured Claude Code runtime models in the shared model picker before probes complete', () => {
    const providers = [
      provider({
        id: 'openai',
        name: 'OpenAI',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: '' }
        ],
        models: [{ id: 'gpt-5', name: 'GPT-5', capabilities }]
      }),
      provider({
        id: 'silicon',
        name: 'SiliconFlow',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: '' },
          { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
        ],

        models: [
          { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', capabilities },
          { id: 'deepseek-ai/DeepSeek-V4-Pro', name: 'DeepSeek V4 Pro', capabilities },
          { id: 'Qwen/Qwen3-235B-A22B-Instruct-2507', name: 'Qwen Coder', capabilities }
        ]
      }),
      provider({
        id: '302ai',
        name: '302.AI',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: '' },
          { protocol: 'messages', baseUrl: 'https://api.302.ai' }
        ],

        models: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat', capabilities: agentCapabilities },
          { id: 'chatgpt-4o-latest', name: 'ChatGPT 4o Latest', capabilities },
          { id: 'o3', name: 'o3', capabilities },
          { id: 'qwen3-235b-a22b', name: 'Qwen3 235B', capabilities },
          { id: 'gemini-2.5-pro-preview-06-05', name: 'Gemini 2.5 Pro Preview', capabilities },
          { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', capabilities: agentCapabilities }
        ]
      }),
      provider({
        id: 'openrouter',
        name: 'OpenRouter',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: '' },
          { protocol: 'messages', baseUrl: 'https://openrouter.ai/api' }
        ],

        models: [
          { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', capabilities },
          { id: 'qwen/qwen3-235b-a22b', name: 'Qwen 3 235B', capabilities },
          { id: 'mistralai/mistral-large', name: 'Mistral Large', capabilities },
          { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', capabilities }
        ]
      }),
      provider({
        id: 'lmstudio',
        name: 'LM Studio',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: '' },
          { protocol: 'messages', baseUrl: 'http://localhost:1234' }
        ],

        models: [
          { id: 'local-qwen3', name: 'Local Qwen3', capabilities },
          { id: 'claude-local-test', name: 'Claude Local Test', capabilities }
        ]
      }),
      provider({
        id: 'disabled-anthropic',
        name: 'Disabled Anthropic',
        endpoints: [
          { protocol: 'messages', baseUrl: '' }
        ],
        enabled: false,
        models: [{ id: 'claude-disabled', name: 'Claude Disabled', capabilities: agentCapabilities }]
      }),
      provider({
        id: 'missing-key',
        name: 'Missing Key',
        endpoints: [
          { protocol: 'messages', baseUrl: '' }
        ],
        hasApiKey: false,
        models: [{ id: 'claude-no-key', name: 'Claude No Key', capabilities: agentCapabilities }]
      }),
      provider({
        id: 'anthropic',
        name: 'Anthropic',
        endpoints: [
          { protocol: 'messages', baseUrl: '' }
        ],
        models: [{ id: 'claude-sonnet', name: 'Claude Sonnet', capabilities: agentCapabilities }]
      })
    ]

    const groups = buildAgentModelOptions(providers, 'claude-code')
    // 供应商停用 ⇒ 不进候选；缺 Key / 其它仍保留（置灰）。
    expect(groups.map((group) => group.label)).toEqual([
      '302.AI',
      'Missing Key',
      'Anthropic'
    ])
    expect(values(groups)).toEqual([
      '302ai:deepseek-chat',
      '302ai:claude-sonnet-4-20250514',
      'missing-key:claude-no-key',
      'anthropic:claude-sonnet'
    ])
  })

  it('does not include models in agent pickers until Claude Code runtime support is explicitly enabled', () => {
    const providers = [
      provider({
        id: 'deepseek',
        name: 'deepseek',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: '' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ],

        models: [
          { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', capabilities },
          { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', capabilities: { ...capabilities, agentRuntimes: { claudeCode: true } } },
          { id: 'deepseek-chat', name: 'deepseek-chat', capabilities: { ...capabilities, agentRuntimes: { claudeCode: false } } }
        ]
      })
    ]

    expect(values(buildAgentModelOptions(providers, 'claude-code'))).toEqual(['deepseek:deepseek-v4-pro'])
  })
})
