import { describe, expect, it } from 'vitest'

import { productText } from '../productText'
import { releaseTimeWords } from './releaseTimeWords'

/**
 * 「发布时间未公布」只有这一个词：日历详情与日报正文都从它来。
 *
 * 判据是**两个消费者读到同一个字符串**，不是「两处都写了差不多的话」——两处各写一遍，
 * 下一次改文案就会只改一处，同一天在两个页面上出现两种说法。
 */
describe('one word for a release time the source never published', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    it(`is the calendar's word and the brief's word (${locale})`, () => {
      const portal = productText[locale].pages.intelligence.portal
      expect(portal.calendar.details.timeNotPublished).toBe(releaseTimeWords[locale])
      expect(portal.dashboard.dailyBriefing.macro.timeNotPublished).toBe(releaseTimeWords[locale])
    })
  }
})
