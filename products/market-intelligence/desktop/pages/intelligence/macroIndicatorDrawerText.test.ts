import { describe, expect, it } from 'vitest'

import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'

/**
 * 「未提供」与「暂无 / —」是两件事，别被人合并成一条文案。
 *
 * - `mkDay.valueMissing` = 值级缺失（源说已发布、没给数）：读者看到的是「有这一条，但没数」；
 * - `market.missingValue`（产品文案表里） = 占位（前值缺失、发布时刻未定）：那是「这里本来就没给数留位」。
 *
 * 2026-11-13 定：那 3 条已发布无值的行照常显示、值区写「未提供」，**禁止复用「暂无」**。
 * 守卫钉两件能红的事：两侧都成对存在；这个词不许退化成占位符（`暂无` / `—` / 空串）。
 */
describe('macro indicator drawer copy', () => {
  it('carries 未提供 and its one-line explanation in both languages', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const mkDay = macroIndicatorDrawerText[language].mkDay as Record<string, string>
      expect(mkDay.valueMissing, language).toBeTruthy()
      expect(mkDay.publishedWithoutValues, language).toBeTruthy()
    }
  })

  it('never degrades the value-missing word into a placeholder', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const value = (macroIndicatorDrawerText[language].mkDay as Record<string, string>).valueMissing
      expect(value, language).not.toBe('暂无')
      expect(value, language).not.toBe('—')
      expect(value.trim().length, language).toBeGreaterThan(0)
    }
  })
})
