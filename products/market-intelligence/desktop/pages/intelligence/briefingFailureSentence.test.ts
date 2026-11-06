import { describe, expect, it } from 'vitest'

import { briefingFailureSentence, type BriefingFailureSentences } from './briefingFailureSentence'
import { productText } from '../../shared/i18n/productText'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

const sentences: BriefingFailureSentences = {
  'editorial-timeout': { step: '写稿', what: '还没等到返回，这次没写完', next: '重试一次，或换一个响应更快的模型' }
}
const formatDuration = (durationMs: number): string => `${Math.round(durationMs / 60_000)} 分钟`

const compose = (input: Partial<Parameters<typeof briefingFailureSentence>[0]> = {}) => briefingFailureSentence({
  code: 'editorial-timeout',
  sentences,
  templates: text.failureSentenceTemplates,
  formatDuration,
  ...input
})

describe('the failure reason is a sentence, not a code label', () => {
  it('names the step that stopped, what happened and how long it took', () => {
    // 用户 2026-11-06：写稿那一步卡了两分钟，读者要能读到这件事本身。
    expect(compose({ failedStage: '写稿', durationMs: 120_000 })).toEqual({
      reason: '写稿没跑完：还没等到返回，这次没写完（用了 2 分钟）',
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

  it('says nothing at all for a code the table has no sentence for', () => {
    // 宁可退回原来的标签，也不许拼出半句人话。
    expect(compose({ code: 'rate-limited' })).toBeUndefined()
    expect(compose({ code: undefined })).toBeUndefined()
  })
})

describe('the failure sentence table is a closed set', () => {
  const failureKeys = (): string[] => Object.keys(text.aiSettings.failure)

  it('never carries an entry for a code that does not exist', () => {
    for (const code of Object.keys(text.failureSentences)) expect(failureKeys()).toContain(code)
  })

  // `02` v2.143：每个失败码一条人话，新增码必须同笔补句子，缺一即红。表由产品逐条给；
  // 表到齐后把这条从 todo 改成 it —— 它会在缺任何一个码时红。
  it.todo('has exactly one sentence for every failure code the panel can show')
})
