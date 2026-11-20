import { describe, expect, it } from 'vitest'

import { productText } from './productText'

/**
 * 月历格子里那个「+N 条」的三层文案（产品经理 2026-11-14 定）。
 *
 * 那个数字**同时含两类**：一二级超出显示上限的、以及未分级的。所以任何写死「未分级」的短句
 * 都会和数字对不上——格子里只放数字+量词，悬停一句话说清，读屏把两个拆分项分别说出。
 */
const PLACEHOLDERS: Record<string, readonly string[]> = {
  chip: ['{count}'],
  title: ['{count}'],
  'aria.both': ['{total}', '{shown}', '{hidden}', '{tiered}', '{untiered}'],
  'aria.tieredOnly': ['{total}', '{shown}', '{hidden}'],
  'aria.untieredOnly': ['{total}', '{shown}', '{hidden}']
}

describe('month cell overflow copy', () => {
  it('carries all three layers in both languages with their placeholders', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const block = productText[language].pages.intelligence.portal.calendar.cellOverflow as unknown as {
        chip: string; title: string; aria: Record<string, string>
      }
      const sentences: Record<string, string> = {
        chip: block.chip,
        title: block.title,
        'aria.both': block.aria.both,
        'aria.tieredOnly': block.aria.tieredOnly,
        'aria.untieredOnly': block.aria.untieredOnly
      }
      for (const [key, placeholders] of Object.entries(PLACEHOLDERS)) {
        const sentence = sentences[key]
        expect(sentence, `${language} ${key}`).toBeTruthy()
        for (const placeholder of placeholders) {
          expect(sentence, `${language} ${key}`).toContain(placeholder)
        }
      }
    }
  })

  it('keeps the two hidden causes in separate sentences instead of one blended number', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const aria = (productText[language].pages.intelligence.portal.calendar.cellOverflow as unknown as {
        aria: Record<string, string>
      }).aria
      // 三条读屏句必须互不相同：同一句套三种情形，等于把「超限的一二级」和「未分级」混成一种。
      expect(new Set([aria.both, aria.tieredOnly, aria.untieredOnly]).size, language).toBe(3)
      // 「两类都有」那句必须同时说出两个拆分项，少了任一个读者就分不清「其中几条重要」。
      expect(aria.both, language).toContain('{tiered}')
      expect(aria.both, language).toContain('{untiered}')
    }
  })
})
