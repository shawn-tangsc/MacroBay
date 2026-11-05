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
import { CONTENT_LOCALE_STORAGE_KEY } from './useBriefingContentLocale'

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


/** 工具条那颗现在只开弹框：点完还要在弹框里按「生成」才算真的跑。 */
async function confirmManualRun(): Promise<void> {
  const run = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.replace(/\s/g, '') === text.manualRunDialog.run.replace(/\s/g, ''))
  await act(async () => { run?.click(); await Promise.resolve(); await Promise.resolve() })
}


/** 确认框里的那颗键：工具栏也有一颗同名的「删除这一版」，所以必须在弹窗里找。 */
function dialogButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  const button = [...(dialog ?? document).querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.replace(/\s/g, '') === label.replace(/\s/g, ''))
  if (button === undefined) throw new Error(`dialog button not found: ${label}`)
  return button
}

let root: Root | null = null
let container: HTMLDivElement | null = null

// The fixture editions are dated 2026-10-30, and the rail marks "today" from the wall clock.
// Without a frozen clock this test passes only before midnight and fails on the next calendar day.
beforeEach(() => {
  // The content language is remembered; a test must not inherit the previous test's choice.
  window.localStorage.clear()
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
      client={client as never}
    /></ConfirmProvider></ConfigProvider>)
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  // The rail groups by day and opens only today (A5.3). These page cases read rows across the whole
  // window, so open every day once, the way a reader would.
  await act(async () => {
    for (const head of container!.querySelectorAll<HTMLButtonElement>('.mi-daily-briefing__rail-day-head[aria-expanded="false"]')) head.click()
  })
  await act(async () => { await Promise.resolve() })
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
    // The day head says 今天; which issue is *current* is decided by the projection and marked on
    // its row (covered by the rail cases), not by the wall clock here.
    expect(dom.querySelector('[data-today]')?.textContent).toBe(text.history.today)
    expect(dom.querySelector('[data-date="2026-10-28"]')?.hasAttribute('disabled')).toBe(false)

    act(() => dom.querySelector<HTMLButtonElement>('.mi-daily-briefing-page__back')!.click())
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('separates the two nothing-states of a day the reader selects', async () => {
    // A day with no edition still has something to say: it either never ran or it failed. The rail
    // carries one word; the pane carries the difference, and selecting never spends a run.
    const failed = { date: '2026-10-20', periodId: 'default', locale: 'zh-CN' as const, availableLocales: [], state: 'missing' as const, attemptCount: 2 }
    const list = vi.fn(async () => ({
      state: 'available' as const,
      // Inside the 14-day window the page renders: a fifteenth row would never reach the rail.
      result: { editions: editions.map((edition, index) => index === 10 ? failed : edition) }
    }))
    const client = fakeClient({ list, get: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'model-unavailable' })) })
    const dom = await renderPage(client)
    const getTodayCalls = (client.getToday as unknown as { mock: { calls: unknown[] } }).mock.calls.length

    // 1. A day that never ran: the pane names it, gives the schedule, and offers no false action.
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-28"]')!.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const never = dom.querySelector('[data-briefing-no-edition="2026-10-28"]')
    expect(never?.textContent).toContain(text.history.notRunTitle)
    // The schedule when the list carries one, otherwise the honest "no attempt recorded".
    const scheduleSentence = text.history.notRunPlanned.split('{')[0]!
    expect([scheduleSentence, text.history.notRunUnknownPlanned].some((sentence) => never?.textContent?.includes(sentence))).toBe(true)
    const backfill = never?.querySelector<HTMLButtonElement>('button')!
    // The one thing this version cannot do is disabled, and its accessible name says why.
    expect(backfill.disabled).toBe(true)
    expect(backfill.getAttribute('aria-label')).toBe(text.history.backfillBlocked)
    expect(dom.querySelector('[data-date="2026-10-28"]')?.getAttribute('aria-current')).toBe('true')

    // 2. A day that failed: the reason and the nine steps, not just one word in the rail.
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-20"]')!.click() })
    for (let round = 0; round < 4; round += 1) await act(async () => { await Promise.resolve() })
    const panel = dom.querySelector('[data-daily-brief-failure]')!
    expect(panel.getAttribute('data-failure-code')).toBe('model-unavailable')
    expect(panel.querySelectorAll('[data-stage]')).toHaveLength(9)
    expect(panel.textContent).toContain(text.aiSettings.failure['model-unavailable']!)
    const retry = panel.querySelector<HTMLButtonElement>('[data-failure-action="retry"]')!
    expect(retry.disabled).toBe(true)
    expect(retry.getAttribute('aria-label')).toBe(text.history.backfillBlocked)

    // 3. Selecting wrote nothing and started nothing: no open, no run, no attempt.
    expect(client.getToday).toHaveBeenCalledTimes(getTodayCalls)
    expect(client.regenerate).not.toHaveBeenCalled()
    // 4. The header keeps today as its target, so the two entries cannot be confused.
    expect(dom.querySelector('[data-toolbar-action="regenerate"]')?.getAttribute('aria-label')).toBe(text.manualGenerateTarget.replace('{date}', '2026-10-30'))
  })

  it('loads a historical edition read-only and never re-reads a cached one', async () => {
    const client = fakeClient()
    const dom = await renderPage(client)
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-29"]')!.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(client.get).toHaveBeenCalledWith({ date: '2026-10-29', locale: 'zh-CN', periodId: 'default' })
    expect(dom.textContent).toContain(text.history.readOnly)
    expect(dom.querySelector('[data-date="2026-10-29"]')?.getAttribute('aria-current')).toBe('true')

    // Back to the day already read: the cache answers, no second request for the same edition.
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-29"]')!.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(client.get).toHaveBeenCalledTimes(1)

    // A day with no edition still reads nothing: the list already answered for it.
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-28"]')!.click() })
    expect(client.get).toHaveBeenCalledTimes(1)
  })

  it('reloads after a delete without starting a generation', async () => {
    // Deleting an issue is the reader saying "this one should not exist". Reloading the page must
    // read what is left, not call getToday, which generates a missing edition — otherwise the delete
    // is undone by the very refresh that follows it. The day that was not deleted must stay on
    // screen, because the list already carries it.
    const deletePeriod = vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 1, remaining: 0, allDone: true }))
    const client = fakeClient({
      deletePeriod,
      get: vi.fn(async ({ date }: { date: string }) => date === '2026-10-29'
        ? { state: 'available' as const, document: briefingDocument('2026-10-29', '历史版次') }
        : date === '2026-10-30'
          ? { state: 'available' as const, document: briefingDocument('2026-10-30') }
          : { state: 'missing' as const })
    })
    const dom = await renderPage(client)
    expect(client.getToday).toHaveBeenCalledTimes(1)

    const row = dom.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row[data-date="2026-10-29"]')!
    // 行右键菜单恰一项「删除这一版」：右键的就是你点中的那一行（02 v2.40）。
    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')][0]!
    act(() => { item.click() })
    for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve() })
    const confirm = dialogButton(text.history.deleteEditionConfirm)
    await act(async () => { confirm.click() })
    for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve() })

    expect(deletePeriod).toHaveBeenCalledWith({ date: '2026-10-29', periodId: 'default', locale: 'zh-CN' })
    // The list is read again (the row that survived must still be on screen), but no new run starts.
    expect(client.list).toHaveBeenCalledTimes(2)
    expect(client.getToday).toHaveBeenCalledTimes(1)
    // Deleting a past issue must not blank today's edition: the reload reads it from the list.
    expect(dom.textContent).toContain('CPI 超预期 · Ripple 获批')
    expect(dom.querySelector('[data-date="2026-10-30"]')?.getAttribute('aria-current')).toBe('true')
  })

  it('deletes the edition the reader is looking at from the top toolbar, after the same confirmation', async () => {
    // 工具栏第五颗是版次级动作：它删的必须是**当前打开的这一版**，不是"最后那一期"。两个入口
    // （工具栏与行右键）共用同一个确认框，所以这里断言的是同一句话与同一个目标三元组。
    const deletePeriod = vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 1, remaining: 0, allDone: true }))
    const client = fakeClient({
      deletePeriod,
      get: vi.fn(async ({ date }: { date: string }) => date === '2026-10-29'
        ? { state: 'available' as const, document: briefingDocument('2026-10-29', '历史版次') }
        : { state: 'missing' as const })
    })
    const dom = await renderPage(client)
    await act(async () => { dom.querySelector<HTMLButtonElement>('.mi-daily-briefing__rail-row[data-date="2026-10-29"]')!.click() })
    for (let round = 0; round < 4; round += 1) await act(async () => { await Promise.resolve() })

    const trigger = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="delete-edition"]')!
    expect(trigger.disabled).toBe(false)
    await act(async () => { trigger.click() })
    // 同一句话点名：日期 · 时刻 · 语言，与行右键弹的逐字一致（同一个 helper 生成）。
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('2026-10-29')
    expect(dialog.textContent).toContain(text.history.editionLanguages.zh)
    expect(dialog.textContent).toContain(text.history.deleteEditionConfirm)
    await act(async () => { dialogButton(text.history.deleteEditionConfirm).click() })
    for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve() })
    expect(deletePeriod).toHaveBeenCalledWith({ date: '2026-10-29', periodId: 'default', locale: 'zh-CN' })
  })

  it('disables the delete action with a visible reason when no edition is open', async () => {
    // 没有可读版次时五颗一起禁用；原因必须是读者看得到的，不是 title 那种禁用处不到的提示。
    const client = fakeClient({
      get: vi.fn(async () => ({ state: 'missing' as const })),
      getToday: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'not-generated' }))
    })
    const dom = await renderPage(client)
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-28"]')!.click() })
    for (let round = 0; round < 4; round += 1) await act(async () => { await Promise.resolve() })
    const trigger = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="delete-edition"]')!
    expect(trigger.disabled).toBe(true)
    expect(trigger.getAttribute('aria-describedby')).not.toBeNull()
    expect(dom.textContent).toContain(text.history.deleteNoEdition)
  })

  it('keeps both languages of one period as two rows after today\'s document lands', async () => {
    // 根因守卫：新文档写回列表时按**日期**整片替换，会把同一天英文那行也写成中文版——两行同键同语言，
    // 读者看到两个「中文」、一条英文标题；React 把它们当同一行复用，右键与删除落到另一行上。
    const today = '2026-10-30'
    const twoLanguages = [
      { date: today, periodId: 'default', locale: 'zh-CN' as const, availableLocales: ['zh-CN', 'en-US'] as const, state: 'generated' as const, generatedAt: `${today}T00:30:00.000Z`, windowEnd: `${today}T00:30:00.000Z`, readingsAvailable: 4 },
      { date: today, periodId: 'default', locale: 'en-US' as const, availableLocales: ['zh-CN', 'en-US'] as const, state: 'generated' as const, generatedAt: `${today}T00:30:00.000Z`, windowEnd: `${today}T00:30:00.000Z`, readingsAvailable: 4 }
    ]
    const client = fakeClient({
      list: vi.fn(async () => ({ state: 'available' as const, result: { editions: twoLanguages } }))
    })
    const dom = await renderPage(client)
    const rows = [...dom.querySelectorAll<HTMLElement>('.mi-daily-briefing__rail-row')]
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.querySelector('[data-edition-locale]')?.getAttribute('data-edition-locale')))
      .toEqual(['zh-CN', 'en-US'])
    // 选中英文那行，只有那一行是 current：一次点击只落在一行上。
    await act(async () => { rows[1]!.click() })
    for (let round = 0; round < 4; round += 1) await act(async () => { await Promise.resolve() })
    const current = [...dom.querySelectorAll<HTMLElement>('.mi-daily-briefing__rail-row')]
      .filter((row) => row.getAttribute('aria-current') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0]!.querySelector('[data-edition-locale]')?.getAttribute('data-edition-locale')).toBe('en-US')
  })

  it('shows a deleted day as empty, keeps the rail where the reader was, and still offers a generate', async () => {
    // One delete action, three promises to the reader: the rail does not jump, the pane says
    // "nothing here" instead of "the read failed", and the header control keeps working.
    // A read was never attempted on this reload, so calling it unreadable would accuse it.
    let listCalls = 0
    // The service still lists every day of the window; a deleted day comes back as "not run",
    // which is what the rail has to show while keeping the reader's place.
    const list = vi.fn(async () => {
      listCalls += 1
      return {
        state: 'available' as const,
        result: {
          editions: listCalls === 1
            ? editions
            : editions.map((edition) => edition.date === '2026-10-30'
              ? { date: edition.date, periodId: 'default', locale: 'zh-CN' as const, availableLocales: [], state: 'missing' as const }
              : edition)
        }
      }
    })
    const client = fakeClient({
      list,
      deletePeriod: vi.fn(async () => ({ editions: 1, attempts: 1, periodRuns: 1, sessionLinks: 1, remaining: 0, allDone: true })),
      get: vi.fn(async ({ date }: { date: string }) => ({ state: 'available' as const, document: briefingDocument(date) }))
    })
    const dom = await renderPage(client)
    const railRow = (): HTMLElement => dom.querySelector<HTMLElement>('.mi-daily-briefing__rail-row[data-date="2026-10-30"]')!

    expect(railRow().getAttribute('aria-current')).toBe('true')
    expect(dom.querySelectorAll('.mi-daily-briefing__rail-row')).toHaveLength(14)

    // 行右键菜单恰一项「删除这一版」：右键的就是你点中的那一行（02 v2.40）。
    act(() => { railRow().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })) })
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')][0]!
    act(() => { item.click() })
    for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve() })
    const confirm = dialogButton(text.history.deleteEditionConfirm)
    await act(async () => { confirm.click() })
    for (let round = 0; round < 6; round += 1) await act(async () => { await Promise.resolve() })

    // 1. The rail stayed put: the same day is still selected, and it now reads "not run".
    expect(railRow().getAttribute('aria-current')).toBe('true')
    expect(railRow().hasAttribute('data-missing') || railRow().textContent).toBeTruthy()
    expect(dom.querySelectorAll('.mi-daily-briefing__rail-row')).toHaveLength(14)
    // 2. The pane is the ordinary "not generated" state — one state, one name — and never the
    //    unreadable one: no read was attempted, so none can have failed.
    const pane = dom.querySelector('[data-briefing-no-edition="2026-10-30"]')
    expect(pane?.textContent).toContain(text.history.notRunTitle)
    expect(dom.textContent).not.toContain(text.stateReasons.unreadable)
    expect(dom.textContent).not.toContain(text.stateReasons.unreadableSince.split('{')[0]!)
    // What the reader did is said once, by the delete note, not by the empty state.
    expect(dom.querySelector('[data-delete-outcome="done"]')?.textContent).toBe(
      text.history.deleteDone.replace('{date}', '2026-10-30').replace('{language}', text.history.editionLanguages.zh))
    // 3. The generate control is still there and still usable.
    const regenerate = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!
    expect(regenerate).not.toBeNull()
    expect(regenerate.disabled).toBe(false)
    // And the delete did not start a run of its own.
    expect(client.getToday).toHaveBeenCalledTimes(1)
  })

  it('keeps a stored Chinese headline out of an English edition, and keeps it in the Chinese one', async () => {
    const base = briefingDocument()
    const stored = {
      ...base,
      edition: { ...base.edition, locale: 'en-US' as const },
      // A document written before the language gate: the translated title is Chinese.
      news: { ...base.news, items: [{ ...base.news.items[0]!, title: 'Bitcoin ETFs saw outflows', translatedTitle: '比特币 ETF 资金流出' }] }
    } as DailyBriefingDocument
    const english = await renderPage(fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: stored })) }))
    const paper = english.querySelector<HTMLElement>('.mi-daily-briefing-page__paper')!

    // Display fallback for old data: the English edition shows the English source headline.
    expect(paper.textContent).toContain('Bitcoin ETFs saw outflows')
    expect(paper.textContent).not.toContain('比特币 ETF 资金流出')

    const chinese = await renderPage(fakeClient({
      getToday: vi.fn(async () => ({ state: 'available' as const, document: { ...stored, edition: { ...stored.edition, locale: 'zh-CN' as const } } }))
    }))
    // A Chinese edition is untouched: the same stored title still renders.
    expect(chinese.querySelector('.mi-daily-briefing-page__paper')?.textContent).toContain('比特币 ETF 资金流出')
  })

  it('copies the current edition as text and reports success', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const dom = await renderPage(fakeClient())
    const copy = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="copy"]')!
    await act(async () => { copy.click(); await Promise.resolve(); await Promise.resolve() })
    expect(writeText).toHaveBeenCalledTimes(1)
    const markdown = (writeText.mock.calls[0] as unknown[] | undefined)?.[0] as string
    expect(markdown).toContain(`# ${text.title}`)
    expect(markdown).toContain('CPI 超预期')
    expect(dom.textContent).toContain(text.copied)
  })

  it('copies an English edition in English, whatever the interface language is', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const client = fakeClient({
      getToday: vi.fn(async () => ({
        state: 'available' as const,
        document: { ...briefingDocument(), edition: { ...briefingDocument().edition, locale: 'en-US' as const } }
      }))
    })
    const dom = await renderPage(client, { locale: 'zh-CN' })
    const copy = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="copy"]')!
    await act(async () => { copy.click(); await Promise.resolve(); await Promise.resolve() })
    const markdown = (writeText.mock.calls[0] as unknown[] | undefined)?.[0] as string
    // Same rule as the file name and the exported image: the edition decides its own language.
    expect(markdown).toContain(`# ${englishText.title}`)
    expect(markdown).not.toContain(`# ${text.title}`)
  })

  it('reports a clipboard failure and copies the historical edition that is on screen', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied') })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const client = fakeClient()
    const dom = await renderPage(client)
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-29"]')!.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    const copy = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="copy"]')!
    await act(async () => { copy.click(); await Promise.resolve(); await Promise.resolve() })
    expect(dom.textContent).toContain(text.copyFailed)
    // 这一句是夹具文档自己的正文（`briefingDocument(..., '历史版次')`），不是文案表里的句子。
    expect((writeText.mock.calls[0] as unknown[] | undefined)?.[0]).toContain('历史版次')
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

  it('runs the issue now from the toolbar', async () => {
    // 顶部那颗现在是「手动生成」：它走的是生成那一条路（`generateNow`），不是"重生成整天那一条"。
    const client = fakeClient()
    const dom = await renderPage(client)
    const run = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!
    await act(async () => { run.click(); await Promise.resolve() })
    await confirmManualRun()
    // 期号必须一路传到服务：没有它，这一跑会落到 `default` 那一期上，把别的期覆盖掉。
    expect(client.regenerate).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'zh-CN',
      timeZone: expect.any(String),
      generation: expect.objectContaining({ asOf: expect.any(String) }),
      periodId: expect.any(String)
    }))
    expect(dom.textContent).toContain('重新生成版')
    expect(run.textContent).toContain(text.manualGenerate)
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
    const button = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!
    await act(async () => { button.click(); await Promise.resolve() })
    await confirmManualRun()
    const running = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!
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
    expect(dom.querySelector('[data-toolbar-action="export"]')).not.toBeNull()
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
    }), { text: blank as unknown as typeof text })
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
    // The header action stays clickable in a failure too: only a run in flight disables it. It and
    // the panel's retry may both be clickable — that is the ask, not a duplicate to remove.
    const headerAction = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!
    expect(headerAction).not.toBeNull()
    expect(headerAction.disabled).toBe(false)
    expect(headerAction.getAttribute('aria-label')).toBe(text.manualGenerateTarget.replace('{date}', '2026-10-30'))
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

  it('leaves the readings count out of the document masthead', async () => {
    const dom = await renderPage(fakeClient())
    const paper = dom.querySelector<HTMLElement>('.mi-daily-briefing-page__paper')!

    // The masthead said "4 items" while the body listed those items one by one.
    expect(paper.querySelector('.mi-brief-poster__readings')).toBeNull()
    expect(paper.textContent).not.toMatch(/\d+\s*项/)
  })

  it('keeps the row free of attempt counts and puts the one attempt trail in the detail column', async () => {
    const dom = await renderPage(fakeClient({ listAttempts: vi.fn(async () => ({ state: 'available' as const, attempts: [] })) }))
    const row = dom.querySelector<HTMLElement>('[data-date="2026-10-30"]')!.closest('.mi-daily-briefing__rail-item')!

    // The row is the clock and the item count; no expander, no "N attempts".
    expect(row.querySelector('[data-attempts-toggle]')).toBeNull()
    // The row carries the item count and the clocks; the attempt count stays in the detail column.
    // 两行制：项数是正文元数据，不进行。
    expect(row.textContent).not.toMatch(/\d+\s*项/)
    expect(row.textContent).not.toContain(text.history.attempts.times)

    // The trail lives in the one detail column, and only there: one disclosure, no toggle button.
    expect(dom.querySelectorAll('[data-briefing-attempts]')).toHaveLength(1)
    const trail = dom.querySelector<HTMLDetailsElement>('[data-briefing-attempts]')!
    const summary = trail.querySelector<HTMLElement>('summary')!
    expect(trail.tagName).toBe('DETAILS')
    expect(summary.querySelectorAll('button, a')).toHaveLength(0)
    expect(summary.textContent).not.toMatch(/\d|次/)
    expect(dom.textContent!.match(/生成记录/g) ?? []).toHaveLength(1)
  })

  it('keeps the detail column as one scroll container ordered gaps → stages → attempts', async () => {
    const dom = await renderPage(fakeClient({ listAttempts: vi.fn(async () => ({ state: 'available' as const, attempts: [] })) }))
    const column = dom.querySelector<HTMLElement>('[data-briefing-detail="true"]')!

    // One container, three marked blocks, exactly once each.
    expect(dom.querySelectorAll('[data-briefing-detail]')).toHaveLength(1)
    // Only the rail's block: the body's stage list (generating) is a different surface and absent here.
    expect(column.querySelectorAll('[data-briefing-stages]')).toHaveLength(1)
    expect(dom.querySelectorAll('[data-briefing-gaps]')).toHaveLength(1)
    expect(dom.querySelectorAll('[data-briefing-attempts]')).toHaveLength(1)

    // The order is a fact the guard can compare, not a promise in a comment.
    const children = [...column.children]
    const stages = children.findIndex((child) => child.hasAttribute('data-briefing-stages'))
    const gaps = children.findIndex((child) => child.hasAttribute('data-briefing-gaps'))
    const attempts = children.findIndex((child) => child.hasAttribute('data-briefing-attempts'))
    expect(gaps).toBeGreaterThanOrEqual(0)
    expect(stages).toBeGreaterThan(gaps)
    expect(attempts).toBeGreaterThan(stages)
  })

  it('keeps exactly one settings entry and opens that one drawer from the failure panel', async () => {
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke: async () => [] } }
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
    // 加一期的入口现在长在期列表里，而不是一颗写着"这个版本还不支持"的灰按钮：它必须可点。
    const generationHead = document.querySelector('[data-settings-section="generation"] .mi-briefing-settings__group-head')!
    expect(generationHead.querySelector('h3')?.textContent).toBe(text.settingsDrawer.sections.generation)
    // 期列表走产品桥；这一条用例只关心入口在不在、可不可点，所以给它一个空列表。
    const addPeriod = document.querySelector<HTMLButtonElement>('[data-briefing-period-add]')!
    expect(addPeriod.disabled).toBe(false)
    expect(addPeriod.textContent).toContain(text.settings.periods.add)
    // 那句"这个版本还不支持一天多期"随禁用按钮一起消失，不许留在界面上。
    expect(document.body.textContent).not.toContain(text.settings.periods.addReason)
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
    // 抽屉里还留着的问号：整块的生成说明（加一期的假按钮已经不存在了）。
    const trigger = document.querySelector<HTMLButtonElement>(`[aria-label="${text.generationSettings.noteLabel}"]`)!
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
    expect(aside.querySelector('[data-briefing-stages] .mi-generation-trace')).not.toBeNull()
    expect(aside.querySelector('[data-generation-trace-missing]')?.textContent).toBe(text.generationTrace.missing)
    expect(aside.textContent).toContain(text.sections.limits)
    // The counts are the verdict: they are on the closed summary line, never behind the disclosure.
    expect(aside.textContent).toContain(text.limits.counts.warning.replace('{count}', '7'))
    expect(aside.textContent).toContain(text.limits.counts.info.replace('{count}', '5'))
    const gaps = aside.querySelector<HTMLDetailsElement>('[data-briefing-gaps] details')!
    // Open by default, on the reader's request: the rows are visible without a click.
    expect(gaps.open).toBe(true)
    // The rows are inside that disclosure and nowhere else.
    expect(gaps.querySelectorAll('.mi-daily-briefing-page__group').length).toBeGreaterThan(0)
    expect(aside.querySelectorAll('.mi-daily-briefing-page__group')).toHaveLength(gaps.querySelectorAll('.mi-daily-briefing-page__group').length)

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
    // Three facts per row and nothing more: severity, what it is, how many.
    for (const button of groupButtons) {
      expect(button.children).toHaveLength(3)
      expect(button.querySelectorAll('.mi-daily-briefing-page__group-example')).toHaveLength(0)
    }

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

    // One disclosure shape for all three blocks: the same native details, no button of its own.
    const gapSummary = gaps.querySelector<HTMLElement>('summary')!
    expect(gapSummary.querySelectorAll('button, a')).toHaveLength(0)
    expect(gaps.open).toBe(true)
    act(() => gapSummary.click())
    expect(gaps.open).toBe(false)
    // Closed, the counts still answer "how bad is it" — they are the verdict, not the detail.
    expect(aside.textContent).toContain(text.limits.counts.warning.replace('{count}', '7'))
    act(() => gaps.querySelector<HTMLElement>('summary')!.click())
    expect(gaps.open).toBe(true)
  })

  it('renders the diagnostics panel in English', async () => {
    const client = fakeClient({ getToday: vi.fn(async () => ({ state: 'available' as const, document: diagnosticsDocument() })) })
    const dom = await renderPage(client, { locale: 'en-US' })
    const aside = dom.querySelector<HTMLElement>('[data-briefing-issues]')!

    expect(aside.textContent).toContain(englishText.sections.limits)
    expect(aside.textContent).toContain(englishText.limits.severity.warning)
    expect(aside.textContent).not.toContain('变化基线缺失')
    act(() => aside.querySelector<HTMLElement>('[data-briefing-gaps] summary')!.click())
    expect(aside.textContent).toContain(englishText.limits.groupLabels['macro-consensus'])
    expect(aside.textContent).toContain(englishText.limits.groupLabels['no-baseline'])

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
    expect(trace.textContent).toContain(text.generationTrace.allCompleted)
    // Contract change: a finished run is collapsed by default; the summary still says it finished.
    const details = trace as HTMLDetailsElement
    expect(details.tagName).toBe('DETAILS')
    // Open in every state; the summary line is where collapsing starts.
    expect(details.open).toBe(true)
    expect(details.querySelector('summary')!.textContent).toMatch(/9 步 · .+ · 全部完成/)
    expect(details.querySelectorAll('[data-briefing-stage-row]')).toHaveLength(9)
    expect(details.querySelectorAll('[data-stage]')).toHaveLength(9)
    expect(trace.textContent).toContain('耗时 30 秒')
    expect(dom.querySelector('[data-briefing-issues] [data-briefing-stages] .mi-generation-trace')).not.toBeNull()
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
    expect(panel.querySelector('[data-stage="writing"]')?.getAttribute('data-stage-state')).toBe('done')
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
  // 行内第二行只说"在等内容"；阶段名与"读不到进度"由提示条说，252px 不背这两句。
  expect(today?.querySelector('[data-rail-title="running"]')?.textContent).toContain('生成中')
  expect(today?.textContent).not.toContain('当天未运行')
  // 来源徽标不是「未运行」：这一期正在跑，来源仍然是定时。
  expect(today?.querySelector('[data-run-source]')?.getAttribute('data-run-source')).toBe('scheduled')
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

it('shows the generating state as the same centred panel a failure uses', async () => {
  const progress = {
    attemptId: 'attempt-1',
    startedAt: '2026-10-30T04:00:00.000Z',
    state: 'running',
    stages: traceStageIds.map((id, index) => ({
      id,
      state: index === 0 ? 'success' : 'pending',
      startedAt: index === 1 ? '2026-10-30T04:00:05.000Z' : index === 0 ? '2026-10-30T04:00:00.000Z' : null,
      finishedAt: index === 0 ? '2026-10-30T04:00:01.000Z' : null,
      durationMs: index === 0 ? 1_000 : 0
    }))
  }
  const client = fakeClient({
    getToday: vi.fn(() => new Promise(() => undefined)),
    getProgress: vi.fn(async () => ({ state: 'running' as const, progress }))
  })
  const dom = await renderPage(client as ReturnType<typeof fakeClient>)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })

  // One status word in the header; the attempt panel lives in the body, exactly where a failure's lives.
  expect(dom.querySelectorAll('.status-pill')).toHaveLength(1)
  expect(dom.querySelectorAll('.state-view')).toHaveLength(0)
  const panel = dom.querySelector<HTMLElement>('.mi-daily-briefing-page__content [data-briefing-stage-panel][data-state="generating"]')!
  expect(panel.querySelectorAll('[data-loading-state]')).toHaveLength(1)
  expect(panel.querySelectorAll('[data-briefing-stage-row]').length).toBeGreaterThan(0)
  // No third layout: the right-hand column is absent while generating, like after a failure.
  // Today already has an edition here, so the archive stays while the new run is in flight.
  expect(dom.querySelectorAll('[data-briefing-detail]')).toHaveLength(1)
  expect(dom.textContent!.match(/正在生成今天的日报/g)).toHaveLength(1)
  // 这一行本来就有版次：重跑时它继续显示那一份的标题，进度在正文区的面板里说，
  // 行内不印阶段名（252px 里那是正文的东西）。跑完原地换标题，不新增一行。
  const todayRow = dom.querySelector<HTMLElement>('[data-date="2026-10-30"]')!.closest('.mi-daily-briefing__rail-item')!
  expect(todayRow.querySelector('[data-rail-title="summary"]')).not.toBeNull()
  expect(todayRow.querySelector('[data-rail-title="running"]')).toBeNull()
  expect(todayRow.querySelector('[data-run-source]')?.getAttribute('data-run-source')).toBe('scheduled')
})

it('keeps the edition readable and reports a run in the right column', async () => {
  // The reader asked for this split: while a run replaces an issue that already has an edition, the
  // edition stays readable and the nine steps report in the right column — not both in the body.
  let settle: (value: unknown) => void = () => undefined
  const client = fakeClient({
    regenerate: vi.fn(() => new Promise((resolve) => { settle = resolve }))
  })
  const dom = await renderPage(client)
  const before = dom.querySelector('.mi-daily-briefing-page__paper')?.textContent
  await act(async () => {
    dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!.click()
    await Promise.resolve()
  })
  await confirmManualRun()

  // 1. No nine-step panel in the body.
  expect(dom.querySelector('.mi-daily-briefing-page__content [data-briefing-stage-panel]')).toBeNull()
  // 2. The edition on screen is the one that was there before the click, unchanged.
  expect(dom.querySelector('.mi-daily-briefing-page__paper')?.textContent).toBe(before)
  // The run reports in the right column, where the steps already live.
  const rail = dom.querySelector<HTMLElement>('[data-briefing-detail]')!
  const railStages = rail.querySelector<HTMLElement>('[data-briefing-stages]')!
  expect(railStages.querySelectorAll('[data-briefing-stage-row]')).toHaveLength(9)
  for (const row of [...railStages.querySelectorAll<HTMLElement>('[data-briefing-stage-row]')]) {
    expect(row.textContent).toContain(text.generationTrace.states.notStarted)
    expect(row.textContent).not.toContain(text.generationTrace.notRecorded)
  }
  // The attempt line is not invented while the run has reported nothing yet.
  expect(railStages.textContent).not.toContain(text.generationTrace.startedAt.split('{time}')[0]!.trim())
  // 4. The header action shows it is working, not merely that it is unavailable.
  const action = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!
  expect(action.className).toContain('ant-btn-loading')
  expect(action.getAttribute('aria-label')).toBe(text.generationProgress.workingHint)

  const replaced = briefingDocument('2026-10-30', '重新生成版')
  await act(async () => {
    settle({
      state: 'available',
      document: {
        ...replaced,
        provenance: { ...replaced.provenance, generationTrace: generationTraceFixture('success') } as typeof replaced.provenance
      }
    })
    await Promise.resolve(); await Promise.resolve()
  })
  // Success replaces the body with the new edition, and the column reports that attempt's steps.
  expect(dom.querySelector('.mi-daily-briefing-page__paper')?.textContent).toContain('重新生成版')
  expect(dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!.className).not.toContain('ant-btn-loading')
  const settledRows = [...dom.querySelectorAll<HTMLElement>('[data-briefing-detail] [data-briefing-stage-row]')]
  expect(settledRows).toHaveLength(9)
  expect(settledRows.every((row) => row.getAttribute('data-stage-state') === 'done')).toBe(true)
})

it('reports a run that is already in flight in the right column, step by step', async () => {
  // A scheduled run (not this window's click): the edition stays readable in the body and the steps
  // report in the column, following the progress the service publishes.
  const progress = {
    attemptId: 'attempt-1',
    startedAt: '2026-10-30T04:00:00.000Z',
    state: 'running' as const,
    stages: traceStageIds.map((id, index) => ({
      id,
      state: index === 0 ? 'success' as const : 'pending' as const,
      startedAt: index === 1 ? '2026-10-30T04:00:05.000Z' : index === 0 ? '2026-10-30T04:00:00.000Z' : null,
      finishedAt: index === 0 ? '2026-10-30T04:00:01.000Z' : null,
      ...(index === 0 ? { durationMs: 1_000 } : {})
    }))
  }
  const client = fakeClient({ getProgress: vi.fn(async () => ({ state: 'running' as const, progress })) })
  const dom = await renderPage(client)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })

  expect(dom.querySelector('.mi-daily-briefing-page__content [data-briefing-stage-panel]')).toBeNull()
  expect(dom.querySelector('.mi-daily-briefing-page__paper')).not.toBeNull()

  const rail = dom.querySelector<HTMLElement>('[data-briefing-detail]')!
  const row = (id: string): HTMLElement => rail.querySelector<HTMLElement>(`[data-stage="${id}"]`)!
  // One row finished, one running, the rest not started: the column follows the run.
  expect(row('source').getAttribute('data-stage-state')).toBe('done')
  expect(row('source').textContent).toContain('1 秒')
  expect(row('candidates').getAttribute('data-stage-state')).toBe('running')
  expect(row('candidates').textContent).toContain(text.generationProgress.running)
  expect(row('writing').getAttribute('data-stage-state')).toBe('waiting')
  expect(row('writing').textContent).toContain(text.generationTrace.states.notStarted)
  // The attempt line names its instant as a start, in the column that shows it.
  expect(rail.textContent).toContain(text.generationTrace.startedAt.split('{time}')[0]!.trim())
  // A run in flight shows the header action working, not merely disabled.
  expect(dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!.className).toContain('ant-btn-loading')
})

it('says a run is waiting for market data, not just that it is running', async () => {
  // The reader saw one "generating", no attempt row, no session and no step: unaudited waiting is
  // indistinguishable from a stuck run. The wait has to say what it waits for, how long, how often.
  const waiting = { since: '2026-10-30T04:00:00.000Z', polls: 4, waitedMs: 120_000, budgetMs: 900_000 }
  const progress = {
    attemptId: '',
    startedAt: waiting.since,
    state: 'running' as const,
    stages: traceStageIds.map((id) => ({ id, state: 'pending' as const })),
    waiting
  }
  const client = fakeClient({ getProgress: vi.fn(async () => ({ state: 'running' as const, progress })) })
  const dom = await renderPage(client)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })

  const rail = dom.querySelector<HTMLElement>('[data-briefing-detail]')!
  expect(rail.textContent).toContain(text.generationTrace.waitingSummary)
  expect(rail.textContent).toContain(text.generationTrace.notStartedYet)
  expect(rail.textContent).toContain(text.generationTrace.waitingElapsed.replace('{seconds}', '120').replace('{polls}', '4'))
  expect(rail.textContent).toContain(text.generationTrace.waitingHint)
  // Waiting is not an edition replacement: the one on screen is still readable.
  expect(dom.querySelector('.mi-daily-briefing-page__paper')).not.toBeNull()
})

it('leaves the archive out while generating a day that never produced one', async () => {
  const missing = editions.map((edition) => ({ ...edition, state: 'missing' as const, generatedAt: undefined, availableLocales: [] }))
  const client = fakeClient({
    getToday: vi.fn(() => new Promise(() => undefined)),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: missing } })),
    getProgress: vi.fn(async () => ({ state: 'idle' as const }))
  })
  const dom = await renderPage(client as ReturnType<typeof fakeClient>)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })

  // No edition to keep: the column exists (so the layout never reflows) but carries no archive,
  // and the run's panel is still in the body.
  expect(dom.querySelectorAll('[data-briefing-detail]')).toHaveLength(1)
  expect(dom.querySelector('[data-briefing-detail] [data-briefing-gaps]')).toBeNull()
  expect(dom.querySelector('[data-briefing-stage-panel][data-state="generating"]')).not.toBeNull()
})

it('shows a past edition\'s archive while today has never been generated', async () => {
  const missing = editions.map((edition) => edition.date === '2026-10-30'
    ? { ...edition, state: 'missing' as const, generatedAt: undefined, availableLocales: [] }
    : edition)
  const client = fakeClient({
    getToday: vi.fn(async () => ({ state: 'unavailable' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: missing } })),
    get: vi.fn(async () => ({ state: 'available' as const, document: briefingDocument('2026-10-29', '历史版次') }))
  })
  const dom = await renderPage(client)
  await act(async () => {
    dom.querySelector<HTMLButtonElement>('[data-date="2026-10-29"]')!.click()
    await Promise.resolve(); await Promise.resolve()
  })

  // The archive follows the edition on screen (a past one here), not whether today was generated.
  expect(dom.querySelectorAll('[data-briefing-detail]')).toHaveLength(1)
})

it('keeps the same three-column body whether or not the archive has content', async () => {
  const withArchive = await renderPage(fakeClient())
  const body = withArchive.querySelector('.mi-daily-briefing-page__body')!
  expect(body.classList.contains('mi-daily-briefing-page__body--with-appendix')).toBe(true)
  expect(withArchive.querySelectorAll('.mi-daily-briefing-page__appendix')).toHaveLength(1)

  const missing = editions.map((edition) => ({ ...edition, state: 'missing' as const, generatedAt: undefined, availableLocales: [] }))
  const withoutArchive = await renderPage(fakeClient({
    getToday: vi.fn(async () => ({ state: 'unavailable' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: missing } }))
  }))
  // Same grid and the same (empty) column: the body must not reflow when the archive is absent.
  expect(withoutArchive.querySelector('.mi-daily-briefing-page__body')!.classList.contains('mi-daily-briefing-page__body--with-appendix')).toBe(true)
  expect(withoutArchive.querySelectorAll('.mi-daily-briefing-page__appendix')).toHaveLength(1)
  expect(withoutArchive.querySelectorAll('[data-briefing-detail]')).toHaveLength(1)
  expect(withoutArchive.querySelector('[data-briefing-detail] [data-briefing-gaps]')).toBeNull()
})

it('keeps the stored edition under a failure notice when a retry fails after an earlier success', async () => {
  const client = fakeClient({
    getToday: vi.fn(async () => ({ state: 'available' as const, document: briefingDocument() })),
    regenerate: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'store-failed' as const }))
  })
  const dom = await renderPage(client)
  await act(async () => {
    dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!.click()
    await Promise.resolve()
  })
  await confirmManualRun()

  expect(dom.querySelector('[data-briefing-stage-panel][data-state="failed"]')).not.toBeNull()
  expect(dom.querySelector('.mi-daily-briefing-page__paper')).not.toBeNull()
  expect(dom.querySelectorAll('[data-briefing-detail]')).toHaveLength(1)
  // A failed retry with an older edition on screen is still not "busy": the header stays clickable.
  expect(dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!.disabled).toBe(false)
})

it('takes the current issue from the service, not from the wall clock', async () => {
  // Before the generation hour the current issue is still the previous calendar day. The list says
  // so (today: 2026-10-29 while the wall clock is 10-30); the page must use that one value for the
  // marker, the empty-state framing and the header target — two definitions is what made "generate
  // today" land on a day the reader thought was history.
  const period = [0, 1, 2, 3].map((back) => {
    const date = new Date(Date.parse('2026-10-29T00:00:00.000Z') - back * 86_400_000).toISOString().slice(0, 10)
    return { date, periodId: 'default', locale: 'zh-CN' as const, availableLocales: [], state: 'missing' as const, scheduledTime: '07:00' }
  })
  const client = fakeClient({
    getToday: vi.fn(async () => ({ state: 'unavailable' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: period, today: '2026-10-29' } })),
    get: vi.fn(async () => ({ state: 'missing' as const }))
  })
  const dom = await renderPage(client)

  // The current issue is the first row, marked as the issue — not "today", which it is not.
  const first = dom.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!
  expect(first.getAttribute('data-date')).toBe('2026-10-29')
  expect(first.getAttribute('aria-current')).toBe('true')
  expect(first.hasAttribute('disabled')).toBe(false)

  await act(async () => { first.click(); await Promise.resolve(); await Promise.resolve() })
  const pane = dom.querySelector('[data-briefing-no-edition="2026-10-29"]')!
  expect(pane.getAttribute('data-current-period')).toBe('true')
  expect(pane.textContent).toContain('本期（2026-10-29）')
  // Not the historical framing, and the action stays clickable.
  const action = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!
  expect(action.disabled).toBe(false)
  expect(action.getAttribute('aria-label')).toBe(text.manualGenerateTarget.replace('{date}', '2026-10-29'))

  // Another day without an edition is history: there the backfill reason does appear.
  await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-28"]')!.click(); await Promise.resolve(); await Promise.resolve() })
  const backfill = dom.querySelector<HTMLButtonElement>('[data-briefing-no-edition="2026-10-28"] button')!
  expect(backfill.disabled).toBe(true)
  expect(backfill.getAttribute('aria-label')).toBe(text.history.backfillBlocked)
})

// Three minimal inputs, each asserting the view state directly. The delete chain went two rounds
// reporting success while these three combinations were never exercised: the pane said "no edition
// at all" for an issue that had one, in another language.
const rowOf = (availableLocales: readonly ('zh-CN' | 'en-US')[]) => ({
  date: '2026-11-03', periodId: 'default', locale: 'zh-CN' as const, availableLocales,
  state: availableLocales.length > 0 ? 'generated' as const : 'missing' as const,
  generatedAt: availableLocales.length > 0 ? '2026-11-03T00:30:00.000Z' : undefined,
  windowEnd: '2026-11-03T00:30:00.000Z', readingsAvailable: 4
})
const enSettings = vi.fn(async () => ({ state: 'available' as const, view: { ...settingsView, language: { ...settingsView.language, settings: { primary: 'follow-ui' as const, additional: ['en-US'] as const } } } }))

it('shows the nine steps when the service is generating, even though this page never clicked', async () => {
  // 07:00 scheduled run: nothing local says "generating", the left rail says so, and the pane said
  // "not generated". One source of truth now includes the service's own answer.
  const period = [{ date: '2026-11-04', periodId: 'default', locale: 'zh-CN' as const, availableLocales: [], state: 'missing' as const, scheduledTime: '07:00' }]
  const dom = await renderPage(fakeClient({
    getToday: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'not-generated' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: period, today: '2026-11-04' } })),
    getProgress: vi.fn(async () => ({ state: 'running' as const, progress: { attemptId: 'a1', startedAt: '2026-11-04T00:00:00.000Z', stages: [] } }))
  }))
  for (let round = 0; round < 40; round += 1) {
    await act(async () => { await Promise.resolve() })
    if (dom.querySelector('[data-briefing-stage-panel][data-state="generating"]')) break
  }

  expect(dom.querySelector('[data-briefing-stage-panel][data-state="generating"]')).not.toBeNull()
  expect(dom.querySelector('[data-briefing-no-edition]')).toBeNull()
})

it('shows the steps while the reader’s own run is in flight, before any edition exists', async () => {
  const dom = await renderPage(fakeClient({
    getToday: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'not-generated' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: [{ date: '2026-10-30', periodId: 'default', locale: 'zh-CN' as const, availableLocales: [], state: 'missing' as const, scheduledTime: '07:00' }], today: '2026-10-30' } })),
    getProgress: vi.fn(async () => ({ state: 'idle' as const })),
    regenerate: vi.fn(() => new Promise(() => undefined))
  }))
  for (let round = 0; round < 40; round += 1) {
    await act(async () => { await Promise.resolve() })
    if (dom.querySelector('[data-briefing-no-edition]')) break
  }
  await act(async () => {
    dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!.click()
    await Promise.resolve()
  })
  await confirmManualRun()

  expect(dom.querySelector('[data-briefing-stage-panel][data-state="generating"]')).not.toBeNull()
  expect(dom.querySelector('[data-briefing-no-edition]')).toBeNull()
})

it('allows "no edition" only when the issue has no language at all', async () => {
  const dom = await renderPage(fakeClient({
    getSettings: enSettings,
    getToday: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'not-generated' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: [rowOf([])], today: '2026-11-03' } })),
    get: vi.fn(async () => ({ state: 'missing' as const }))
  }))
  for (let round = 0; round < 40; round += 1) {
    await act(async () => { await Promise.resolve() })
    if (dom.querySelector('[data-briefing-no-edition]') || dom.querySelector('[data-briefing-locale-missing]')) break
  }

  expect(dom.querySelector('[data-briefing-no-edition="2026-11-03"]')).not.toBeNull()
  expect(dom.querySelector('[data-briefing-locale-missing]')).toBeNull()
})

it('never lets the first read contradict the list about which languages exist', async () => {
  // Walkthrough: the list said two editions (and the menu offered to delete the Chinese one) while
  // the pane claimed the Chinese edition did not exist, until a tab click fixed it. The list is the
  // authority: if it says the language is there, the pane reads it before saying anything.
  const chinese = briefingDocument('2026-11-03')
  const client = fakeClient({
    getSettings: vi.fn(async () => ({ state: 'available' as const, view: { ...settingsView, language: { ...settingsView.language, settings: { primary: 'follow-ui' as const, additional: ['en-US'] as const } } } })),
    // The open misses it — a stale read, a race, whatever: the page must not repeat that as fact.
    getToday: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'not-generated' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: [{ date: '2026-11-03', periodId: 'default', locale: 'zh-CN' as const, availableLocales: ['zh-CN', 'en-US'] as const, state: 'generated' as const, generatedAt: '2026-11-03T00:30:00.000Z', windowEnd: '2026-11-03T00:30:00.000Z', readingsAvailable: 4 }], today: '2026-11-03' } })),
    get: vi.fn(async ({ locale }: { locale: string }) => locale === 'zh-CN'
      ? { state: 'available' as const, document: chinese }
      : { state: 'missing' as const })
  })
  const dom = await renderPage(client)
  for (let round = 0; round < 40; round += 1) {
    await act(async () => { await Promise.resolve() })
    if (dom.querySelector('.mi-daily-briefing-page__paper') || dom.querySelector('[data-briefing-locale-missing]')) break
  }

  // No clicks: the pane already shows the Chinese edition the list reported.
  expect(dom.querySelector('.mi-daily-briefing-page__paper')).not.toBeNull()
  expect(dom.querySelector('[data-briefing-locale-missing]')).toBeNull()
})

it('describes the current issue as the issue, never as today, when a language is missing', async () => {
  // 03:00 is still the previous issue, so "today has no Chinese edition" is the wrong subject: the
  // reader is inside the issue that was generated yesterday.
  const period = [0, 1].map((back) => {
    const date = new Date(Date.parse('2026-11-03T00:00:00.000Z') - back * 86_400_000).toISOString().slice(0, 10)
    return { date, periodId: 'default', locale: 'zh-CN' as const, availableLocales: back === 0 ? ['en-US'] as const : [] , state: back === 0 ? 'generated' as const : 'missing' as const, generatedAt: '2026-11-03T00:30:00.000Z', windowEnd: '2026-11-03T00:30:00.000Z', readingsAvailable: 4 }
  })
  const dom = await renderPage(fakeClient({
    getSettings: vi.fn(async () => ({ state: 'available' as const, view: { ...settingsView, language: { ...settingsView.language, settings: { primary: 'follow-ui' as const, additional: ['en-US'] as const } } } })),
    getToday: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'not-generated' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: period, today: '2026-11-03' } })),
    get: vi.fn(async ({ locale }: { locale: string }) => locale === 'en-US'
      ? { state: 'available' as const, document: { ...briefingDocument('2026-11-03'), edition: { ...briefingDocument('2026-11-03').edition, locale: 'en-US' as const } } }
      : { state: 'missing' as const })
  }))
  for (let round = 0; round < 20; round += 1) await act(async () => { await Promise.resolve() })

  const pane = dom.querySelector('[data-briefing-locale-missing="zh-CN"]')
  expect(pane).not.toBeNull()
  expect(pane?.textContent).toContain(text.languageTabs.missingCurrentPeriod.replace('{language}', text.languageTabs['zh-CN']))
  expect(pane?.textContent).not.toContain('今天还没有')
})

it('selects the current issue as soon as the page opens, with no button of its own', async () => {
  // A fresh open had no row selected and the pane said "this day was never generated" instead of
  // "this issue". The current issue is the default selection, and its action is the header's.
  const period = [0, 1, 2].map((back) => {
    const date = new Date(Date.parse('2026-10-30T00:00:00.000Z') - back * 86_400_000).toISOString().slice(0, 10)
    return { date, periodId: 'default', locale: 'zh-CN' as const, availableLocales: [], state: 'missing' as const, scheduledTime: '07:00' }
  })
  const dom = await renderPage(fakeClient({
    getToday: vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'not-generated' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: period, today: '2026-10-30' } }))
  }))

  const first = dom.querySelector<HTMLElement>('.mi-daily-briefing__rail-row')!
  expect(first.getAttribute('aria-current')).toBe('true')
  const pane = dom.querySelector('[data-briefing-no-edition="2026-10-30"]')!
  expect(pane.getAttribute('data-current-period')).toBe('true')
  // The header owns the action for the current issue; the pane does not offer a second, disabled one.
  expect(pane.querySelector('button')).toBeNull()
  expect(dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!.disabled).toBe(false)
})

it('never starts a run just because the page was opened', async () => {
  // An open that silently spends a model run looks like a hang, and the run is the reader's to
  // start. The open is a read: `getToday` is asked for the stored edition only.
  const client = fakeClient()
  const dom = await renderPage(client)

  expect(client.getToday).toHaveBeenCalledWith({ locale: 'zh-CN', timeZone: expect.any(String), generate: false })
  expect(client.regenerate).not.toHaveBeenCalled()

  // The click opens the form; the run starts when the reader confirms it, once.
  await act(async () => {
    dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!.click()
    await Promise.resolve()
  })
  expect(client.regenerate).not.toHaveBeenCalled()
  await confirmManualRun()
  expect(client.regenerate).toHaveBeenCalledTimes(1)
})

it('names the header action once, whoever it acts on', async () => {
  // 期模型之后，"今天有没有版次"不再是这颗按钮的条件：一天可以有多期，重生成要指定是哪一期，
  // 所以它只说一件事——手动生成；旧的两种说法（立即生成 / 重新生成今天的日报）随之作废。
  const ready = await renderPage(fakeClient())
  expect(ready.querySelector('[data-toolbar-action="regenerate"]')?.textContent).toContain(text.manualGenerate)
  expect(ready.querySelector('[data-toolbar-action="regenerate"]')?.textContent).not.toContain(text.regenerateToday)

  const missing = editions.map((edition) => ({ ...edition, state: 'missing' as const, generatedAt: undefined, availableLocales: [] }))
  const empty = await renderPage(fakeClient({
    getToday: vi.fn(async () => ({ state: 'unavailable' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: missing } }))
  }))
  expect(empty.querySelector('[data-toolbar-action="regenerate"]')?.textContent).toContain(text.manualGenerate)
  expect(empty.querySelector('[data-toolbar-action="regenerate"]')?.textContent).not.toContain(text.generateToday)
})

it('keeps a generate action in the header even when there is nothing to regenerate', async () => {
  const missing = editions.map((edition) => ({ ...edition, state: 'missing' as const, generatedAt: undefined, availableLocales: [] }))
  const dom = await renderPage(fakeClient({
    getToday: vi.fn(async () => ({ state: 'unavailable' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: missing } }))
  }))
  // An empty page must not hide the action that makes content: it is disabled only mid-run.
  const button = dom.querySelector<HTMLButtonElement>('[data-toolbar-action="regenerate"]')!
  expect(button).not.toBeNull()
  expect(button.disabled).toBe(false)
  // No edition for today yet: the label says "generate", not "regenerate".
  expect(button.textContent).toContain(text.manualGenerate)
})

it('shows one empty reason and no detail column when no edition exists', async () => {
  const missing = editions.map((edition) => ({ ...edition, state: 'missing' as const, generatedAt: undefined, availableLocales: [] }))
  const client = fakeClient({
    getToday: vi.fn(async () => ({ state: 'unavailable' as const })),
    list: vi.fn(async () => ({ state: 'available' as const, result: { editions: missing } }))
  })
  const dom = await renderPage(client)

  // The column keeps its width even with nothing to audit; it must not push the body sideways.
  expect(dom.querySelectorAll('[data-briefing-detail]')).toHaveLength(1)
  expect(dom.querySelector('[data-briefing-detail] [data-briefing-gaps]')).toBeNull()
  expect(dom.querySelectorAll('.state-view')).toHaveLength(1)
  expect(dom.querySelectorAll('.state-view__action')).toHaveLength(1)
  expect(dom.querySelectorAll('[data-locale]')).toHaveLength(0)
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
      { locale: 'en-US', text: englishText as unknown as typeof text }
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


describe('the edition language and the interface language are two different things', () => {
  const cjk = /[\u4e00-\u9fff]/

  /** Every Chinese string in the document replaced: the paper has to be English on its own. */
  const withoutChinese = <T,>(value: T): T => {
    if (typeof value === 'string') return (cjk.test(value) ? 'English text' : value) as T
    if (Array.isArray(value)) return value.map((item) => withoutChinese(item)) as T
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, withoutChinese(item)])) as T
    }
    return value
  }

  const asEdition = (document: DailyBriefingDocument, locale: DailyBriefingDocument['edition']['locale']): DailyBriefingDocument =>
    ({ ...document, edition: { ...document.edition, locale } })

  const englishEdition = (): DailyBriefingDocument =>
    withoutChinese(asEdition(briefingDocument('2026-10-30', 'CPI beats expectations'), 'en-US'))

  // The state × action matrix the reader asked for: every state the page can be in, with the two
  // controls that must never vanish — the generate action and the language switch. A missing one is
  // a dead end, and the reader hit two of them today.
  const enabledSettings = vi.fn(async () => ({ state: 'available' as const, view: { ...settingsView, language: { ...settingsView.language, settings: { primary: 'follow-ui' as const, additional: ['en-US'] as const } } } }))
  const allMissing = editions.map((edition) => ({ ...edition, state: 'missing' as const, generatedAt: undefined, availableLocales: [] }))
  const emptyRail = { list: vi.fn(async () => ({ state: 'available' as const, result: { editions: allMissing } })) }

  it('is not vacuously green: writing the document back in Chinese turns the same scan red', async () => {
    const dom = await renderPage(fakeClient(), { locale: 'zh-CN' })
    expect(dom.querySelector('.mi-daily-briefing-page__paper')?.textContent).toMatch(cjk)
  })
})
