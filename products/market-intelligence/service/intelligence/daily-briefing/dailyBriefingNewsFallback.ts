import type { NewsQuery } from './dailyBriefingSource'

/**
 * 没有新闻查询时的回答：明确说「不可用」，不是空的成功。
 *
 * `state: 'unavailable'` 让日报把这一栏写成有名字的缺口（界面据 `state` 说缺什么），而空数组
 * 会让读者以为今天真的没有新闻。装配处只在没有配新闻源时用它，所以这条答案不需要别的参数。
 */
export const unavailableNewsQuery: NewsQuery = {
  async query(input) {
    return {
      state: 'unavailable' as const,
      asOf: input.asOf,
      generatedAt: input.asOf,
      window: input.window,
      items: [],
      caveats: []
    }
  }
}
