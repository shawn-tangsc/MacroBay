import { describe, expect, it } from 'vitest'

import { notificationSettingsText } from './notificationSettingsText'

/**
 * 清单行名是这一屏自己的短名表，**两种语言各一份**。
 *
 * 今晚的真事故：`briefing.ready` 的声明加回了事件目录，中文名也加了，英文那份漏了——
 * 英文界面上那一行就变成「名称暂时读不出来」。它不是崩溃，但违反了「读不到就说读不到、
 * 别让一行凭空少个名字」这条，而且**只有切到英文才看得见**，中文自测永远发现不了。
 *
 * 所以这里不比字面量，只比两张表的**键集合**：谁加了新事件只补一种语言，这条就红。
 */
describe('eventNames 覆盖两种语言', () => {
  const zh = notificationSettingsText['zh-CN']
  const en = notificationSettingsText['en-US']

  it('has exactly the same events named in zh-CN and en-US', () => {
    expect(Object.keys(en.eventNames).sort()).toEqual(Object.keys(zh.eventNames).sort())
  })

  it('never leaves a name empty, in either language', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      for (const [id, name] of Object.entries(notificationSettingsText[language].eventNames)) {
        expect(name.trim(), `${language} ${id}`).not.toBe('')
      }
    }
  })

  it('names the briefing-ready row the settings screen shows', () => {
    // 用户 2026-11-04 翻案恢复这一行；名字必须在（否则那一行只能显示兜底句）。
    expect(zh.eventNames['market-intelligence.briefing.ready']).toBe('日报已完成')
    expect(en.eventNames['market-intelligence.briefing.ready']).toBe('The daily brief is ready')
  })
})
