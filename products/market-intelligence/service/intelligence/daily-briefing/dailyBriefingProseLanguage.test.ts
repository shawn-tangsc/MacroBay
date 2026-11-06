import { describe, expect, it } from 'vitest'

import { proseLanguageBreach } from './dailyBriefingProseLanguage'

/**
 * 判的是整段（`02` `A0.9` v2.148）：一段中文出现在英文版次里就是破绽，一个中文专名不算。
 */
describe('prose language, judged by the paragraph', () => {
  it('treats a Chinese paragraph as a breach in an English edition', () => {
    expect(proseLanguageBreach('BTC 与 ETH 的 ETF 5 日累计净流出分别为 -15.13 亿美元，短线资金面偏空。', 'en-US')).toBe(true)
  })

  it('lets a Chinese name or a symbol pass in an English edition', () => {
    expect(proseLanguageBreach('The Fed (美联储) holds rates.', 'en-US')).toBe(false)
    expect(proseLanguageBreach('BTC perpetual (永续)', 'en-US')).toBe(false)
    expect(proseLanguageBreach('CPI 3.4% vs 3.2% expected', 'en-US')).toBe(false)
  })

  it('treats an English paragraph as a breach in a Chinese edition', () => {
    expect(proseLanguageBreach('Stablecoins keep contracting and bids thin out.', 'zh-CN')).toBe(true)
  })

  it('lets numbers, clock times and symbols pass in either edition', () => {
    for (const text of ['-15.13 亿美元', 'BTC -1.1%', '20:30 CPI', '']) {
      expect(proseLanguageBreach(text, 'zh-CN')).toBe(false)
      expect(proseLanguageBreach(text, 'en-US')).toBe(false)
    }
  })
})
