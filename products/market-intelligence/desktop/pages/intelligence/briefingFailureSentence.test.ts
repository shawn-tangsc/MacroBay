import { describe, expect, it } from 'vitest'

import { briefingFailureSentence, type BriefingFailureSentences } from './briefingFailureSentence'
import { productText } from '../../shared/i18n/productText'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

const sentences: BriefingFailureSentences = {
  'editorial-timeout': { step: '写稿', what: '还没等到返回，这次没写完', next: '重试一次，或换一个响应更快的模型' }
}
const fallback = { step: '生成', what: '这一期没能生成出来', next: '重新生成一次' }
const compose = (input: Partial<Parameters<typeof briefingFailureSentence>[0]> = {}) => briefingFailureSentence({
  code: 'editorial-timeout',
  sentences,
  fallback,
  templates: text.failureSentenceTemplates,
  ...input
})

describe('the failure reason is a sentence, not a code label', () => {
  it('names the step that stopped and what happened, with no duration clause', () => {
    // 用户 2026-11-06：写稿那一步卡了两分钟，读者要能读到这件事本身。
    expect(compose({ failedStage: '写稿', durationMs: 120_000 })).toEqual({
      reason: '写稿没跑完：还没等到返回，这次没写完',
      next: '接下来：重试一次，或换一个响应更快的模型'
    })
  })

  it('drops the duration clause entirely when it cannot be computed, never an empty bracket', () => {
    const sentence = compose({ failedStage: '写稿' })
    expect(sentence?.reason).toBe('写稿没跑完：还没等到返回，这次没写完')
    expect(sentence?.reason).not.toContain('（）')
    expect(sentence?.reason).not.toContain('{duration}')
  })

  it('falls back to the table’s own step name when the attempt stopped before any stage', () => {
    // 模型没配好这种：一步都没进，trace 里没有卡住的步骤。
    expect(compose({})?.reason).toBe('这次在写稿就停下了：还没等到返回，这次没写完')
  })

  it('falls back to one sentence for a code the table does not carry, never the code itself', () => {
    // 表外码的唯一出口：兜底句。读者不会在这里看到内部代号。
    expect(compose({ code: 'not-in-the-table' })).toEqual({
      reason: '这次在生成就停下了：这一期没能生成出来',
      next: '接下来：重新生成一次'
    })
    expect(compose({ code: undefined })?.reason).toContain('这一期没能生成出来')
  })
})

describe('the failure sentence table is a closed set', () => {
  const failureKeys = (): string[] => Object.keys(text.aiSettings.failure)

  it('never carries an entry for a code that does not exist', () => {
    for (const code of Object.keys(text.failureSentences)) expect(failureKeys()).toContain(code)
  })

  // `02` v2.143/v2.145：每个失败码一条人话，新增码必须同笔补句子，缺一即红——两个方向都断言。
  it('has exactly one sentence for every failure code the panel can show', () => {
    expect(Object.keys(text.failureSentences).sort()).toEqual(failureKeys().sort())
  })

  it('keeps the two languages on the same key set', () => {
    const en = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing.failureSentences
    expect(Object.keys(en).sort()).toEqual(Object.keys(text.failureSentences).sort())
  })

  it('never repeats the step name at the start of what happened, and never states the duration', () => {
    // 否则会拼出「写稿没跑完：写稿等了两分钟」。句首重名是这条要防的形状；
    // 句中顺带提到同一步（比如「译文没通过校验」）是自然中文，不改产品原话。
    for (const [code, entry] of Object.entries(text.failureSentences)) {
      expect(entry.what.startsWith(entry.step), code).toBe(false)
      expect(entry.what, code).not.toMatch(/\d+\s*(分钟|秒|小时|分)/)
      expect(entry.next.length, code).toBeGreaterThan(0)
    }
  })
})
