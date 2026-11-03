import { describe, expect, it } from 'vitest'
import { productText } from '../../../shared/i18n/productText'

/**
 * 刷新有结论时，界面上只出现这三句之一（`text.market[feedback.state]`）。
 *
 * 产品口径：`completed / partial / unavailable` 是**这一批刷新**的结论，不是读者的词。句子要说清
 * 发生了什么、读者现在看的是什么数据；「部分完成」「partial」一旦写进句子，读者会把「这一次刷新
 * 不顺」当成「这份日历的数据不完整」，然后去看的数是错的。
 *
 * 断言句子本身，不靠截图——截图只证明那一屏当时是对的，换个句子它照样过得去。
 */
const locales = [
  ['zh-CN', productText['zh-CN'].pages.intelligence.portal.calendar.market],
  ['en-US', productText['en-US'].pages.intelligence.portal.calendar.market]
] as const

describe('market calendar refresh feedback copy', () => {
  it('says what happened and what the reader is looking at, without naming the internal verdict', () => {
    expect(productText['zh-CN'].pages.intelligence.portal.calendar.market.partial).toBe('部分来源失败，保留已有数据')
    for (const [, market] of locales) {
      for (const state of ['completed', 'partial', 'unavailable'] as const) {
        // Case-folded so the English sentence cannot smuggle "Partially" past this either.
        expect(market[state].toLowerCase()).not.toContain('partial')
        expect(market[state]).not.toContain('部分完成')
      }
    }
  })
})
