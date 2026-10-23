import { describe, expect, it } from 'vitest'

import { buildAgentModelOptions, describeAgentModelCompatibility } from './agentModelOptions'
import {
  agentCapabilities,
  chatCapabilities as capabilities,
  optionValues as values,
  testCompatibility as compatibility,
  testProvider as provider
} from './agentModelOptionsFixture'

/**
 * PLAT-70：三态判定 —— 有证据通过 / 没有证据（可选但标注）/ 明确不可用（置灰 + 原因）。
 * 关键回归：**不允许因为「没有 report」就把模型从列表里删掉**。
 */
describe('agent model option verification state', () => {
  /**
   * 根因回归：map 里没有条目（还没探测过 / IPC 失败 / 证据过期）时，
   * 旧实现 `compatibility?.selectable === true` 会把整个列表清空 ⇒ 用户「什么都选不了」。
   */
  it('lists tagged models as selectable-but-unverified when there is no runtime evidence yet', () => {
    const providers = [
      provider({
        id: 'anthropic',
        name: 'Anthropic',
        endpoints: [
          { protocol: 'messages', baseUrl: '' }
        ],
        models: [
          { id: 'claude-sonnet', name: 'Claude Sonnet', capabilities: agentCapabilities },
          { id: 'claude-opus', name: 'Claude Opus', capabilities: agentCapabilities }
        ]
      })
    ]

    for (const map of [new Map(), undefined]) {
      const options = buildAgentModelOptions(providers, 'claude-code', map).flatMap((group) => group.options)
      expect(options).toHaveLength(2)
      for (const option of options) {
        expect(option.selectable).toBe(true)
        expect(option.verification).toBe('unverified')
      }
      expect(options.map((option) => option.value)).toEqual([
        'anthropic:claude-sonnet',
        'anthropic:claude-opus'
      ])
    }
  })

  it('keeps verified models selectable when the shared snapshot is ready', () => {
    const providers = [
      provider({
        id: 'deepseek',
        name: 'deepseek',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: '' },
          { protocol: 'messages', baseUrl: 'https://api.deepseek.com/anthropic' }
        ],

        models: [{ id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', capabilities: agentCapabilities }]
      })
    ]
    const compatibilityByModelKey = new Map([
      [
        'deepseek:deepseek-v4-pro',
        compatibility('deepseek', 'deepseek-v4-pro', {
          selectable: true,
          route: 'gateway',
          status: 'ready',
          summary: 'Agent gateway runtime probe passed.'
        })
      ]
    ])

    const [option] = buildAgentModelOptions(providers, 'claude-code', compatibilityByModelKey).flatMap(
      (group) => group.options
    )
    expect(option?.selectable).toBe(true)
    expect(option?.verification).toBe('verified')
  })

  it('shows clearly unavailable models but disables them with a reason', () => {
    const providers = [
      provider({
        id: 'deepseek',
        name: 'deepseek',
        models: [
          { id: 'deepseek-chat', name: 'deepseek-chat', capabilities: agentCapabilities },
          { id: 'deepseek-disabled', name: 'deepseek-disabled', capabilities: agentCapabilities }
        ]
      })
    ]
    const compatibilityByModelKey = new Map([
      [
        'deepseek:deepseek-chat',
        compatibility('deepseek', 'deepseek-chat', {
          selectable: false,
          status: 'auth-failed',
          summary: 'Direct Claude Code runtime authentication failed.'
        })
      ],
      [
        'deepseek:deepseek-disabled',
        compatibility('deepseek', 'deepseek-disabled', {
          selectable: false,
          status: 'provider-disabled',
          summary: 'Provider is disabled.'
        })
      ]
    ])

    const options = buildAgentModelOptions(providers, 'claude-code', compatibilityByModelKey).flatMap(
      (group) => group.options
    )
    expect(options.map((option) => option.value)).toEqual(['deepseek:deepseek-chat', 'deepseek:deepseek-disabled'])
    for (const option of options) {
      expect(option.selectable).toBe(false)
      expect(option.verification).toBe('unavailable')
    }
    expect(options[0]?.status).toBe('auth-failed')
    expect(options[1]?.status).toBe('provider-disabled')
  })

  it('treats a stale (unknown) snapshot as unverified instead of hiding the model', () => {
    const providers = [
      provider({
        id: 'anthropic',
        name: 'Anthropic',
        endpoints: [
          { protocol: 'messages', baseUrl: '' }
        ],
        models: [{ id: 'claude-sonnet', name: 'Claude Sonnet', capabilities: agentCapabilities }]
      })
    ]
    const compatibilityByModelKey = new Map([
      [
        'anthropic:claude-sonnet',
        compatibility('anthropic', 'claude-sonnet', {
          selectable: false,
          status: 'unknown',
          summary: 'Stored runtime evidence is stale. Re-checking Claude Code route…'
        })
      ]
    ])

    const [option] = buildAgentModelOptions(providers, 'claude-code', compatibilityByModelKey).flatMap(
      (group) => group.options
    )
    expect(option?.selectable).toBe(true)
    expect(option?.verification).toBe('unverified')
  })

  it('keeps a model that needs the gateway in the picker as unverified, not unavailable', () => {
    const providers = [
      provider({
        id: 'tokenrhythm',
        name: 'TokenRhythm',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://tokenrhythm.studio' },
          { protocol: 'messages', baseUrl: 'https://tokenrhythm.studio' }
        ],
        models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', capabilities: agentCapabilities }]
      })
    ]
    const compatibilityByModelKey = new Map([
      [
        'tokenrhythm:deepseek-v4.1-flash',
        compatibility('tokenrhythm', 'deepseek-v4.1-flash', {
          selectable: false,
          route: 'gateway',
          status: 'gateway-required',
          summary: 'This provider exposes an Anthropic-shaped endpoint, but Claude Code Agent runtime must use the local agent gateway route.'
        })
      ]
    ])

    const [option] = buildAgentModelOptions(providers, 'claude-code', compatibilityByModelKey).flatMap(
      (group) => group.options
    )
    // The model supports Messages; needing a route is not a model capability failure. Hiding it
    // made a 12-model provider show only the 4 models whose last probe happened to pass.
    expect(option?.selectable).toBe(true)
    expect(option?.verification).toBe('unverified')
  })

  it('drops models of a disabled provider and keeps the rest', () => {
    const providers = [
      provider({
        id: 'anthropic',
        name: 'Anthropic',
        endpoints: [
          { protocol: 'messages', baseUrl: '' }
        ],
        enabled: false,
        models: [{ id: 'claude-sonnet', name: 'Claude Sonnet', capabilities: agentCapabilities }]
      }),
      provider({
        id: 'no-endpoint',
        name: 'No Endpoint',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: '' }
        ],
        models: [{ id: 'plain-chat', name: 'Plain Chat', capabilities: agentCapabilities }]
      })
    ]

    const options = buildAgentModelOptions(providers, 'claude-code').flatMap((group) => group.options)
    // 供应商停用 ⇒ 不进入候选（用户已把这家关掉）。
    expect(options.map((option) => option.value)).toEqual(['no-endpoint:plain-chat'])
    expect(options.map((option) => option.status)).toEqual(['missing-endpoint'])
    expect(options.every((option) => option.verification === 'unavailable')).toBe(true)
  })

  it('renders nothing when no model carries the runtime tag, so the UI can show its empty state', () => {
    const providers = [
      provider({
        id: 'openai',
        name: 'OpenAI',
        endpoints: [
          { protocol: 'chat-completions', baseUrl: '' }
        ],
        models: [{ id: 'gpt-5', name: 'GPT-5', capabilities }]
      })
    ]

    expect(buildAgentModelOptions(providers, 'claude-code', new Map())).toEqual([])
    expect(buildAgentModelOptions(providers, 'claude-code')).toEqual([])
  })

  it('only accepts models tagged for the requested agent runtime', () => {
    const providers = [
      provider({
        id: 'mixed',
        name: 'Mixed',
        endpoints: [
          { protocol: 'messages', baseUrl: '' }
        ],
        models: [
          { id: 'for-claude', name: 'For Claude', capabilities: agentCapabilities },
          {
            id: 'for-openai',
            name: 'For OpenAI',
            capabilities: { ...capabilities, agentRuntimes: { openaiAgents: true } }
          }
        ]
      })
    ]

    expect(values(buildAgentModelOptions(providers, 'claude-code'))).toEqual(['mixed:for-claude'])
    expect(values(buildAgentModelOptions(providers, 'openai-agents'))).toEqual(['mixed:for-openai'])
  })

  it('describes unverified runtime routes explicitly', () => {
    expect(
      describeAgentModelCompatibility({
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        runtimeId: 'claude-code',
        selectable: false,
        route: 'none',
        status: 'unknown',
        summary: 'Claude Code runtime route has not been verified yet.'
      })
    ).toBe('Runtime route unverified')
    expect(
      describeAgentModelCompatibility({
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        runtimeId: 'claude-code',
        selectable: false,
        route: 'none',
        status: 'gateway-required',
        summary: 'Gateway required'
      })
    ).toBe('Gateway required')
  })
})
