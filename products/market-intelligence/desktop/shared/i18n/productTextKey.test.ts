import { describe, expect, it } from 'vitest'

import { productText } from './productText'
import { productTextKeys, resolveProductTextKey } from './productTextKey'

const LANGUAGES = ['zh-CN', 'en-US'] as const

/**
 * 两处**有意留空**的句子：`states.available` 与 `changeWindows.latest` 在界面上不需要文字
 * （前者的「正常」不显示标签，后者不带变化量后缀）。写进测试是为了让「多出第三个空串」
 * 当场变红——空串和「键不存在」解析结果一样，靠肉眼看不出差别。
 */
/**
 * 按语言不同的**数字单位词**，只有一侧存在的那几个键，逐条具名。
 *
 * 不是「数字单位随语言变」这种规则级豁免——那等于允许任何键各写一半。这里写死三个键名和
 * 各自属于哪一侧：中文用「亿 / 万」，英文用「million」。它们是格式化的责任、不是文案的责任，
 * 口径由架构师 2026-11-02 定，债务出口是 `MI-1-E7`（把三个单位词收成一个 `{value}` 模板）。
 *
 * 断言写成「单侧键集合 === 这张表」，一条同时管三件事：债务还清（表里还有、实际没了）会红；
 * 有人新留一个单侧键会红并报出键名；改名或挪层级也会红，豁免表不会悄悄失效。
 */
const LANGUAGE_SPECIFIC_KEYS = [
  { key: 'pages.intelligence.portal.dashboard.capitalConditions.a11yAmountYi', side: 'zh-CN', reason: '中文金额单位：亿' },
  { key: 'pages.intelligence.portal.dashboard.capitalConditions.a11yAmountWan', side: 'zh-CN', reason: '中文金额单位：万' },
  { key: 'pages.intelligence.portal.dashboard.capitalConditions.a11yAmountMillion', side: 'en-US', reason: 'English amount unit: million' }
] as const

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
      // A named one-sided unit is only asserted on the side it belongs to.
      const languageSpecific = LANGUAGE_SPECIFIC_KEYS.find((entry) => entry.key === key)
      expect(resolveProductTextKey('zh-CN', key), `zh-CN ${key}`).not.toBe('')
      if (languageSpecific) continue
      expect(resolveProductTextKey('en-US', key), `en-US is missing ${key}`).not.toBe('')
    }
  })

  it('keeps the deliberately empty sentences the only ones', () => {
    const empty = [...productTextKeys('zh-CN')].filter((key) => resolveProductTextKey('zh-CN', key) === '')
    expect(empty.sort()).toEqual([...DELIBERATELY_EMPTY].sort())
  })

  it('keeps both language tables on the same key set, minus the named one-sided units', () => {
    const zh = productTextKeys('zh-CN')
    const en = productTextKeys('en-US')
    // Named, not a rule: each entry says which side it belongs to. One assertion covers debt paid
    // back, a new silent one-sided key, and a rename.
    const oneSided = [
      ...[...en].filter((key) => !zh.has(key)).map((key) => ({ key, side: 'en-US' })),
      ...[...zh].filter((key) => !en.has(key)).map((key) => ({ key, side: 'zh-CN' }))
    ]
    const byKey = (a: { key: string }, b: { key: string }): number => a.key.localeCompare(b.key)
    expect(oneSided.sort(byKey)).toEqual(LANGUAGE_SPECIFIC_KEYS.map(({ key, side }) => ({ key, side })).sort(byKey))
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
