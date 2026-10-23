import { describe, expect, it } from 'vitest'

import { economicCalendarPresentationPolicy } from '../../features/macro/economic-calendar/economicCalendarModel'
import { productText } from './productText'

/**
 * 一个发布，一个名字（设计 145 §8 D）。
 *
 * 同一个发布曾经有两份词表：图表竖线读分析侧的 `readableNames.eventName`（「核心 CPI」），
 * 日历与它打开的抽屉读 `calendar.events`（「Core CPI（核心消费者价格指数）」）——同一份发布在
 * 两个渲染面读两个名字，是读者已经指出的瑕疵。现在分析侧是唯一 owner，日历侧的 `events` 是同一份
 * 值的引用（只多一个「未注册官方行」的兜底词）。
 *
 * 这三条断言就是"唯一 owner"的机器证明：谁想给已注册的发布在日历侧另起一个名字，这里先红。
 */
const locales = ['zh-CN', 'en-US'] as const

const analysisNames = (locale: typeof locales[number]): Record<string, string> =>
  productText[locale].pages.intelligence.portal.analysisWorkspace.readableNames.eventName as Record<string, string>
const calendarNames = (locale: typeof locales[number]): Record<string, string> =>
  productText[locale].pages.intelligence.portal.calendar.events as Record<string, string>

describe('registered release names', () => {
  it('names exactly the calendar\'s registered releases, in both locales', () => {
    const registered = [...economicCalendarPresentationPolicy.titleKeys].sort()
    for (const locale of locales) {
      expect(Object.keys(analysisNames(locale)).sort(), `analysis eventName (${locale})`).toEqual(registered)
      // The calendar surface carries the same releases plus the one fallback key for an official row
      // whose title key is not registered at all.
      expect(Object.keys(calendarNames(locale)).sort(), `calendar events (${locale})`).toEqual([...registered, 'unknown'].sort())
    }
  })

  it('gives the calendar surface the analysis side\'s own names, not a second set of words', () => {
    for (const locale of locales) {
      const names = analysisNames(locale)
      for (const [key, name] of Object.entries(names)) {
        expect(calendarNames(locale)[key], `${locale}:${key}`).toBe(name)
      }
    }
  })

  it('keeps the unregistered-official fallback out of the release vocabulary', () => {
    for (const locale of locales) {
      const fallback = calendarNames(locale).unknown
      expect(fallback, locale).toBeTruthy()
      // It is a surface fallback ("an official macro event"), never a name for a release: no
      // registered release may end up reading it.
      expect(Object.values(analysisNames(locale)), locale).not.toContain(fallback)
    }
  })
})
