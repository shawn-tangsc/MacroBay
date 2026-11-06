import { describe, expect, it } from 'vitest'

import type {
  BriefingMacroItem,
  BriefingMarketRow,
  BriefingPulseRow,
  DailyBriefingDocument
} from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { briefingIssueCounts, briefingIssues, groupBriefingIssues } from './dailyBriefingIssues'

const zhText = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const enText = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing
const formatTime = (value: string): string => value.slice(11, 16)

function document(overrides: Partial<DailyBriefingDocument> = {}): DailyBriefingDocument {
  return {
    schemaVersion: 1,
    policyVersion: 'daily-briefing.v1',
    edition: {
      date: '2026-10-30', locale: 'zh-CN',
      generatedAt: '2026-10-30T00:30:00.000Z',
      windowStart: '2026-10-29T00:30:00.000Z',
      windowEnd: '2026-10-30T00:30:00.000Z',
      timeZone: 'Asia/Shanghai'
    },
    status: {
      readings: [
        { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
        { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
      ],
      readingsAvailable: 4, readingsTotal: 4
    },
    lede: { source: 'template', text: '', generatedAt: '2026-10-30T00:30:00.000Z' },
    news: { items: [], macro: [], notes: {} },
    data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'available' } } },
    conclusion: null,
    next: { items: [] },
    citations: [],
    provenance: { summaryId: null, readAt: '2026-10-30T00:30:00.000Z' },
    ...overrides
  }
}

function pulse(overrides: Partial<BriefingPulseRow> = {}): BriefingPulseRow {
  return {
    id: 'stablecoin', group: 'funds', labelKey: 'dailyBriefing.row.stablecoin',
    importance: { tier: 'support', source: 'rule', reasonCode: 'context' },
    state: 'available', value: { number: 253_000_000_000, format: 'usd' },
    change: { value: -0.33, unit: 'percent', window: '1d' },
    window: '1d', observedAt: '2026-10-30T00:12:00.000Z',
    ...overrides
  }
}

function market(overrides: Partial<BriefingMarketRow> = {}): BriefingMarketRow {
  return {
    id: 'dxy', labelKey: 'dailyBriefing.row.dxy',
    importance: { tier: 'support', source: 'rule', reasonCode: 'context' },
    state: 'available', value: { number: 0.2, format: 'percent' },
    change: null, window: '24h', observedAt: '2026-10-30T00:00:00.000Z',
    ...overrides
  }
}

function macro(overrides: Partial<BriefingMacroItem> = {}): BriefingMacroItem {
  return {
    eventKey: 'US.CPI', title: 'CPI', scheduledAt: '2026-10-29T12:30:00.000Z', importance: 'high',
    actual: '3.4%', previous: '3.1%',
    surprise: { direction: 'consensus-unavailable' },
    ...overrides
  }
}

function withFunds(funds: readonly BriefingPulseRow[], extra: Partial<DailyBriefingDocument> = {}): DailyBriefingDocument {
  return document({ data: { market: [], funds, sentiment: { fearGreed: null, news: { state: 'available' } } }, ...extra })
}

function withMarket(rows: readonly BriefingMarketRow[]): DailyBriefingDocument {
  return document({ data: { market: rows, funds: [], sentiment: { fearGreed: null, news: { state: 'available' } } } })
}

describe('daily briefing issues', () => {
  it('explains a stablecoin row whose day-over-day change has no baseline', () => {
    const issues = briefingIssues({
      document: withFunds([pulse({ change: null, changeReason: 'no-baseline' })]),
      text: zhText,
      formatTime
    })
    const issue = issues.find((entry) => entry.id === 'baseline:stablecoin:no-baseline')!

    expect(issue.category).toBe('baseline')
    expect(issue.severity).toBe('warning')
    expect(issue.title).toBe('稳定币：昨日无可比数据，已隐藏变化')
    expect(issue.source).toBe('DefiLlama 稳定币')
    expect(issue.at).toBe('2026-10-30T00:12:00.000Z')
    expect(issue.advice).toContain('下一次发布')
  })

  // `A0.8`：过期的那一档必须在问题清单里说出来，连「几小时没更新」一起说；
  // 「确实没有」那一档则一条问题都不报——它本来就不是问题。
  it('reports a source disagreement as exactly one gap, and never as a value', () => {
    // `02` v2.128：两个来源说两个数 → 值格整格不渲染，右列**恰一条**冲突说明。
    const issues = briefingIssues({
      document: document({ news: { items: [], macro: [], notes: { macroValueConflicts: ['US.ADP'] } } }),
      text: zhText,
      formatTime
    })
    const conflicts = issues.filter((entry) => entry.template === 'macro-value-conflict')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.title).toBe(zhText.limits.macro.valueConflict)
  })

  it('names each "not readable" reason for the calendar, and stays silent for "nothing happened"', () => {
    const stale = briefingIssues({
      document: document({ news: { items: [], macro: [], notes: { macroEmpty: 'calendar-stale', macroEmptyHours: 42 } } }),
      text: zhText,
      formatTime
    })
    const staleIssue = stale.find((entry) => entry.id === 'data:calendar:calendar-stale')!
    expect(staleIssue.severity).toBe('warning')
    expect(staleIssue.title).toContain('42')
    expect(staleIssue.title).not.toContain('没有已发布的高影响事件')

    const timeout = briefingIssues({
      document: document({ news: { items: [], macro: [], notes: { macroEmpty: 'calendar-catch-up-timeout' } } }),
      text: zhText,
      formatTime
    })
    expect(timeout.find((entry) => entry.id === 'data:calendar:calendar-catch-up-timeout')?.title).toContain('90')

    const nothing = briefingIssues({
      document: document({ news: { items: [], macro: [], notes: { macroEmpty: 'past-24h-no-high-impact-release' } } }),
      text: zhText,
      formatTime
    })
    expect(nothing.some((entry) => entry.id.startsWith('data:calendar'))).toBe(false)
  })

  it('explains the fear-and-greed baseline and how long ago it was last published', () => {
    const fearGreed = pulse({
      id: 'fear-greed', group: 'sentiment', labelKey: 'dailyBriefing.row.fearGreed',
      value: { number: 48, format: 'score' }, change: null, changeReason: 'no-baseline',
      window: 'latest', observedAt: '2026-10-29T00:00:00.000Z'
    })
    const issues = briefingIssues({
      document: document({ data: { market: [], funds: [], sentiment: { fearGreed, news: { state: 'available' } } } }),
      text: zhText,
      formatTime
    })
    const issue = issues.find((entry) => entry.id === 'baseline:fear-greed:no-baseline')!

    expect(issue.title).toContain('昨日无可比数据，已隐藏变化')
    expect(issue.title).toContain('上次发布于 00:00')
    expect(issue.title).toContain('间隔 25 小时')
  })

  it('explains an ETF row with no as-of history and an ETF source that is disabled', () => {
    const noHistory = briefingIssues({
      document: withFunds([pulse({
        id: 'etf-btc', labelKey: 'dailyBriefing.row.etfBtc', value: null, change: null,
        state: 'unavailable', reason: 'etf-unavailable', window: 'trading-day', observedAt: null
      })]),
      text: zhText,
      formatTime
    }).find((entry) => entry.id === 'data:etf-btc:unavailable')!
    // The clock comes from this edition's own cutoff, not from the current settings.
    expect(noHistory.title).toBe('美国比特币现货基金：00:30 前无可用历史，最近交易日数据尚未返回')
    expect(noHistory.source).toBe('0xRouter ETF')
    expect(noHistory.advice).toContain('开盘后')

    // No readable cutoff: the sentence says only that the trading day has not arrived, and prints no time.
    const noTime = briefingIssues({
      document: withFunds([pulse({
        id: 'etf-btc', labelKey: 'dailyBriefing.row.etfBtc', value: null, change: null,
        state: 'unavailable', reason: 'etf-unavailable', window: 'trading-day', observedAt: null
      })]),
      text: zhText,
      formatTime: () => ''
    }).find((entry) => entry.id === 'data:etf-btc:unavailable')!
    expect(noTime.title).toBe('美国比特币现货基金：最近交易日数据尚未返回')
    expect(noTime.title).not.toMatch(/\d{2}:\d{2}/)
    expect(noTime.advice).not.toMatch(/\d{2}:\d{2}/)

    const gated = briefingIssues({
      document: withFunds([pulse({
        id: 'etf-eth', labelKey: 'dailyBriefing.row.etfEth', value: null, change: null,
        state: 'unavailable', reason: 'capital-gate', window: 'trading-day', observedAt: null
      })]),
      text: zhText,
      formatTime
    }).find((entry) => entry.id === 'data:etf-eth:unavailable')!
    expect(gated.title).toContain('随稳定币/资金面数据不可用')
    expect(gated.advice).toContain('ETF 会随之恢复')

    const disabled = briefingIssues({
      document: withFunds([pulse({
        id: 'etf-btc', labelKey: 'dailyBriefing.row.etfBtc', value: null, change: null,
        state: 'source-disabled', window: 'trading-day', observedAt: null
      })]),
      text: zhText,
      formatTime
    }).find((entry) => entry.id === 'data:etf-btc:disabled')!
    expect(disabled.title).toBe('美国比特币现货基金：来源未启用，未显示数据')
    expect(disabled.advice).toContain('配置看板来源')
  })

  it('explains a released macro event without a consensus and an upcoming one without a previous value', () => {
    const issues = briefingIssues({
      document: document({
        news: { items: [], macro: [macro({ consensus: undefined })], notes: {} },
        next: { items: [], focus: { eventKey: 'US.FOMC', title: 'FOMC', at: '2026-11-04T18:00:00.000Z', importance: 'high', category: 'central-bank-activity' } }
      }),
      text: zhText,
      formatTime
    })
    expect(issues.find((entry) => entry.id === 'data:macro:consensus:US.CPI')?.title).toBe('CPI：预期值未收录')
    expect(issues.find((entry) => entry.id === 'data:next:consensus:US.FOMC')?.title).toBe('FOMC：预期值未收录')
    expect(issues.find((entry) => entry.id === 'data:next:previous:US.FOMC')?.severity).toBe('info')
  })

  // `02` v2.133 B 案：讲话/声明类事件没有数值是设计如此，**不是缺口**。
  // 记进右列会让读者和排查的人都以为坏了，而它本来就不会有数。
  it('files no gap for a statement-only event, and still files one for a numeric release that is missing', () => {
    const speech = macro({ eventKey: 'US.FED.SPEECH', title: '里奇蒙联储主席巴尔金发表讲话', actual: undefined, previous: undefined, consensus: undefined })
    // 正常发布行：有前值、有预期值，只是这次的实际值还没到——那是缺口。
    const released = macro({ eventKey: 'US.CPI', actual: undefined, consensus: '3.2%', previous: '3.1%' })
    const issues = briefingIssues({
      document: document({ news: { items: [], macro: [speech, released], notes: {} } }),
      text: zhText,
      formatTime
    })
    // 讲话行：一条缺口都不该有（实际值 / 预期值 / 前值三项都不记）。
    expect(issues.filter((entry) => entry.id.includes('US.FED.SPEECH'))).toHaveLength(0)
    // 有预期值、缺实际值的正常发布行照旧记缺口——两种行在数据上可区分。
    expect(issues.some((entry) => entry.id === 'data:macro:actual:US.CPI')).toBe(true)
  })

  it('explains DXY, gold and the ten-year when they are unavailable or lack a comparison window', () => {
    const issues = briefingIssues({
      document: withMarket([
        market({ id: 'dxy', state: 'unavailable', value: null, reason: 'query-failed' }),
        market({ id: 'gold', labelKey: 'dailyBriefing.row.gold', changeReason: 'insufficient-window' }),
        market({ id: 'us10y', labelKey: 'dailyBriefing.row.us10y', state: 'unavailable', value: null, reason: 'not-collected', window: 'daily' })
      ]),
      text: zhText,
      formatTime
    })
    expect(issues.find((entry) => entry.id === 'data:dxy:unavailable')?.title).toBe('美元：数据不可用')
    expect(issues.find((entry) => entry.id === 'baseline:gold:insufficient-window')?.title).toBe('黄金：比较窗口不足，未显示变化')
    expect(issues.find((entry) => entry.id === 'data:us10y:unavailable')?.title).toBe('美债 10Y 名义收益率：数据不可用')
  })

  it('reports the successful core-fact backfill without exposing its internal reason', () => {
    const issues = briefingIssues({
      document: document({
        provenance: {
          summaryId: null, readAt: '2026-10-30T00:30:00.000Z',
          supplements: [{ at: '2026-10-30T00:20:00.000Z', tool: 'daily-brief-core-fact-ensure', reason: 'filled 2 core data rows: core-stablecoin-supply-usd, etf-net-flow-btc' }]
        }
      }),
      text: zhText,
      formatTime
    })
    const issue = issues.find((entry) => entry.category === 'backfill')!

    expect(issue.severity).toBe('info')
    expect(issue.title).toBe('已回补 2 个核心数据行：稳定币、美国比特币现货基金')
    expect(JSON.stringify(issue)).not.toContain('filled 2 core data rows')
    expect(issue.at).toBe('2026-10-30T00:20:00.000Z')
  })

  it('reports a model fallback, a disabled WebSearch and a blocking generation failure', () => {
    const fallback = briefingIssues({
      document: document({
        provenance: {
          summaryId: null, readAt: '2026-10-30T00:30:00.000Z',
          editorialMeta: { promptVersion: 'v1', model: 'provider:model', source: 'default', fallback: 'custom-unavailable' }
        }
      }),
      text: zhText,
      formatTime,
      webSearchEnabled: false
    })
    expect(fallback.find((entry) => entry.id === 'ai:model-fallback')?.title).toContain('回落到默认模型')
    expect(fallback.find((entry) => entry.id === 'ai:websearch-off')?.category).toBe('ai')

    const blocked = briefingIssues({
      document: document({
        provenance: {
          summaryId: null, readAt: '2026-10-30T00:30:00.000Z',
          editorialFailure: 'model-unavailable',
          editorialFailureDetail: 'sk-live-SECRET0123456789\n    at handler (/app/private/secret.js:1:1)'
        }
      }),
      text: zhText,
      formatTime
    })
    const failure = blocked.find((entry) => entry.severity === 'blocking')!
    expect(failure.category).toBe('ai')
    expect(failure.title).toBe('AI 编辑未完成：默认模型不可用')
    expect(JSON.stringify(blocked)).not.toContain('sk-live')
    expect(JSON.stringify(blocked)).not.toContain('/app/private')

    const system = briefingIssues({
      document: document({ provenance: { summaryId: null, readAt: '2026-10-30T00:30:00.000Z', editorialFailure: 'store-failed' } }),
      text: zhText,
      formatTime
    }).find((entry) => entry.id === 'system:editorial-failure:store-failed')!
    expect(system.severity).toBe('blocking')
    expect(system.title).toBe('生成或存储未完成：日报保存失败')
  })

  it('keeps the conclusion gaps and caveats, deduplicates them and flags uncited evidence and conflicts', () => {
    const issues = briefingIssues({
      document: document({
        conclusion: {
          summaryId: 's1', publishedAt: '2026-10-30T00:00:00.000Z', direction: 'bearish', directions: [], summary: 's',
          conditions: [], invalidations: [],
          counterEvidence: [{ statement: 'BTC ETF 反证', citations: [] }],
          topSignal: null,
          dataGaps: ['证据条数已截断', '其他域数据未提供'],
          caveats: ['证据条数已截断', '资金费率是场所特定的']
        },
        citations: [{ index: 1, refId: 'ev-1', observedAt: '2026-10-30T00:00:00.000Z', statement: 'US.CPI consensus: 3.1 (source conflict)' }]
      }),
      text: zhText,
      formatTime
    })
    const evidence = issues.filter((entry) => entry.category === 'evidence')
    expect(evidence.filter((entry) => entry.title === '数据缺口：证据条数已截断')).toHaveLength(1)
    expect(evidence.map((entry) => entry.title)).toContain('数据限制：资金费率是场所特定的')
    expect(evidence.find((entry) => entry.id.startsWith('evidence:claim:'))?.title).toContain('反证未附证据')
    expect(evidence.find((entry) => entry.id === 'evidence:conflict:1')?.title).toBe('来源冲突：US.CPI consensus: 3.1')
    expect(JSON.stringify(evidence)).not.toContain('(source conflict)')
  })

  it('reports a brief generated well after its statistics cutoff', () => {
    const issues = briefingIssues({
      document: document({
        edition: {
          date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T04:30:00.000Z',
          windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', timeZone: 'Asia/Shanghai'
        }
      }),
      text: zhText,
      formatTime
    })
    expect(issues.find((entry) => entry.category === 'timing')?.title).toBe('本期在统计截止后 4 小时生成')
  })

  it('sorts blocking first, then by category, and counts each severity', () => {
    const issues = briefingIssues({
      document: document({
        provenance: {
          summaryId: null, readAt: '2026-10-30T00:30:00.000Z',
          editorialFailure: 'store-failed',
          supplements: [{ at: '2026-10-30T00:20:00.000Z', tool: 'daily-brief-core-fact-ensure', reason: 'filled 1 core data rows: dxy-level' }]
        },
        data: {
          market: [],
          funds: [pulse({ change: null, changeReason: 'no-baseline' })],
          sentiment: { fearGreed: null, news: { state: 'available' } }
        }
      }),
      text: zhText,
      formatTime
    })
    expect(issues[0]?.severity).toBe('blocking')
    expect(issues.every((entry) => entry.source.length > 0 && entry.at.length > 0 && entry.advice.length > 0)).toBe(true)
    expect(briefingIssueCounts(issues)).toEqual({ blocking: 1, warning: 1, info: 1 })
  })

  it('returns nothing for an edition without a limitation', () => {
    expect(briefingIssues({ document: document(), text: zhText, formatTime })).toEqual([])
  })

  /**
   * "Not applicable" is not a limitation.
   *
   * A window longer than the 24-hour curve makes the two price cards state no curve — the read did
   * answer, the curve simply cannot cover the window. Counting that as a gap would tell the reader the
   * data is missing, and would make a 48-hour edition look worse than the 24-hour edition of the same
   * day for a reason that is purely about the drawing.
   */
  it('does not turn an inapplicable curve into a limitation', () => {
    const plain = briefingIssues({ document: withMarket([market()]), text: zhText, formatTime })
    const withCurve = briefingIssues({
      document: withMarket([market({ curve: [[
        { at: '2026-10-29T00:30:00.000Z', returnPercent: 0 },
        { at: '2026-10-30T00:30:00.000Z', returnPercent: 0.4 }
      ]] })]),
      text: zhText,
      formatTime
    })
    const inapplicable = briefingIssues({
      document: withMarket([market({ curveReason: 'window-too-long' })]),
      text: zhText,
      formatTime
    })

    // The same edition with and without a stored curve yields the same limitations, and a longer
    // window adds none either: the only thing that changed is whether a line can be drawn.
    expect(withCurve).toEqual(plain)
    expect(inapplicable).toEqual(plain)

    const longerWindow = briefingIssues({
      document: document({
        edition: { ...document().edition, windowStart: '2026-10-28T00:30:00.000Z', windowHours: 48 },
        data: { market: [market({ curveReason: 'window-too-long' })], funds: [], sentiment: { fearGreed: null, news: { state: 'available' } } }
      }),
      text: zhText,
      formatTime
    })
    expect(longerWindow).toEqual(plain)
  })

  it('renders the same derivation in English', () => {
    const issues = briefingIssues({
      document: withFunds([pulse({ change: null, changeReason: 'no-baseline' })]),
      text: enText,
      formatTime
    })
    expect(issues.find((entry) => entry.id === 'baseline:stablecoin:no-baseline')?.title)
      .toBe('Stablecoins: no comparable data for yesterday, so the change is hidden')
    expect(issues.find((entry) => entry.id === 'baseline:stablecoin:no-baseline')?.advice).toContain('next release')
  })
})

describe('issue grouping', () => {
  it('counts by category, code and copy template, puts blocking first and keeps empty groups out', () => {
    const macroItems = Array.from({ length: 7 }, (_, index) => macro({
      eventKey: `US.EVENT.${index}`, title: `EVENT ${index}`, consensus: undefined
    }))
    const staleRows = [
      market({ id: 'dxy', state: 'stale', change: null }),
      market({ id: 'gold', labelKey: 'dailyBriefing.row.gold', state: 'stale', change: null })
    ]
    const issues = briefingIssues({
      document: document({
        news: { items: [], macro: macroItems, notes: {} },
        data: {
          market: staleRows,
          funds: [pulse({ change: null, changeReason: 'no-baseline' })],
          sentiment: { fearGreed: null, news: { state: 'available' } }
        },
        provenance: { summaryId: null, readAt: '2026-10-30T00:30:00.000Z', editorialFailure: 'store-failed' }
      }),
      text: zhText,
      formatTime
    })
    const groups = groupBriefingIssues(issues, zhText)
    const label = (name: string) => groups.find((group) => group.label === name)!

    expect(label('预期值未收录').count).toBe(7)
    expect(label('数据陈旧').count).toBe(2)
    expect(label('变化基线缺失').count).toBe(1)
    expect(groups[0]?.severity).toBe('blocking')
    expect(groups.every((group) => group.count > 0)).toBe(true)
    expect(groups.reduce((total, group) => total + group.count, 0)).toBe(issues.length)
    expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length)
    for (const group of groups) {
      expect(group.issues.every((issue) => issue.category === group.category && issue.code === group.code && issue.template === group.template)).toBe(true)
      expect(group.example).toBe(group.issues[0]?.title)
    }
  })
})
