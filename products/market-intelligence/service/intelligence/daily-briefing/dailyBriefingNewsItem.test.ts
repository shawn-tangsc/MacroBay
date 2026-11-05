import { describe, expect, it } from 'vitest'

import type { NewsSentimentItemView } from '../news-sentiment/newsSentimentQuery'
import { toBriefingNewsItem } from './dailyBriefingNewsItem'

const item = (overrides: Partial<NewsSentimentItemView> = {}): NewsSentimentItemView =>
  ({
    itemId: 'item-1',
    title: 'U.S. Democratic sweep could be the final nail in the Clarity Act coffin',
    sourceId: 'rss:coindesk',
    sourceName: 'CoinDesk RSS',
    publishedAt: '2026-11-05T00:11:00.000Z',
    scoredAt: '2026-11-05T00:12:00.000Z',
    polarity: 'bearish',
    strength: 'strong',
    confidence: 0.8,
    symbols: [],
    caveats: [],
    ...overrides
  }) as NewsSentimentItemView

describe('a briefing item keeps the headline in the edition’s own language', () => {
  it('uses a translation that was made for this edition’s language', () => {
    // 列表页有一条中文标题翻译（`targetLocale: zh-CN`），日报是中文版，就该用它。此前的代码只认
    // 「正文翻译」带出来的 `titleLocale`，标题翻译那条不带语言，判断永远不成立，退回英文原文——
    // 同一篇文章列表页是中文、日报里是英文，原因就在这里。
    const mapped = toBriefingNewsItem(
      item({ displayTitle: '美国民主党大获全胜可能成为“Clarity Act”棺材上的最后一颗钉子', titleLocale: 'zh-CN' }),
      'zh-CN'
    )
    expect(mapped.translatedTitle).toBe('美国民主党大获全胜可能成为“Clarity Act”棺材上的最后一颗钉子')
  })

  it('refuses a translation made for another language, and keeps the original', () => {
    // 防呆必须保留：英文版里不许串进中文标题。
    const mapped = toBriefingNewsItem(
      item({ displayTitle: '美国民主党大获全胜可能成为…', titleLocale: 'zh-CN' }),
      'en-US'
    )
    expect(mapped.translatedTitle).toBeUndefined()
    expect(mapped.title).toContain('Democratic sweep')
  })

  it('never treats a title it cannot place as same-language', () => {
    // 没有语言标记就不知道它是什么语言——不许当成“和本期一样”。
    const mapped = toBriefingNewsItem(item({ displayTitle: '中文标题但没有标记' }), 'zh-CN')
    expect(mapped.translatedTitle).toBeUndefined()
  })

  it('drops a "translation" that is just the original string', () => {
    const mapped = toBriefingNewsItem(item({ displayTitle: 'U.S. Democratic sweep could be the final nail in the Clarity Act coffin', titleLocale: 'en-US' }), 'zh-CN')
    expect(mapped.translatedTitle).toBeUndefined()
  })
})
