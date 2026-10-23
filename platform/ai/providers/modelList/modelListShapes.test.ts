import { describe, expect, it } from 'vitest'

import { DEFAULT_MODEL_LIST_SHAPE } from './modelListShape'
import { hasCustomModelListShape, resolveModelListShape } from './modelListShapes'
import { normalizeRemoteModels } from './remoteModelNormalize'

describe('model list shape resolution', () => {
  it('falls back to the default shape for unknown providers', () => {
    expect(resolveModelListShape({ id: 'acme-custom', endpoints: [{ protocol: 'chat-completions', baseUrl: '' }] })).toEqual(DEFAULT_MODEL_LIST_SHAPE)
    expect(hasCustomModelListShape('acme-custom')).toBe(false)
  })

  it('routes by protocol first so a custom gemini provider still uses the native envelope', () => {
    const shape = resolveModelListShape({ id: 'my-gemini-proxy', endpoints: [{ protocol: 'gemini', baseUrl: '' }] })
    expect(shape.envelope).toBe('models')
    expect(shape.auth).toBe('x-goog-api-key')
    expect(shape.idPath).toBe('name')
  })

  it('declares the measured per-provider differences', () => {
    const doubao = resolveModelListShape({ id: 'doubao', endpoints: [{ protocol: 'chat-completions', baseUrl: '' }] })
    expect(doubao.lifecycle).toEqual({
      kind: 'string-in-set',
      path: 'status',
      values: ['shutdown', 'retired', 'deprecated', 'offline']
    })
    // 厂商候选在前，默认候选（context_length）在后作为兜底。
    expect(doubao.aliases.contextWindow?.[0]).toEqual({ path: 'token_limits.context_window' })

    // 折后价优先：与今天的 parseModelPricing 行为一致（默认形状即口径）。
    expect(resolveModelListShape({ id: 'openai', endpoints: [{ protocol: 'chat-completions', baseUrl: '' }] }).aliases['price.prompt']?.[0]).toEqual({
      path: 'effective_pricing.prompt'
    })

    const gateway = resolveModelListShape({ id: 'gateway', endpoints: [{ protocol: 'chat-completions', baseUrl: '' }] })
    expect(gateway.aliases['price.prompt']?.[0]).toEqual({ path: 'pricing.input', scale: 1e6 })
    expect(gateway.lifecycle).toEqual({ kind: 'presence', path: 'deprecated_at' })

    const lanyun = resolveModelListShape({ id: 'lanyun', endpoints: [{ protocol: 'chat-completions', baseUrl: '' }] })
    expect(lanyun.displayNamePaths).toEqual(['display_name', 'title'])
    expect(lanyun.lifecycle).toEqual({ kind: 'zero', path: 'status' })

    expect(resolveModelListShape({ id: 'ocoolai', endpoints: [{ protocol: 'chat-completions', baseUrl: '' }] })).toEqual(DEFAULT_MODEL_LIST_SHAPE)
  })

  it('points aihubmix at the rich list with comma-separated readers', () => {
    const aihubmix = resolveModelListShape({ id: 'aihubmix', endpoints: [{ protocol: 'chat-completions', baseUrl: '' }] })

    // 富列表在主机根，id/显示名都换成了富字段。
    expect(aihubmix.listPath).toBe('/api/v1/models')
    expect(aihubmix.idPath).toBe('model_id')
    expect(aihubmix.displayNamePaths).toEqual(['model_name'])
    // 价格是 USD / 每百万 tokens：不 scale，也不走默认的 effective_pricing。
    expect(aihubmix.aliases['price.prompt']?.[0]).toEqual({ path: 'pricing.input' })
    expect(aihubmix.aliases['price.completion']?.[0]).toEqual({ path: 'pricing.output' })
    expect(aihubmix.aliases['price.cacheRead']?.[0]).toEqual({ path: 'pricing.cache_read' })
    expect(aihubmix.aliases.contextWindow?.[0]).toEqual({ path: 'context_length' })
    expect(aihubmix.aliases.maxOutput?.[0]).toEqual({ path: 'max_output' })
    // types / endpoints / modalities 都是逗号分隔字符串。
    expect(aihubmix.aliases['cap.vision']?.[0]).toEqual({
      path: 'input_modalities',
      read: 'split-includes',
      token: 'image'
    })
    expect(aihubmix.aliases['messages.responses']?.[0]).toEqual({
      path: 'endpoints',
      read: 'split-includes',
      token: 'responses'
    })
    expect(aihubmix.aliases['messages.anthropic']?.[0]).toEqual({
      path: 'endpoints',
      read: 'split-includes',
      token: 'claude_api'
    })
    expect(aihubmix.aliases['messages.gemini']?.[0]).toEqual({
      path: 'endpoints',
      read: 'split-includes',
      token: 'gemini_api'
    })
    expect(aihubmix.kindSources).toEqual([{ path: 'types', read: 'split-includes' }])
    expect(aihubmix.lifecycle).toEqual({
      kind: 'string-in-set',
      path: 'retire_stage',
      values: ['deprecated', 'retired', 'shutdown', 'offline']
    })
    // 其余继承默认：data 信封 / bearer / 无分页 / 无补充源。
    expect(aihubmix).toMatchObject({
      envelope: 'data',
      auth: 'bearer',
      pagination: null,
      modelProviderTag: 'remote',
      grouping: 'ownedBy'
    })
    expect(aihubmix.enrichment).toBeUndefined()
  })

  it('declares the dashscope enrichment source without touching the default shape', () => {
    // 默认形状不带 enrichment：其余厂商的请求数与归一结果必须完全不变。
    expect(DEFAULT_MODEL_LIST_SHAPE.enrichment).toBeUndefined()
    expect(resolveModelListShape({ id: 'qiniu', endpoints: [{ protocol: 'chat-completions', baseUrl: '' }] }).enrichment).toBeUndefined()

    const dashscope = resolveModelListShape({
      id: 'dashscope',
      endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }]
    })
    expect(dashscope.defaultCurrency).toBe('CNY')
    expect(dashscope.enrichment).toEqual({
      // 主机根相对路径：实际请求 https://dashscope.aliyuncs.com/api/v1/models。
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
    })
    // 补充源不覆盖本家/默认别名。
    expect(dashscope.aliases.contextWindow?.[0]).toEqual({ path: 'context_length' })
  })

  it('normalizes the measured dashscope native entry (CNY per million, no scale)', () => {
    const dashscope = resolveModelListShape({
      id: 'dashscope',
      endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }]
    })
    const [model] = normalizeRemoteModels([{ id: 'qwen3.8-max' }], dashscope, {
      enrichmentById: new Map([['qwen3.8-max', {
        model: 'qwen3.8-max',
        model_info: { context_window: 1000000, max_input_tokens: 1000000, max_output_tokens: 65536 },
        prices: [{
          range_name: 'Default',
          prices: [
            { type: 'input_token', price: '12' },
            { type: 'output_token', price: '36' },
            { type: 'input_token_cache', price: '1.5' }
          ]
        }]
      }]])
    })

    expect(model).toMatchObject({
      contextLength: 1000000,
      maxCompletionTokens: 65536,
      pricing: {
        currency: 'CNY',
        promptPerMillion: 12,
        completionPerMillion: 36,
        cacheReadPerMillion: 1.5
      }
    })
  })
})
