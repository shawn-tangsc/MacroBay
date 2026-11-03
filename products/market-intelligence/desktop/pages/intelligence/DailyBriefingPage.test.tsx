// @vitest-environment happy-dom
import { act } from 'react'
import { ConfigProvider } from 'antd'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import type { DailyBriefingSettingsView } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingPage } from './DailyBriefingPage'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing
const englishText = productText['en-US'].pages.intelligence.portal.dashboard.dailyBriefing

/** Both settings blocks read the same view; the drawer is what shows them side by side. */
const settingsView: DailyBriefingSettingsView = {
  settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: true },
  generation: { periods: [{ id: 'default', generationTime: '08:00', generationTimeZone: 'Asia/Shanghai', generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' }] },
  language: { settings: { primary: 'follow-ui', additional: [] }, plan: { locales: ['zh-CN'], primary: { requested: 'zh-CN', used: 'zh-CN' }, writeCount: 1 } },
  webSearchSupported: false,
  resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' }
}

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
    ? { date, periodId: 'default', locale: 'zh-CN', availableLocales: [], state: 'missing' }
    : { date, periodId: 'default', locale: 'zh-CN', availableLocales: ['zh-CN'], state: 'generated', generatedAt: `${date}T00:30:00.000Z`, windowEnd: `${date}T00:30:00.000Z`, readingsAvailable: 4 }
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
    root!.render(<ConfigProvider button={WINDOW_ANTD_BUTTON_CONFIG}><ConfirmProvider><DailyBriefingPage
      locale={locale}
      text={textOverride ?? (locale === 'zh-CN' ? text : englishText)}
      eventTitles={{ cpi: 'CPI', fomc: 'FOMC' }}
      onBack={onBack}
      onConfigureSources={onConfigureSources}
      {...(onOpenModelSettings ? { onOpenModelSettings } : {})}
      client={client}
    /></ConfirmProvider></ConfigProvider>)
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
    expect(dom.textContent).toContain(text.title)
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
    expect(dom.textContent).toContain(text.history.readOnly)
    expect(dom.querySelector('[data-date="2026-10-29"]')?.getAttribute('aria-current')).toBe('true')

    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-28"]')!.click() })
    expect(client.get).toHaveBeenCalledTimes(2)
  })

  it('moves the pressed language with the edition it loads in place', async () => {
    // The row summary carries the issue's primary language (Chinese). Reading the English version
    // of the same issue must move the pressed button, or the reader sees English text under a
    // Chinese button.
    const chinese = briefingDocument('2026-10-30')
    const english = { ...chinese, edition: { ...chinese.edition, locale: 'en-US' as const } }
    const client = fakeClient({
      list: vi.fn(async () => ({
        state: 'available' as const,
        result: { editions: [{ ...editions[0], availableLocales: ['zh-CN', 'en-US'] as const }] }
      })),
      get: vi.fn(async ({ locale }: { locale: string }) =>
        ({ state: 'available' as const, document: locale === 'en-US' ? english : chinese }))
    })
    const dom = await renderPage(client)
    const englishButton = dom.querySelector<HTMLButtonElement>('[data-locale="en-US"]')!
    expect(englishButton.getAttribute('aria-pressed')).toBe('false')

    await act(async () => { englishButton.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(client.get).toHaveBeenCalledWith({ date: '2026-10-30', locale: 'en-US' })
    expect(dom.querySelector('[data-locale="en-US"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(dom.querySelector('[data-locale="zh-CN"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(dom.querySelector('[data-date="2026-10-30"]')?.getAttribute('aria-current')).toBe('true')
  })

  it('copies the current edition as text and reports success', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const dom = await renderPage(fakeClient())
    const copy = dom.querySelector<HTMLButtonElement>('.mi-daily-briefing__copy')!
    await act(async () => { copy.click(); await Promise.resolve(); await Promise.resolve() })
    expect(writeText).toHaveBeenCalledTimes(1)
    const markdown = writeText.mock.calls[0]?.[0] as string
    expect(markdown).toContain(`# ${text.title}`)
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
    // 这一句是夹具文档自己的正文（`briefingDocument(..., '历史版次')`），不是文案表里的句子。
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

  it('says when the window was computed in the system zone because the setting was unreadable', async () => {
    // The reader configured a time; a silent fallback would hand them another day boundary with no
    // explanation. The note is the only thing on screen that can say which zone produced this window.
    const client = fakeClient({
      getToday: vi.fn(async () => ({ state: 'available' as const, document: briefingDocument(), timeZoneSource: 'system' as const }))
    })
    const dom = await renderPage(client)
    const note = dom.querySelector('.mi-daily-briefing__clock-note')
    expect(note?.textContent).toBe(text.timeZoneFromSystem)
    expect(note?.getAttribute('role')).toBe('status')
  })

  it('stays quiet when the settings zone was used', async () => {
    const dom = await renderPage(fakeClient())
    expect(dom.querySelector('.mi-daily-briefing__clock-note')).toBeNull()
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
    expect(dom.textContent).toContain(text.title)
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

  it('keeps the toolbar regenerate on the normal path', async () => {
    const dom = await renderPage(fakeClient())
    expect(dom.querySelector('[data-toolbar-action="regenerate"]')).not.toBeNull()
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

  it('explains an editorial timeout and offers retry plus the one settings entry', async () => {
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: failedDocument('editorial-timeout') })) })
    const dom = await renderPage(client)
    const panel = dom.querySelector<HTMLElement>('[data-daily-brief-failure]')!

    expect(panel).not.toBeNull()
    expect(panel.textContent).toContain(text.failurePanel.editorialTitle)
    expect(panel.querySelector('[data-failure-code-label]')?.textContent)
      .toBe(`${text.failurePanel.codeLabel}${text.labelSeparator}${text.aiSettings.failure['editorial-timeout']}`)
    expect(panel.textContent).not.toContain('editorial-timeout')
    expect(panel.textContent).toContain(text.failurePanel.advice.retryOrModel)
    expect(panel.querySelector('[data-failure-action="retry"]')).not.toBeNull()
    // Two actions only: retry, and the same settings drawer the header opens. A third button per
    // advice code is what the reader saw as duplicated settings entries.
    expect(panel.querySelector('[data-failure-action="settings"]')).not.toBeNull()
    expect(panel.querySelectorAll('[data-failure-action]')).toHaveLength(2)
    expect(dom.querySelector('.mi-daily-briefing-page__paper')).toBeNull()
    // One retry, in the panel under the reason: the toolbar's copy is hidden while the failure is
    // shown, so the reader never has to choose between two buttons that do the same thing.
    expect(dom.querySelector('[data-toolbar-action="regenerate"]')).toBeNull()
    expect(dom.querySelectorAll('[data-failure-action="retry"]')).toHaveLength(1)

    await act(async () => {
      panel.querySelector<HTMLButtonElement>('[data-failure-action="retry"]')!.click()
      await Promise.resolve(); await Promise.resolve()
    })
    expect(client.regenerate).toHaveBeenCalledWith({ locale: 'zh-CN', timeZone: expect.any(String) })
    expect(dom.querySelector('[data-daily-brief-failure]')).toBeNull()
    expect(dom.textContent).toContain('重新生成版')
  })

  // The drawer's three close routes and the two answers to its question. Kept as helpers because
  // the evidence matrix is "entry x state": every route is checked in two states, and a copy-pasted
  // click per case is how one route silently stops being covered.
  const openSettingsDrawer = async (dom: HTMLDivElement): Promise<void> => {
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-briefing-settings-open]')!.click(); await Promise.resolve() })
  }
  const aiSwitch = (): HTMLElement => document.querySelector<HTMLElement>('[role="switch"]')!
  /** The switch's own value, which is what "the edits are still there" means. */
  const editorialSwitchValue = (): string | null => aiSwitch()?.getAttribute('aria-checked') ?? null
  const toggleEditorial = async (): Promise<void> => {
    await act(async () => { aiSwitch().click(); await Promise.resolve() })
  }
  const closeButton = (): HTMLButtonElement => [...document.querySelectorAll('button')]
    .filter((button) => button.textContent?.replace(/\s/g, '') === text.generationSettings.cancel).at(-1)!
  const confirmButton = (label: string): HTMLButtonElement => [...document.querySelectorAll('button')]
    .find((button) => button.textContent?.replace(/\s/g, '') === label)!
  const discardQuestionVisible = (): boolean => document.body.textContent?.includes(text.settingsDrawer.discardTitle) === true
  const drawerOpen = (): boolean => document.querySelector('[data-settings-section="generation"]') !== null
  const pressEscape = async (): Promise<void> => {
    // antd's modal drawer handles Escape on its own panel and keys off keyCode; dispatching on
    // `document` never reaches it.
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')
    await act(async () => { (panel ?? document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); await Promise.resolve() })
  }
  const clickMask = async (): Promise<void> => {
    const mask = document.querySelector<HTMLElement>('.ant-drawer-mask')
    expect(mask, 'the modal drawer must render a mask to click').not.toBeNull()
    await act(async () => { mask!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
  }

  it('asks before closing the drawer with unsaved edits instead of dropping them', async () => {
    // The one silent-loss path: the reader edits a field, presses 取消, and nothing on screen says
    // the edit is gone. A clean close must not ask; a dirty one must keep the edit until discarded.
    const client = fakeClient({
      getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
      saveSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView }))
    })
    const dom = await renderPage(client)

    // Clean close: no confirmation, the drawer just closes.
    await openSettingsDrawer(dom)
    await act(async () => { closeButton().click(); await Promise.resolve() })
    expect(drawerOpen()).toBe(false)
    expect(discardQuestionVisible()).toBe(false)

    // Edit, then try to close: the drawer stays, the question names what would be lost, and the
    // edited value is still the value on screen (not the value that was read).
    await openSettingsDrawer(dom)
    expect(editorialSwitchValue()).toBe('true')
    await toggleEditorial()
    await act(async () => { closeButton().click(); await Promise.resolve() })
    expect(discardQuestionVisible()).toBe(true)
    expect(drawerOpen()).toBe(true)
    expect(editorialSwitchValue()).toBe('false')

    // Discarding is the only way the edits leave: confirm closes the drawer.
    await act(async () => { confirmButton(text.settingsDrawer.discardConfirm).click(); await Promise.resolve() })
    expect(drawerOpen()).toBe(false)
  })

  it('keeps the edit when the reader answers the question with 继续编辑', async () => {
    // The other half of the guard: cancelling the confirmation must not close the drawer and must
    // not reset the form to the values that were read.
    const client = fakeClient({
      getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
      saveSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView }))
    })
    const dom = await renderPage(client)
    await openSettingsDrawer(dom)
    await toggleEditorial()

    await act(async () => { closeButton().click(); await Promise.resolve() })
    expect(discardQuestionVisible()).toBe(true)
    await act(async () => { confirmButton(text.settingsDrawer.discardCancel).click(); await Promise.resolve() })

    // The drawer and the edited value survive the cancelled question; asking again works, which is
    // what proves the first dialog was dismissed rather than merely faded out of view.
    expect(drawerOpen()).toBe(true)
    expect(editorialSwitchValue()).toBe('false')
    await act(async () => { closeButton().click(); await Promise.resolve() })
    expect(discardQuestionVisible()).toBe(true)
    expect(drawerOpen()).toBe(true)
    expect(editorialSwitchValue()).toBe('false')
  })

  it('asks after a failed save, when the edits are still in the drawer', async () => {
    // The reviewer's case: edit, press save, save fails, close — the edits are still there and the
    // reader was just told the save did not go through. That close must ask.
    const client = fakeClient({
      getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
      saveSettings: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'failed' }))
    })
    const dom = await renderPage(client)
    await openSettingsDrawer(dom)
    await toggleEditorial()

    await act(async () => { document.querySelector<HTMLButtonElement>('[data-settings-save="true"]')!.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    // Both sections were ready, so both writes were attempted and both were rejected.
    expect(document.body.textContent).toContain(text.settingsDrawer.saveFailed.replace('{sections}', `${text.settingsDrawer.sectionFailed.generation}、${text.settingsDrawer.sectionFailed.ai}`))

    await act(async () => { closeButton().click(); await Promise.resolve() })
    expect(discardQuestionVisible()).toBe(true)
    expect(drawerOpen()).toBe(true)
    expect(editorialSwitchValue()).toBe('false')

    await act(async () => { confirmButton(text.settingsDrawer.discardConfirm).click(); await Promise.resolve() })
    expect(drawerOpen()).toBe(false)
  })

  it('still asks on Escape after a failed save', async () => {
    // Escape in the `save-failed` state: the same onClose route, but a different cell of the matrix.
    const client = fakeClient({
      getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
      saveSettings: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'failed' }))
    })
    const dom = await renderPage(client)
    await openSettingsDrawer(dom)
    await toggleEditorial()
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-settings-save="true"]')!.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    await pressEscape()
    expect(discardQuestionVisible()).toBe(true)
    expect(drawerOpen()).toBe(true)
    expect(editorialSwitchValue()).toBe('false')

    await act(async () => { confirmButton(text.settingsDrawer.discardConfirm).click(); await Promise.resolve() })
    expect(drawerOpen()).toBe(false)
  })

  it('takes the same asking path when the reader presses Escape', async () => {
    const client = fakeClient({
      getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
      saveSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView }))
    })
    const dom = await renderPage(client)
    await openSettingsDrawer(dom)
    await toggleEditorial()

    await pressEscape()
    expect(discardQuestionVisible()).toBe(true)
    expect(drawerOpen()).toBe(true)
    expect(editorialSwitchValue()).toBe('false')

    await act(async () => { confirmButton(text.settingsDrawer.discardConfirm).click(); await Promise.resolve() })
    expect(drawerOpen()).toBe(false)
  })

  it('asks when the reader clicks the mask, and keeps the edit until discarded', async () => {
    const client = fakeClient({
      getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
      saveSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView }))
    })
    const dom = await renderPage(client)
    await openSettingsDrawer(dom)
    await toggleEditorial()

    await clickMask()
    expect(discardQuestionVisible()).toBe(true)
    expect(drawerOpen()).toBe(true)
    expect(editorialSwitchValue()).toBe('false')

    await act(async () => { confirmButton(text.settingsDrawer.discardConfirm).click(); await Promise.resolve() })
    expect(drawerOpen()).toBe(false)
  })

  it('does not ask when the settings could not be loaded at all', async () => {
    const client = fakeClient({
      getSettings: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'failed' }))
    })
    const dom = await renderPage(client)
    await openSettingsDrawer(dom)

    await act(async () => { closeButton().click(); await Promise.resolve() })
    expect(discardQuestionVisible()).toBe(false)
    expect(drawerOpen()).toBe(false)
  })

  it('does not ask after a successful save, so the saved values are the new baseline', async () => {
    const client = fakeClient({
      getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
      saveSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView }))
    })
    const dom = await renderPage(client)
    await openSettingsDrawer(dom)
    await toggleEditorial()

    await act(async () => { document.querySelector<HTMLButtonElement>('[data-settings-save="true"]')!.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(discardQuestionVisible()).toBe(false)
  })

  it('keeps exactly one settings entry and opens that one drawer from the failure panel', async () => {
    const getSettings = vi.fn(async () => ({ state: 'available' as const, view: settingsView }))
    const client = fakeClient({
      getToday: vi.fn(async () => ({ state: 'available' as const, document: failedDocument('editorial-timeout') })),
      getSettings,
      saveSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView }))
    })
    const dom = await renderPage(client)

    // The header entry, and nothing else that opens a settings surface of its own.
    expect(dom.querySelectorAll('[data-briefing-settings-open]')).toHaveLength(1)
    expect(dom.querySelectorAll(`[aria-label="${text.aiSettings.open}"]`)).toHaveLength(0)
    // The failure panel's button is the same entry, not a second one.
    const failureAction = dom.querySelector<HTMLButtonElement>('[data-failure-action="settings"]')!
    expect(failureAction.getAttribute('data-open-settings-section')).toBe('ai')

    await act(async () => {
      failureAction.click()
      await Promise.resolve(); await Promise.resolve()
    })
    const generation = document.querySelector('[data-settings-section="generation"]')
    const ai = document.querySelector('[data-settings-section="ai"]')
    expect(generation).not.toBeNull()
    expect(ai).not.toBeNull()
    // The platform-wide values are jumps, never a second editable copy. The sentence explaining
    // that is an explanation, so it rides in the question mark instead of taking a line of its own.
    const platform = document.querySelector<HTMLElement>('[data-settings-platform="true"]')!
    expect(platform.textContent).not.toContain(text.settingsDrawer.platformNote)
    expect(platform.textContent).toContain(text.settingsDrawer.platformTitle)
    const platformHeading = platform.querySelector('h3')!
    const help = platformHeading.querySelector<HTMLButtonElement>(`[aria-label="${text.settingsDrawer.platformNote}"]`)!
    expect(help).not.toBeNull()
    // The question mark comes before the title, like every other field-level explanation.
    expect(platformHeading.firstElementChild?.contains(help)).toBe(true)
    expect(platformHeading.lastElementChild?.textContent).toBe(text.settingsDrawer.platformTitle)
    // The sentence is not gone: focus opens the explanation that holds it.
    await act(async () => {
      help.focus()
      await Promise.resolve(); await Promise.resolve()
    })
    expect(document.querySelector('[data-popover-content]')?.textContent).toContain(text.settingsDrawer.platformNote)
    const globalLinks = [...document.querySelectorAll<HTMLElement>('[data-global-link]')]
    expect(globalLinks).toHaveLength(2)
    expect(globalLinks.every((link) => !link.matches('input, select, textarea'))).toBe(true)
    // Every form control in the drawer belongs to the brief's own settings: the scoped blocks carry
    // the marker, so a control added outside them would show up as unscoped.
    expect(document.querySelectorAll('[data-setting-scope="brief"]')).toHaveLength(2)
    // Adding a period is a group-level action: it sits on the "Generation" heading row, not as a
    // field of its own, so the drawer never looks like it lost the control.
    const generationHead = document.querySelector('[data-settings-section="generation"] .mi-briefing-settings__group-head')!
    expect(generationHead.querySelector('h3')?.textContent).toBe(text.settingsDrawer.sections.generation)
    expect(generationHead.textContent).toContain(text.settings.periods.add)
    expect(generationHead.querySelector('button[disabled]')?.getAttribute('aria-label')).toBe(text.settings.periods.addReason)
    // The form-wide note lives in the block now, so the drawer shows it too — it used to exist only
    // in the dialog shell, which meant this surface silently lost it.
    expect(document.querySelector('[data-settings-section="generation"]')?.textContent)
      .toContain(text.generationSettings.noteLabel)
  })

  it('opens the same drawer from the web-search banner and keeps one entry', async () => {
    const client = fakeClient({
      getSettings: vi.fn(async () => ({
        state: 'available' as const,
        view: { ...settingsView, settings: { ...settingsView.settings, webSearchEnabled: false } }
      }))
    })
    const dom = await renderPage(client)

    expect(dom.querySelectorAll('[data-briefing-settings-open]')).toHaveLength(1)
    const banner = dom.querySelector<HTMLElement>('[data-open-settings-section="ai"]')!
    expect(banner.textContent).toBe(text.aiSettings.goEnable)

    await act(async () => {
      banner.click()
      await Promise.resolve(); await Promise.resolve()
    })
    expect(document.querySelector('[data-settings-section="ai"]')).not.toBeNull()
    expect(document.querySelector('[data-settings-section="generation"]')).not.toBeNull()
  })

  it('closes one explanation on Escape without closing the drawer, and returns focus', async () => {
    const client = fakeClient({
      getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
      saveSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView }))
    })
    const dom = await renderPage(client)
    await act(async () => {
      dom.querySelector<HTMLButtonElement>('[data-briefing-settings-open]')!.click()
      await Promise.resolve(); await Promise.resolve()
    })
    // The disabled "add a period" button carries the same reason sentence as its own name; the
    // question mark beside it is the enabled one.
    const trigger = [...document.querySelectorAll<HTMLButtonElement>(`[aria-label="${text.settings.periods.addReason}"]`)]
      .find((button) => !button.disabled)!
    expect(trigger).not.toBeUndefined()

    await act(async () => {
      trigger.focus()
      await Promise.resolve()
    })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await Promise.resolve(); await Promise.resolve()
    })
    // One Escape closes the explanation it was aimed at; the drawer stays, and focus is back on
    // the question mark instead of falling to the page behind the mask.
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    expect(document.querySelector('[data-settings-section="generation"]')).not.toBeNull()
    expect(document.querySelector('[data-settings-section="ai"]')).not.toBeNull()
  })

  it('names a model failure and keeps the readable detail', async () => {
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
    expect(panel.querySelector('[data-failure-action="settings"]')).not.toBeNull()
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
    expect(panel.querySelector('[data-failure-action="settings"]')).not.toBeNull()
  })

  it('treats a source failure as a data problem and still offers only retry and settings', async () => {
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'source-failed' as const })) })
    const dom = await renderPage(client)
    const panel = dom.querySelector<HTMLElement>('[data-daily-brief-failure]')!

    expect(panel.textContent).toContain(text.failurePanel.generationTitle)
    expect(panel.textContent).toContain(text.aiSettings.failure['source-failed'])
    expect(panel.textContent).toContain(text.failurePanel.advice.data)
    // The advice sentence names the source check; the buttons do not grow a third entry for it.
    expect(panel.querySelectorAll('[data-failure-action]')).toHaveLength(2)
    expect(panel.querySelector('[data-failure-action="settings"]')).not.toBeNull()
  })

  it('names the block that failed to save and keeps the drawer open', async () => {
    const client = fakeClient({
      getSettings: vi.fn(async () => ({ state: 'available' as const, view: settingsView })),
      saveSettings: vi.fn(async () => ({ state: 'unavailable' as const }))
    })
    const dom = await renderPage(client)
    await act(async () => {
      dom.querySelector<HTMLButtonElement>('[data-briefing-settings-open]')!.click()
      await Promise.resolve(); await Promise.resolve()
    })
    const save = document.querySelector<HTMLButtonElement>('[data-settings-save="true"]')!
    expect(save.disabled).toBe(false)

    await act(async () => {
      save.click()
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    })
    const failed = document.querySelector<HTMLElement>('[data-settings-save-failed]')!
    // Two forms, one save: a bare "save failed" would leave the reader guessing which block to fix.
    expect(failed.textContent).toContain(text.settingsDrawer.sectionFailed.generation)
    expect(failed.textContent).toContain(text.settingsDrawer.sectionFailed.ai)
    expect(document.querySelector('[data-settings-section="generation"]')).not.toBeNull()
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


describe('the exported image follows the edition, not the interface', () => {
  it('exports a Chinese edition in Chinese, with the completeness line in Chinese', async () => {
    const partial = editions.map((edition) => edition.date === '2026-10-30'
      ? { ...edition, expectedLocales: ['zh-CN', 'en-US'] as const, state: 'partial' as const }
      : edition)
    const container = await renderPage(
      fakeClient({ list: vi.fn(async () => ({ state: 'available' as const, result: { editions: partial } })) }),
      { locale: 'en-US', text: englishText }
    )
    const poster = container.querySelector('.mi-daily-briefing-share-host .mi-brief-poster')
    expect(poster).not.toBeNull()
    // The edition is Chinese, so the poster is Chinese even though the interface is English.
    expect(poster!.textContent).toContain(productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing.sections.data)
    expect(poster!.textContent).not.toContain(englishText.sections.data)
    // "本该两版、只成一版" is the only case that writes this; the sentence comes from the edition's language.
    expect(poster!.querySelector('[data-completeness-note="true"]')?.textContent)
      .toBe(productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing.completeness.missingVersion)
    // The history rail's word never reaches the image.
    expect(poster!.textContent).not.toContain('未完整')
  })

  it('says nothing on the image when the edition is complete', async () => {
    const complete = editions.map((edition) => edition.date === '2026-10-30'
      ? { ...edition, expectedLocales: ['zh-CN'] as const }
      : edition)
    const container = await renderPage(
      fakeClient({ list: vi.fn(async () => ({ state: 'available' as const, result: { editions: complete } })) })
    )
    const poster = container.querySelector('.mi-daily-briefing-share-host .mi-brief-poster')
    expect(poster!.querySelector('[data-completeness-note="true"]')).toBeNull()
  })
})

describe('language fallback on the brief page', () => {
  const fallbackSentence = text.settings.periods.languageUnsupported.replace('{language}', 'ja-JP')

  const fallbackView = {
    settings: { editorialEnabled: true, providerId: '', modelId: '', webSearchEnabled: false },
    generation: { periods: [{ id: 'default', generationTime: '08:00', generationTimeZone: 'Asia/Shanghai', generationTimeZoneInvalid: null, windowHours: 24, cronExpression: '0 8 * * *' }] },
    language: { settings: { primary: 'follow-ui', additional: [] }, plan: { locales: ['en-US'], primary: { requested: 'ja-JP', used: 'en-US', fallbackReason: 'ui-language-unsupported' }, writeCount: 1 } },
    webSearchSupported: false,
    resolved: { state: 'agent', providerId: 'p', modelId: 'm', source: 'default' }
  }

  it('shows the reason as a visible status line, not behind a help trigger or a hidden container', async () => {
    const container = await renderPage(fakeClient({
      getSettings: vi.fn(async () => ({ state: 'available' as const, view: fallbackView }))
    }) as ReturnType<typeof fakeClient>)
    const statuses = [...container.querySelectorAll('[role="status"]')]
    const line = statuses.find((node) => node.textContent === fallbackSentence)
    expect(line, `status line with the reason; got ${statuses.map((node) => node.textContent).join(' | ')}`).toBeDefined()
    // The same key the settings dialog shows; there is no second sentence for this state.
    expect(line!.textContent).toBe(text.settings.periods.languageUnsupported.replace('{language}', 'ja-JP'))
    // Not a popover trigger: nobody may reach this state by clicking a question mark.
    expect(container.querySelector(`[aria-label="${fallbackSentence}"]`)).toBeNull()
    // Visible: neither the node nor an ancestor is hidden from sight or from assistive tech.
    expect(line!.closest('[aria-hidden="true"]')).toBeNull()
    expect(line!.closest('.hidden')).toBeNull()
  })

  it('renders no status line for the reason when the interface language is supported', async () => {
    const container = await renderPage(fakeClient())
    expect([...container.querySelectorAll('[role="status"]')].some((node) => node.textContent === fallbackSentence)).toBe(false)
  })
})

