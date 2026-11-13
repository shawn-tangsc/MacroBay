import { describe, expect, it } from 'vitest'

import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { productText } from '../../shared/i18n/productText'

/**
 * 距发布那个 tag 的四句（2026-11-14）。
 *
 * 两条硬约束写在键上：`date` 型排期只能出天数或「今天」，**永不进倒计时**（它的 `releaseAt`
 * 是 00:00Z 占位，拿去倒计时就是编时间）；「已过」不设键——那一格直接不画。
 */
describe('release countdown copy', () => {
  it('carries the four sentences in both languages', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const countdown = (macroIndicatorDrawerText[language] as unknown as {
        countdown: Record<string, string>
      }).countdown
      for (const key of ['days', 'today', 'hoursMinutes', 'minutes'] as const) {
        expect(countdown[key], `${language} ${key}`).toBeTruthy()
      }
      // 占位符必须对上：天数句带 {days}，今天句**不带任何占位**（带一个空占位就是拼错）。
      expect(countdown.days, language).toContain('{days}')
      expect(countdown.today, language).not.toContain('{')
      expect(countdown.hoursMinutes, language).toContain('{hours}')
      expect(countdown.hoursMinutes, language).toContain('{minutes}')
      expect(countdown.minutes, language).toContain('{minutes}')
    }
  })

  it('keeps the default expectation chain two stages, with manual outside it', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const options = productText[language].settings.intelligenceSources.coreIndicators.sourceOrder.options
      // 默认链里不许出现手填那一档（手填只能被显式选中）。
      expect(options.defaultChain.toLowerCase()).not.toContain(language === 'zh-CN' ? '手填' : 'manual')
      // 但「只用手填」这个选项必须在——显式选择是唯一的入口。
      expect(options.manualOnly, language).toBeTruthy()
    }
  })
})
