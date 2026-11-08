import { describe, expect, it } from 'vitest'

import { briefingTextBreaches, briefingTextLeaves } from './dailyBriefingTextScanner'

/**
 * 扫描器的判据只有两条：**每个字符串叶子都被扫过**，以及**来源数据的逐字引用不算违规**。
 *
 * 这里刻意用"逐叶子注入"的方式：夹具里每加一个字段，注入循环自动覆盖它，
 * 扫描器不用改一行——这正是「字段一加就漏」那个缺陷的机器判据。
 */
const source = 'Nasdaq-listed company may sell $450 million bitcoin'

function documentFixture(): Record<string, unknown> {
  return {
    edition: { date: '2026-11-02', locale: 'en-US' },
    lede: { text: 'Rates hold the tape while flows turn.' },
    conclusion: {
      summary: 'Yields pulled back and spot flows turned positive.',
      change: 'The 10-year yield fell 6bp.',
      topSignal: { rationale: 'ETF inflows returned for a second session.' },
      conditions: ['Funding stays positive.'],
      dataGaps: []
    },
    news: {
      items: [{ title: source, excerpt: 'A company filed to sell bitcoin.' }],
      sources: [{ label: 'Reuters', url: 'https://example.com/a' }],
      notes: { macroEmpty: 'calendar-stale' }
    },
    data: { market: [{ label: 'BTC 24h', change: '+1.2%' }] },
    next: { items: [{ title: 'CPI release' }] }
  }
}

describe('the briefing text scanner', () => {
  it('reaches every string leaf and names a stable path for each', () => {
    const paths = briefingTextLeaves(documentFixture()).map((leaf) => leaf.path)
    for (const expected of [
      'edition.date',
      'lede.text',
      'conclusion.summary',
      'conclusion.change',
      'conclusion.topSignal.rationale',
      'conclusion.conditions[0]',
      'news.items[0].title',
      'news.sources[0].label',
      'news.notes.macroEmpty',
      'data.market[0].change',
      'next.items[0].title'
    ]) {
      expect(paths).toContain(expected)
    }
  })

  it('accepts a clean English edition', () => {
    expect(briefingTextBreaches({ document: documentFixture(), locale: 'en-US', sourceTexts: [source] })).toEqual([])
  })

  it('catches a whole Chinese paragraph in an English edition and names where it is', () => {
    const document = documentFixture()
    ;(document.conclusion as { topSignal: { rationale: string } }).topSignal.rationale = '资金流印证了收益率回落，风险资产重新获得支撑。'
    const breaches = briefingTextBreaches({ document, locale: 'en-US', sourceTexts: [source] })
    expect(breaches).toHaveLength(1)
    expect(breaches[0]?.path).toBe('conclusion.topSignal.rationale')
  })

  it('does not flag source data quoted verbatim, including a Chinese headline in an English edition', () => {
    const chineseHeadline = '某上市公司拟出售 4.5 亿美元比特币'
    const document = documentFixture()
    ;(document.news as { items: { title: string }[] }).items[0]!.title = chineseHeadline
    // 这条标题在来源数据里原样存在 → 引用，不是模型自己写的中文。
    expect(briefingTextBreaches({ document, locale: 'en-US', sourceTexts: [source, chineseHeadline] })).toEqual([])
    // 同一句话若来源里没有，就必须报出来（否则等于给任何引用都开后门）。
    expect(briefingTextBreaches({ document, locale: 'en-US', sourceTexts: [source] })).toHaveLength(1)
  })

  it('catches an English paragraph in a Chinese edition too, with the same function', () => {
    const document = documentFixture()
    ;(document.conclusion as { summary: string }).summary = 'Yields pulled back and spot flows turned positive for the second session today'
    // 夹具本身是英文文档，中文版次里几乎每条都会命中——这里只断言**注入的那条一定被点名**。
    const breaches = briefingTextBreaches({ document, locale: 'zh-CN' })
    expect(breaches.map((leaf) => leaf.path)).toContain('conclusion.summary')
  })

  it('covers every leaf by construction: injecting foreign text into each one is always caught', () => {
    // 逐叶子注入：把每个字符串换成一段明显是他种语言的文字，断言每一条都被点名。
    const injected = documentFixture()
    const leaves = briefingTextLeaves(injected)
    for (const leaf of leaves) {
      const copy = structuredClone(injected)
      const target = copy as Record<string, unknown>
      const segments = leaf.path.replace(/\[(\d+)\]/gu, '.$1').split('.')
      let cursor: Record<string, unknown> | unknown[] = target
      for (let index = 0; index < segments.length - 1; index += 1) {
        const key = segments[index]!
        cursor = (Array.isArray(cursor) ? cursor[Number(key)] : cursor[key]) as Record<string, unknown>
      }
      const last = segments[segments.length - 1]!
      const text = '资金流印证了收益率回落，风险资产重新获得支撑，市场重新定价。'
      if (Array.isArray(cursor)) cursor[Number(last)] = text
      else (cursor as Record<string, unknown>)[last] = text
      const breaches = briefingTextBreaches({ document: copy, locale: 'en-US' })
      expect(breaches.map((entry) => entry.path), `leaf ${leaf.path}`).toContain(leaf.path)
    }
  })
})
