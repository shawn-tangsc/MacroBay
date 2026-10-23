import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import {
  buildModelProtocolCounts,
  emptyModelProtocolFilter,
  matchesModelProtocol
} from './modelProtocolFilter'

/**
 * PLAT-82：协议 pill 只看模型的 `supportedProtocols`（厂商声明 ∪ 供应商实际可用协议），
 * **不再从 `chatProtocol` 反推** —— 一个模型可以同时支持多条协议。
 */
function model(overrides: Partial<ModelDefinition>): ModelDefinition {
  return { id: 'm', name: 'M', capabilities: { chat: true }, ...overrides }
}

describe('PLAT-82 protocol filter', () => {
  const chatAndMessages = model({
    id: 'a',
    chatProtocol: 'chat-completions',
    messagesSupport: 'yes',
    supportedProtocols: ['chat-completions', 'messages']
  })
  const chatAndResponses = model({
    id: 'r',
    chatProtocol: 'chat-completions',
    responsesSupport: 'yes',
    supportedProtocols: ['chat-completions', 'responses']
  })
  const gemini = model({ id: 'g', chatProtocol: 'gemini', supportedProtocols: ['gemini'] })
  const plain = model({ id: 'p', chatProtocol: 'chat-completions', supportedProtocols: ['chat-completions'] })

  it('counts the four chat protocols independently', () => {
    expect(buildModelProtocolCounts([chatAndMessages, chatAndResponses, gemini, plain])).toEqual({
      'chat-completions': 3,
      responses: 1,
      messages: 1,
      gemini: 1
    })
  })

  it('narrows by whichever protocol toggles are on', () => {
    expect(matchesModelProtocol(chatAndMessages, emptyModelProtocolFilter)).toBe(true)
    expect(matchesModelProtocol(chatAndResponses, { ...emptyModelProtocolFilter, messages: true })).toBe(false)
    expect(matchesModelProtocol(chatAndResponses, { ...emptyModelProtocolFilter, responses: true })).toBe(true)
    expect(matchesModelProtocol(gemini, { ...emptyModelProtocolFilter, gemini: true })).toBe(true)
    expect(matchesModelProtocol(plain, { ...emptyModelProtocolFilter, responses: true })).toBe(false)
    // chat/completions 维度 = 支持 chat/completions 的聊天模型；非聊天族不命中。
    const embedding = model({ id: 'bge-m3', capabilities: { chat: false, embedding: true } })
    expect(matchesModelProtocol(embedding, { ...emptyModelProtocolFilter, 'chat-completions': true })).toBe(false)
  })

  it('falls back to the legacy derivation when supportedProtocols is missing (migration window)', () => {
    // 线上回归：字段是后加的，迁移前的行还没有值 —— 不能因为缺字段就把 pill 全清零。
    expect(buildModelProtocolCounts([
      model({ id: 'legacy-messages', chatProtocol: 'chat-completions', messagesSupport: 'yes' })
    ])).toEqual({ 'chat-completions': 1, responses: 0, messages: 1, gemini: 0 })
    expect(buildModelProtocolCounts([
      model({ id: 'legacy-responses', chatProtocol: 'responses', responsesSupport: 'yes' })
    ])).toEqual({ 'chat-completions': 0, responses: 1, messages: 0, gemini: 0 })
    expect(buildModelProtocolCounts([
      model({ id: 'legacy-gemini', chatProtocol: 'gemini' })
    ])).toEqual({ 'chat-completions': 0, responses: 0, messages: 0, gemini: 1 })
    expect(buildModelProtocolCounts([model({ id: 'legacy-plain', chatProtocol: 'chat-completions' })]))
      .toEqual({ 'chat-completions': 1, responses: 0, messages: 0, gemini: 0 })
    // 什么都没有 ⇒ 仍然不落在任何 pill 上。
    expect(buildModelProtocolCounts([model({ id: 'legacy-unknown' })]))
      .toEqual({ 'chat-completions': 0, responses: 0, messages: 0, gemini: 0 })
  })

  it('never lets the messages pill fall below what the row icon shows (PLAT-82 regression)', () => {
    // 行内 Anthropic 图标读 `messagesSupport === 'yes'`；pill 必须包含同一个模型。
    const declared = model({ id: 'declared-messages', chatProtocol: 'chat-completions', messagesSupport: 'yes' })
    expect(buildModelProtocolCounts([declared]).messages).toBe(1)

    // 即使 `supportedProtocols` 已存在但漏了 messages（历史脏数据），也要以声明为准。
    const stale = model({
      id: 'stale-supported',
      chatProtocol: 'chat-completions',
      messagesSupport: 'yes',
      supportedProtocols: ['chat-completions']
    })
    expect(buildModelProtocolCounts([stale]).messages).toBe(1)
    expect(matchesModelProtocol(stale, { ...emptyModelProtocolFilter, messages: true })).toBe(true)

    // DeepSeek 口径：49 条模型里 2 条上游声明 messages ⇒ Messages 2。
    const deepseek = [
      model({ id: 'deepseek-v4-flash', chatProtocol: 'chat-completions', messagesSupport: 'yes' }),
      model({ id: 'deepseek-v4-pro', chatProtocol: 'chat-completions', messagesSupport: 'yes' }),
      ...Array.from({ length: 47 }, (_, index) =>
        model({ id: `deepseek-plain-${index}`, chatProtocol: 'chat-completions', messagesSupport: 'no' }))
    ]
    expect(buildModelProtocolCounts(deepseek)).toMatchObject({ 'chat-completions': 49, messages: 2 })
  })

  it('adds declarations on top of an existing supportedProtocols set', () => {
    const model1 = model({
      id: 'declared-plus-supported',
      chatProtocol: 'chat-completions',
      responsesSupport: 'yes',
      supportedProtocols: ['chat-completions']
    })
    expect(buildModelProtocolCounts([model1])).toEqual({
      'chat-completions': 1,
      responses: 1,
      messages: 0,
      gemini: 0
    })
  })

  it('counts every protocol a LANYUN model declares via api_paths', () => {
    // 单条模型同时含三条路径 ⇒ 三个 pill 都要计数（旧的 chatProtocol 反推只能命中一个）。
    const allThree = model({
      id: 'automodel',
      chatProtocol: 'messages',
      supportedProtocols: ['chat-completions', 'responses', 'messages']
    })
    expect(buildModelProtocolCounts([allThree])).toEqual({
      'chat-completions': 1,
      responses: 1,
      messages: 1,
      gemini: 0
    })
    expect(matchesModelProtocol(allThree, { ...emptyModelProtocolFilter, messages: true, responses: true })).toBe(true)
  })

  it('counts TokenRhythm chat models that also declare responses (Chat 26 / Responses 15 / Messages 11)', () => {
    // 声明了 responses 的模型 `chatProtocol` 会快照成 responses，但它**仍然**支持 chat/completions。
    const models = [
      ...Array.from({ length: 15 }, (_, index) =>
        model({
          id: `responses-${index}`,
          chatProtocol: 'responses',
          responsesSupport: 'yes',
          supportedProtocols: ['chat-completions', 'responses']
        })),
      ...Array.from({ length: 11 }, (_, index) =>
        model({
          id: `messages-${index}`,
          chatProtocol: 'chat-completions',
          messagesSupport: 'yes',
          supportedProtocols: ['chat-completions', 'messages']
        }))
    ]
    expect(buildModelProtocolCounts(models)).toEqual({
      'chat-completions': 26,
      responses: 15,
      messages: 11,
      gemini: 0
    })
  })

  it('never puts a pure Gemini model on chat/completions', () => {
    const pureGemini = model({ id: 'gemini-3.5-flash', chatProtocol: 'gemini', supportedProtocols: ['gemini'] })
    expect(buildModelProtocolCounts([pureGemini])).toEqual({
      'chat-completions': 0,
      responses: 0,
      messages: 0,
      gemini: 1
    })
    expect(matchesModelProtocol(pureGemini, { ...emptyModelProtocolFilter, 'chat-completions': true })).toBe(false)
  })

  it('never infers messages support from the model id (PLAT-82)', () => {
    // 上游没返回、也没实测过 ⇒ unknown，不能因为 id 像 glm-* 就说支持 messages。
    const byPrefix = model({ id: 'glm-4.5', chatProtocol: 'chat-completions', supportedProtocols: ['chat-completions'] })
    expect(buildModelProtocolCounts([byPrefix])).toEqual({
      'chat-completions': 1,
      responses: 0,
      messages: 0,
      gemini: 0
    })
    expect(matchesModelProtocol(byPrefix, { ...emptyModelProtocolFilter, messages: true })).toBe(false)
  })
})
