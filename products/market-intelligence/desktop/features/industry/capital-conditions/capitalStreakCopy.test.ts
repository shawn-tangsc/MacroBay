import { describe, expect, it } from 'vitest'

import { resolveProductTextKey } from '../../../shared/i18n/productTextKey'

/**
 * 「连续 净流出 · 7 日」在读者眼里是「最近 7 个日历日都有数」，而它数的是**交易日**。
 * 用户 2026-11-17 定的措辞：连续那一列必须写「个交易日」。周末与当日未定稿不进这张表，
 * 措辞不写清楚，读者就会以为数据缺了。
 */
describe('the streak column counts trading days, and says so', () => {
  it('names the unit in both languages', () => {
    expect(resolveProductTextKey('zh-CN', 'pages.intelligence.portal.dashboard.capitalConditions.streak')).toContain('个交易日')
    expect(resolveProductTextKey('zh-CN', 'pages.intelligence.portal.dashboard.capitalConditions.streakSingle')).toContain('个交易日')
    expect(resolveProductTextKey('en-US', 'pages.intelligence.portal.dashboard.capitalConditions.streak')).toContain('trading days')
    expect(resolveProductTextKey('en-US', 'pages.intelligence.portal.dashboard.capitalConditions.streakSingle')).toContain('trading day')
  })
})
