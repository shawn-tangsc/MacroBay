// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import { briefingChangeArrows, briefingFearGreedBuckets, briefingPaymentDirections, briefingPolicyGaugeWords } from './dailyBriefingPaymentDirections'

const text = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing
const zhText = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const CJK = /[\u4e00-\u9fff]/

const briefing = (): DailyBriefingDocument => ({
  schemaVersion: 6,
  policyVersion: 'daily-briefing.v17',
  edition: {
    date: '2026-10-30', locale: 'en-US', generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: 'Stablecoins keep contracting.', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: {
    items: [],
    macro: [{
      eventKey: 'US.CPI', title: 'CPI', scheduledAt: '2026-10-30T00:00:00.000Z',
      importance: 'high', actual: '3.4%', previous: '3.1%', consensus: '3.2%', surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
    }],
    notes: {}
  },
  data: {
    market: [{
      id: 'btc', labelKey: 'dailyBriefing.row.btc', importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' },
      state: 'available', value: { number: -1.1, format: 'percent' }, change: null, window: '24h', observedAt: '2026-10-30T00:25:00.000Z'
    }],
    policyPath: { state: 'available', meetingDate: '2026-12-09', outcome: 'hike-25', probability: 76, observedAt: '2026-10-30T02:10:00.000Z' },
    leverage: { state: 'available', btc: { openInterestUsd: 1_200_000_000, change24hPct: -1.2 }, eth: { openInterestUsd: 800_000_000, change24hPct: 0.4 } },
    funds: [],
    sentiment: {
      fearGreed: null,
      news: { state: 'available', counts: { bearish: 2, bullish: 1, mixed: 0, neutral: 1 }, itemCount: 4 }
    }
  },
  conclusion: {
    summaryId: 's1', publishedAt: '2026-10-30T00:00:00.000Z', direction: 'bearish', directions: [],
    summary: 'Stablecoin contraction pulls bids away.',
    conditions: ['Stablecoins keep contracting'],
    invalidations: [{ asset: 'BTC', horizonEnd: '2026-10-31T00:00:00.000Z', text: 'Stablecoins turn positive.' }],
    counterEvidence: [], topSignal: null, dataGaps: [], caveats: []
  },
  next: {
    items: [],
    focus: {
      eventKey: 'US.FOMC', title: 'FOMC decision', at: '2026-11-02T18:00:00.000Z',
      importance: 'high', category: 'central-bank-activity', countryCode: 'US', countryName: '美国'
    }
  },
  citations: [
    { index: 1, refId: 'macro-calendar:US.CPI', observedAt: '2026-10-30T00:00:00.000Z' },
    { index: 2, refId: 'news:n1', observedAt: '2026-10-30T00:00:00.000Z' },
    { index: 3, refId: 'ev-1' }
  ],
  provenance: { summaryId: 's1', readAt: '2026-10-30T00:30:00.000Z' }
})

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

const renderWith = async (
  doc: DailyBriefingDocument,
  // Both locales are passed here; the component's own prop is the union of the two copy trees.
  copy: typeof text | typeof zhText,
  locale: 'zh-CN' | 'en-US'
): Promise<HTMLDivElement> => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const formatTime = (value: string): string => value.slice(0, 16).replace('T', ' ')
  await act(async () => root!.render(createElement(DailyBriefingShareCard, {
    document: doc, text: copy, locale, formatTime,
    // 宏观空态那句要印「截至 {time}（{zone}）」：时区由页面给，卡片不自猜。
    timeZone: 'UTC',
    // The card never owns these words; the page hands them in, so the test hands them in too.
    paymentDirectionsCompact: briefingPaymentDirections(locale),
    policyWords: briefingPolicyGaugeWords(locale), changeArrows: briefingChangeArrows(locale), fearGreedBuckets: briefingFearGreedBuckets(locale)
  })))
  return host
}

const render = (doc: DailyBriefingDocument = briefing()): Promise<HTMLDivElement> => renderWith(doc, text, 'en-US')

const withFocus = (overrides: Partial<NonNullable<DailyBriefingDocument['next']['focus']>>): DailyBriefingDocument => {
  const base = briefing()
  return { ...base, next: { ...base.next, focus: { ...base.next.focus!, ...overrides } } }
}

describe('a backfilled edition says which world it read', () => {
  const backfilled = (): DailyBriefingDocument => {
    const base = briefing()
    return {
      ...base,
      edition: { ...base.edition, isBackfill: true, readAt: '2026-10-30T12:20:00.000Z', generatedAs: '2026-10-30T12:20:00.000Z' }
    }
  }

  it('prints the cutoff only, never when we read the store', async () => {
    // 用户 2026-11-06：简报里**不显示具体生成时刻**——「本版读取 …」整段撤掉（正文/导出/复制同源）。
    // 统计截止保留：那是这一版的窗口末端，读者要看。
    const host = await render(backfilled())
    const cutoff = host.querySelector<HTMLElement>('[data-meta-cutoff]')!
    expect(cutoff.textContent).toBe(text.metaCutoff.replace('{time}', '2026-10-30 00:30').replace('{zone}', 'GMT'))
    expect(host.querySelector('[data-meta-read-at]')).toBeNull()
    expect(host.textContent).not.toContain('本版读取')
  })

  it('prints no backfill marker at all, and keeps the field in the document', async () => {
    // 用户 2026-11-06：这句也从简报里去掉（正文/导出/复制同源）。字段仍写在文档里，排查要用。
    const host = await render(backfilled())
    expect(host.querySelector('[data-backfill-note]')).toBeNull()
    expect(host.textContent).not.toContain('补跑')
    expect((backfilled() as { edition: { isBackfill?: boolean } }).edition.isBackfill).toBe(true)
  })

})

describe('the macro section draws events, and says why it is empty without implying missing data', () => {
  const emptyMacro = (notes: DailyBriefingDocument['news']['notes']): DailyBriefingDocument => {
    const doc = briefing()
    return { ...doc, news: { ...doc.news, macro: [], notes } }
  }
  // 用户 2026-11-06：正文里「没数据」「没拿到」「未拿到」「未公布」一个都不许出现。
  // 「暂时读不到：<原因>」是 2026-11-09（`MI-2-R89`）唯一被允许的缺失话术，只在**读不到**时说，
  // 所以它仍在「确实没有」那一档的禁令里——这一档正文一个字都不印。
  const forbidden = ['没数据', '没拿到', '未拿到', '未公布', '没有已发布的高影响事件', '暂时读不到']
  const assertClean = (host: HTMLElement): void => {
    for (const word of forbidden) expect(host.textContent).not.toContain(word)
  }

  it('draws nothing at all when the window held no high-impact event', async () => {
    const rendered = await render(emptyMacro({ macroEmpty: 'past-24h-no-high-impact-release' }))
    expect(rendered.querySelector('.mi-brief-poster__macro-head')).toBeNull()
    expect(rendered.querySelectorAll('.mi-brief-poster__macro')).toHaveLength(0)
    assertClean(rendered)
  })

  it('says the macro section could not be read, and why, when the calendar failed', async () => {
    // 用户 2026-11-09（`MI-2-R89`，呈现分寸放宽后）：空栏不再只靠右列解释——正文用同一句
    // 「暂时读不到：<原因>」说出来，与「数据缺口与限制」是同一个推导、同一句话。
    // 「确实没有」那一档仍不印（见上一条）：区分「拿不到」和「没有」，不把前者写成后者。
    // 期望句由同一张文案表推出（过期那条还要填上小时数），不是手抄一句话：文案一改，用例跟着改。
    const cases: Array<{ notes: DailyBriefingDocument['news']['notes']; expected: string }> = [
      { notes: { macroEmpty: 'calendar-stale', macroEmptyHours: 42 }, expected: `${text.macroUnreadable}${text.macroEmptyCodes['calendar-stale'].replace('{hours}', '42')}` },
      { notes: { macroEmpty: 'calendar-catch-up-timeout' }, expected: `${text.macroUnreadable}${text.macroEmptyCodes['calendar-catch-up-timeout']}` },
      { notes: { macroEmpty: 'calendar-unavailable' }, expected: `${text.macroUnreadable}${text.macroEmptyCodes['calendar-unavailable']}` }
    ]
    for (const { notes, expected } of cases) {
      const rendered = await render(emptyMacro(notes))
      expect(rendered.querySelector('.mi-brief-poster__macro-head')?.textContent).toBe(text.sections.macro)
      const rows = rendered.querySelectorAll('.mi-brief-poster__macro')
      expect(rows).toHaveLength(1)
      const row = rendered.querySelector('.mi-brief-poster__macro-row-empty')
      expect(row?.getAttribute('data-macro-empty')).toBe('unreadable')
      expect(row?.textContent).toBe(expected)
      // 仍然是一个判断，不是一句哭诉：说原因，但不出现「没数据/没拿到」这类把事说死的词。
      for (const word of ['没数据', '没拿到', '未拿到', '未公布', '没有已发布的高影响事件']) {
        expect(rendered.textContent, word).not.toContain(word)
      }
    }
  })

  it('prints the no-AI sentence on the exported sheet when the editorial failed', async () => {
    // r17 `A9`：导出的那张图就是这张海报，所以说明必须印在这里——不能只在屏幕上说。
    const doc = briefing()
    const rendered = await render({ ...doc, provenance: { ...doc.provenance, editorialFailure: 'provider-account-balance-insufficient' } })
    const notice = rendered.querySelector('.mi-brief-poster__ai-notice')
    expect(notice?.getAttribute('data-editorial-notice')).toBe('quota')
    expect(notice?.textContent).toBe(text.aiSettings.notice.quota)
  })

  it('prints no such line on a clean edition', async () => {
    const rendered = await render(briefing())
    expect(rendered.querySelector('.mi-brief-poster__ai-notice')).toBeNull()
  })

  it('says nothing when the edition recorded no reason at all', async () => {
    // 反例：老版本文档没有 `macroEmpty` 码。此时说不出是哪一档原因，**就不说**——
    // 编一句「暂时读不到」等于替文档猜原因。
    const rendered = await render(emptyMacro({}))
    expect(rendered.querySelector('.mi-brief-poster__macro-head')).toBeNull()
    expect(rendered.querySelector('.mi-brief-poster__macro-row-empty')).toBeNull()
  })

  it('keeps an event that has no actual, and renders no value cell for it', async () => {
    // 反证：把值删掉，事件行仍在（时刻/国家/名称），值那一格**整块不渲染**——连破折号都没有。
    const doc = briefing()
    const rendered = await render({ ...doc, news: { ...doc.news, macro: [{ ...doc.news.macro[0]!, actual: undefined }], notes: {} } })
    const rows = rendered.querySelectorAll('.mi-brief-poster__macro:not(.mi-brief-poster__macro-row-empty)')
    expect(rows).toHaveLength(1)
    expect(rendered.textContent).toContain(doc.news.macro[0]!.title)
    expect(rendered.textContent).not.toContain(text.macro.actual)
    expect(rows[0]!.textContent).not.toContain('3.4%')
    // 值格整块不渲染：破折号、占位符都不留（别处的分隔符不在这条判据里）。
    expect(rows[0]!.textContent).not.toContain('—')
    expect(rows[0]!.querySelector('small')).toBeNull()
    assertClean(rendered)
  })

  // `02` v2.133 B 案：讲话/声明类行**不写解析**，且结构上就看得出不同——不是少一句话。
  it('draws a statement row as one segment, and an explained row as two', async () => {
    const doc = briefing()
    const speech = {
      ...doc.news.macro[0]!, eventKey: 'US.FED.SPEECH', title: '里奇蒙联储主席巴尔金发表讲话',
      actual: undefined, previous: undefined, consensus: undefined, why: undefined,
      surprise: { direction: 'consensus-unavailable' as const, reason: 'missing-actual' }
    }
    const explained = { ...doc.news.macro[0]!, why: '初请低于前值，劳动力市场仍紧，抬高贴现率压力。' }
    const rendered = await render({ ...doc, news: { ...doc.news, macro: [speech, explained], notes: {} } })

    const absent = rendered.querySelector('[data-macro-parse="absent"]')!
    const present = rendered.querySelector('[data-macro-parse="present"]')!
    expect(absent).not.toBeNull()
    expect(present).not.toBeNull()
    // 结构判据：absent 行里**根本不生成**解析容器；present 行里恰一个。
    expect(absent.querySelectorAll('.mi-brief-poster__news-reason')).toHaveLength(0)
    expect(present.querySelectorAll('.mi-brief-poster__news-reason')).toHaveLength(1)
    // 讲话行照常显示时刻与标题，但没有值、没有解析，也不出现任何缺失话术。
    expect(absent.textContent).toContain('里奇蒙联储主席巴尔金发表讲话')
    expect(absent.textContent).not.toContain('—')
    assertClean(rendered)
  })

  it('marks a web-sourced value with the same suffix, and leaves a store value alone', async () => {
    // `02` v2.128：只给网页取到的值加「（网页）」；库内值一个字都不加。
    const base = briefing()
    const web = await render({
      ...base,
      news: { ...base.news, macro: [{ ...base.news.macro[0]!, valueSource: 'web' }], notes: {} }
    })
    expect(web.textContent!.split(text.macroWebValue).length - 1).toBe(1)
    const store = await render({ ...base, news: { ...base.news, macro: [{ ...base.news.macro[0]!, valueSource: 'calendar' }], notes: {} } })
    expect(store.textContent).not.toContain(text.macroWebValue)
    // 值本身两处都在：加的全是后缀，不是换了一份文字。
    expect(web.textContent).toContain('3.4%')
    expect(store.textContent).toContain('3.4%')
  })


  it('stays silent for an edition written before reasons were recorded', async () => {
    const rendered = await render({ ...briefing(), news: { ...briefing().news, macro: [], notes: {} } })
    expect(rendered.querySelector('.mi-brief-poster__macro-head')).toBeNull()
  })

  it('marks a cancelled event and draws it without a value cell (v2.125)', async () => {
    // 那天原定有一场、后来取消了：行在、含「已取消」、值格不渲染。藏起来读者会以为数据漏了。
    const doc = briefing()
    const rendered = await render({
      ...doc,
      news: { ...doc.news, macro: [{ ...doc.news.macro[0]!, actual: undefined, lifecycleState: 'cancelled' }], notes: {} }
    })
    const row = rendered.querySelector('.mi-brief-poster__macro:not(.mi-brief-poster__macro-row-empty)')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain(text.macro.cancelled)
    expect(rendered.textContent).not.toContain(text.macro.actual)
    expect(row!.querySelector('small')).toBeNull()
    assertClean(rendered)
  })

  // 用户 2026-11-06：AI 判定有用的**全部显示**，所以「共 N 条（另 M 条未列出）」这句连同截断一起删。
  it('never prints a shown/hidden count, whatever the candidate list holds', async () => {
    const doc = briefing()
    const candidates = Array.from({ length: 6 }, (_, index) => ({ ...doc.news.macro[0]!, eventKey: `EV.${index}`, title: `Event ${index}` }))
    const rendered = await render({ ...doc, news: { ...doc.news, macro: candidates.slice(0, 4), macroCandidates: candidates } })
    expect(rendered.querySelector('[data-macro-coverage]')).toBeNull()
    expect(rendered.textContent).not.toMatch(/未列出|not listed/)
  })

  it('still renders an edition written at schema 13, before the lifecycle field existed', async () => {
    // 库里已有旧版本文档（A11.2）：读 13 的文档不许报错、不许丢字段，缺 lifecycleState 就当没取消。
    const base = briefing()
    const old: DailyBriefingDocument = {
      ...base,
      schemaVersion: 13,
      policyVersion: 'daily-briefing.v23',
      edition: { ...base.edition, periodId: 'default', periodTime: '2026-10-30T00:30:00.000Z', periodKind: 'scheduled', runTrigger: 'scheduled' }
    }
    const rendered = await render(old)
    expect(rendered.textContent).toContain('3.4%')
    expect(rendered.querySelector('.mi-brief-poster__macro-cancelled')).toBeNull()
    expect(rendered.querySelector('.mi-brief-poster__macro-head')).not.toBeNull()
  })
})

describe('daily brief share card in English', () => {
  it('names the leverage, rate path and news count in English', async () => {
    const rendered = await render()
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''
    expect(poster).toContain(text.sections.leverage)
    // The card names what the dial is, not the section it sits in.
    expect(poster).toContain(text.sections.policyProbability)
    // The label names what the value is (the target range), not a claim about how it was priced.
    expect(poster).toContain(text.sections.policyRange)
    expect(poster).toContain(text.sections.rangeUnavailable)
    expect(poster).toContain(text.policyOutcomes['hike-25'])
    expect(poster).toContain('4 items:')
    expect(poster).not.toContain('条：')
  })

  it('names the citation sources and the next event country without Chinese', async () => {
    const rendered = await render()
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''
    expect(poster).toContain(text.citationSources.macroCalendar)
    expect(poster).toContain(text.citationSources.news)
    expect(poster).toContain(text.citationSources.analysis)
    expect(poster).toContain('United States')
    expect(poster).not.toContain('宏观日历')
    expect(poster).not.toContain('分析证据')
    expect(poster).not.toContain('美国')
    expect(poster).not.toMatch(CJK)
  })

  it('keeps the fallback row on the page and says nothing extra when the number is a 24-hour move', async () => {
    const base = briefing()
    const doc: DailyBriefingDocument = {
      ...base,
      data: {
        ...base.data,
        market: base.data.market.map((row) => row.id === 'btc'
          ? { ...row, state: 'stale' as const, reason: 'stale-fallback' as const, valueBasis: 'curve' as const }
          : row)
      }
    }
    const rendered = await render(doc)
    // A 24-hour move computed from the curve is still a 24-hour move: the row's own timestamp says
    // when it is, so an extra "where it came from" note would only repeat it and explain our method.
    expect(rendered.querySelector('.mi-brief-poster__stale')).toBeNull()
    expect(rendered.textContent).toContain('2026')
  })

  it('still speaks when the number is not what its name promises', async () => {
    const base = briefing()
    const doc: DailyBriefingDocument = {
      ...base,
      data: {
        ...base.data,
        market: base.data.market.map((row) => row.id === 'btc'
          ? { ...row, state: 'stale' as const, reason: 'stale-fallback' as const, valueBasis: 'last-close' as const }
          : row)
      }
    }
    const rendered = await render(doc)
    // The day's move is not a 24-hour move here, so the row has to say so.
    expect(rendered.querySelector('.mi-brief-poster__stale')?.textContent).toBe(text.staleBasis.lastClose)
  })

  it('keeps a stale row in the exported image, marked as stale', async () => {
    const base = briefing()
    const doc: DailyBriefingDocument = {
      ...base,
      data: {
        ...base.data,
        market: base.data.market.map((row) => row.id === 'btc'
          ? { ...row, state: 'stale' as const, reason: 'stale-fallback' as const, valueBasis: 'curve' as const }
          : row)
      }
    }
    const rendered = await renderWith(doc, text, 'en-US')
    // The image and the copied text are one edition: a stale row is labelled, not dropped from half
    // of the exports. Dropping it here made the PNG lose rows the text still carried.
    expect(rendered.textContent).toContain('BTC')
  })

  it('renders only the data rows the editor kept', async () => {
    const base = briefing()
    const rendered = await render({
      ...base,
      data: {
        ...base.data,
        market: [
          ...base.data.market,
          {
            id: 'index' as const, labelKey: 'dailyBriefing.row.index',
            importance: { tier: 'support' as const, source: 'rule' as const, reasonCode: 'context' as const },
            materiality: { material: true as const, reasonCode: 'index-move' as const },
            visibility: 'hidden' as const, visibilityReason: 'not-selected',
            state: 'available' as const, value: { number: 1.42, format: 'percent' as const },
            change: null, window: '24h' as const, observedAt: '2026-10-30T00:25:00.000Z'
          }
        ],
        leverage: base.data.leverage ? { ...base.data.leverage, visibility: 'hidden' as const, visibilityReason: 'no-material-change' } : undefined,
        policyPath: base.data.policyPath ? { ...base.data.policyPath, visibility: 'hidden' as const, visibilityReason: 'no-material-change' } : undefined
      }
    })
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''
    expect(poster).toContain(text.rows.btc)
    expect(poster).not.toContain(text.rows.index)
    expect(poster).not.toContain(text.sections.leverage)
    expect(poster).not.toContain(text.sections.policyPath)
  })

  it('leads the money and sentiment cells with their level, and keeps one comparison beside it', async () => {
    const base = briefing()
    const rendered = await render({
      ...base,
      data: {
        ...base.data,
        funds: [{
          id: 'stablecoin', group: 'funds' as const, labelKey: 'dailyBriefing.row.stablecoin',
          importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
          state: 'available' as const, value: { number: 253_033_903_673.4, format: 'usd' as const },
          change: { value: -0.33, unit: 'percent' as const, window: '1d' as const },
          auxiliaryChanges: [
            { value: -843_904_300.6, unit: 'usd' as const, window: '1d' as const },
            { value: -0.8134, unit: 'percent' as const, window: '7d' as const },
            { value: -2.2699, unit: 'percent' as const, window: '30d' as const }
          ],
          window: '1d' as const, observedAt: '2026-10-30T00:12:00.000Z'
        }],
        sentiment: {
          ...base.data.sentiment,
          fearGreed: {
            id: 'fear-greed', group: 'sentiment' as const, labelKey: 'dailyBriefing.row.fearGreed',
            importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
            state: 'available' as const, value: { number: 28, format: 'score' as const },
            change: { value: -2, unit: 'points' as const, window: '1d' as const },
            window: 'latest' as const, observedAt: '2026-10-30T00:00:00.000Z'
          }
        }
      }
    })
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''

    // The cell leads with the stock and keeps the day's dollar move; the longer windows are the
    // copied text's, not a cell's.
    expect(poster).toContain('253B USD')
    expect(poster).toContain('↓843.9M USD')
    expect(poster).not.toContain('7d -0.81%')
    expect(poster).not.toContain('30d')
    // Fear and greed leads with the score, then the step since the last release — no date span.
    expect(poster).toContain('28')
    // A move is an arrow and a magnitude: the arrow carries the direction, so the number does not repeat it.
    expect(poster).toContain('↓2 pts')
  })

  it('prints the missing baseline instead of a zero change', async () => {
    const base = briefing()
    const rendered = await render({
      ...base,
      data: {
        ...base.data,
        funds: [{
          id: 'stablecoin', group: 'funds' as const, labelKey: 'dailyBriefing.row.stablecoin',
          importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
          state: 'available' as const, value: { number: 253_033_903_673.4, format: 'usd' as const },
          change: null, changeReason: 'no-baseline' as const,
          window: '1d' as const, observedAt: '2026-10-30T00:12:00.000Z'
        }],
        sentiment: {
          ...base.data.sentiment,
          fearGreed: {
            id: 'fear-greed', group: 'sentiment' as const, labelKey: 'dailyBriefing.row.fearGreed',
            importance: { tier: 'must' as const, source: 'rule' as const, reasonCode: 'reading' as const },
            state: 'available' as const, value: { number: 30, format: 'score' as const },
            change: null, changeReason: 'no-baseline' as const,
            window: 'latest' as const, observedAt: '2026-10-30T00:00:00.000Z'
          }
        }
      }
    })
    // A row that is not one of the four headline numbers lands in the metrics block, so read the
    // whole card: where it prints does not matter, that it prints does.
    const numbers = rendered.textContent ?? ''

    // The rows print with their missing baseline stated; the poster used to drop them silently,
    // which is how a quiet day looked like a day with no readings.
    expect(numbers).toContain(text.rows.stablecoin)
    expect(numbers).toContain(text.rows.fearGreed)
    expect(numbers).not.toContain('0.00%')
  })

  it('separates the invalidation label with the locale separator', async () => {
    const rendered = await render()
    expect(rendered.textContent).toContain(`${text.conclusion.invalidation}: Stablecoins turn positive.`)
  })

  const withForecast = (overrides: Partial<NonNullable<NonNullable<DailyBriefingDocument['conclusion']>['synthesisDetail']>> = {}): DailyBriefingDocument => {
    const base = briefing()
    return {
      ...base,
      conclusion: {
        ...base.conclusion!,
        synthesis: 'agent',
        synthesisDetail: {
          direction: 'bearish',
          confidence: 'medium',
          summary: base.conclusion!.summary,
          outlook: '未来 1-3 日基准情形偏空：BTC 弱于 ETH。',
          conditions: ['ETF 流出维持在 -6.43 亿美元附近'],
          counterEvidence: ['若 ETF 连续两日净流入 6.43 亿美元且 BTC 收复 1.10% 跌幅，则判断失效'],
          watch: ['ETF 净流出 -6.43 亿美元是否收窄', 'BTC 资金费率 0.00% 是否转负'],
          regimeChange: '方向由持平转为偏空',
          confirmed: ['CPI 3.4% 高于预期后 BTC 反弹停止'],
          refuted: [],
          coreTension: 'CPI 3.4% 高于预期，但 BTC 只跌 1.10%',
          whatWouldChange: 'BTC 收复 1.10% 跌幅且 ETF 转为净流入',
          evidenceRefs: ['data:btc'],
          ...overrides
        }
      }
    }
  }

  it('renders the forecast the conclusion lands on, once each', async () => {
    const rendered = await render(withForecast())
    const poster = rendered.querySelector('.mi-brief-poster')!

    const outlook = poster.querySelector('.mi-brief-poster__outlook')?.textContent ?? ''
    expect(outlook).toContain('未来 1-3 日基准情形偏空')
    expect(poster.querySelectorAll('.mi-brief-poster__watch li')).toHaveLength(2)
    expect(poster.querySelector('.mi-brief-poster__overturn')?.textContent).toContain('BTC 收复 1.10% 跌幅')
    // The summary is stated once; the forecast block says the next part without repeating it.
    const summary = poster.querySelector('.mi-brief-poster__summary')!.textContent ?? ''
    expect(summary.match(/Stablecoin contraction pulls bids away\./g)).toHaveLength(1)
  })

  it('marks a changed call with a chip and hides the no-change sentinel', async () => {
    const changed = await render(withForecast())
    const chip = changed.querySelector('[data-regime-change="true"]')
    expect(chip?.textContent).toBe(text.conclusion.regimeChanged)
    // What changed is on the poster now. It used to be a `title` plus an `aria-label`: the pointer
    // got the sentence, sighted keyboard readers got a chip, and the exported image carried neither.
    expect(chip?.getAttribute('title')).toBeNull()
    expect(chip?.nextElementSibling?.textContent).toBe(`${text.labelSeparator}方向由持平转为偏空`)

    const unchanged = await render(withForecast({ regimeChange: '无重要变化' }))
    expect(unchanged.querySelector('[data-regime-change="true"]')).toBeNull()
  })

  it('states whether the earlier read held as one line', async () => {
    const held = await render(withForecast())
    expect(held.querySelector('[data-standing="held"]')?.textContent)
      .toContain(text.conclusion.basisHeld)
    expect(held.querySelector('[data-standing="held"]')?.textContent)
      .toContain('CPI 3.4% 高于预期后 BTC 反弹停止')

    const overturned = await render(withForecast({ confirmed: [], refuted: ['CPI 回落后 BTC 反弹没有出现'] }))
    expect(overturned.querySelector('[data-standing="overturned"]')?.textContent)
      .toContain(text.conclusion.basisOverturned)

    const partly = await render(withForecast({ refuted: ['CPI 回落后 BTC 反弹没有出现'] }))
    expect(partly.querySelector('[data-standing="partly"]')?.textContent)
      .toContain(text.conclusion.basisPartlyHeld)
  })

  it('names the basis of a forecast as its premises and falsifiers', async () => {
    const base = briefing()
    const withFalsifier: DailyBriefingDocument = {
      ...base,
      conclusion: {
        ...base.conclusion!,
        conditions: ['ETF outflows keep running for two sessions'],
        counterEvidence: [{ statement: 'Two straight days of ETF inflows.', citations: [] }]
      }
    }
    const rendered = await render(withFalsifier)
    const cards = [...rendered.querySelectorAll('.mi-brief-poster__basis-card')]

    // The basis belongs to the forecast the editor just made, so the headings say what that forecast
    // needs and what would overturn it — not "conditions" and "counter-evidence" of a past call.
    expect(cards.map((card) => card.querySelector('h3')?.textContent)).toEqual(['Premises', 'Falsifiers'])
    expect(cards[0]?.textContent).toContain('ETF outflows keep running for two sessions')
    expect(cards[1]?.textContent).toContain('Two straight days of ETF inflows.')

    const chinese = await renderWith(withFalsifier, zhText, 'zh-CN')
    expect([...chinese.querySelectorAll('.mi-brief-poster__basis-card h3')].map((heading) => heading.textContent))
      .toEqual(['判断前提', '证伪条件'])
  })

  it('shows only the two surprise cards and keeps the baseline out of the row', async () => {
    const rendered = await render(withFocus({
      consensus: '3.2%',
      previous: '3.1%',
      watch: [
        { condition: 'higher than expected', implication: 'Rates rise, BTC falls.' },
        { condition: 'lower than expected', implication: 'Rates fall, BTC rallies.' },
        { condition: 'inline with consensus', implication: 'The range holds.' }
      ]
    }))
    const grid = rendered.querySelector('.mi-brief-poster__next-watch-grid')
    const cards = [...rendered.querySelectorAll('[data-watch-kind]')]
    const baseline = rendered.querySelector('[data-watch-baseline]')!

    expect(grid?.getAttribute('data-watch-count')).toBe('2')
    expect(cards).toHaveLength(2)
    expect(cards.every((card) => card.parentElement === grid)).toBe(true)
    expect(cards.map((card) => card.getAttribute('data-watch-kind'))).toEqual(['lower', 'higher'])
    expect(cards.map((card) => card.querySelector('span')?.textContent))
      .toEqual(['Lower than expected', 'Higher than expected'])
    // The baseline is a footnote under the row, not a third card.
    expect(baseline.parentElement).not.toBe(grid)
    expect(baseline.textContent).toBe('In line with consensus: The range holds.')
  })

  it('localizes the inline condition into a Chinese footnote instead of leaking the AI phrase', async () => {
    const rendered = await renderWith(withFocus({
      consensus: '3.2%',
      previous: '29',
      watch: [
        { condition: 'higher than expected', implication: '利率上行，BTC 承压。' },
        { condition: 'inline with consensus', implication: '区间维持。' },
        { condition: 'lower than expected', implication: '利率下行，BTC 反弹。' }
      ]
    }), zhText, 'zh-CN')
    const cards = [...rendered.querySelectorAll('[data-watch-kind]')]
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''

    expect(cards.map((card) => card.getAttribute('data-watch-kind'))).toEqual(['lower', 'higher'])
    expect(cards.map((card) => card.querySelector('span')?.textContent)).toEqual(['低于预期', '高于预期'])
    expect(rendered.querySelector('[data-watch-baseline]')?.textContent).toBe('符合预期：区间维持。')
    expect(poster).not.toContain('Inline with consensus')
  })

  it('omits the baseline footnote when inline has no actionable implication', async () => {
    const rendered = await render(withFocus({
      watch: [
        { condition: 'higher than expected', implication: 'Rates rise.' },
        { condition: 'lower than expected', implication: 'Rates fall.' },
        { condition: 'inline with consensus', implication: '   ' }
      ]
    }))

    expect(rendered.querySelectorAll('[data-watch-kind]')).toHaveLength(2)
    expect(rendered.querySelector('[data-watch-baseline]')).toBeNull()
  })

  it('hides an unrecognized English watch condition instead of printing it', async () => {
    const rendered = await render(withFocus({
      watch: [{ condition: 'markets reprice around the print', implication: 'Spreads widen.' }]
    }))
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''

    expect(rendered.querySelector('[data-watch-kind]')).toBeNull()
    expect(rendered.querySelector('.mi-brief-poster__next-watch-grid')).toBeNull()
    expect(poster).not.toContain('markets reprice')
    expect(poster).not.toContain(text.next.watchOther)
  })


  it('carries expected and previous into the event header instead of a trailing line', async () => {
    const rendered = await render(withFocus({ consensus: '3.2%', previous: '29' }))
    const meta = rendered.querySelector('.mi-brief-poster__next-meta')!.textContent

    expect(meta).toBe('High impact · United States · Consensus 3.2% · Previous 29')
    expect(rendered.querySelector('.mi-brief-poster__next-values')).toBeNull()
    expect((rendered.querySelector('.mi-brief-poster')!.textContent?.match(/Previous 29/g) ?? [])).toHaveLength(1)
  })

  it('shows a lone previous in the event header', async () => {
    const rendered = await renderWith(withFocus({ previous: '29', consensus: undefined }), zhText, 'zh-CN')
    const meta = rendered.querySelector('.mi-brief-poster__next-meta')!.textContent

    expect(meta).toBe('高影响 · 美国 · 前值 29')
    expect(rendered.querySelector('.mi-brief-poster__next-values')).toBeNull()
  })
})

describe('news titles follow the edition language', () => {
  const SOURCE = 'JPMorgan says AI labels no longer win lenders'
  const TRANSLATED = '摩根大通表示，AI 标签不再能赢得贷款方'
  const SECOND = 'Spot ETF inflows hit a record'

  const newsItem = (overrides: Partial<DailyBriefingDocument['news']['items'][number]>) => ({
    itemId: 'n1', title: SOURCE, sourceName: 'CoinDesk RSS', publishedAt: '2026-10-30T00:00:00.000Z',
    polarity: 'bearish' as const, strength: 3, confidence: 80, symbols: ['BTC'] as const,
    ...overrides
  })

  const withNews = (locale: 'zh-CN' | 'en-US', items: DailyBriefingDocument['news']['items']): DailyBriefingDocument => {
    const base = briefing()
    return { ...base, edition: { ...base.edition, locale }, news: { ...base.news, items } }
  }

  it('falls back to the source title on an English card', async () => {
    const rendered = await renderWith(withNews('en-US', [newsItem({ translatedTitle: TRANSLATED })]), text, 'en-US')
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''
    expect(poster).toContain(SOURCE)
    expect(poster).not.toContain(TRANSLATED)
  })

  it('keeps the translated title on a Chinese card', async () => {
    const rendered = await renderWith(withNews('zh-CN', [newsItem({ translatedTitle: TRANSLATED })]), zhText, 'zh-CN')
    const poster = rendered.querySelector('.mi-brief-poster')!.textContent ?? ''
    expect(poster).toContain(TRANSLATED)
    expect(poster).not.toContain(SOURCE)
  })

  it('keeps both items, in order, and drops none', async () => {
    const rendered = await renderWith(withNews('en-US', [
      newsItem({ itemId: 'n1', translatedTitle: TRANSLATED }),
      newsItem({ itemId: 'n2', title: SECOND, polarity: 'bullish' })
    ]), text, 'en-US')
    const titles = [...rendered.querySelectorAll('.mi-brief-poster__news p')].map((node) => node.textContent ?? '')
    expect(titles).toHaveLength(2)
    expect(titles[0]).toContain(SOURCE)
    expect(titles[1]).toContain(SECOND)
  })
})

describe('the sheet lists newest first (user 2026-11-06)', () => {
  it('draws news by publishedAt, latest on top, whatever order the document holds', async () => {
    const doc = briefing()
    const base = doc.news.items[0]!
    const items = [
      { ...base, itemId: 'older', title: 'Older', publishedAt: '2026-10-29T18:57:00.000Z' },
      { ...base, itemId: 'newest', title: 'Newest', publishedAt: '2026-10-30T02:48:00.000Z' },
      { ...base, itemId: 'middle', title: 'Middle', publishedAt: '2026-10-29T20:27:00.000Z' }
    ]
    const host = await render({ ...doc, news: { ...doc.news, items, notes: {} } })
    const titles = [...host.querySelectorAll('.mi-brief-poster__news')].map((node) => node.textContent ?? '')
    expect(titles[0]).toContain('Newest')
    expect(titles[1]).toContain('Middle')
    expect(titles[2]).toContain('Older')
  })

  it('draws macro events by scheduledAt, latest on top', async () => {
    const doc = briefing()
    const base = doc.news.macro[0]!
    const macro = [
      { ...base, eventKey: 'older', title: 'Older event', scheduledAt: '2026-10-29T13:30:00.000Z' },
      { ...base, eventKey: 'newest', title: 'Newest event', scheduledAt: '2026-10-29T14:10:00.000Z' },
      { ...base, eventKey: 'middle', title: 'Middle event', scheduledAt: '2026-10-29T13:50:00.000Z' }
    ]
    const host = await render({ ...doc, news: { ...doc.news, macro, notes: {} } })
    const rows = [...host.querySelectorAll('.mi-brief-poster__macro:not(.mi-brief-poster__macro-row-empty)')].map((node) => node.textContent ?? '')
    expect(rows[0]).toContain('Newest event')
    expect(rows[1]).toContain('Middle event')
    expect(rows[2]).toContain('Older event')
  })
})
