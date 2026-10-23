import { describe, expect, it } from 'vitest'

import {
  readBooleanField,
  readFirstString,
  readKindValues,
  readNumberField,
  readPath,
  readStringField
} from './remoteModelFields'

describe('remote model field reader', () => {
  it('reads nested paths and treats non-objects as missing', () => {
    expect(readPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1)
    expect(readPath({ a: null }, 'a.b')).toBeUndefined()
    expect(readPath({ a: 'text' }, 'a.b')).toBeUndefined()
    expect(readPath({ a: { b: undefined } }, 'a.b')).toBeUndefined()
  })

  it('returns booleans for value sources and keeps explicit false as declared', () => {
    expect(readBooleanField({ supports_vision: false }, [{ path: 'supports_vision' }])).toEqual({ declared: true, value: false })
    expect(readBooleanField({ supports_vision: true }, [{ path: 'supports_vision' }])).toEqual({ declared: true, value: true })
    expect(readBooleanField({}, [{ path: 'supports_vision' }])).toEqual({ declared: false })
    // 非布尔标量不算声明。
    expect(readBooleanField({ supports_vision: 'yes' }, [{ path: 'supports_vision' }])).toEqual({ declared: false })
  })

  it('supports array membership and object non-emptiness', () => {
    expect(readBooleanField({ supported_parameters: ['tools', 'temperature'] }, [
      { path: 'supported_parameters', read: 'includes', token: 'tools' }
    ])).toEqual({ declared: true, value: true })
    expect(readBooleanField({ supported_parameters: ['temperature'] }, [
      { path: 'supported_parameters', read: 'includes', token: 'tools' }
    ])).toEqual({ declared: true, value: false })
    // 字段不存在 ⇒ 未声明（不能因为"没有"就断言 false）。
    expect(readBooleanField({}, [
      { path: 'supported_parameters', read: 'includes', token: 'tools' }
    ])).toEqual({ declared: false })

    expect(readBooleanField({ effort: { supported_levels: ['high'] } }, [
      { path: 'effort', read: 'non-empty' }
    ])).toEqual({ declared: true, value: true })
    expect(readBooleanField({ effort: {} }, [
      { path: 'effort', read: 'non-empty' }
    ])).toEqual({ declared: true, value: false })
  })

  it('supports comma-separated membership on a single string field', () => {
    const source = [{ path: 'endpoints', read: 'split-includes' as const, token: 'responses' }]
    expect(readBooleanField({ endpoints: 'chat_completions,responses' }, source)).toEqual({ declared: true, value: true })
    // 未命中也是"已声明 false"。
    expect(readBooleanField({ endpoints: 'chat_completions' }, source)).toEqual({ declared: true, value: false })
    // 空串 / 全空白 ⇒ **未声明**（"没填这条信息" ≠ "明确不支持"）：
    // AIHubMix 有 769 条空 endpoints，按"声明 false"会把它标成整家中转站都不支持 messages。
    expect(readBooleanField({ endpoints: '' }, source)).toEqual({ declared: false })
    expect(readBooleanField({ endpoints: '   ' }, source)).toEqual({ declared: false })
    // 不是字符串 ⇒ 未声明。
    expect(readBooleanField({ endpoints: ['responses'] }, source)).toEqual({ declared: false })
    expect(readBooleanField({ endpoints: 1 }, source)).toEqual({ declared: false })
    expect(readBooleanField({}, source)).toEqual({ declared: false })
    // 多余空格 + 大小写都不影响比较。
    expect(readBooleanField({ endpoints: ' Chat_Completions , RESPONSES , claude_api ' }, source)).toEqual({
      declared: true,
      value: true
    })
    expect(readBooleanField({ endpoints: 'chat_completions ,RESPONSES' }, [
      { path: 'endpoints', read: 'split-includes', token: ' Responses ' }
    ])).toEqual({ declared: true, value: true })
    // 只做整段匹配：`claude_api_v2` 不算 `claude_api`。
    expect(readBooleanField({ endpoints: 'claude_api_v2' }, [
      { path: 'endpoints', read: 'split-includes', token: 'claude_api' }
    ])).toEqual({ declared: true, value: false })
  })

  it('parses numbers from strings and applies the per-token scale', () => {
    expect(readNumberField({ context_length: '256000' }, [{ path: 'context_length' }])).toEqual({
      declared: true,
      value: 256000
    })
    expect(readNumberField({ pricing: { input: '0.00000012' } }, [
      { path: 'pricing.input', scale: 1e6 }
    ])).toEqual({ declared: true, value: 0.12 })
    expect(readNumberField({ context_length: '' }, [{ path: 'context_length' }])).toEqual({ declared: false })
  })

  it('prefers the first declared source and keeps source order meaningful', () => {
    const sources = [{ path: 'effective_pricing.prompt' }, { path: 'pricing.prompt' }]
    expect(readNumberField({
      effective_pricing: { prompt: '4.00000000' },
      pricing: { prompt: '8.00000000' }
    }, sources)).toEqual({ declared: true, value: 4 })
    expect(readNumberField({ pricing: { prompt: '8.00000000' } }, sources)).toEqual({ declared: true, value: 8 })
  })

  it('reads strings and the first non-empty display name', () => {
    expect(readStringField({ currency: 'CNY' }, [{ path: 'currency' }])).toEqual({ declared: true, value: 'CNY' })
    expect(readStringField({ currency: '   ' }, [{ path: 'currency' }])).toEqual({ declared: false })
    expect(readFirstString({ display_name: 'AutoModel', title: 'x' }, ['display_name', 'title'])).toBe('AutoModel')
    expect(readFirstString({ display_name: '  ', title: 'x' }, ['display_name', 'title'])).toBe('x')
    expect(readFirstString({}, ['name'])).toBeUndefined()
  })

  it('matches an array entry by type and reads its subfield', () => {
    const payload = {
      prices: [
        {
          range_name: 'Default',
          prices: [
            { type: 'input_token', price: '12', price_unit: '每百万tokens' },
            { type: 'output_token', price: '36', price_unit: '每百万tokens' }
          ]
        }
      ]
    }
    const matches = (equals: string) => [{
      path: 'prices.0.prices',
      read: 'match' as const,
      where: { path: 'type', equals },
      valuePath: 'price'
    }]

    expect(readNumberField(payload, matches('input_token'))).toEqual({ declared: true, value: 12 })
    // where.equals / where.path 都 trim 后不区分大小写比较。
    expect(readNumberField(payload, matches('  INPUT_TOKEN '))).toEqual({ declared: true, value: 12 })
    expect(readNumberField(payload, matches('output_token'))).toEqual({ declared: true, value: 36 })
    // 未命中 ⇒ 未声明（不能拿第一项兜底）。
    expect(readNumberField(payload, matches('input_token_cache'))).toEqual({ declared: false })
  })

  it('reads match values as strings and applies scale after matching', () => {
    const payload = {
      prices: [{ prices: [{ type: 'input_token', price: '0.012', price_unit: '每千tokens' }] }]
    }
    expect(readNumberField(payload, [{
      path: 'prices.0.prices',
      read: 'match',
      where: { path: 'type', equals: 'input_token' },
      valuePath: 'price',
      scale: 1000
    }])).toEqual({ declared: true, value: 12 })
    expect(readStringField(payload, [{
      path: 'prices.0.prices',
      read: 'match',
      where: { path: 'type', equals: 'input_token' },
      valuePath: 'price_unit'
    }])).toEqual({ declared: true, value: '每千tokens' })
  })

  it('treats a non-array match path and unusable matched values as undeclared', () => {
    const source = [{
      path: 'prices',
      read: 'match' as const,
      where: { path: 'type', equals: 'input_token' },
      valuePath: 'price'
    }]
    // 不是数组（对象 / null / 字符串都不能当数组读）。
    expect(readNumberField({ prices: { type: 'input_token', price: '12' } }, source)).toEqual({ declared: false })
    expect(readNumberField({ prices: null }, source)).toEqual({ declared: false })
    expect(readNumberField({ prices: 'input_token' }, source)).toEqual({ declared: false })
    // 数组为空 / 命中项的子字段不是数字。
    expect(readNumberField({ prices: [] }, source)).toEqual({ declared: false })
    expect(readNumberField({ prices: [{ type: 'input_token', price: 'free' }] }, source)).toEqual({ declared: false })
    expect(readNumberField({ prices: [{ type: 'input_token' }] }, source)).toEqual({ declared: false })
  })

  it('reads kind values from single fields and arrays, keeping the raw type', () => {
    expect(readKindValues({ type: 'speech_model' }, [{ path: 'type', read: 'value' }])).toEqual({
      values: ['speech_model'],
      typeValue: 'speech_model'
    })
    expect(readKindValues({ type: '  ' }, [{ path: 'type', read: 'value' }])).toEqual({
      values: [],
      typeValue: undefined
    })
    expect(readKindValues({
      domain: 'LLM',
      task_type: ['TextGeneration', 'VisualQuestionAnswering']
    }, [
      { path: 'domain', read: 'value' },
      { path: 'task_type', read: 'includes' }
    ])).toEqual({
      values: ['llm', 'textgeneration', 'visualquestionanswering'],
      typeValue: 'LLM'
    })
    expect(readKindValues({
      supportedGenerationMethods: ['generateContent', 'countTokens']
    }, [{ path: 'supportedGenerationMethods', read: 'includes' }])).toEqual({
      values: ['generatecontent', 'counttokens'],
      typeValue: undefined
    })
    // 逗号分隔字符串：逐项切分、trim、小写；`type` 不透传（和数组读法一致）。
    expect(readKindValues({ types: ' image_generation, LLM ,search' }, [
      { path: 'types', read: 'split-includes' }
    ])).toEqual({
      values: ['image_generation', 'llm', 'search'],
      typeValue: undefined
    })
    // 空串 / 非字符串 / 缺失 ⇒ 没有 kind 值。
    expect(readKindValues({ types: '' }, [{ path: 'types', read: 'split-includes' }])).toEqual({
      values: [],
      typeValue: undefined
    })
    expect(readKindValues({ types: ['llm'] }, [{ path: 'types', read: 'split-includes' }])).toEqual({
      values: [],
      typeValue: undefined
    })
  })
})
