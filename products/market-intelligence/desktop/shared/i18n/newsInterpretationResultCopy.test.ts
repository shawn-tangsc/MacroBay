import { describe, expect, it } from 'vitest'

import { productText } from './productText'
import { newsInterpretationResultCopy, newsInterpretationResultCopyKeys } from './newsInterpretationResultCopy'

const resolve = (key: string, locale: 'zh-CN' | 'en-US'): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), productText[locale])

describe('「AI 解读」结果条文案（R37 §9.4）', () => {
  it('every closed code has a sentence and an action in both locales', () => {
    for (const code of ['analysis-not-enabled', 'analysis-provider-not-ready', 'analysis-initial-request-unavailable', 'analysis-initial-request-failed', 'analysis-event-group-not-found']) {
      const entry = newsInterpretationResultCopy({ failureCode: code })
      for (const locale of ['zh-CN', 'en-US'] as const) {
        expect(resolve(entry.sentenceKey, locale), `${locale} ${code}`).toBeTruthy()
        if (entry.actionKey) expect(resolve(entry.actionKey, locale), `${locale} ${code} action`).toBeTruthy()
      }
    }
    for (const reason of ['trigger-evidence-missing', 'market-facts-below-minimum']) {
      const entry = newsInterpretationResultCopy({ insufficientReason: reason })
      for (const locale of ['zh-CN', 'en-US'] as const) { expect(resolve(entry.sentenceKey, locale), `${locale} ${reason}`).toBeTruthy(); expect(resolve(entry.actionKey!, locale)).toBeTruthy() }
    }
  })

  it('gives the reader the action §9.4 prescribes, and none where the code is unknown', () => {
    // 开关/模型没就绪：去设置，不给重试——重试只会再失败一次。
    expect(newsInterpretationResultCopy({ failureCode: 'analysis-not-enabled' }).action).toBe('open-settings')
    expect(newsInterpretationResultCopy({ failureCode: 'analysis-provider-not-ready' }).action).toBe('open-settings')
    // 服务启动中与默认失败：可重试。
    expect(newsInterpretationResultCopy({ failureCode: 'analysis-initial-request-unavailable' }).action).toBe('retry')
    expect(newsInterpretationResultCopy({ failureCode: 'analysis-initial-request-failed' }).action).toBe('retry')
    // 内部状态不一致：原地重试无效，要刷新。
    expect(newsInterpretationResultCopy({ failureCode: 'analysis-event-group-not-found' }).action).toBe('refresh')
    // 事实不够是我们的问题：给「查看原因」，不给重试。
    expect(newsInterpretationResultCopy({ insufficientReason: 'trigger-evidence-missing' }).action).toBe('details')
    expect(newsInterpretationResultCopy({ insufficientReason: 'market-facts-below-minimum' }).action).toBe('details')
  })

  it('falls back for codes outside the table instead of forwarding every analysis-* code', () => {
    const entry = newsInterpretationResultCopy({ failureCode: 'analysis-provider-error' })
    expect(entry.sentenceKey).toBe('pages.intelligence.portal.dashboard.newsInterpretationResult.fallback.sentence')
    expect(entry.action).toBeNull()
    expect(newsInterpretationResultCopy({}).sentenceKey).toBe(entry.sentenceKey)
  })

  it('keeps the two locales in step with the closed code set', () => {
    for (const key of newsInterpretationResultCopyKeys) {
      expect(typeof resolve(key, 'zh-CN'), `zh-CN ${key}`).toBe('string')
      expect(typeof resolve(key, 'en-US'), `en-US ${key}`).toBe('string')
    }
    // 键表只有一份：文案里多出表外的状态句，说明有人在两处各写了一份。
    const states = Object.keys(((resolve('pages.intelligence.portal.dashboard.newsInterpretationResult.states', 'zh-CN') as Record<string, unknown>)))
    expect(states.sort()).toEqual([
      'analysis-event-group-not-found', 'analysis-initial-request-failed', 'analysis-initial-request-unavailable',
      'analysis-not-enabled', 'analysis-provider-not-ready',
      'insufficient-facts:market-facts-below-minimum', 'insufficient-facts:trigger-evidence-missing',
      'no-judgment', 'not-eligible'
    ].sort())
  })
})

describe('「没有判定」与「不够格」不和兜底共用一句话', () => {
  it('gives each its own sentence in both locales, with no action', () => {
    const fallback = newsInterpretationResultCopy({})
    for (const state of ['no-judgment', 'not-eligible'] as const) {
      const entry = newsInterpretationResultCopy({ state })
      expect(entry.action).toBeNull()
      expect(entry.sentenceKey).not.toBe(fallback.sentenceKey)
      for (const locale of ['zh-CN', 'en-US'] as const) {
        const sentence = resolve(entry.sentenceKey, locale)
        expect(typeof sentence, `${locale} ${state}`).toBe('string')
        expect(sentence, `${locale} ${state} must differ from fallback`).not.toBe(resolve(fallback.sentenceKey, locale))
      }
      // 两个状态之间也不许共用一句：它们是两件事（等得到 vs 本来就不该点）。
      expect(entry.sentenceKey).not.toBe(newsInterpretationResultCopy({ state: state === 'no-judgment' ? 'not-eligible' : 'no-judgment' }).sentenceKey)
    }
  })
})
