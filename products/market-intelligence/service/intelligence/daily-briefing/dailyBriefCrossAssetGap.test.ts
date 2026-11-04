import { describe, expect, it } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { withCrossAssetFailureGap } from './dailyBriefCrossAssetGap'

/**
 * One sentence in the conclusion's own gap list, in the edition's language.
 *
 * The stored document keeps its shape: no field is added, so no schemaVersion moves. What changes is
 * that a reader sees "cross-asset query failed: rejected:…" instead of only "cross-asset domain
 * missing" — the difference between a failed read and missing data.
 */
const document = (language: 'zh-CN' | 'en-US', conclusion: unknown = { dataGaps: [] }): DailyBriefingDocument => ({
  edition: { locale: language },
  conclusion
} as unknown as DailyBriefingDocument)

describe('cross-asset failure in the gap list', () => {
  it('names the failure in the edition language, without touching anything else', () => {
    const zh = withCrossAssetFailureGap(document('zh-CN'), 'rejected:closedReturns.btc.4h', 'zh-CN')
    expect(zh.conclusion?.dataGaps).toEqual(['跨资产查询失败：rejected:closedReturns.btc.4h'])

    const en = withCrossAssetFailureGap(document('en-US'), 'threw:boom', 'en-US')
    expect(en.conclusion?.dataGaps).toEqual(['Cross-asset query failed: threw:boom'])
  })

  it('keeps the existing gaps and does not repeat itself', () => {
    const once = withCrossAssetFailureGap(document('zh-CN', { dataGaps: ['原有缺口'] }), 'not-wired', 'zh-CN')
    expect(once.conclusion?.dataGaps).toEqual(['原有缺口', '跨资产查询失败：not-wired'])
    expect(withCrossAssetFailureGap(once, 'not-wired', 'zh-CN')).toBe(once)
  })

  it('changes nothing when the read succeeded or there is no conclusion', () => {
    const doc = document('zh-CN')
    expect(withCrossAssetFailureGap(doc, undefined, 'zh-CN')).toBe(doc)
    const empty = document('zh-CN', null)
    expect(withCrossAssetFailureGap(empty, 'not-wired', 'zh-CN')).toBe(empty)
  })
})
