import { describe, expect, it } from 'vitest'

import { notificationSettingsText } from './notificationSettingsText'

/**
 * 这一屏的文案表**两种语言各一份**，键必须同形。
 *
 * 今晚的真事故：一个键只补了中文、漏了英文，英文界面上那一行就空着。
 * 它不是崩溃，但违反「读不到就说读不到、别让一行凭空少个字」这条，而且**只有切到英文才看得见**。
 *
 * 所以这里不比字面量（字面量会随文案改而红），只比两张表的**键集合与非空性**：
 * 谁加了新键只补一种语言，这条就红。
 */
describe('notification settings copy covers both languages', () => {
  const zh = notificationSettingsText['zh-CN']
  const en = notificationSettingsText['en-US']

  it('has exactly the same keys in zh-CN and en-US', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('never leaves a string empty, in either language', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      for (const [key, value] of Object.entries(notificationSettingsText[language])) {
        if (typeof value === 'string') {
          expect(value.trim(), `${language} ${key}`).not.toBe('')
        }
      }
    }
  })

  it('keeps the receipt template able to carry a reason in both languages', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const sentence = notificationSettingsText[language].desktopFailed('PUSH-REASON-SENTINEL')
      expect(sentence).toContain('PUSH-REASON-SENTINEL')
      expect(sentence.trim()).not.toBe('')
    }
  })
})
