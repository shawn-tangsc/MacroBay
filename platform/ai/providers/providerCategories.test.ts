import { describe, expect, it } from 'vitest'

import {
  PROVIDER_CATEGORY_BY_ID,
  PROVIDER_CATEGORY_ORDER,
  createSystemProviderPresets,
  providerCategoryOf,
  systemProviderIds
} from './providerPresets'

/**
 * PLAT-62：供应商分组是**纯展示分类**，不进入 provider 契约与持久化。
 * 这里只锁数据：组顺序固定、显式映射完整、未收录 id 一律归 gateway。
 */
const expectedSizes: Record<string, number> = {
  relay: 12,
  domestic: 14,
  international: 13,
  local: 4,
  gateway: 1
}

describe('PLAT-62 provider categories', () => {
  it('exposes the five groups in the fixed UI order', () => {
    expect(PROVIDER_CATEGORY_ORDER).toEqual([
      'relay',
      'domestic',
      'international',
      'local',
      'gateway'
    ])
  })

  it('includes TokenRhythm in the relay group with the expected preset', () => {
    expect(systemProviderIds).toContain('tokenrhythm')
    expect(providerCategoryOf('tokenrhythm')).toBe('relay')
    const preset = createSystemProviderPresets().find((provider) => provider.id === 'tokenrhythm')
    expect(preset).toMatchObject({
      name: 'TokenRhythm',
      endpoints: [
        { protocol: 'chat-completions', baseUrl: 'https://tokenrhythm.studio' },
        { protocol: 'responses', baseUrl: 'https://tokenrhythm.studio/v1' },
        { protocol: 'messages', baseUrl: 'https://tokenrhythm.studio' }
      ],
      baseUrl: 'https://tokenrhythm.studio',
      models: [],
      websites: {
        official: 'https://tokenrhythm.studio/account',
        apiKey: 'https://tokenrhythm.studio/i/rf_tr_C4LK8Z?share_id=ad1db639-8069-4f57-9c08-fa4a114a276d',
        docs: 'https://tokenrhythm.studio/docs/overview'
      }
    })
  })

  it('maps every listed provider id to its group', () => {
    for (const category of PROVIDER_CATEGORY_ORDER) {
      const ids = Object.keys(PROVIDER_CATEGORY_BY_ID).filter((id) => PROVIDER_CATEGORY_BY_ID[id] === category)
      // gateway 额外接收未收录 id，显式映射里只有 new-api。
      expect(ids, `group ${category}`).toHaveLength(expectedSizes[category])
    }
  })

  it('puts relay/domestic/international/local/gateway ids where the plan says', () => {
    expect(providerCategoryOf('aihubmix')).toBe('relay')
    expect(providerCategoryOf('openrouter')).toBe('relay')
    // PM 裁决：硅基流动按使用习惯归中转聚合站。
    expect(providerCategoryOf('silicon')).toBe('relay')
    expect(providerCategoryOf('deepseek')).toBe('domestic')
    expect(providerCategoryOf('zhipu')).toBe('domestic')
    expect(providerCategoryOf('minimax')).toBe('domestic')
    expect(providerCategoryOf('mimo')).toBe('domestic')
    // PM 最终裁决：按「国内站/国际站」分 ⇒ 原 domesticCloud 成员并入 domestic。
    expect(providerCategoryOf('dashscope')).toBe('domestic')
    expect(providerCategoryOf('qiniu')).toBe('domestic')
    expect(providerCategoryOf('modelscope')).toBe('domestic')
    expect(providerCategoryOf('tokenhub')).toBe('domestic')
    expect(providerCategoryOf('ppio')).toBe('domestic')
    expect(providerCategoryOf('anthropic')).toBe('international')
    // PM 裁决：按「面向哪个市场/站点」而非母公司国籍 —— 智谱国际站 / MiniMax 国际站。
    expect(providerCategoryOf('zai')).toBe('international')
    expect(providerCategoryOf('minimax-global')).toBe('international')
    // PM 最终裁决：原 cloud 成员并入 international。
    expect(providerCategoryOf('cerebras')).toBe('international')
    expect(providerCategoryOf('hyperbolic')).toBe('international')
    expect(providerCategoryOf('gpustack')).toBe('local')
    expect(providerCategoryOf('new-api')).toBe('gateway')
  })

  it('falls back to gateway for any unlisted id (custom providers)', () => {
    expect(providerCategoryOf('acme-custom')).toBe('gateway')
    expect(providerCategoryOf('')).toBe('gateway')
  })

  it('resolves a category for every preset provider', () => {
    for (const providerId of systemProviderIds) {
      expect(PROVIDER_CATEGORY_ORDER).toContain(providerCategoryOf(providerId))
    }
  })
})
