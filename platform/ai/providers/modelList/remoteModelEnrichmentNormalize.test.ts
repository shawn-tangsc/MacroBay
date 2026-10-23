import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MODEL_LIST_SHAPE,
  type ModelListEnrichment,
  type ModelListShape
} from './modelListShape'
import { normalizeRemoteModels } from './remoteModelNormalize'

/**
 * Step 4 的归一合并契约（用合成 shape，不依赖 dashscope 的真实数据）。
 * 真实的 dashscope 形状见 `modelListShapes.test.ts`。
 */
const ENRICHMENT: ModelListEnrichment = {
  path: '/api/v1/models',
  itemsPath: 'output.models',
  idPath: 'model',
  pages: { pageParam: 'page_no', sizeParam: 'page_size', size: 200, maxPages: 5 },
  aliases: {
    contextWindow: [{ path: 'model_info.context_window' }],
    maxOutput: [{ path: 'model_info.max_output_tokens' }],
    'price.prompt': [{
      path: 'prices.0.prices',
      read: 'match',
      where: { path: 'type', equals: 'input_token' },
      valuePath: 'price'
    }],
    'price.completion': [{
      path: 'prices.0.prices',
      read: 'match',
      where: { path: 'type', equals: 'output_token' },
      valuePath: 'price'
    }],
    'price.cacheRead': [{
      path: 'prices.0.prices',
      read: 'match',
      where: { path: 'type', equals: 'input_token_cache' },
      valuePath: 'price'
    }]
  }
}

function enrichedShape(overrides: Partial<ModelListShape> = {}): ModelListShape {
  return {
    ...DEFAULT_MODEL_LIST_SHAPE,
    defaultCurrency: 'CNY',
    enrichment: ENRICHMENT,
    ...overrides
  }
}

function nativeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'qwen3.8-max',
    name: 'qwen3.8-max',
    model_info: { context_window: 1000000, max_input_tokens: 1000000, max_output_tokens: 65536 },
    prices: [{
      range_name: 'Default',
      prices: [
        { type: 'input_token', price: '12', price_unit: '每百万tokens' },
        { type: 'output_token', price: '36', price_unit: '每百万tokens' },
        { type: 'input_token_cache', price: '1.5', price_unit: '每百万tokens' }
      ]
    }],
    ...overrides
  }
}

function byId(...entries: Array<[string, unknown]>): ReadonlyMap<string, unknown> {
  return new Map(entries)
}

describe('remote model enrichment merge', () => {
  it('fills price and context from the enrichment entry with the same id', () => {
    const [model] = normalizeRemoteModels(
      [{ id: 'qwen3.8-max' }],
      enrichedShape(),
      { enrichmentById: byId(['qwen3.8-max', nativeEntry()]) }
    )

    expect(model?.pricing).toEqual({
      currency: 'CNY',
      promptPerMillion: 12,
      completionPerMillion: 36,
      cacheReadPerMillion: 1.5
    })
    expect(model?.contextLength).toBe(1000000)
    expect(model?.maxCompletionTokens).toBe(65536)
    // 身份字段仍来自主列表，补充源不改 name/group/kind。
    expect(model?.name).toBe('qwen3.8-max')
    expect(model?.group).toBe('qwen3.8')
  })

  it('ignores enrichment ids that the main list does not contain', () => {
    const models = normalizeRemoteModels(
      [{ id: 'qwen-plus' }],
      enrichedShape(),
      {
        enrichmentById: byId(
          ['qwen-plus', nativeEntry({ model: 'qwen-plus' })],
          // 只在原生接口出现（embedding / rerank / TTS …）：绝不能因此新增模型。
          ['text-embedding-v3', nativeEntry({ model: 'text-embedding-v3' })]
        )
      }
    )

    expect(models.map((model) => model.id)).toEqual(['qwen-plus'])
  })

  it('keeps the main-list value when both sides declare the same semantic', () => {
    const [model] = normalizeRemoteModels(
      [{
        id: 'qwen3.8-max',
        context_length: 32000,
        max_completion_tokens: 8000,
        pricing: { prompt: '1', completion: '2' }
      }],
      enrichedShape(),
      { enrichmentById: byId(['qwen3.8-max', nativeEntry()]) }
    )

    expect(model?.contextLength).toBe(32000)
    expect(model?.maxCompletionTokens).toBe(8000)
    expect(model?.pricing).toMatchObject({ promptPerMillion: 1, completionPerMillion: 2 })
  })

  it('never applies the default aliases to the enrichment entry', () => {
    const [model] = normalizeRemoteModels(
      [{ id: 'qwen3.8-max' }],
      enrichedShape(),
      {
        enrichmentById: byId(['qwen3.8-max', {
          model: 'qwen3.8-max',
          // 这些字段属于默认/本家别名，补充源没有声明它们 ⇒ 一律不读。
          context_length: 999,
          max_completion_tokens: 777,
          pricing: { prompt: '9', completion: '9' },
          supports_vision: true
        }])
      }
    )

    expect(model?.contextLength).toBeUndefined()
    expect(model?.maxCompletionTokens).toBeUndefined()
    expect(model?.pricing).toBeUndefined()
    expect(model?.capabilities.vision).toBeUndefined()
  })
})
