import { describe, expect, it } from 'vitest'

import { productText } from '../desktop/shared/i18n/productText'
import type { DailyBriefingDocument } from './dailyBriefing'
import { briefingDataRows } from './dailyBriefingDataGroups'
import { dailyBriefingToMarkdown } from './dailyBriefingMarkdown'

const labels = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

const document = (overrides: Partial<DailyBriefingDocument> = {}): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: 'CPI 超预期 · Ripple 获批', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: {
    items: [{
      itemId: 'n1', title: 'JPMorgan says AI labels no longer win lenders', sourceName: 'CoinDesk RSS',
      publishedAt: '2026-10-30T00:00:00.000Z', polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC']
    }],
    macro: [{
      eventKey: 'US.CPI', title: 'cpi', titleKey: 'cpi', scheduledAt: '2026-10-29T12:30:00.000Z',
      importance: 'high', actual: '3.4%', previous: '3.1%', consensus: '3.2%', surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
    }],
    notes: {}
  },
  data: {
    market: [{
      id: 'btc', labelKey: 'dailyBriefing.row.btc', importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' },
      state: 'available', value: { number: -1.1, format: 'percent' }, change: null, window: '24h', observedAt: '2026-10-30T00:25:00.000Z'
    }],
    funds: [{
      id: 'stablecoin', group: 'funds', labelKey: 'dailyBriefing.row.stablecoin', importance: { tier: 'must', source: 'rule', reasonCode: 'reading' },
      state: 'available', value: { number: 253_033_903_673.4, format: 'usd' }, change: { value: -0.33, unit: 'percent', window: '1d' },
      auxiliaryChanges: [
        { value: -843_904_300.6, unit: 'usd', window: '1d' },
        { value: -0.8134, unit: 'percent', window: '7d' },
        { value: -2.2699, unit: 'percent', window: '30d' }
      ],
      window: '1d', observedAt: '2026-10-30T00:12:00.000Z'
    }],
    sentiment: {
      fearGreed: { id: 'fear-greed', group: 'sentiment', labelKey: 'dailyBriefing.row.fearGreed', importance: { tier: 'must', source: 'rule', reasonCode: 'reading' }, state: 'available', value: { number: 30, format: 'score' }, change: { value: -2, unit: 'points', window: '1d' }, window: 'latest', observedAt: null },
      news: { state: 'available', counts: { bearish: 1, bullish: 0, mixed: 0, neutral: 2 }, itemCount: 3 }
    }
  },
  conclusion: {
    summaryId: 's1', publishedAt: '2026-10-30T00:00:00.000Z', direction: 'bearish', directions: [],
    summary: 'Stablecoin contraction pulls bids away.',
    translation: '稳定币收缩把买盘推走。',
    conditions: ['Stablecoins keep contracting'],
    invalidations: [{ asset: 'BTC', horizonEnd: '2026-10-31T00:00:00.000Z', text: 'Stablecoins turn positive.' }],
    counterEvidence: [{ statement: 'BTC ETF took in $110M.', citations: [1] }],
    topSignal: null, dataGaps: ['No consensus'], caveats: ['Funding is venue-specific.']
  },
  next: { items: [{ eventKey: 'US.FOMC', title: 'fomc', titleKey: 'fomc', at: '2026-11-02T18:00:00.000Z', importance: 'high', category: 'central-bank-activity' }] },
  citations: [{ index: 1, refId: 'ev-1', sourceLabel: 'DefiLlama', observedAt: '2026-10-30T00:00:00.000Z', statement: '稳定币收缩' }],
  provenance: { summaryId: 's1', readAt: '2026-10-30T00:30:00.000Z' },
  ...overrides
})

const options = {
  labels,
  locale: 'zh-CN' as const,
  direction: (term: string) => term,
  eventTitle: (item: Readonly<{ title: string }>) => item.title,
  formatTime: (value: string) => value.slice(0, 16)
}

describe('the copied text reads the same figures as the card', () => {
  it('prints the level and the move for a price row, exactly as the card does', () => {
    // 生产形态：`close` 有值、`value` 是 percent、`change: null`。以前只读 `change`，复制出来只剩一个
    // 百分比、连点位都没有——图上是 `80,682.1 · ↑1.2%`，文本是 `+1.23%`，同一份内容两个样子。
    const base = document()
    const doc = {
      ...base,
      data: {
        ...base.data,
        market: [{
          ...base.data.market[0]!,
          close: { value: 80_682.1, at: '2026-10-30T00:25:00.000Z' },
          value: { number: 1.23, format: 'percent' as const },
          change: null
        }]
      }
    }
    const markdown = dailyBriefingToMarkdown(doc, options)
    const line = markdown.split('\n').find((entry) => entry.startsWith('- ') && entry.includes('BTC'))!
    // 点位与涨跌幅两个数都在，而且与卡片同一份读取函数给出（一位小数）。
    expect(line, markdown).toBeDefined()
    expect(line).toContain('80,682.1')
    expect(line).toContain('1.2%')
  })
})

describe('a web-sourced value says so in the copy too (v2.128)', () => {
  it('prints the same value label the card prints, suffix included', () => {
    const base = document()
    const web = dailyBriefingToMarkdown({
      ...base,
      news: { ...base.news, macro: [{ ...base.news.macro[0]!, valueSource: 'web' }] }
    }, options)
    const store = dailyBriefingToMarkdown(base, options)
    // 三处一致：这里用的就是分享卡同一份拼法（`briefingMacroValueLabel`）。
    expect(web).toContain(`实际 3.4%${labels.macroWebValue}`)
    // 库内值一个字都不加。
    expect(store).toContain('实际 3.4%')
    expect(store).not.toContain(labels.macroWebValue)
  })

  it('prints no value segment at all when the event has no value', () => {
    const base = document()
    const markdown = dailyBriefingToMarkdown({
      ...base,
      news: { ...base.news, macro: [{ ...base.news.macro[0]!, actual: undefined }] }
    }, options)
    // 没有值就整段不出现：不印破折号、也不说"没拿到"（v2.124/v2.128）。
    expect(markdown).not.toContain('实际 —')
    expect(markdown).not.toContain('没拿到')
  })
})

describe('daily briefing markdown', () => {
  it('says the day is dense only when the must rows pass the threshold', () => {
    const base = document()
    const row = base.data.market[0]!
    const dense = dailyBriefingToMarkdown({
      ...base,
      data: { ...base.data, market: Array.from({ length: 8 }, (_, index) => ({ ...row, id: (['btc','eth','index','dxy','gold','us10y','us10y-real'] as const)[index % 7]!, labelKey: 'dailyBriefing.row.btc' })) }
    }, options)
    expect(dense).toContain(options.labels.denseDay)
    const normal = dailyBriefingToMarkdown({
      ...base,
      data: { ...base.data, market: Array.from({ length: 6 }, (_, index) => ({ ...row, id: (['btc','eth','index','dxy','gold','us10y','us10y-real'] as const)[index % 7]!, labelKey: 'dailyBriefing.row.btc' })) }
    }, options)
    expect(normal).not.toContain(options.labels.denseDay)
  })

  it('marks the index row as a perpetual proxy when it is one', () => {
    const base = document()
    const indexRow = { ...base.data.market[0]!, id: 'index' as const, labelKey: 'dailyBriefing.row.index' }
    const proxied = dailyBriefingToMarkdown({ ...base, data: { ...base.data, market: [...base.data.market, { ...indexRow, indexSource: 'proxy' as const }] } }, options)
    expect(proxied).toContain(options.labels.indexProxy)
    const real = dailyBriefingToMarkdown({ ...base, data: { ...base.data, market: [...base.data.market, { ...indexRow, indexSource: 'real' as const }] } }, options)
    expect(real).not.toContain(options.labels.indexProxy)
  })

  it('marks the perpetual contract on the copied price rows, like the card does', () => {
    const markdown = dailyBriefingToMarkdown(document(), options)
    const btc = markdown.split('\n').find((line) => line.startsWith('- BTC'))
    expect(btc).toContain(options.labels.perpetualContract)
    // 纳指不是永续合约报价：那一行不许挂这个标记。
    const index = markdown.split('\n').find((line) => line.startsWith('- 纳指'))
    if (index) expect(index).not.toContain(options.labels.perpetualContract)
  })

  it('marks an untranslated headline as the original in the copied text', () => {
    const markdown = dailyBriefingToMarkdown(document(), options)
    expect(markdown).toContain('（原文）')
    const translated = document()
    const withTranslation = dailyBriefingToMarkdown({
      ...translated,
      news: { ...translated.news, items: [{ ...translated.news.items[0]!, translatedTitle: '摩根大通称 AI 标签不再赢得贷款机构' }] }
    }, options)
    expect(withTranslation).not.toContain('（原文）')
  })

  it('carries the no-AI sentence into the copied text, and leaves it out when there is none', () => {
    // r17 `A9`：屏幕上有的那句，复制出去也要有；没有这回事时不许多出一行。
    const withNotice = dailyBriefingToMarkdown(document(), { ...options, editorialNotice: '本期只有数据，没有 AI 写的解读。' })
    expect(withNotice).toContain('本期只有数据，没有 AI 写的解读。')
    const without = dailyBriefingToMarkdown(document(), options)
    expect(without).not.toContain('没有 AI 写的解读')
  })

  it('leaves the readings count out of the copy header', () => {
    const markdown = dailyBriefingToMarkdown(document(), options)
    // The header block only: the body may legitimately say "5 项" about its own rows, so scanning
    // the whole document would turn this into a rule about wording rather than about the header.
    const header = markdown.split('\n').filter((line) => line.startsWith('> '))
    expect(header).toHaveLength(1)
    expect(header[0]).not.toMatch(/\d+\s*项/)
    expect(header[0]).toContain('2026-10-30')
  })

  it('keeps every source and fallback word out of the exported copy', () => {
    // The reader decided: the brief text and the exported image carry the reading, not the
    // provenance. Trace lives in the trace column.
    const base = document()
    const doc: DailyBriefingDocument = {
      ...base,
      data: {
        ...base.data,
        market: [{ ...base.data.market[0]!, state: 'stale' as const, reason: 'stale-fallback' as const, valueBasis: 'published' as const }]
      }
    }
    const markdown = dailyBriefingToMarkdown(doc, options)
    for (const phrase of Object.values(labels.staleBasis)) expect(markdown).not.toContain(phrase)
    expect(markdown).not.toContain(labels.states.stale)
  })

  it('exports a text edition with rows, conclusion and citations', () => {
    const markdown = dailyBriefingToMarkdown(document(), options)
    expect(markdown).toContain('# 每日简报 — 2026-10-30')
    expect(markdown).toContain('## 过去 24 小时要闻')
    expect(markdown).toContain('JPMorgan says AI labels no longer win lenders')
    expect(markdown).toContain('## 过去 24 小时数据')
    expect(markdown).toContain('### 重点')
    expect(markdown).toContain('稳定币')
    expect(markdown).toContain('## 结论')
    expect(markdown).toContain('稳定币收缩把买盘推走。')
    expect(markdown).toContain('Stablecoin contraction pulls bids away.')
    expect(markdown).toContain('什么会推翻它')
    expect(markdown).toContain('[1]')
    expect(markdown).toContain('## 接下来 7 日关注')
    expect(markdown).toContain('fomc')
    expect(markdown).toContain('证据')
    expect(markdown).toContain('DefiLlama')
    expect(markdown).toContain('稳定币收缩')
    expect(markdown).not.toContain('<svg')
    expect(markdown).not.toContain('<div')
  })

  it('leads change rows with the move and keeps the level as the caption', () => {
    const markdown = dailyBriefingToMarkdown(document(), options)

    // The 1d move is the line; the quarter-trillion level and the longer windows sit behind it.
    expect(markdown).toContain('- 稳定币: 1d -0.33% (总量 253B USD · 1d -843.9M USD · 7d -0.81% · 30d -2.27%)')
    expect(markdown).toContain('- 恐惧贪婪: 1d -2 点 (当前 30)')
  })

  it('states a missing baseline instead of a zero change', () => {
    const base = document()
    const stablecoin = base.data.funds[0]!
    const fearGreed = base.data.sentiment.fearGreed!
    const markdown = dailyBriefingToMarkdown({
      ...base,
      data: {
        ...base.data,
        funds: [{ ...stablecoin, change: null, changeReason: 'no-baseline' }],
        sentiment: {
          ...base.data.sentiment,
          fearGreed: { ...fearGreed, change: null, changeReason: 'no-baseline' }
        }
      }
    }, options)

    // The rows print — a reading without a baseline is still a reading — and the missing baseline is
    // stated instead of a fabricated zero. Dropping the row made a quiet day look like no data.
    expect(markdown).toContain('- 稳定币:')
    expect(markdown).toContain('- 恐惧贪婪:')
    expect(markdown).not.toContain('0.00%')
  })

  it('names what a change is measured against instead of calling every move a day move', () => {
    const base = document()
    const markdown = dailyBriefingToMarkdown({
      ...base,
      data: {
        ...base.data,
        sentiment: {
          ...base.data.sentiment,
          fearGreed: {
            ...base.data.sentiment.fearGreed!,
            cadence: 'publication-day',
            change: { value: 4, unit: 'points', window: 'publication-day' },
            window: 'publication-day',
            observedAt: '2026-11-02T00:00:00.000Z',
            baselineAt: '2026-10-30T00:00:00.000Z'
          }
        }
      }
    }, options)

    // The release cadence and its real span, not a fixed `1d`.
    expect(markdown).toContain('- 恐惧贪婪: 较上次发布 +4 点（10-30 → 11-02） (当前 30)')
  })

  it('leaves the banned word out of every reason the copied text can print', () => {
    // Reasons reach the copy through the whole text tree (`labels.reasons[row.reason]`), so the
    // check has to look at the values the tree actually carries, not at a `.reasons` call site.
    for (const reason of Object.values(options.labels.reasons)) expect(reason).not.toContain('读数')
  })

  it('states an empty edition instead of leaving blank sections', () => {
    const empty = document({
      status: { readings: [
        { id: 'fear-greed', state: 'unavailable' }, { id: 'funding', state: 'unavailable' },
        { id: 'capital', state: 'unavailable' }, { id: 'calendar', state: 'source-disabled' }
      ], readingsAvailable: 0, readingsTotal: 4 },
      lede: { source: 'template', text: '', generatedAt: '2026-10-30T00:30:00.000Z' },
      news: { items: [], macro: [], notes: { newsEmpty: 'news-source-disabled', macroEmpty: 'calendar-source-disabled' } },
      data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'source-disabled' } } },
      conclusion: null,
      next: { items: [], note: 'calendar-source-disabled' }
    })
    const markdown = dailyBriefingToMarkdown(empty, options)
    expect(markdown).toContain('四项数据都读不到')
    expect(markdown).not.toContain('## 过去 24 小时要闻')
    expect(markdown).not.toContain('## 结论')
    expect(markdown).not.toContain('## 接下来 7 日关注')
  })

  it('renders only the data rows the editor kept', () => {
    const base = document()
    const markdown = dailyBriefingToMarkdown({
      ...base,
      data: {
        ...base.data,
        market: [
          ...base.data.market,
          {
            id: 'dxy' as const, labelKey: 'dailyBriefing.row.dxy',
            importance: { tier: 'support' as const, source: 'rule' as const, reasonCode: 'context' as const },
            materiality: { material: true as const, reasonCode: 'fx-move' as const },
            visibility: 'hidden' as const, visibilityReason: 'not-selected',
            state: 'available' as const, value: { number: 0.43, format: 'percent' as const },
            change: null, window: '24h' as const, observedAt: '2026-10-30T00:25:00.000Z'
          }
        ],
        funds: base.data.funds.map((row) => ({
          ...row,
          visibility: 'hidden' as const,
          visibilityReason: 'no-material-change'
        }))
      }
    }, options)
    expect(markdown).toContain('BTC')
    expect(markdown).not.toContain('美元')
    expect(markdown).not.toContain('稳定币:')
  })

  it('escapes markdown punctuation in titles', () => {
    const markdown = dailyBriefingToMarkdown(document({
      news: {
        items: [{ itemId: 'n1', title: 'A *star* [link]', sourceName: 'S', publishedAt: '2026-10-30T00:00:00.000Z', polarity: 'neutral', strength: 1, confidence: 50, symbols: ['BTC'] }],
        macro: [], notes: {}
      }
    }), options)
    expect(markdown).toContain('A \\*star\\* \\[link\\]')
  })
})

describe('daily briefing markdown news titles', () => {
  const SOURCE = 'JPMorgan says AI labels no longer win lenders'
  const TRANSLATED = '摩根大通表示，AI 标签不再能赢得贷款方'
  const SECOND = 'Spot ETF inflows hit a record'

  const newsItem = (overrides: Partial<DailyBriefingDocument['news']['items'][number]>) => ({
    itemId: 'n1', title: SOURCE, sourceName: 'CoinDesk RSS', publishedAt: '2026-10-30T00:00:00.000Z',
    polarity: 'bearish' as const, strength: 3, confidence: 80, symbols: ['BTC'] as const,
    ...overrides
  })

  const withNews = (locale: 'zh-CN' | 'en-US', items: DailyBriefingDocument['news']['items']): DailyBriefingDocument => {
    const base = document()
    return { ...base, edition: { ...base.edition, locale }, news: { ...base.news, items } }
  }

  it('draws the source title in an English edition when the translation is Chinese', () => {
    const markdown = dailyBriefingToMarkdown(
      withNews('en-US', [newsItem({ translatedTitle: TRANSLATED })]),
      { ...options, locale: 'en-US' }
    )
    expect(markdown).toContain(SOURCE)
    expect(markdown).not.toContain(TRANSLATED)
  })

  it('keeps the translated title in a Chinese edition', () => {
    const markdown = dailyBriefingToMarkdown(
      withNews('zh-CN', [newsItem({ translatedTitle: TRANSLATED })]),
      { ...options, locale: 'zh-CN' }
    )
    expect(markdown).toContain(TRANSLATED)
    expect(markdown).not.toContain(`**${SOURCE}**`)
  })

  it('keeps every news item, in order, on both paths', () => {
    const items = [
      newsItem({ itemId: 'n1', translatedTitle: TRANSLATED }),
      newsItem({ itemId: 'n2', title: SECOND, polarity: 'bullish' })
    ]
    const english = dailyBriefingToMarkdown(withNews('en-US', items), { ...options, locale: 'en-US' })
    const chinese = dailyBriefingToMarkdown(withNews('zh-CN', items), { ...options, locale: 'zh-CN' })
    for (const [markdown, first] of [[english, SOURCE], [chinese, TRANSLATED]] as const) {
      expect(markdown).toContain(first)
      expect(markdown).toContain(SECOND)
      expect(markdown.indexOf(first)).toBeLessThan(markdown.indexOf(SECOND))
    }
  })
})

describe('the data region has one partition', () => {
  it('keeps the funding rows out of the row list and the ETF rows in it', () => {
    // The duplicate that started this: the funding rate printed in the funds block and again in the
    // leverage card. Restoring it to the list turns this red, which is the point.
    const base = document()
    const fundRow = (id: 'funding-btc' | 'funding-eth' | 'etf-btc' | 'etf-eth', value: number) => ({
      id, group: 'funds' as const, labelKey: `dailyBriefing.row.${id}`,
      importance: { tier: 'support' as const, source: 'rule' as const, reasonCode: 'context' as const },
      state: 'available' as const, value: { number: value, format: 'percent' as const },
      change: null, window: '24h' as const, observedAt: base.edition.windowEnd
    })
    const rows = briefingDataRows({
      ...base,
      data: {
        ...base.data,
        funds: [...base.data.funds, fundRow('funding-btc', 0.01), fundRow('funding-eth', 0.01), fundRow('etf-btc', -398_600_000), fundRow('etf-eth', -139_700_000)]
      }
    })
    const ids = rows.map((row) => row.id)
    expect(ids.filter((id) => id === 'funding-btc')).toHaveLength(0)
    expect(ids.filter((id) => id === 'funding-eth')).toHaveLength(0)
    expect(ids.filter((id) => id === 'etf-btc')).toHaveLength(1)
    expect(ids.filter((id) => id === 'etf-eth')).toHaveLength(1)
  })
})

describe('one number, one place', () => {
  it('prints each ETF row once, alongside the funding block rather than inside it', () => {
    const base = document()
    const fund = (id: 'etf-btc' | 'etf-eth', value: number) => ({
      id, group: 'funds' as const, labelKey: `dailyBriefing.row.${id}`,
      importance: { tier: 'support' as const, source: 'rule' as const, reasonCode: 'context' as const },
      state: 'available' as const, value: { number: value, format: 'flow-usd' as const },
      change: null, window: 'trading-day' as const, observedAt: base.edition.windowEnd
    })
    const markdown = dailyBriefingToMarkdown({
      ...base,
      data: { ...base.data, funds: [...base.data.funds, fund('etf-btc', -398_600_000), fund('etf-eth', -139_700_000)] }
    }, options)
    // The fixture carries the label keys, so the ids are what identifies a row here.
    const occurrences = (needle: string): number => markdown.split(needle).length - 1
    expect(occurrences('dailyBriefing.row.etf-btc')).toBe(1)
    expect(occurrences('dailyBriefing.row.etf-eth')).toBe(1)
    // The funding rows are excluded from the data list: the leverage block is their only home.
    expect(occurrences('dailyBriefing.row.funding-btc')).toBe(0)
  })
})

describe('the copied text carries the whole title', () => {
  it('writes the lede in full, with no ellipsis', () => {
    const long = 'Stablecoin contraction keeps the read defensive across every venue the desk covers today, and the funding leg still leans short'
    const markdown = dailyBriefingToMarkdown(document({ lede: { source: 'template', text: long, generatedAt: '2026-10-30T00:30:00.000Z' } }), options)
    // The export image may clamp to two lines (a separate implementation-period item); the copied
    // text is the full sentence, and it must not arrive pre-truncated.
    expect(markdown).toContain(long)
    expect(markdown).not.toContain(`${long.slice(0, 40)}…`)
  })
})
