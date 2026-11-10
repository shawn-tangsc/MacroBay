import { describe, expect, it } from 'vitest'

import { productText } from './productText'

/**
 * 中英键路径必须**完全相等**（2026-11-10，产品文案表）。
 *
 * 为什么值得一条守卫：这张表被整体重写过一次，一条线把另一条线刚加的几张状态词表覆盖掉，
 * 运行期读到 `undefined` 才炸出来——那是读者可见的空行，不是构建错误。现有的
 * `productText.test.ts` 只查「英文里不许有中日韩字符」和几张 map 的键对齐，**整表的键路径
 * 从来没有人对过**。
 *
 * 判据：两侧的**叶子路径集合**必须相等；缺一侧、多一侧都红，并**点名那条路径**——
 * 「数组不相等」帮不了下一个改表的人，他会不知道少的是哪一句。
 */
type Locale = 'zh-CN' | 'en-US'

/** 叶子 = 非纯对象（字符串、数字、布尔、函数、数组、null）。函数按「路径本身」算一条。 */
function isLeaf(value: unknown): boolean {
  if (typeof value === 'function') return true
  if (Array.isArray(value)) return true
  return typeof value !== 'object' || value === null
}

function collectKeyPaths(value: unknown, prefix: string, out: Set<string>): void {
  if (isLeaf(value)) {
    if (prefix.length > 0) out.add(prefix)
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectKeyPaths(child, prefix.length === 0 ? key : `${prefix}.${key}`, out)
  }
}

function keyPaths(locale: Locale): Set<string> {
  const out = new Set<string>()
  collectKeyPaths((productText as Record<string, unknown>)[locale], '', out)
  return out
}

/**
 * 三处**设计使然**的中英不等：资金面金额读法按语言不同。
 *
 * 中文按「亿 / 万」两档读屏，英文只按「million」一档；类型联合在
 * `capitalFlowAccessibleName.ts`。**显式写死这三条路径**，不用后缀白名单、不用正则——
 * 白名单会遮住将来资金面改读法时的真差异，而这份清单一旦过期，下面「例外必须仍在」那条会绿着骗人。
 */
const MONEY_READING_EXCEPTIONS = {
  /** 中文有、英文没有。 */
  zhOnly: [
    'pages.intelligence.portal.dashboard.capitalConditions.a11yAmountYi',
    'pages.intelligence.portal.dashboard.capitalConditions.a11yAmountWan'
  ],
  /** 英文有、中文没有。 */
  enOnly: [
    'pages.intelligence.portal.dashboard.capitalConditions.a11yAmountMillion'
  ]
} as const

describe('productCopy: every key path exists on both locales', () => {
  it('collects a real number of paths, so an empty table cannot pass this test', () => {
    // 「两侧都空 ⇒ 相等」是这类守卫最常见的假绿：表被搬走或导出改名后，两个空集合也相等。
    expect(keyPaths('zh-CN').size).toBeGreaterThan(500)
    expect(keyPaths('en-US').size).toBeGreaterThan(500)
  })

  it('differs only where the money reading is designed to differ, and names any other path', () => {
    const zh = keyPaths('zh-CN')
    const en = keyPaths('en-US')
    const missingEn = [...zh].filter((path) => !en.has(path)).sort()
    const missingZh = [...en].filter((path) => !zh.has(path)).sort()
    const allowedEn = new Set<string>(MONEY_READING_EXCEPTIONS.zhOnly)
    const allowedZh = new Set<string>(MONEY_READING_EXCEPTIONS.enOnly)
    // 例外之外**零差异**；报错点名路径，下一个改表的人不必去数两个大对象。
    expect({
      unexpectedZhOnly: missingEn.filter((path) => !allowedEn.has(path)),
      unexpectedEnOnly: missingZh.filter((path) => !allowedZh.has(path)),
      // 例外本身缺了、或方向反了（中文独有的跑到英文侧），也要红。
      missingZhOnly: MONEY_READING_EXCEPTIONS.zhOnly.filter((path) => !missingEn.includes(path)),
      missingEnOnly: MONEY_READING_EXCEPTIONS.enOnly.filter((path) => !missingZh.includes(path))
    }).toEqual({ unexpectedZhOnly: [], unexpectedEnOnly: [], missingZhOnly: [], missingEnOnly: [] })
  })
})
