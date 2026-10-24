// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { CryptoIntelligenceDashboard } from './CryptoIntelligenceDashboard'
import { MarketAnalysisDashboardLayout } from './MarketAnalysisDashboardLayout'

const portal = productText['zh-CN'].pages.intelligence.portal
const asOf = '2026-10-07T09:06:14.792Z'
const conclusion = '方向：偏多：ETF 连续流入，资金面转强。'
let root: Root | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const never = async () => ({ state: 'unavailable' })
/** The dashboard needs every panel client; only the timeline IPC matters here. */
const dashboardProps = {
  text: portal.dashboard,
  calendarText: portal.calendar,
  client: { queryMonth: never } as never,
  fearGreedClient: { querySnapshot: never } as never,
  fundingRateClient: { query: never } as never,
  now: () => new Date(asOf),
  onBack: () => {},
  onConfigureSources: () => {},
  onManageSource: () => {},
  onOpenCalendar: () => {}
}

describe('dashboard conclusion slot', () => {
  it('hands a card row\'s calendar jump on with the event, not only the month', () => {
    // Both arguments are strings, so the compiler cannot tell them apart; the order is what the
    // calendar page consumes as `openTarget.eventKey`, so it is pinned here rather than assumed.
    const source = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/MarketAnalysisDashboardLayout.tsx'), 'utf8')
    expect(source).toContain('onOpenEventInCalendar={(eventKey, month) => onOpenCalendar(month, eventKey)}')
  })

  it('mounts the latest conclusion card in its dashboard slot', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return {
        schemaVersion: 1, nextCursor: null,
        items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: conclusion, version: 4 }]
      }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      if (method === 'marketAnalysis.getAnalysisRun') return { id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null, queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 2, change: null }
      if (method === 'marketAnalysis.getSummary') return {
        id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 4, eventAssessment: conclusion,
        knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [], scenarios: [],
        nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-1'], createdAt: asOf
      }
      return []
    })
    vi.stubGlobal('platform', { products: { invoke }, agents: { getState: async () => ({ agents: [], sessions: [], messagesBySessionId: {} }), onStateChanged: () => () => {} } })

    // Mirrors index.tsx: the layout injects its mount point into the dashboard child.
    function Surface(): React.ReactElement {
      return createElement(MarketAnalysisDashboardLayout, { text: portal },
        createElement(CryptoIntelligenceDashboard, { ...dashboardProps } as never))
    }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Surface)))
    await act(async () => {})

    // The right column is the news sentiment card now; the analysis timeline lives in a drawer
    // opened from the conclusion card.
    expect(container.querySelector('[data-news-sentiment-card]')).not.toBeNull()
    expect(document.querySelectorAll('.mi-analysis-timeline__entry').length).toBe(0)
    // The workspace must not run a second, unused timeline reader when the
    // dashboard layout already owns one.
    expect(invoke.mock.calls.filter(call => call[1] === 'marketAnalysis.listTimeline')).toHaveLength(1)
    const slot = container.querySelector('[data-dashboard-conclusion-slot]')
    const card = container.querySelector('.mi-analysis-conclusion-card')
    expect(slot).not.toBeNull()
    // Portalled card, but still inside the dashboard's slot in DOM order.
    expect(slot?.querySelector('.mi-analysis-conclusion-card')).toBe(card)
    expect(container.querySelector('.mi-analysis-conclusion-card__conclusion')?.textContent).toContain('ETF 连续流入，资金面转强。')
    expect(container.querySelector('.mi-analysis-conclusion__direction')?.textContent).toBe('偏多')
    // The macro release strip used to sit above this slot; with it removed the slot follows the
    // dashboard header, which is what keeps the card in the same place on screen.
    const header = container.querySelector('.mi-crypto-dashboard__header')
    expect(header && slot && (header.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)

    const timelineButton = [...container.querySelectorAll('button')].find((button) => button.textContent === portal.analysisDrawer.open)
    expect(timelineButton).toBeTruthy()
    await act(async () => { timelineButton?.click() })
    await act(async () => {})
    expect(document.querySelectorAll('.mi-analysis-timeline__entry').length).toBeGreaterThan(0)
  })

  it('shows the verdict and the operation directions on the card, and nothing the reader kept for the drawer', async () => {
    // The reader asked for 本次变化/因果链 without opening the drawer, for the direction rows to wear
    // the same pill as the conclusion, and for a `low` confidence not to clutter the card.
    const body = '方向：偏空：现货买盘转弱。本次变化：ETF 净流入由 +1.2 亿转为 -6.5 亿。因果链：资金流出 → 现货需求下降 → 偏空。'
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return {
        schemaVersion: 1, nextCursor: null,
        items: [{ id: 'mi-tl-2', eventGroupId: 'mi-eg-2', analysisRunId: 'mi-ar-2', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-2', safeTitle: '市场分析已生成', safeExcerpt: body, version: 1 }]
      }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      if (method === 'marketAnalysis.getAnalysisRun') return { id: 'mi-ar-2', eventGroupId: 'mi-eg-2', analysisPhase: 'correction', status: 'succeeded', failureCode: null, queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 2, change: null }
      if (method === 'marketAnalysis.getSummary') return {
        id: 'mi-as-2', schemaVersion: 1, analysisRunId: 'mi-ar-2', eventGroupId: 'mi-eg-2', version: 1, eventAssessment: body,
        knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [], scenarios: [],
        directions: [
          { horizon: 'short', direction: '偏空', rationale: '资金流出。', confidence: 'medium', evidenceRefIds: ['ev-1'] },
          { horizon: 'long', direction: '震荡', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['ev-1'] }
        ],
        nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-1'], createdAt: asOf
      }
      return []
    })
    vi.stubGlobal('platform', { products: { invoke }, agents: { getState: async () => ({ agents: [], sessions: [], messagesBySessionId: {} }), onStateChanged: () => () => {} } })

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(MarketAnalysisDashboardLayout, { text: portal },
      createElement(CryptoIntelligenceDashboard, { ...dashboardProps } as never))))
    await act(async () => {})

    const card = container.querySelector('.mi-analysis-conclusion-card')!
    // Verdict only: the labelled parts belong to the drawer, one click away.
    const conclusion = card.querySelector('.mi-analysis-conclusion-card__conclusion')
    expect(conclusion?.textContent).toContain('现货买盘转弱。')
    expect(conclusion?.textContent).not.toContain('本次变化')
    expect(conclusion?.textContent).not.toContain('因果链')
    expect(card.querySelector('[data-block="change"]')).toBeNull()
    // A direction the model itself rates low is not shown at all; the medium one still is.
    const rows = card.querySelectorAll('.mi-analysis-directions li')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.querySelector('.mi-analysis-conclusion__direction')?.textContent).toBe('偏空')
    expect(rows[0]?.textContent).toContain('置信度中')
    expect(card.querySelector('.mi-analysis-directions')?.textContent).not.toContain('长期证据不足。')
  })
})
