import { expect, it } from 'vitest'
import { productText } from './productText'

// 这张表的值既有句子也有嵌套块（事件语境那几组标签），所以只能按 unknown 收：
// 断言只比「键集合」与「值非空」，不做类型收窄——收窄反而会把这个异质结构说成一种。
const card = (locale: 'zh-CN' | 'en-US'): Readonly<Record<string, unknown>> =>
  productText[locale].pages.intelligence.portal.calendarCard as unknown as Readonly<Record<string, unknown>>

it('keeps the card copy complete and identical in both locales', () => {
  expect(Object.keys(card('zh-CN')).sort()).toEqual(Object.keys(card('en-US')).sort())
  for (const key of Object.keys(card('zh-CN'))) {
    expect(card('zh-CN')[key], `zh ${key}`).toBeTruthy()
    expect(card('en-US')[key], `en ${key}`).toBeTruthy()
    // Nested blocks (the event-context labels) must match key for key too.
    if (typeof card('zh-CN')[key] === 'object') {
      expect(Object.keys(card('en-US')[key] as object).sort()).toEqual(Object.keys(card('zh-CN')[key] as object).sort())
    }
    // A raw key must never reach the reader.
    expect(card('zh-CN')[key]).not.toBe(key)
    expect(card('en-US')[key]).not.toBe(key)
  }
})

it('names every string the card and the column controls need', () => {
  expect(Object.keys(card('zh-CN')).sort()).toEqual([
    'agentTitle', 'awaitingData', 'categories', 'clearConversation', 'closeAgent', 'collapseAgent', 'copyEvent', 'dxy', 'empty', 'eventContext', 'expandAgent', 'importanceHigh', 'loading', 'openCalendar', 'openEventInCalendar', 'reactionHint', 'refresh', 'releasedEmpty',
    'staleNotice', 'surprise', 'switchToAgent', 'switchToCalendar', 'timePending', 'title', 'todaySection', 'unavailable', 'upcomingSection'
  ])
  // `loading` and `staleNotice` arrived with the three waiting states; a key the card renders but
  // this list does not know about is exactly what makes the list stop meaning anything.
})
