import { describe, expect, it } from 'vitest'

import { productText } from './productText'
import { productTextKeys, resolveProductTextKey } from './productTextKey'

const LANGUAGES = ['zh-CN', 'en-US'] as const

/**
 * 两处**有意留空**的句子：`states.available` 与 `changeWindows.latest` 在界面上不需要文字
 * （前者的「正常」不显示标签，后者不带变化量后缀）。写进测试是为了让「多出第三个空串」
 * 当场变红——空串和「键不存在」解析结果一样，靠肉眼看不出差别。
 */
const DELIBERATELY_EMPTY = [
  'pages.intelligence.portal.dashboard.dailyBriefing.states.available',
  'pages.intelligence.portal.dashboard.dailyBriefing.changeWindows.latest'
]

describe('product text dotted-key resolver', () => {
  it('resolves a nested sentence the same way the object reads it', () => {
    const key = 'pages.intelligence.portal.analysisDrawer.close'
    expect(resolveProductTextKey('zh-CN', key)).toBe(productText['zh-CN'].pages.intelligence.portal.analysisDrawer.close)
    expect(resolveProductTextKey('en-US', key)).toBe(productText['en-US'].pages.intelligence.portal.analysisDrawer.close)
  })

  it('returns an empty string for an unknown key instead of the key name', () => {
    const key = 'pages.intelligence.analysisDrawer.noSuchSentence'
    expect(resolveProductTextKey('zh-CN', key)).toBe('')
    expect(resolveProductTextKey('zh-CN', key)).not.toBe(key)
  })

  it('covers every leaf in both languages', () => {
    for (const key of productTextKeys('zh-CN')) {
      if (DELIBERATELY_EMPTY.includes(key)) continue
      expect(resolveProductTextKey('zh-CN', key), `zh-CN ${key}`).not.toBe('')
      expect(resolveProductTextKey('en-US', key), `en-US is missing ${key}`).not.toBe('')
    }
  })

  it('keeps the deliberately empty sentences the only ones', () => {
    const empty = [...productTextKeys('zh-CN')].filter((key) => resolveProductTextKey('zh-CN', key) === '')
    expect(empty.sort()).toEqual([...DELIBERATELY_EMPTY].sort())
  })

  it('keeps both language tables on the same key set', () => {
    const zh = productTextKeys('zh-CN')
    const en = productTextKeys('en-US')
    expect([...en].filter((key) => !zh.has(key))).toEqual([])
    expect([...zh].filter((key) => !en.has(key))).toEqual([])
  })

  it('keeps every key usable as an aria label key (dotted, no spaces, no CJK)', () => {
    for (const language of LANGUAGES) {
      for (const key of productTextKeys(language)) {
        expect(key, key).not.toMatch(/\s/)
        expect(key, key).not.toMatch(/[\u3400-\u9fff]/)
      }
    }
  })
})
