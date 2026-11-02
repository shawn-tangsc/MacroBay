import { expect, it } from 'vitest'
import { productText } from './productText'

const card = (locale: 'zh-CN' | 'en-US') => productText[locale].pages.intelligence.portal.calendarCard as Record<string, string>

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
