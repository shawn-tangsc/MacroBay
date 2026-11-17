import { describe, expect, it, vi } from 'vitest'

import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import { NEWS_ARRIVAL_HEADLINE_LIMIT, readerTimeLabel, renderNewsArrival } from '../../../contracts/newsArrivalSentences'
import {
  buildNewsArrivalRequest,
  isNewsArrivalWorthNotifying,
  notifyNewsArrival,
  type NewsArrivalNoticeInput
} from './newsArrivalNotice'

/**
 * 判据都来自 R40 需求稿 §1 / §5 / §6：
 * 低重要性 = `strength = 1` 或例行公告；只看强度不看方向；没有判定就不发（这里表现为调用点不给它）；
 * 动作只到舆情页，所以文案不许出现「查看这条」。
 */
const BASE: NewsArrivalNoticeInput & { sourceName: string } = {
  itemId: 'item-a',
  headline: 'SEC Approves Spot Ethereum ETF Options',
  sourceName: 'CoinDesk RSS',
  polarity: 'bullish',
  publishedAt: '2026-10-24T12:00:00.000Z',
  timeZone: 'Asia/Shanghai'
}

describe('isNewsArrivalWorthNotifying', () => {
  it('holds back the whole low tier (strength 1 and 2)', () => {
    // 用户 2026-11-18：≤2 就是低。2 是最容易被写回 1 的边界，所以单独钉一次。
    expect(isNewsArrivalWorthNotifying({ title: 'A quiet weekend', polarity: 'neutral', strength: 1 })).toBe(false)
    expect(isNewsArrivalWorthNotifying({ title: 'Ether ETF options approved', polarity: 'bullish', strength: 2 })).toBe(false)
  })

  it('lets a story through as soon as strength reaches 3 — the same threshold the phone uses', () => {
    expect(isNewsArrivalWorthNotifying({ title: 'Ether ETF options approved', polarity: 'bullish', strength: 3 })).toBe(true)
  })

  it('judges importance without looking at direction', () => {
    // 中性但强度高也是「重要但没方向」，读者该知道。
    expect(isNewsArrivalWorthNotifying({ title: 'Exchange publishes quarterly attestation', polarity: 'neutral', strength: 3 })).toBe(true)
  })

  it('holds back routine announcements — the existing routine rule decides, not a second one', () => {
    // 例行公告今天定义在 `strength <= 2` 这一档，所以它本来也落在门槛下面；这条留在这里是因为
    // 例行规则若放宽档位，门槛不该替它决定——两件事各自有一次判据。
    expect(isNewsArrivalWorthNotifying({ title: 'OKX to Perform Scheduled Maintenance on the RFQ System', polarity: 'neutral', strength: 2 })).toBe(false)
    // 同一条标题若是利空的真事故（强度 4），那是新闻、不是例行公告。
    expect(isNewsArrivalWorthNotifying({ title: 'System maintenance caused a 6-hour outage', polarity: 'bearish', strength: 4 })).toBe(true)
  })
})

describe('renderNewsArrival', () => {
  it('puts the source and the story in the title, and the direction plus the reader-local time in the body', () => {
    const zh = renderNewsArrival({ ...BASE, locale: 'zh-CN' })!
    expect(zh.title).toBe('CoinDesk RSS · SEC Approves Spot Ethereum ETF Options')
    // 2026-10-24T12:00Z 在 Asia/Shanghai 是 20:00。
    expect(zh.body).toBe('偏多 · 10-24 20:00')
    expect(zh.reason).not.toBe('')
  })

  it('uses the reader’s time zone, not the machine one', () => {
    const tokyo = renderNewsArrival({ ...BASE, locale: 'zh-CN', timeZone: 'Asia/Tokyo' })!
    expect(tokyo.body).toBe('偏多 · 10-24 21:00')
  })

  it('truncates a long headline but never the source', () => {
    const long = 'X'.repeat(NEWS_ARRIVAL_HEADLINE_LIMIT + 40)
    const zh = renderNewsArrival({ ...BASE, headline: long, locale: 'zh-CN' })!
    expect(zh.title.startsWith('CoinDesk RSS · ')).toBe(true)
    expect(zh.title.endsWith('…')).toBe(true)
    expect(zh.title.length).toBeLessThan('CoinDesk RSS · '.length + NEWS_ARRIVAL_HEADLINE_LIMIT + 1)
  })

  it('says the time is unknown instead of printing an unformattable one', () => {
    const zh = renderNewsArrival({ ...BASE, publishedAt: 'not-a-time', locale: 'zh-CN' })!
    expect(zh.body).toBe('偏多 · 时间未知')
    expect(readerTimeLabel('not-a-time', 'Asia/Shanghai')).toBe('')
  })
})

describe('buildNewsArrivalRequest', () => {
  it('targets the desktop-only event with one action that only opens the news page', () => {
    const request = buildNewsArrivalRequest(BASE)!
    expect(request.dedupeVars).toEqual({ builder: 'template', vars: { itemId: 'item-a' } })
    expect(request.actions).toHaveLength(1)
    expect(request.actions[0]).toMatchObject({ id: 'open-sentiment', kind: 'open' })
    expect(request.actions[0]?.deeplink).toMatchObject({ scope: 'product', productId: 'market-intelligence' })
    // 动作标签走产品文案键（记录里存引用，切语言后历史通知的按钮跟着变）。这一版只打开页面，
    // 所以那个键的句子必须是「打开舆情」——逐字判据在 `newsSentimentTierWords.test.ts`，
    // 这里钉住「用的是那个键」，不然句子对了、键接错了也看不出来。
    expect(request.actions[0]?.labelRef).toMatchObject({
      scope: 'product',
      productId: 'market-intelligence',
      key: 'notification.action.market-intelligence.open-sentiment'
    })
  })

  it('refuses to build a notice without a source name', () => {
    expect(buildNewsArrivalRequest({ ...BASE, sourceName: '   ' })).toBeUndefined()
  })

  it('always ships both languages, so switching the app language does not empty an old record', () => {
    const request = buildNewsArrivalRequest(BASE)!
    expect(Object.keys(request.rendered ?? {}).sort()).toEqual(['en-US', 'zh-CN'])
  })
})

describe('notifyNewsArrival', () => {
  it('submits the registered event id and swallows a submission failure', async () => {
    // 事件 id 在提交那一刻的实参上：生产者门禁靠它证明「这条事件真的有人发」。
    const submit = vi.fn(async (_request: NotificationSubmitRequest) => {
      throw new Error('runtime down')
    })
    await expect(notifyNewsArrival(submit, BASE)).resolves.toBeUndefined()
    expect(submit).toHaveBeenCalledTimes(1)
    expect((submit.mock.calls[0]![0] as NotificationSubmitRequest).eventTypeId).toBe('market-intelligence.news.item-arrived')
  })

  it('does nothing at all when no submission point is wired', async () => {
    await expect(notifyNewsArrival(undefined, BASE)).resolves.toBeUndefined()
  })
})
