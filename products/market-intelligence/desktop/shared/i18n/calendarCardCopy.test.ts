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
    'agentTitle', 'awaitingData', 'categories', 'clearConversation', 'closeAgent', 'collapseAgent', 'copyEvent', 'dxy', 'empty', 'eventContext', 'expandAgent', 'filterNote', 'importanceHigh', 'loading', 'openCalendar', 'openEventInCalendar', 'reactionHint', 'refresh', 'releasedEmpty',
    'staleNotice', 'surprise', 'switchToAgent', 'switchToCalendar', 'timePending', 'title', 'todaySection', 'unavailable', 'unknownCountry', 'upcomingSection'
  ])
  // `loading` and `staleNotice` arrived with the three waiting states; `unknownCountry` arrived with
  // the three-step country fallback (the card used to draw nothing when the name was missing).
  // 这张表的用处就在这：卡片渲染了、而这份清单不知道的键，正是让清单失去意义的那种漂移。
})

/**
 * 「金融事件」只能有一个叫法（用户 2026-11-19）。
 *
 * 同一个类别出现在三处：卡片分类（`calendarCard.categories`）、tooltip 与抽屉行尾（`calendar.market.kinds`）。
 * 以前列表那处写「财经事件」、其余写「金融事件」，读者会以为是两类东西。这条断言把三处钉在同一个词上——
 * 谁以后再改其中一处，这里当场红。
 */
it('names the financial-event category the same way in the card, the tooltip and the drawer row', () => {
  // 中文侧必须**逐字相同**：同一个类别不许两个词。
  const zh = productText['zh-CN'].pages.intelligence.portal
  for (const kind of ['economic-indicator', 'financial-event', 'central-bank-activity'] as const) {
    expect(zh.calendarCard.categories[kind]).toBe(zh.calendar.market.kinds[kind])
  }
  // 英文侧只查**同一个词根**：卡片标签是单数（`Indicator`）、类别表是复数（`Economic indicators`），
  // 这是英文的语法差别，不是两套叫法；谁把 financial 换成别的词，这里会红。
  const en = productText['en-US'].pages.intelligence.portal
  expect(en.calendarCard.categories['financial-event']).toMatch(/^Financial events?$/u)
  expect(en.calendar.market.kinds['financial-event']).toBe('Financial events')
  // 中文侧的实际用词：金融事件（不是财经事件）。
  expect(productText['zh-CN'].pages.intelligence.portal.calendar.market.kinds['financial-event']).toBe('金融事件')
})
