import { describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { briefingMacroEmptyCopy } from './briefingMacroEmptyCopy'

const zhText = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const enText = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing

/**
 * 宏观栏「什么都不印」这一档的唯一守卫。
 *
 * 背景（2026-11-06 用户原话 + 2026-11-09 Chief 裁定）：日报正文是最容易被质疑的地方，
 * 「窗口里确实没有高影响事件」时**整栏不出现**，不印任何句子。四行表里「确实为空＝空态」只适用于
 * 经济日历页，不套宏观栏（台账 `MI-1-D8`）。
 *
 * 这条用例存在的理由：那个分支靠一行 `return null` 维持，任何人顺手把它改成返回一句话，
 * 界面上就会多出一句「本期没有高影响事件」——读者会质疑这份简报，而测试不会红。所以要红在这里。
 */
const labels = {
  macroEmptyCodes: {
    'calendar-unavailable': '日历自动同步已停止，简报里的日历内容来自上次成功同步',
    'calendar-stale': '日历数据已过期（最后成功采集在 {hours} 小时前）',
    'past-24h-no-high-impact-release': '过去 24 小时没有已发布的高影响事件'
  },
  macroUnreadable: '暂时读不到：'
} as const

function documentWith(macroEmpty: string | undefined, macroEmptyHours?: number) {
  return { news: { notes: { ...(macroEmpty === undefined ? {} : { macroEmpty }), ...(macroEmptyHours === undefined ? {} : { macroEmptyHours }) } } } as never
}

describe('the empty macro section in a daily briefing', () => {
  it('says nothing at all when the window really had no high-impact event', () => {
    // 这一条就是「宏观栏不印」的判据：不许变成一句「过去 24 小时没有…」。
    expect(briefingMacroEmptyCopy(documentWith('past-24h-no-high-impact-release'), labels)).toBeNull()
  })

  it('says nothing when the edition recorded no reason at all', () => {
    // 老版次没有原因码：编不出是六种里的哪一种，只能不说。
    expect(briefingMacroEmptyCopy(documentWith(undefined), labels)).toBeNull()
  })

  it('says nothing for a code the copy table does not know', () => {
    // 认不出的码不许回落到「没有」那句（那是把「不知道为什么」说成「确实没有」）。
    expect(briefingMacroEmptyCopy(documentWith('something-new'), labels)).toBeNull()
  })

  it('carries a readable reason with the 读不到 prefix, never as plain "nothing"', () => {
    const copy = briefingMacroEmptyCopy(documentWith('calendar-stale', 42), labels)
    expect(copy).toEqual({ sentence: '暂时读不到：日历数据已过期（最后成功采集在 42 小时前）', unreadable: true })
  })

  /**
   * 真表守卫（2026-11-14）：两条补采原因码必须中英都有，而且**「结果未知」是原因，不是「没有」**。
   *
   * 为什么钉在这里：认不出的码现在一律不印话，所以少写一个键不会报错、也不会红，
   * 只会让那一档在界面上**整句消失**——看起来跟「窗口里确实没有」一模一样。
   * 另外，超时那句不许再带秒数：90/20 是内部预算，写死进句子，下次调上限就是假话。
   */
  it('carries both catch-up reason codes in both languages, with no internal number', () => {
    expect(Object.keys(zhText.macroEmptyCodes).sort()).toEqual(Object.keys(enText.macroEmptyCodes).sort())
    for (const [name, text] of [['zh-CN', zhText], ['en-US', enText]] as const) {
      const unknown = briefingMacroEmptyCopy(documentWith('calendar-catch-up-unknown'), text)
      expect(unknown, name).not.toBeNull()
      expect(unknown!.unreadable, name).toBe(true)
      expect(unknown!.sentence, name).not.toContain('{')

      const timeout = briefingMacroEmptyCopy(documentWith('calendar-catch-up-timeout'), text)
      expect(timeout, name).not.toBeNull()
      expect(timeout!.sentence, name).not.toMatch(/\d/)
    }
  })
})

/**
 * 「未来 7 天」那一栏的两段话（产品 2026-11-14 定）：主句说**我们判不出**，
 * 小标题给自己的一级指标排期。这里钉两件事：
 * 1. 中英都齐、都非空；
 * 2. **「无法判定」与「确实没有」必须是两句不同的话**——合并成一句就等于替来源下断言。
 */
describe('the "next 7 days" section when importance is unknown', () => {
  it('carries both sentences in both languages, and never reuses the "nothing there" one', () => {
    for (const [language, text, noEvent] of [
      ['zh-CN', zhText, '未来 7 天没有高影响事件'],
      ['en-US', enText, 'No high-impact event in the next 7 days']
    ] as const) {
      const unknown = text.nextImportanceUnknown
      expect(unknown.sentence.trim(), language).not.toBe('')
      expect(unknown.scheduleTitle.trim(), language).not.toBe('')
      expect(unknown.sentence, language).not.toBe(noEvent)
      expect(text.nextEmptyCodes['next-7d-importance-unknown'], language).not.toBe(noEvent)
    }
  })
})

/**
 * 简报两段新增的六句（产品 2026-11-14 定）。这里钉三件：
 * 1. 中英都齐、都非空；
 * 2. 占位符一一对得上（`{total}` / `{indicators}` / `{centralBank}` / `{financial}` / `{count}`）——
 *    少一个占位就会渲染出「共 条发布」；
 * 3. 空态那句**必须带「已收录」**：窗口里一条都没有时，只能说「没有已收录的发布」，
 *    不许说成「没有发布」——那是替来源下断言。
 */
describe('过去 24 小时与未来段的新六句', () => {
  it('carries every sentence in both languages with matching placeholders', () => {
    /* 表头只带 `{count}`；构成明细是**另一个键**（只进 ⓘ）——两者不许再拼成一句长句。 */
    const expected = [
      ['pastWindow.header', ['{count}']],
      ['pastWindow.composition', ['{indicators}', '{centralBank}', '{financial}']],
      ['pastWindow.others', ['{count}']]
    ] as const
    for (const [language, text] of [['zh-CN', zhText], ['en-US', enText]] as const) {
      for (const [key, placeholders] of expected) {
        const [group, name] = key.split('.') as [ 'pastWindow', 'header' | 'composition' | 'others' ]
        const value = text[group][name]
        expect(value.trim(), `${language} ${key}`).not.toBe('')
        for (const placeholder of placeholders) {
          expect(value, `${language} ${key}`).toContain(placeholder)
        }
      }
      expect(text.pastWindow.emptyCollected.trim(), language).not.toBe('')
      // 「已收录」不能省：那三个字是这句话唯一诚实的部分。
      expect(text.pastWindow.emptyCollected, language).toMatch(language === 'zh-CN' ? /已收录/ : /collected/i)
      expect(text.importanceUnprovided.trim(), language).not.toBe('')
      expect(text.nextImportanceUnknown.sentence.trim(), language).not.toBe('')
      expect(text.nextImportanceUnknown.scheduleTitle.trim(), language).not.toBe('')
    }
  })
})
