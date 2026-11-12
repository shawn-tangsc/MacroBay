import { describe, expect, it } from 'vitest'

import { productText } from './productText'

/**
 * 「额度用尽」和「套餐不含」在界面上必须是两句话（用户 2026-11-13：没有与拿不到要分开）。
 *
 * 前者是这个月用完了、下个月会回来；后者是这条路走不通。折成一句，读者改不了自己的动作。
 * 另外**不许写恢复时间**：我们不知道额度何时恢复，写「下月 1 日」就是编的——所以句子里的数字
 * 一律为 0（日期一定带数字，这是一个能红的判据，不是措辞白名单）。
 */
const languages = ['zh-CN', 'en-US'] as const

function failureCodeSentence(language: typeof languages[number], code: string): string | undefined {
  const codes = (productText[language].settings.intelligenceSources.syncRun as {
    failureCodes?: Record<string, string>
  }).failureCodes
  return codes?.[code]
}

describe('credential failure copy', () => {
  it('has a sentence for credits-exhausted in both languages', () => {
    for (const language of languages) {
      const sentence = failureCodeSentence(language, 'credits-exhausted')
      expect(sentence, language).toBeTruthy()
      expect(sentence!.trim().length, language).toBeGreaterThan(0)
    }
  })

  it('never says an exhausted quota is a restricted plan', () => {
    for (const language of languages) {
      const exhausted = failureCodeSentence(language, 'credits-exhausted')
      const restricted = failureCodeSentence(language, 'plan-restricted')
      expect(exhausted, language).not.toBe(restricted)
    }
  })

  it('states no recovery time', () => {
    for (const language of languages) {
      expect(failureCodeSentence(language, 'credits-exhausted'), language).not.toMatch(/\d/)
    }
  })
})
