import { describe, expect, it } from 'vitest'

import {
  PROVIDER_REACHABILITY_BY_ID,
  providerReachabilityOf,
  systemProviderIds
} from './providerPresets'

/**
 * PLAT-62 追加：可达性标签（纯展示元数据，不进 provider 契约/持久化）。
 * 口径：国内网络环境下「是否通常需要代理」——经验数据，可按需修正。
 */
const proxyIds = [
  'openai',
  'anthropic',
  'gemini',
  'grok',
  'mistral',
  'nvidia',
  'groq',
  'together',
  'fireworks',
  'hyperbolic',
  'cerebras',
  'aihubmix',
  'openrouter',
  'poe'
]

describe('PLAT-62 provider reachability', () => {
  it('marks exactly the known proxy-required ids', () => {
    expect(Object.keys(PROVIDER_REACHABILITY_BY_ID).sort()).toEqual([...proxyIds].sort())
    for (const providerId of proxyIds) {
      expect(providerReachabilityOf(providerId), providerId).toBe('proxy')
    }
  })

  it('keeps domestic sites, international-site domestic vendors, local runtimes and gateways direct', () => {
    const direct = [
      'deepseek',
      'zhipu',
      'moonshot',
      'dashscope',
      'ppio',
      'modelscope',
      'zai',
      'minimax-global',
      'ollama',
      'lmstudio',
      'ovms',
      'gpustack',
      'new-api',
      'silicon',
      'tokenrhythm'
    ]
    for (const providerId of direct) {
      expect(providerReachabilityOf(providerId), providerId).toBe('direct')
    }
  })

  it('falls back to direct for any unlisted id (custom providers)', () => {
    expect(providerReachabilityOf('acme-custom')).toBe('direct')
    expect(providerReachabilityOf('')).toBe('direct')
  })

  it('resolves a reachability for every preset provider', () => {
    for (const providerId of systemProviderIds) {
      expect(['direct', 'proxy']).toContain(providerReachabilityOf(providerId))
    }
  })
})
