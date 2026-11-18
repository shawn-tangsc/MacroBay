import { describe, expect, it } from 'vitest'

import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { interpretationAdmission } from './analysisNewsInterpretationAdmission'

/**
 * 准入只有一处（R39 S1 §3）：四个例子在三个调用点必须同果。
 * 这里断的是**函数本身**的四档；三个调用点各有一条集成断言（写端点 / 只读菜单 / 遗留手动刷新）。
 */
const asOf = '2026-11-16T09:30:00.000Z'
const item = (overrides: Partial<IntelligenceItem> = {}): IntelligenceItem => ({
  itemId: 'item-1', primaryRawRecordId: 'raw-1', canonicalDedupeKey: 'k', sourceId: 'coindesk-rss',
  eventType: 'news', title: 'headline', sourceCategory: 'news', sourceTrust: 'high',
  publishedAt: '2026-11-16T08:46:00.000Z', detectedAt: asOf, timelineStatus: 'evaluated', normalizerVersion: 'v1',
  ...overrides
})
const verdict = () => ({
  itemId: 'item-1', sourceId: 'coindesk-rss', publishedAt: '2026-11-16T08:46:00.000Z', scoredAt: asOf,
  polarity: 'bearish' as const, strength: 3, confidence: 80, symbols: ['BTC'] as const, reasonCode: 'c',
  engine: 'model' as const, caveats: []
})

describe('手动解读准入：一处实现，两个分支', () => {
  it('舆情：要判定 + 发布时间', () => {
    expect(interpretationAdmission(item(), { latestNewsSentiment: verdict as never, now: () => asOf })).toEqual({ ok: true })
    expect(interpretationAdmission(item(), { latestNewsSentiment: () => undefined, now: () => asOf }))
      .toEqual({ ok: false, reason: 'no-judgment' })
    expect(interpretationAdmission(item({ publishedAt: '' }), { latestNewsSentiment: verdict as never, now: () => asOf }))
      .toEqual({ ok: false, reason: 'no-publication' })
  })

  it('消息面：只要发布时间 + 来源在注册表，不要求判定', () => {
    const message = item({ sourceId: 'alternative-fear-greed', eventType: 'metric' })
    expect(interpretationAdmission(message, { now: () => asOf })).toEqual({ ok: true })
    expect(interpretationAdmission({ ...message, publishedAt: '' }, { now: () => asOf }))
      .toEqual({ ok: false, reason: 'no-publication' })
    expect(interpretationAdmission(item({ sourceId: 'not-in-registry' }), { now: () => asOf }))
      .toEqual({ ok: false, reason: 'source-not-covered' })
  })

  it('条目不存在', () => {
    expect(interpretationAdmission(undefined, { now: () => asOf })).toEqual({ ok: false, reason: 'item-not-found' })
  })
})
