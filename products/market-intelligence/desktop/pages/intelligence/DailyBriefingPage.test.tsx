// @vitest-environment happy-dom
import { act } from 'react'
import { ConfigProvider } from 'antd'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { DailyBriefingPage } from './DailyBriefingPage'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const englishText = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing

const briefingDocument = (date = '2026-10-30', lede = 'CPI 超预期 · Ripple 获批'): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date, locale: 'zh-CN', generatedAt: `${date}T00:30:00.000Z`,
    windowStart: `${date}T00:30:00.000Z`, windowEnd: `${date}T00:30:00.000Z`, timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: lede, generatedAt: `${date}T00:30:00.000Z` },
  news: {
    items: [{
      itemId: 'n1', title: 'JPMorgan says AI labels no longer win lenders', sourceName: 'CoinDesk RSS',
      publishedAt: `${date}T00:00:00.000Z`, polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC']
    }],
    macro: [{
      eventKey: 'US.CPI', title: 'cpi', titleKey: 'cpi', scheduledAt: `${date}T00:00:00.000Z`,
      importance: 'high', actual: '3.4%', previous: '3.1%', consensus: '3.2%',
      surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
    }],
    notes: {}
  },
  data: {
    market: [
      { id: 'btc', labelKey: 'dailyBriefing.row.btc', importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' }, state: 'available', value: { number: -1.1, format: 'percent' }, change: null, window: '24h', observedAt: `${date}T00:25:00.000Z` },
      { id: 'index', labelKey: 'dailyBriefing.row.index', importance: { tier: 'support', source: 'rule', reasonCode: 'context' }, state: 'available', value: { number: 0.82, format: 'percent' }, change: null, window: '24h', observedAt: `${date}T00:25:00.000Z` }
    ],
    funds: [
      { id: 'stablecoin', group: 'funds', labelKey: 'dailyBriefing.row.stablecoin', importance: { tier: 'must', source: 'rule', reasonCode: 'reading' }, state: 'available', value: { number: 253_033_903_673.4, format: 'usd' }, change: { value: -0.33, unit: 'percent', window: '1d' }, window: '1d', observedAt: `${date}T00:12:00.000Z` }
    ],
    sentiment: {
      fearGreed: { id: 'fear-greed', group: 'sentiment', labelKey: 'dailyBriefing.row.fearGreed', importance: { tier: 'must', source: 'rule', reasonCode: 'reading' }, state: 'available', value: { number: 48, format: 'score' }, change: null, changeReason: 'no-baseline', window: 'latest', observedAt: `${date}T00:00:00.000Z` },
      news: { state: 'available', counts: { bearish: 1, bullish: 0, mixed: 0, neutral: 2 }, itemCount: 3 }
    }
  },
  conclusion: {
    summaryId: 's1', publishedAt: `${date}T00:00:00.000Z`, direction: 'bearish',
    directions: [
      { horizon: 'short', direction: 'bearish', confidence: 'low' },
      { horizon: 'medium', direction: 'bearish', confidence: 'medium' }
    ],
    summary: 'Stablecoin contraction pulls bids away.',
    translation: '稳定币收缩把买盘推走。',
    conditions: ['Stablecoins keep contracting'],
    invalidations: [{ asset: 'BTC', horizonEnd: `${date}T00:00:00.000Z`, text: 'Stablecoins turn positive.' }],
    counterEvidence: [{ statement: 'BTC ETF took in $110M.', citations: [1] }],
    topSignal: { horizon: 'medium', direction: 'bearish', confidence: 'medium', rationale: 'ETF flows confirm.', citations: [1] },
    dataGaps: ['No consensus'], caveats: ['Funding is venue-specific.']
  },
  next: { items: [{ eventKey: 'US.FOMC', title: 'fomc', titleKey: 'fomc', at: `${date}T18:00:00.000Z`, importance: 'high', category: 'central-bank-activity' }] },
  citations: [{ index: 1, refId: 'ev-1', sourceLabel: 'DefiLlama Stablecoins', observedAt: '2026-10-30T00:00:00.000Z', statement: '稳定币 30 日净收缩 65.66 亿美元' }],
  provenance: { summaryId: 's1', readAt: `${date}T00:30:00.000Z` }
})

const emptyDocument = (): DailyBriefingDocument => ({
  ...briefingDocument(),
  status: {
    readings: [
      { id: 'fear-greed', state: 'unavailable' }, { id: 'funding', state: 'unavailable' },
      { id: 'capital', state: 'unavailable' }, { id: 'calendar', state: 'source-disabled' }
    ],
    readingsAvailable: 0, readingsTotal: 4
  },
  lede: { source: 'template', text: '', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: { items: [], macro: [], notes: { newsEmpty: 'news-source-disabled', macroEmpty: 'calendar-source-disabled' } },
  data: { market: [], funds: [], sentiment: { fearGreed: null, news: { state: 'source-disabled' } } },
  conclusion: null,
  next: { items: [], note: 'calendar-source-disabled' }
})

const failedDocument = (code: string, detail?: string): DailyBriefingDocument => ({
  ...briefingDocument(),
  provenance: {
    ...briefingDocument().provenance,
    editorialFailure: code,
    ...(detail ? { editorialFailureDetail: detail } : {})
  }
})

/**
 * One edition that carries every kind of limitation the right rail must name: a source that is
 * disabled, a source that failed, a change without a baseline, an ETF row without an as-of point,
 * a missing consensus, a backfill, a model fallback, a late generation and a duplicated caveat.
 */
const diagnosticsDocument = (date = '2026-10-30'): DailyBriefingDocument => ({
  ...briefingDocument(date),
  edition: { ...briefingDocument(date).edition, generatedAt: `${date}T04:30:00.000Z` },
  news: {
    items: [],
    macro: [{
      eventKey: 'US.CPI', title: 'cpi', titleKey: 'cpi', scheduledAt: `${date}T00:00:00.000Z`,
      importance: 'high', actual: '3.4%', previous: '3.1%',
      surprise: { direction: 'consensus-unavailable' }
    }],
    notes: {}
  },
  data: {
    market: [{
      id: 'dxy', labelKey: 'dailyBriefing.row.dxy', importance: { tier: 'support', source: 'rule', reasonCode: 'context' },
      state: 'unavailable', value: null, change: null, window: '24h', observedAt: null, reason: 'query-failed'
    }],
    funds: [
      {
        id: 'stablecoin', group: 'funds', labelKey: 'dailyBriefing.row.stablecoin',
        importance: { tier: 'support', source: 'rule', reasonCode: 'context' },
        state: 'available', value: { number: 253_033_903_673.4, format: 'usd' },
        change: null, changeReason: 'no-baseline', window: '1d', observedAt: `${date}T00:12:00.000Z`
      },
      {
        id: 'etf-btc', group: 'funds', labelKey: 'dailyBriefing.row.etfBtc',
        importance: { tier: 'must', source: 'rule', reasonCode: 'gap' },
        state: 'unavailable', value: null, change: null, reason: 'etf-unavailable',
        window: 'trading-day', observedAt: null
      }
    ],
    sentiment: {
      fearGreed: {
        id: 'fear-greed', group: 'sentiment', labelKey: 'dailyBriefing.row.fearGreed',
        importance: { tier: 'must', source: 'rule', reasonCode: 'gap' },
        state: 'source-disabled', value: null, change: null, window: 'latest', observedAt: null
      },
      news: { state: 'available', counts: { bearish: 0, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 0 }
    }
  },
  conclusion: {
    ...briefingDocument(date).conclusion!,
    dataGaps: ['证据条数已截断'],
    caveats: ['证据条数已截断', '资金费率是场所特定的']
  },
  provenance: {
    ...briefingDocument(date).provenance,
    supplements: [{
      at: `${date}T04:00:00.000Z`, tool: 'daily-brief-core-fact-ensure',
      reason: 'filled 2 core data rows: core-stablecoin-supply-usd, etf-net-flow-btc'
    }],
    editorialMeta: { promptVersion: 'v1', model: 'provider:model', source: 'default', fallback: 'custom-unavailable' }
  }
})

const traceStageIds = [
  'source', 'candidates', 'selection', 'field-backfill', 'writing', 'validation', 'repair-1', 'repair-2', 'store'
] as const

function generationTraceFixture(state: 'success' | 'failed', failed?: string, failureCode?: string) {
  const failedAt = failed ? traceStageIds.indexOf(failed as (typeof traceStageIds)[number]) : -1
  return {
    attemptId: 'attempt-1',
    startedAt: '2026-10-30T04:00:00.000Z',
    finishedAt: '2026-10-30T04:00:30.000Z',
    state,
    stages: traceStageIds.map((id, position) => ({
      id,
      state: failedAt < 0 ? 'success' : position < failedAt ? 'success' : position === failedAt ? 'failed' : 'skipped',
      startedAt: '2026-10-30T04:00:00.000Z',
      finishedAt: '2026-10-30T04:00:01.000Z',
      durationMs: 1_000,
      ...(position === failedAt && failureCode ? { failureCode } : {})
    }))
  }
}

const editions: readonly DailyBriefingEditionSummary[] = Array.from({ length: 14 }, (_, index) => {
  const date = new Date(Date.parse('2026-10-30T00:00:00.000Z') - index * 86_400_000).toISOString().slice(0, 10)
  return date === '2026-10-28'
    ? { date, locale: 'zh-CN', availableLocales: [], state: 'missing' }
    : { date, locale: 'zh-CN', availableLocales: ['zh-CN'], state: 'generated', generatedAt: `${date}T00:30:00.000Z`, windowEnd: `${date}T00:30:00.000Z`, readingsAvailable: 4 }
})

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    getToday: vi.fn(async () => ({ state: 'available' as const, document: briefingDocument() })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions } })),
    regenerate: vi.fn(async () => ({ state: 'available' as const, document: briefingDocument('2026-10-30', '重新生成版') })),
    getProgress: vi.fn(async () => ({ state: 'idle' as const })),
    get: vi.fn(async ({ date }: { date: string }) => date === '2026-10-29'
      ? { state: 'available' as const, document: briefingDocument('2026-10-29', '历史版次') }
      : { state: 'missing' as const }),
    ...overrides
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

// The fixture editions are dated 2026-10-30, and the rail marks "today" from the wall clock.
// Without a frozen clock this test passes only before midnight and fails on the next calendar day.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-30T04:00:00.000Z'))
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function renderPage(client: ReturnType<typeof fakeClient>, options: Readonly<{
  onBack?: () => void
  onConfigureSources?: () => void
  onOpenModelSettings?: () => void
  locale?: 'zh-CN' | 'en-US'
  text?: typeof text
}> = {}): Promise<HTMLDivElement> {
  const { onBack = vi.fn(), onConfigureSources = vi.fn(), onOpenModelSettings, locale = 'zh-CN', text: textOverride } = options
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<ConfigProvider button={WINDOW_ANTD_BUTTON_CONFIG}><DailyBriefingPage
      locale={locale}
      text={textOverride ?? (locale === 'zh-CN' ? text : englishText)}
      eventTitles={{ cpi: 'CPI', fomc: 'FOMC' }}
      onBack={onBack}
      onConfigureSources={onConfigureSources}
      {...(onOpenModelSettings ? { onOpenModelSettings } : {})}
      client={client}
    /></ConfigProvider>)
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return container
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T00:30:00.000Z')) })
afterEach(() => { vi.useRealTimers() })

describe('daily briefing page', () => {
  it('renders today, the 14-day rail and goes back to the dashboard', async () => {
    const onBack = vi.fn()
    const dom = await renderPage(fakeClient(), { onBack })
    expect(dom.textContent).toContain('每日简报')
    expect(dom.textContent).toContain('CPI 超预期')
    expect(dom.querySelectorAll('[data-date]')).toHaveLength(14)
    expect(dom.querySelector('[data-date="2026-10-30"]')?.getAttribute('aria-current')).toBe('true')
    expect(dom.querySelector('[data-date="2026-10-30"]')?.textContent).toContain(text.history.today)
    expect(dom.querySelector('[data-date="2026-10-28"]')?.hasAttribute('disabled')).toBe(true)

    act(() => dom.querySelector<HTMLButtonElement>('.mi-daily-briefing-page__back')!.click())
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('loads a historical edition read-only and leaves a missing day disabled', async () => {
    const client = fakeClient()
    const dom = await renderPage(client)
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-29"]')!.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(client.get).toHaveBeenCalledWith({ date: '2026-10-29', locale: 'zh-CN' })
    expect(dom.textContent).toContain('历史版次')
    expect(dom.textContent).toContain(text.history.readOnly)
    expect(dom.querySelector('[data-date="2026-10-29"]')?.getAttribute('aria-current')).toBe('true')

    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-28"]')!.click() })
    expect(client.get).toHaveBeenCalledTimes(2)
  })

  it('copies the current edition as text and reports success', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const dom = await renderPage(fakeClient())
    const copy = dom.querySelector<HTMLButtonElement>('.mi-daily-briefing__copy')!
    await act(async () => { copy.click(); await Promise.resolve(); await Promise.resolve() })
    expect(writeText).toHaveBeenCalledTimes(1)
    const markdown = writeText.mock.calls[0]?.[0] as string
    expect(markdown).toContain('# 每日简报')
    expect(markdown).toContain('CPI 超预期')
    expect(dom.textContent).toContain(text.copied)
  })

  it('reports a clipboard failure and copies the historical edition that is on screen', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied') })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const client = fakeClient()
    const dom = await renderPage(client)
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-29"]')!.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const copy = dom.querySelector<HTMLButtonElement>('.mi-daily-briefing__copy')!
    await act(async () => { copy.click(); await Promise.resolve(); await Promise.resolve() })
    expect(dom.textContent).toContain(text.copyFailed)
    expect(writeText.mock.calls[0]?.[0]).toContain('历史版次')
  })

  it('guides a clean install through the platform state with the product sentence', async () => {
    const onConfigureSources = vi.fn()
    const dom = await renderPage(fakeClient({
      getToday: vi.fn(async () => ({ state: 'available' as const, document: emptyDocument() }))
    }), { onConfigureSources })
    const state = dom.querySelector('.mi-daily-briefing-page__content .state-view[data-state="empty"]')!
    expect(state).not.toBeNull()
    // Only the reason slot is ours; the reason says the product sentence, not a hand-written block.
    expect(state.querySelector('[data-reason-source="product"]')?.textContent).toBe(text.stateReasons.nothingEnabled)
    for (const section of [text.sections.news, text.sections.data, text.sections.conclusion, text.sections.next]) {
      expect(dom.querySelector(`[aria-label="${section}"]`)).toBeNull()
    }
    const configure = state.querySelector<HTMLButtonElement>('.state-view__action')!
    act(() => configure.click())
    expect(onConfigureSources).toHaveBeenCalledTimes(1)
  })

  it('regenerates today in place', async () => {
    const client = fakeClient()
    const dom = await renderPage(client)
    const regenerate = dom.querySelector<HTMLButtonElement>('.mi-daily-briefing__regenerate')!
    await act(async () => { regenerate.click(); await Promise.resolve(); await Promise.resolve() })
    expect(client.regenerate).toHaveBeenCalledWith({ locale: 'zh-CN', timeZone: expect.any(String) })
    expect(dom.textContent).toContain('重新生成版')
  })

  it('says the brief is being generated and refuses a second click while it runs', async () => {
    // The reader could press the button again while the first run was still going; each press
    // started another run. The control has to close that door itself, not just the service.
    let release: (() => void) | undefined
    const client = fakeClient({
      regenerate: vi.fn(async () => {
        await new Promise<void>((resolve) => { release = resolve })
        return { state: 'available' as const, document: briefingDocument('2026-10-30', '重新生成版') }
      })
    })
    const dom = await renderPage(client)
    const button = dom.querySelector<HTMLButtonElement>('.mi-daily-briefing__regenerate')!
    await act(async () => { button.click(); await Promise.resolve() })
    const running = dom.querySelector<HTMLButtonElement>('.mi-daily-briefing__regenerate')!
    expect(running.textContent).toBe(text.regenerating)
    expect(running.disabled).toBe(true)
    await act(async () => { running.click(); await Promise.resolve() })
    expect(client.regenerate).toHaveBeenCalledTimes(1)
    await act(async () => { release?.(); await Promise.resolve(); await Promise.resolve() })
    expect(dom.textContent).toContain('重新生成版')
    expect(client.regenerate).toHaveBeenCalledTimes(1)
  })

  it('renders the shareable poster and its export action', async () => {
    const dom = await renderPage(fakeClient())
    expect(dom.querySelector('.mi-brief-poster')?.textContent).toContain('每日简报')
    expect(dom.querySelector('.mi-brief-poster')?.textContent).toContain('Stablecoin contraction pulls bids away.')
    expect(dom.querySelector('.mi-brief-poster')?.textContent).toContain('DefiLlama Stablecoins')
    expect(dom.querySelector('.mi-brief-poster')?.textContent).toContain('稳定币 30 日净收缩')
    expect(dom.querySelector('.mi-daily-briefing__export')).not.toBeNull()
  })

  it('renders an unreadable read as an error, not as "nothing was made", and retries', async () => {
    const getToday = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ state: 'available' as const, document: briefingDocument() })
    const client = fakeClient({ getToday })
    const dom = await renderPage(client)
    // A read that did not finish is `error`; calling it `empty` is the lie this migration removes.
    const state = dom.querySelector('.state-view[data-state="error"]')!
    expect(state).not.toBeNull()
    expect(dom.querySelector('.state-view[data-state="empty"]')).toBeNull()
    const reason = state.querySelector('[data-reason-source="product"]')?.textContent ?? ''
    expect(reason).toContain(text.stateReasons.unreadableSince.split('{moment}')[0]!)
    expect(reason).not.toContain('{moment}')
    const retry = state.querySelector<HTMLButtonElement>('.state-view__action')!
    await act(async () => { retry.click(); await Promise.resolve(); await Promise.resolve() })
    expect(getToday).toHaveBeenCalledTimes(2)
    expect(dom.textContent).toContain('每日简报')
  })

  it('tells a first run apart from an unreadable read', async () => {
    const getToday = vi.fn(async () => ({ state: 'unavailable' as const }))
    const client = fakeClient({
      getToday,
      list: vi.fn(async () => ({ state: 'available' as const, result: { editions: [] } }))
    })
    const dom = await renderPage(client)
    const state = dom.querySelector('.mi-daily-briefing-page__content .state-view[data-state="empty"]')!
    expect(state.querySelector('[data-reason-source="product"]')?.textContent).toBe(text.stateReasons.noBrief)
    expect(state.querySelector('.state-view__action')?.textContent).toBe('创建')
    await act(async () => {
      state.querySelector<HTMLButtonElement>('.state-view__action')!.click()
      await Promise.resolve(); await Promise.resolve()
    })
    expect(getToday).toHaveBeenCalledTimes(2)
  })

  it('falls back to the platform sentence when the product sentence is blank', async () => {
    const blank = { ...text, stateReasons: { ...text.stateReasons, noBrief: '' } }
    const dom = await renderPage(fakeClient({
      getToday: vi.fn(async () => ({ state: 'unavailable' as const })),
      list: vi.fn(async () => ({ state: 'available' as const, result: { editions: [] } }))
    }), { text: blank })
    const reason = dom.querySelector('.mi-daily-briefing-page__content .state-view[data-state="empty"] [data-reason-source]')!
    expect(reason.getAttribute('data-reason-source')).toBe('platform')
  })

  it('renders an empty history rail through the platform state', async () => {
    const dom = await renderPage(fakeClient({
      getToday: vi.fn(async () => ({ state: 'unavailable' as const })),
      list: vi.fn(async () => ({ state: 'available' as const, result: { editions: [] } }))
    }))
    const rail = dom.querySelector('.mi-daily-briefing__rail')!
    const state = rail.querySelector('.state-view[data-state="empty"]')!
    expect(state.querySelector('[data-reason-source="product"]')?.textContent).toBe(text.stateReasons.noEditions)
    expect(state.querySelector('.state-view__action')).toBeNull()
  })

  it('explains an editorial timeout and offers retry, AI settings and model service actions', async () => {
    const onOpenModelSettings = vi.fn()
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: failedDocument('editorial-timeout') })) })
    const dom = await renderPage(client, { onOpenModelSettings })
    const panel = dom.querySelector<HTMLElement>('[data-daily-brief-failure]')!

    expect(panel).not.toBeNull()
    expect(panel.textContent).toContain(text.failurePanel.editorialTitle)
    expect(panel.querySelector('[data-failure-code-label]')?.textContent)
      .toBe(`${text.failurePanel.codeLabel}${text.labelSeparator}${text.aiSettings.failure['editorial-timeout']}`)
    expect(panel.textContent).not.toContain('editorial-timeout')
    expect(panel.textContent).toContain(text.failurePanel.advice.retryOrModel)
    expect(panel.querySelector('[data-failure-action="retry"]')).not.toBeNull()
    expect(panel.querySelector('[data-failure-action="ai-settings"]')).not.toBeNull()
    expect(dom.querySelector('.mi-daily-briefing-page__paper')).toBeNull()

    act(() => panel.querySelector<HTMLButtonElement>('[data-failure-action="model-service"]')!.click())
    expect(onOpenModelSettings).toHaveBeenCalledTimes(1)

    await act(async () => {
      panel.querySelector<HTMLButtonElement>('[data-failure-action="retry"]')!.click()
      await Promise.resolve(); await Promise.resolve()
    })
    expect(client.regenerate).toHaveBeenCalledWith({ locale: 'zh-CN', timeZone: expect.any(String) })
    expect(dom.querySelector('[data-daily-brief-failure]')).toBeNull()
    expect(dom.textContent).toContain('重新生成版')
  })

  it('sends model and provider failures to model settings with a readable detail', async () => {
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: failedDocument('model-unavailable', 'custom-unavailable') })) })
    const dom = await renderPage(client)
    const panel = dom.querySelector<HTMLElement>('[data-daily-brief-failure]')!
    const detail = panel.querySelector('[data-failure-detail]')

    expect(panel.textContent).toContain(text.aiSettings.failure['model-unavailable'])
    expect(panel.textContent).toContain(text.failurePanel.detail['custom-unavailable'])
    expect(panel.textContent).toContain(text.failurePanel.advice.model)
    expect(panel.textContent).not.toContain('model-unavailable')
    expect(panel.textContent).not.toContain('custom-unavailable')
    expect(detail?.textContent).toContain(text.failurePanel.detailLabel)
    expect(panel.querySelector('[data-failure-action="model-service"]')).not.toBeNull()
  })

  it('shows a truncated-output reason, redacts credentials and truncates long detail', async () => {
    const secret = 'sk-live-SECRET0123456789'
    const longDetail = `stop_reason=max_tokens ${'x'.repeat(80)} ${secret} ${'y'.repeat(240)}\n    at handler (/app/private/secret.js:1:1)`
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: failedDocument('agent-turn-output-truncated', longDetail) })) })
    const dom = await renderPage(client)
    const panel = dom.querySelector<HTMLElement>('[data-daily-brief-failure]')!
    const detail = panel.querySelector<HTMLElement>('[data-failure-detail]')!

    expect(panel.textContent).toContain(text.aiSettings.failure['agent-turn-output-truncated'])
    expect(panel.textContent).toContain(text.failurePanel.advice.retryOrModel)
    expect(detail.textContent).toContain('stop_reason=max_tokens')
    expect(detail.textContent).toContain('…')
    expect(detail.textContent!.length).toBeLessThan(220)
    expect(detail.textContent).not.toContain(secret)
    expect(detail.textContent).not.toContain('/app/private/secret.js')
  })

  it('keeps a specific unknown-number detail and asks for a retry or AI-settings check', async () => {
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: failedDocument('unknown-number', '42000') })) })
    const dom = await renderPage(client)
    const panel = dom.querySelector<HTMLElement>('[data-daily-brief-failure]')!

    expect(panel.textContent).toContain(text.aiSettings.failure['unknown-number'])
    expect(panel.querySelector('[data-failure-detail]')?.textContent).toContain('42000')
    expect(panel.textContent).toContain(text.failurePanel.advice.retryOrSettings)
    expect(panel.querySelector('[data-failure-action="ai-settings"]')).not.toBeNull()
  })

  it('treats a source failure as a data problem and sends the reader to the sources', async () => {
    const onConfigureSources = vi.fn()
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'source-failed' as const })) })
    const dom = await renderPage(client, { onConfigureSources })
    const panel = dom.querySelector<HTMLElement>('[data-daily-brief-failure]')!

    expect(panel.textContent).toContain(text.failurePanel.generationTitle)
    expect(panel.textContent).toContain(text.aiSettings.failure['source-failed'])
    expect(panel.textContent).toContain(text.failurePanel.advice.data)
    expect(panel.querySelector('[data-failure-action="model-service"]')).toBeNull()

    act(() => panel.querySelector<HTMLButtonElement>('[data-failure-action="sources"]')!.click())
    expect(onConfigureSources).toHaveBeenCalledTimes(1)
  })

  it('renders the failure panel in English', async () => {
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: failedDocument('model-unavailable', 'default-unavailable') })) })
    const dom = await renderPage(client, { locale: 'en-US' })
    const panel = dom.querySelector<HTMLElement>('[data-daily-brief-failure]')!

    expect(panel.textContent).toContain(englishText.failurePanel.editorialTitle)
    expect(panel.textContent).toContain(englishText.aiSettings.failure['model-unavailable'])
    expect(panel.textContent).toContain(englishText.failurePanel.detail['default-unavailable'])
    expect(panel.textContent).toContain(englishText.failurePanel.advice.model)
  })

  it('groups limitations into severity-ordered summaries and opens one group in a drawer', async () => {
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: diagnosticsDocument() })) })
    const dom = await renderPage(client)
    const aside = dom.querySelector<HTMLElement>('[data-briefing-issues]')!

    expect(aside).not.toBeNull()
    // The timeline is the first block; this edition has no trace, so it says so without guessing.
    expect(aside.firstElementChild?.classList.contains('mi-generation-trace')).toBe(true)
    expect(aside.querySelector('[data-generation-trace-missing]')?.textContent).toBe(text.generationTrace.missing)
    expect(aside.textContent).toContain(text.sections.limits)
    expect(aside.textContent).toContain(text.limits.counts.warning.replace('{count}', '7'))
    expect(aside.textContent).toContain(text.limits.counts.info.replace('{count}', '5'))

    // The rail is a list of group summaries; no individual fact is listed before a group is opened.
    const groupButtons = [...aside.querySelectorAll<HTMLButtonElement>('.mi-daily-briefing-page__group')]
    expect(groupButtons.length).toBeGreaterThan(0)
    expect(aside.querySelectorAll('[data-issue-detail]')).toHaveLength(0)
    expect(document.querySelector('[data-issue-drawer]')).toBeNull()
    const groupLabel = (button: HTMLButtonElement): string | null | undefined =>
      button.querySelector('.mi-daily-briefing-page__group-label')?.textContent
    const groupCount = (button: HTMLButtonElement): string | null | undefined =>
      button.querySelector('.mi-daily-briefing-page__group-count')?.textContent
    const groupSeverities = groupButtons.map((button) => button.getAttribute('data-group-severity'))
    expect(groupSeverities.lastIndexOf('warning')).toBeLessThan(groupSeverities.indexOf('info'))

    const consensusGroup = groupButtons.find((button) => groupLabel(button) === '预期值未收录')!
    expect(groupCount(consensusGroup)).toBe('2 项')
    expect(groupCount(groupButtons.find((button) => groupLabel(button) === '变化基线缺失')!)).toBe('1 项')
    expect(groupCount(groupButtons.find((button) => groupLabel(button) === '核心数据回补')!)).toBe('1 项')
    expect(groupCount(groupButtons.find((button) => groupLabel(button) === '数据缺口')!)).toBe('1 项')
    expect(groupButtons.some((button) => groupLabel(button) === '数据陈旧')).toBe(false)

    // Source, time and advice belong to the detail layer, not to the summary rows.
    expect(aside.textContent).not.toContain(`${text.limits.roles.source}${text.labelSeparator}`)

    act(() => consensusGroup.click())
    // The drawer's body is portalled, so it is looked up on the document, not inside the page div.
    const drawer = document.querySelector<HTMLElement>('[data-issue-drawer]')!
    expect(drawer).not.toBeNull()
    // The title lives in the shared drawer's header, filled from the product key by parameters.
    const drawerRoot = document.querySelector<HTMLElement>('.mi-issue-drawer')!
    expect(drawerRoot.textContent).toContain('「预期值未收录」明细（2 项）')
    const details = [...drawer.querySelectorAll('[data-issue-detail]')]
    expect(details).toHaveLength(2)
    expect(new Set(details.map((detail) => detail.querySelector('.mi-issue-drawer__title')?.textContent)).size).toBe(2)
    for (const detail of details) {
      expect(detail.textContent).toContain(text.limits.roles.source)
      expect(detail.textContent).toContain(text.limits.roles.time)
      expect(detail.textContent).toContain(text.limits.roles.advice)
    }

    // Escape and returning focus to the opening row are the shared drawer's own behaviour, covered by
    // its suite; this page no longer hand-rolls either.
    // Closing from the header empties the drawer again, and focus returns to the row that opened it.
    const closeButton = [...document.querySelectorAll<HTMLButtonElement>('.ant-drawer-header button')].at(-1)!
    await act(async () => { closeButton.click() })
    await act(async () => {})
    expect(document.querySelector('[data-issue-drawer]')).toBeNull()
    // Focus restoration is the shared drawer's job as well; asserting it here would test the platform
    // through a page, so it stays in the component's own suite.

    // Internal reason strings, machine codes and model ids never reach the rail or the drawer.
    expect(aside.textContent).not.toContain('filled 2 core data rows')
    expect(aside.textContent).not.toContain('custom-unavailable')
    expect(aside.textContent).not.toContain('no-baseline')
    expect(aside.textContent).not.toContain('provider:model')

    const toggle = aside.querySelector<HTMLButtonElement>('.mi-daily-briefing-page__appendix-toggle')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    act(() => toggle.click())
    expect(aside.querySelectorAll('.mi-daily-briefing-page__group')).toHaveLength(0)
    expect(aside.textContent).toContain(text.limits.expand)
    expect(aside.textContent).toContain(text.limits.counts.warning.replace('{count}', '7'))
    act(() => aside.querySelector<HTMLButtonElement>('.mi-daily-briefing-page__appendix-toggle')!.click())
    expect(aside.querySelectorAll('.mi-daily-briefing-page__group').length).toBeGreaterThan(0)
    expect(aside.textContent).toContain(text.limits.collapse)
  })

  it('renders the diagnostics panel in English', async () => {
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: diagnosticsDocument() })) })
    const dom = await renderPage(client, { locale: 'en-US' })
    const aside = dom.querySelector<HTMLElement>('[data-briefing-issues]')!

    expect(aside.textContent).toContain(englishText.sections.limits)
    expect(aside.textContent).toContain(englishText.limits.categories.data)
    expect(aside.textContent).toContain(englishText.limits.severity.warning)
    expect(aside.textContent).toContain(englishText.limits.groupLabels['macro-consensus'])
    expect(aside.textContent).toContain(englishText.limits.groupLabels['no-baseline'])
    expect(aside.textContent).not.toContain('变化基线缺失')

    const consensusGroup = [...aside.querySelectorAll<HTMLButtonElement>('.mi-daily-briefing-page__group')]
      .find((button) => button.querySelector('.mi-daily-briefing-page__group-label')?.textContent === englishText.limits.groupLabels['macro-consensus'])!
    act(() => consensusGroup.click())
    // The drawer's body is portalled, so it is looked up on the document, not inside the page div.
    const drawer = document.querySelector<HTMLElement>('[data-issue-drawer]')!
    expect(drawer.textContent).toContain('CPI: consensus not collected')
    // The close control belongs to the shared drawer, so its label is the platform's, not this page's.
    expect(document.querySelector('.mi-issue-drawer .ant-drawer-header')).not.toBeNull()
    expect(drawer.textContent).toContain(englishText.limits.roles.advice)
  })

  it('keeps the successful generation stages in the right rail for tracing', async () => {
    const base = briefingDocument()
    const withTrace = {
      ...base,
      provenance: { ...base.provenance, generationTrace: generationTraceFixture('success') }
    } as DailyBriefingDocument
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: withTrace })) })
    const dom = await renderPage(client)
    const trace = dom.querySelector<HTMLElement>('[data-generation-trace-state="success"]')!

    expect(trace).not.toBeNull()
    expect(trace.textContent).toContain(text.generationTrace.title)
    expect(trace.textContent).toContain(text.generationTrace.completed)
    // The successful stages are a vertical stepper that starts fully visible; there is no fold.
    expect(trace.querySelectorAll('.ant-steps-item')).toHaveLength(9)
    expect(trace.querySelectorAll('[data-stage]')).toHaveLength(9)
    expect(trace.textContent).toContain('耗时 30 秒')
    expect(trace.querySelector('.mi-generation-trace__toggle')).toBeNull()
    expect(dom.querySelector<HTMLElement>('[data-briefing-issues]')?.firstElementChild?.classList.contains('mi-generation-trace')).toBe(true)
  })

  it('shows where a failed generation stopped and renders the same trace on a fresh read', async () => {
    const result = {
      state: 'unavailable' as const,
      failureCode: 'store-failed',
      generationTrace: generationTraceFixture('failed', 'store', 'store-failed')
    }
    const client = fakeClient({ getToday: vi.fn(async () => result) })
    const dom = await renderPage(client)
    const panel = dom.querySelector<HTMLElement>('[data-daily-brief-failure]')!

    expect(panel.textContent).toContain('失败于：落库/发布')
    expect(panel.querySelector('[data-stage="store"]')?.getAttribute('data-stage-state')).toBe('failed')
    expect(panel.querySelector('[data-stage="writing"]')?.getAttribute('data-stage-state')).toBe('success')
    expect(panel.querySelector('[data-failed-stage="store"]')).not.toBeNull()

    // The next read of the same failed edition still carries the trace: the service persists the
    // attempt, so a refresh does not reduce the diagnosis to one failure code.
    act(() => root!.unmount())
    container!.remove()
    root = null
    container = null
    const again = await renderPage(client)
    expect(again.querySelector('[data-daily-brief-failure]')?.textContent).toContain('失败于：落库/发布')
    expect(again.querySelector('[data-stage="store"]')?.getAttribute('data-stage-state')).toBe('failed')
  })
})

it('says the progress could not be read without falling back to "not generated"', async () => {
  // getToday never settles, so the page stays in its generating state while getProgress fails.
  const client = fakeClient({
    getToday: vi.fn(() => new Promise(() => undefined)),
    // Today's row is a gap, which is the state the rail must not label "not generated" mid-run.
    list: vi.fn(async () => ({
      state: 'available' as const,
      result: { editions: editions.map((edition) => (edition.date === '2026-10-30' ? { ...edition, state: 'missing' as const } : edition)) }
    })),
    getProgress: vi.fn(async () => ({ state: 'unavailable' as const }))
  })
  const dom = await renderPage(client as ReturnType<typeof fakeClient>)

  await act(async () => { await Promise.resolve() })

  const notice = dom.querySelector('[data-progress-unreadable]')
  expect(notice?.textContent).toContain('生成还在进行')
  // The rail must not claim the edition was never made while the pipeline is still running.
  const today = dom.querySelector('.mi-daily-briefing__rail-row[data-date="2026-10-30"]')
  expect(today?.textContent).toContain('生成中')
  expect(today?.textContent).toContain('进度未知')
  expect(today?.textContent).not.toContain('当天未运行')
})

it('shows only a loading state before the first read resolves', async () => {
  // Both reads hang: nothing has been read yet, so nothing may be reported as missing or failed.
  const client = fakeClient({
    getToday: vi.fn(() => new Promise(() => undefined)),
    list: vi.fn(() => new Promise(() => undefined))
  })
  const dom = await renderPage(client as ReturnType<typeof fakeClient>)
  await act(async () => { await Promise.resolve() })

  expect(dom.textContent).toContain(text.generating)
  expect(dom.textContent).toContain(text.history.loading)
  // No empty state and no error state anywhere before the first read comes back.
  expect(dom.textContent).not.toContain(text.noBriefTitle)
  expect(dom.textContent).not.toContain(text.unavailable)
  expect(dom.textContent).not.toContain(text.history.empty)
  expect(dom.querySelector('[data-state="error"]')).toBeNull()
})

it('offers a retry when the read itself fails', async () => {
  // A read that did not finish is a failure, and a failure without a retry leaves the reader nowhere.
  const client = fakeClient({ getToday: vi.fn(async () => { throw new Error('down') }) })
  const dom = await renderPage(client as ReturnType<typeof fakeClient>)

  const errorState = dom.querySelector('.state-view[data-state="error"]')
  expect(errorState).not.toBeNull()
  expect(errorState!.querySelector('.state-view__action')?.textContent).toBe('重试')
})

it('says the history could not be read instead of claiming there is none', async () => {
  const client = fakeClient({
    getToday: vi.fn(async () => { throw new Error('down') }),
    list: vi.fn(async () => { throw new Error('down') })
  })
  const dom = await renderPage(client as ReturnType<typeof fakeClient>)
  await act(async () => {})
  await act(async () => {})

  const rail = dom.querySelector('.mi-daily-briefing__rail')
  expect(rail?.textContent).not.toContain(text.history.empty)
  const errorState = rail?.querySelector('.state-view[data-state="error"]')
  expect(errorState).not.toBeNull()
  expect(errorState!.querySelector('.state-view__action')?.textContent).toBe('重试')
})
