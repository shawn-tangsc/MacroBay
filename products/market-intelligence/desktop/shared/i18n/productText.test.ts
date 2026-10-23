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
