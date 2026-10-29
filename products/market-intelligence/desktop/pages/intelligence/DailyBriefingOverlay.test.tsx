// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { DailyBriefingOverlay } from './DailyBriefingOverlay'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

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
    conditions: ['Stablecoins keep contracting'],
    invalidations: [{ asset: 'BTC', horizonEnd: `${date}T00:00:00.000Z`, text: 'Stablecoins turn positive.' }],
    counterEvidence: [{ statement: 'BTC ETF took in $110M.', citations: [1] }],
    topSignal: { horizon: 'medium', direction: 'bearish', confidence: 'medium', rationale: 'ETF flows confirm.', citations: [1] },
    dataGaps: ['No consensus'], caveats: ['Funding is venue-specific.']
  },
  next: { items: [{ eventKey: 'US.FOMC', title: 'fomc', titleKey: 'fomc', at: `${date}T18:00:00.000Z`, importance: 'high', category: 'central-bank-activity' }] },
  citations: [{ index: 1, refId: 'ev-1' }],
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
    get: vi.fn(async ({ date }: { date: string }) => date === '2026-10-29'
      ? { state: 'available' as const, document: briefingDocument('2026-10-29', '历史版次') }
      : { state: 'missing' as const }),
    ...overrides
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

async function renderOverlay(client: ReturnType<typeof fakeClient>, onClose = vi.fn(), onConfigureSources?: () => void): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<DailyBriefingOverlay open locale="zh-CN" text={text} eventTitles={{ cpi: 'CPI', fomc: 'FOMC' }} onClose={onClose} {...(onConfigureSources ? { onConfigureSources } : {})} client={client} />)
  })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return container
}

describe('daily briefing overlay', () => {
  it('renders today, the 14-day rail, and closes from the close button or Escape', async () => {
    const onClose = vi.fn()
    const dom = await renderOverlay(fakeClient(), onClose)
    expect(dom.textContent).toContain('每日简报')
    expect(dom.textContent).toContain('CPI 超预期')
    expect(dom.querySelectorAll('[data-date]')).toHaveLength(14)
    expect(dom.querySelector('[data-date="2026-10-30"]')?.getAttribute('aria-current')).toBe('true')
    expect(dom.querySelector('[data-date="2026-10-30"]')?.textContent).toContain(text.history.today)
    expect(dom.querySelector('[data-date="2026-10-28"]')?.hasAttribute('disabled')).toBe(true)

    act(() => dom.querySelector<HTMLButtonElement>('.mi-daily-briefing__close')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('loads a historical edition read-only and leaves a missing day disabled', async () => {
    const client = fakeClient()
    const dom = await renderOverlay(client)
    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-29"]')!.click() })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(client.get).toHaveBeenCalledWith({ date: '2026-10-29', locale: 'zh-CN' })
    expect(dom.textContent).toContain('历史版次')
    expect(dom.textContent).toContain(text.history.readOnly)
    expect(dom.querySelector('[data-date="2026-10-29"]')?.getAttribute('aria-current')).toBe('true')

    await act(async () => { dom.querySelector<HTMLButtonElement>('[data-date="2026-10-28"]')!.click() })
    expect(client.get).toHaveBeenCalledTimes(1)
  })

  it('guides a clean install to the sources when every reading is missing', async () => {
    const onConfigureSources = vi.fn()
    const dom = await renderOverlay(fakeClient({
      getToday: vi.fn(async () => ({ state: 'available' as const, document: emptyDocument() }))
    }), vi.fn(), onConfigureSources)
    expect(dom.textContent).toContain(text.emptyGuide)
    const configure = [...dom.querySelectorAll('button')].find((button) => button.textContent === text.configureSources)!
    act(() => configure.click())
    expect(onConfigureSources).toHaveBeenCalledTimes(1)
  })

  it('shows an unavailable state and retries without crashing', async () => {
    const getToday = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ state: 'available' as const, document: briefingDocument() })
    const client = fakeClient({ getToday })
    const dom = await renderOverlay(client)
    expect(dom.textContent).toContain(text.unavailable)
    const retry = [...dom.querySelectorAll('button')].find((button) => button.textContent === text.retry)!
    await act(async () => { retry.click(); await Promise.resolve(); await Promise.resolve() })
    expect(getToday).toHaveBeenCalledTimes(2)
    expect(dom.textContent).toContain('每日简报')
  })
})
