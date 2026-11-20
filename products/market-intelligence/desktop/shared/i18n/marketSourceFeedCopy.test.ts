import { describe, expect, it } from 'vitest'

import { productText } from './productText'

/**
 * 日历行上「这条是谁给的」按**真实来源**显示：六个 feed id，中英各六个名字。
 *
 * 旧的两档枚举把官方行一律说成 Narwhal——那是假话；而三个 Narwhal feed 是**同一次采集的三类**，
 * 不是三个来源，所以它们必须显示同一个名字（写差一个字，读者会当成三个源）。
 * 缺一个名字时渲染层会退到固定文案 `market.source`，不会印 id；这条守的是别退。
 */
const FEED_IDS = [
  'macro-calendar-bls',
  'macro-calendar-bea',
  'macro-calendar-fed',
  'macro-calendar-narwhal-economic-data',
  'macro-calendar-narwhal-financial-events',
  'macro-calendar-narwhal-central-bank-activities'
] as const

describe('market source names per feed', () => {
  it('names every feed in both languages', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const market = productText[language].pages.intelligence.portal.calendar.market as unknown as {
        sourceByFeed: Record<string, string>
      }
      for (const feedId of FEED_IDS) {
        expect(market.sourceByFeed[feedId], `${language} ${feedId}`).toBeTruthy()
      }
    }
  })

  it('carries a neutral sentence for a source it cannot name', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const market = productText[language].pages.intelligence.portal.calendar.market as unknown as { sourceUnknown: string }
      // 「不知道来源」不等于「没有这条发布」：中性一句话，不藏行、不印 id。
      expect(market.sourceUnknown, language).toBeTruthy()
    }
  })

  it('gives the three Narwhal feeds one and the same name', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const market = productText[language].pages.intelligence.portal.calendar.market as unknown as {
        sourceByFeed: Record<string, string>
      }
      const names = new Set([
        market.sourceByFeed['macro-calendar-narwhal-economic-data'],
        market.sourceByFeed['macro-calendar-narwhal-financial-events'],
        market.sourceByFeed['macro-calendar-narwhal-central-bank-activities']
      ])
      expect(names.size, language).toBe(1)
    }
  })
})
