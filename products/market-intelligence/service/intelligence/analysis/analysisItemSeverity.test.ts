import { describe, expect, it } from 'vitest'

import {
  analysisItemSeverityPolicy,
  isNewsSeveritySource,
  isTriggerableNewsVerdict,
  resolveItemTriggerSeverity
} from './analysisItemSeverity'

/**
 * 事故样本：CoinDesk 的跨境支付新闻（JPMorgan/DBS），情绪判定是
 * `neutral` / `strength 1` / `symbols []` / `no-direct-crypto-impact`，
 * 旧尺子把它判成 high 并启动了一次与它无关的分析。
 */
const crossBorderPaymentVerdict = { polarity: 'neutral', strength: 1, symbols: [] } as const
const directionalVerdict = { polarity: 'bearish', strength: 3, symbols: ['BTC'] } as const

describe('一条情报的严重度：判据是情绪判定，不是准入资格', () => {
  it('中性、无标的、明确说没有直接影响的一条新闻，落到不会触发分析的档', () => {
    const severity = resolveItemTriggerSeverity({
      severityHint: 'info', admitted: true, news: true, verdict: crossBorderPaymentVerdict
    })
    expect(severity).toBe('low')
    expect(isTriggerableNewsVerdict(crossBorderPaymentVerdict)).toBe(false)
  })

  it('同样够格进情报，但方向明确、强度够、有标的的新闻，才判到 high', () => {
    const severity = resolveItemTriggerSeverity({
      severityHint: 'info', admitted: true, news: true, verdict: directionalVerdict
    })
    expect(severity).toBe('high')
    expect(isTriggerableNewsVerdict(directionalVerdict)).toBe(true)
  })

  it('中性但带着标的，最多到 medium，构成不了 high', () => {
    expect(resolveItemTriggerSeverity({
      severityHint: 'info', admitted: true, news: true,
      verdict: { polarity: 'neutral', strength: 4, symbols: ['BTC'] }
    })).toBe('medium')
  })

  it('方向明确但强度只有一丝，最多到 medium', () => {
    expect(resolveItemTriggerSeverity({
      severityHint: 'info', admitted: true, news: true,
      verdict: { polarity: 'bullish', strength: analysisItemSeverityPolicy.minimumTriggerStrength - 1, symbols: ['BTC'] }
    })).toBe('medium')
  })

  it('mixed 不是中性：混合且有标的、够强度时仍可判 high', () => {
    expect(resolveItemTriggerSeverity({
      severityHint: 'info', admitted: true, news: true,
      verdict: { polarity: 'mixed', strength: 3, symbols: ['ETH'] }
    })).toBe('high')
  })

  it('还没判过的新闻不冒充「不重要」：给 medium，等判定写下来', () => {
    expect(resolveItemTriggerSeverity({ severityHint: 'info', admitted: true, news: true })).toBe('medium')
  })

  it('数据类条目从不看情绪判定，准入仍是判据', () => {
    expect(resolveItemTriggerSeverity({ severityHint: 'info', admitted: true, news: false })).toBe('high')
    expect(resolveItemTriggerSeverity({ severityHint: 'info', admitted: false, news: false })).toBe('low')
  })

  it('来源自己标注的严重度优先于任何推导', () => {
    expect(resolveItemTriggerSeverity({
      severityHint: 'critical', admitted: false, news: true, verdict: crossBorderPaymentVerdict
    })).toBe('critical')
    expect(resolveItemTriggerSeverity({
      severityHint: 'warning', admitted: true, news: true, verdict: directionalVerdict
    })).toBe('medium')
  })

  it('新闻来源的判定只认登记过的那几个源', () => {
    expect(isNewsSeveritySource('coindesk-rss')).toBe(true)
    expect(isNewsSeveritySource('alternative-fear-greed')).toBe(false)
  })
})
