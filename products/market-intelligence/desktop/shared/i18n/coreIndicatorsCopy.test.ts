import { describe, expect, it } from 'vitest'

import { productText } from './productText'

/**
 * 「核心指标」这组配置的文案（用户 2026-11-14）：导航项 + 四项 + 三档来源 + 两个显示开关 + **四种空态**。
 *
 * 四种空态里最容易被漏的是「本期已发布 · 盘口已下架」——盘按期结算下架是**正常态**，
 * 不单列它，读者会以为这个指标一直没有盘。这条把它钉住：少一项就红。
 */
const METRICS = ['cpiYoy', 'coreCpiYoy', 'nonfarmPayrolls', 'corePceYoy'] as const
const EMPTY_STATES = ['noMarket', 'marketSettled', 'incomplete', 'unconfigured'] as const

describe('core indicator settings copy', () => {
  it('keeps the menu item, whose content is source configuration rather than expectation order', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const text = productText[language].settings.intelligenceSources
      expect(text.businessTabs.coreIndicators, language).toBeTruthy()
      // 量词是「项指标」：这一项数的是指标，不是来源；写成「N 个源」会让读者以为这里能接数据源。
      expect(text.businessSubtitle.indicators, language).toContain('{count}')
      expect(text.businessSubtitle.indicators, language).not.toBe(text.businessSubtitle.sources)
    }
  })

  it('carries the four metrics and the three source options', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const block = productText[language].settings.intelligenceSources.coreIndicators
      for (const metric of METRICS) expect(block.metrics[metric], `${language} ${metric}`).toBeTruthy()
      for (const option of ['defaultChain', 'marketOnly', 'surveyOnly', 'manualOnly'] as const) {
        expect(block.sourceOrder.options[option], `${language} ${option}`).toBeTruthy()
      }
      expect(block.showVolume, language).toBeTruthy()
      expect(block.showAsOf, language).toBeTruthy()
    }
  })

  it('separates all four empty states, including the settled market', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const empty = productText[language].settings.intelligenceSources.coreIndicators.empty
      for (const state of EMPTY_STATES) expect(empty[state], `${language} ${state}`).toBeTruthy()
      const sentences = new Set(EMPTY_STATES.map((state) => empty[state]))
      expect(sentences.size, `${language}: 四种空态不能有两句一样`).toBe(EMPTY_STATES.length)
    }
  })
})
