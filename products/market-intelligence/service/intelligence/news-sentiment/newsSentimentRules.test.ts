import { describe, expect, it } from 'vitest'

import { NEWS_SENTIMENT_STRENGTH_SCALE } from './newsSentimentModel'
import { isRoutineNewsNotice, scoreNewsWithRules } from './newsSentimentRules'

describe('newsSentimentRules', () => {
  it('reads a listing as bullish: 上架算 3 —— 影响一类资产的预期（尺子第 3 档）', () => {
    const result = scoreNewsWithRules({
      title: 'Binance Will List RWUSD and Introduce RWUSD Zero Trading Fee Promotion',
      summary: 'Binance will list RWUSD.'
    })
    expect(result!.polarity).toBe('bullish')
    expect(result!.strength).toBe(3)
    expect(result!.reasonCode).toBe('news.listing.v1')
    expect(result!.symbols).toEqual([])
  })

  it('reads a delisting as bearish before the listing rule can match: 下架算 3，影响的是那一类资产', () => {
    const result = scoreNewsWithRules({
      title: 'Binance Futures Will Delist PTBUSDT and MITOUSDT USDⓈ-M Perpetual Contracts (2026-10-23)'
    })
    expect(result!.polarity).toBe('bearish')
    expect(result!.strength).toBe(3)
    expect(result!.reasonCode).toBe('news.delisting.v1')
  })

  it('reads an exploit as bearish strength 4: 主流链安全事件在尺子的第 4 档，不是第 5 档', () => {
    const result = scoreNewsWithRules({
      title: "India's largest exchange denies hack after sleuths pointed to $16 million in suspicious outflow"
    })
    expect(result!.polarity).toBe('bearish')
    expect(result!.strength).toBe(4)
    expect(result!.reasonCode).toBe('news.exploit.v1')
  })

  it('reads a trading halt or paused withdrawals as bearish', () => {
    const result = scoreNewsWithRules({
      title: 'OKX to suspend deposits and withdrawals for maintenance'
    })
    expect(result!.polarity).toBe('bearish')
    expect(result!.reasonCode).toBe('news.halt.v1')
  })

  it('reads an ETF approval as bullish and tags ETH when named', () => {
    const result = scoreNewsWithRules({
      title: 'SEC Approves Spot Ethereum ETF Options'
    })
    expect(result!.polarity).toBe('bullish')
    expect(result!.strength).toBe(4)
    expect(result!.reasonCode).toBe('news.etf-approval.v1')
    expect(result!.symbols).toEqual(['ETH'])
  })

  it('reads generic enforcement as bearish strength 4: 调查与诉讼是第 4 档，不是第 5 档', () => {
    const result = scoreNewsWithRules({
      title: 'SEC Charges Two Individuals in $50M Crypto Fraud'
    })
    expect(result!.polarity).toBe('bearish')
    expect(result!.strength).toBe(4)
    expect(result!.reasonCode).toBe('news.enforcement.v1')
  })

  it('reads a major enforcement action as strength 5: 禁令与刑事起诉在尺子的第 5 档', () => {
    // 用户 2026-11-24：执法拆两档——重大执法（禁令/禁止/吊销牌照/停业/刑事起诉）走 5。
    const banned = scoreNewsWithRules({ title: 'SEC Bans Crypto Staking Service in Landmark Ruling' })!
    expect(banned.reasonCode).toBe('news.enforcement.major.v1')
    expect(banned.strength).toBe(5)

    const indicted = scoreNewsWithRules({ title: 'DOJ Files Criminal Charges Against Exchange Executive' })!
    expect(indicted.reasonCode).toBe('news.enforcement.major.v1')
    expect(indicted.strength).toBe(5)

    const revoked = scoreNewsWithRules({ title: 'Regulator Revokes License of Three Crypto Exchanges' })!
    expect(revoked.reasonCode).toBe('news.enforcement.major.v1')
    expect(revoked.strength).toBe(5)
  })

  it('keeps ordinary suits, fines and cease-and-desist orders at strength 4', () => {
    const lawsuit = scoreNewsWithRules({ title: 'Investors File Lawsuit Against Token Issuer' })!
    expect(lawsuit.reasonCode).toBe('news.enforcement.v1')
    expect(lawsuit.strength).toBe(4)

    const fine = scoreNewsWithRules({ title: 'CFTC Issues $5M Fine to Trading Firm for Record-Keeping Failures' })!
    expect(fine.reasonCode).toBe('news.enforcement.v1')
    expect(fine.strength).toBe(4)

    const order = scoreNewsWithRules({ title: 'State Regulator Issues Cease-and-Desist Order to Lender' })!
    expect(order.reasonCode).toBe('news.enforcement.v1')
    expect(order.strength).toBe(4)
  })

  it('produces no judgment at all when no rule matches — "not judged" is not "neutral/low"', () => {
    // 2026-11-18 修：以前这里返回 neutral / strength 1 / news.no-rule.v1，界面上就成了「中性·低」，
    // 还连锁压低重要性、挡住桌面通知与按条解读。没命中就是没判，交给下一轮模型。
    expect(scoreNewsWithRules({ title: "Ethereum's Next Upgrade Could Cut Fees, Developers Say" })).toBeUndefined()
    expect(scoreNewsWithRules({ title: 'BTC holds above $81,000' })).toBeUndefined()
  })

  it('keeps the symbol extraction for a headline a rule does match', () => {
    const result = scoreNewsWithRules({ title: 'Binance Will Delist BTC Perpetual' })!
    expect(result!.symbols).toEqual(['BTC'])
  })

  it('caps the evidence quote at 200 characters', () => {
    const title = `Binance Will List ${'X'.repeat(400)}`
    const result = scoreNewsWithRules({ title })!
    expect(result!.evidenceQuote?.length).toBeLessThanOrEqual(200)
  })

  it('scores the fallback on the same five-level ruler as the model — rule tier and scale definition must agree', () => {
    /* 不变量（用户 2026-11-24）：兜底与模型用同一把尺。
       两边都钉住——只钉数字，改尺子的措辞不会红；只钉措辞，改规则档位不会红。
       判据取自 `NEWS_SENTIMENT_STRENGTH_SCALE` 的原文：4 档含「主流链安全事件」，
       3 档含「一类资产」，5 档含「重大执法」。 */
    const definitionOf = (level: number) =>
      NEWS_SENTIMENT_STRENGTH_SCALE.find((entry) => entry.level === level)?.definition ?? ''

    expect(definitionOf(4)).toContain('主流链安全事件')
    expect(definitionOf(3)).toContain('一类资产')
    expect(definitionOf(5)).toContain('重大执法')

    const strengthOf = (title: string): number => scoreNewsWithRules({ title })?.strength ?? -1
    // 入侵 = 4（主流链安全事件在第 4 档，不是第 5 档）
    expect(strengthOf('Exchange hacked, $16 million drained')).toBe(4)
    // 下架 = 3（影响的是那一类资产）
    expect(strengthOf('Binance Will Delist XYZ Token')).toBe(3)
    // 上架 = 3（同上）
    expect(strengthOf('Binance Will List XYZ Token')).toBe(3)
    // 重大执法 = 5（尺子第 5 档明写「重大执法」）
    expect(strengthOf('SEC Bans Crypto Staking Service')).toBe(5)
    // 一般执法 = 4
    expect(strengthOf('SEC Opens Investigation Into Token Issuer')).toBe(4)
  })
})


describe('isRoutineNewsNotice', () => {
  it('drops neutral low-strength maintenance notices', () => {
    expect(isRoutineNewsNotice({ title: 'OKX to Perform Scheduled Maintenance on the RFQ System', polarity: 'neutral', strength: 1 })).toBe(true)
    expect(isRoutineNewsNotice({ title: 'API upgrade window on October 22', polarity: 'neutral', strength: 2 })).toBe(true)
  })

  it('keeps directional or severe operational events', () => {
    expect(isRoutineNewsNotice({ title: 'OKX will suspend withdrawals', polarity: 'bearish', strength: 4 })).toBe(false)
    expect(isRoutineNewsNotice({ title: 'System maintenance caused a 6-hour outage', polarity: 'bearish', strength: 4 })).toBe(false)
    expect(isRoutineNewsNotice({ title: 'Exchange lists new perpetual contract', polarity: 'bullish', strength: 3 })).toBe(false)
    expect(isRoutineNewsNotice({ title: 'Protocol upgrade scheduled', polarity: 'neutral', strength: 1 })).toBe(false)
  })
})
