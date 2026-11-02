import { describe, expect, it } from 'vitest'

import { productText } from './productText'

/**
 * 英文界面里不能再出现中文——包括来源名称、分组、筛选这些「看起来像数据」的内置文案。
 *
 * 这一页曾经只有英文骨架（标题、按钮）翻了，`sourceNames`/`providerNames`/`sourceCategories`
 * 整块从中文复制过来，英文用户看到的就是「宏观 / 币安 / 美联储」。这里用机器守着两件事：
 * 1) `productText['en-US']` 的任何字符串都不允许含中日韩字符；
 * 2) 中文侧定义的每个来源/分组标签，英文侧必须同名同键，新增来源不会只翻一半。
 */
const chineseCharacters = /[\u3400-\u9fff\uf900-\ufaff]/

const englishLabelMaps = [
  'sourceCategories',
  'sourceNames',
  'providerNames',
  'readinessLabels',
  'sourceFilters',
  'sourceBadges',
  'agentNames',
  'panelNames'
] as const

describe('English product copy', () => {
  it('contains no Chinese text in any user-visible string', () => {
    expect(collectChinesePaths(productText['en-US'])).toEqual([])
  })

  it('translates every intelligence-source label the Chinese copy defines', () => {
    const zh = productText['zh-CN'].settings.intelligenceSources
    const en = productText['en-US'].settings.intelligenceSources

    for (const mapKey of englishLabelMaps) {
      expect(Object.keys(en[mapKey]).sort(), `intelligenceSources.${mapKey}`).toEqual(
        Object.keys(zh[mapKey]).sort()
      )
    }
  })
})

function collectChinesePaths(value: unknown, path: readonly string[] = []): string[] {
  if (typeof value === 'string') return chineseCharacters.test(value) ? [path.join('.')] : []
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectChinesePaths(item, [...path, String(index)]))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => collectChinesePaths(item, [...path, key]))
  }
  return []
}

describe('reader-facing copy avoids coined terms', () => {
  /** Every leaf sentence, both languages; comments are not values and are not checked. */
  function leaves(language: 'zh-CN' | 'en-US'): Array<[string, string]> {
    const out: Array<[string, string]> = []
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        out.push([path, node])
        return
      }
      if (node === null || typeof node !== 'object') return
      for (const [key, value] of Object.entries(node)) walk(value, path === '' ? key : `${path}.${key}`)
    }
    walk(productText[language], '')
    return out
  }

  it('does not call a reading a "回退值" or a "Fallback"', () => {
    // The reader has never seen this word, and it flattened five different time bases into one.
    // What they need is which instant the number is from, so the words themselves have to say it.
    for (const [path, sentence] of [...leaves('zh-CN'), ...leaves('en-US')]) {
      expect(sentence, path).not.toContain('回退值')
      expect(sentence, path).not.toMatch(/\bFallback\b/)
    }
  })

  it('still says which instant each stale basis comes from', () => {
    const basis = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing.staleBasis
    // Every basis names a time basis; none of them may collapse into the same sentence.
    const sentences = Object.values(basis)
    expect(new Set(sentences).size).toBe(sentences.length)
    expect(sentences.every((sentence) => sentence.trim() !== '')).toBe(true)
  })
})
