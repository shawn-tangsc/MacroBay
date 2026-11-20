import { describe, expect, it } from 'vitest'

import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'

/**
 * 卡面新出现的两族文字（2026-11-14）：左卡的「已发布」三档标签、三张卡共用的八个行名。
 *
 * 超过 3 天不渲染任何标签、整卡降权——那是「不渲染 + 类名」，没有键，所以这里不测它；
 * 这里测的是**有标签的那几档**必须中英齐全、占位符对得上，否则实现只能把中文写进组件。
 */
const TAGS = {
  minutes: '{minutes}',
  hours: '{hours}',
  daysAgo: '{days}'
} as const

describe('macro indicator card labels', () => {
  it('carries the three published-tag forms with their placeholders', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const published = (macroIndicatorDrawerText[language] as unknown as {
        published: Record<string, string>
      }).published
      for (const [key, placeholder] of Object.entries(TAGS)) {
        expect(published[key], `${language} ${key}`).toContain(placeholder)
      }
      // 昨天 / 前天是整句，不许带占位（带一个空占位就是拼错）。
      for (const key of ['yesterday', 'beforeYesterday'] as const) {
        expect(published[key], `${language} ${key}`).toBeTruthy()
        expect(published[key], `${language} ${key}`).not.toContain('{')
      }
    }
  })

  it('names all eight rows in both languages, and the two cards share the same set', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const rows = (macroIndicatorDrawerText[language] as unknown as {
        cardRows: Record<string, string>
      }).cardRows
      expect(Object.keys(rows).sort()).toEqual([
        'avgHourlyMom', 'avgHourlyYoy', 'coreMom', 'coreYoy', 'mom', 'nonfarm', 'unemployment', 'yoy'
      ])
      for (const [key, label] of Object.entries(rows)) expect(label, `${language} ${key}`).toBeTruthy()
    }
  })
})
