import { describe, expect, it } from 'vitest'

import { codeTableReasonSets } from '../../../service/intelligence/macro-calendar/marketCalendarCodeTable'
import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'

/**
 * 待补理由的悬停句（用户 2026-11-01：「没有」与「拿不到」必须能分开；Chief 2026-11-21：
 * **悬停里不许出现英文 token**）。
 *
 * 这条用例盯的是**唯一判据**：闭集里每个理由在两种语言下都有一句白话，
 * 且「机构没有可长期引用的公开页」与「我们还没能核到机构页」不许写成同一句——
 * 合并了就等于把两种事实又压回一种，读者看不出差别。
 *
 * 加第 7 个理由却不配文案时，`Record<PendingReason, string>` 会先在类型层红；
 * 这条再兜一次「配了但配成 token / 配成同一句」。
 */
const locales = ['zh-CN', 'en-US'] as const

describe('官网页待补理由的悬停句', () => {
  for (const locale of locales) {
    it(`${locale}：闭集每个理由都有白话句，且不是内部 token`, () => {
      const reasons = macroIndicatorDrawerText[locale].mkDay.mappingOfficialPendingReasons
      for (const reason of codeTableReasonSets.pending) {
        const sentence = reasons[reason]
        expect(sentence.trim().length, `${locale} 缺 ${reason} 的句子`).toBeGreaterThan(0)
        // token 漏到读者眼前的样子就是 `official-source-…` / `source-name-…`，一律算没配。
        expect(sentence, `${locale} 把 ${reason} 配成了 token`).not.toMatch(/^(official|source|awaiting|period|name)-/)
      }
    })

    it(`${locale}：「机构没有可引用的公开页」与「我们还没能核到」不是同一句`, () => {
      const reasons = macroIndicatorDrawerText[locale].mkDay.mappingOfficialPendingReasons
      expect(reasons['official-source-not-public'])
        .not.toBe(reasons['official-source-todo'])
    })
  }
})