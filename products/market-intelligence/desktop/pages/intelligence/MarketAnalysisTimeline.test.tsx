import { analysisTimelineRefreshPolicy } from './analysisTimelineRefreshPolicy'
import { isAlreadyAvailableError } from './useMarketAnalysisTimeline'
import { marketAnalysisTimelineClient } from '../../shared/ipc/marketAnalysisTimelineClient'
// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { MarketAnalysisTimeline } from './MarketAnalysisTimeline'
import { useMarketAnalysisTimeline, type AnalysisSelectionState } from './useMarketAnalysisTimeline'
import type { AnalysisWorkspaceBinding } from '../../../contracts/analysisWorkspaceContracts'

const asOf = '2026-09-28T00:00:00.000Z'

/** Waits for the settings read the panel performs on mount to reach the DOM. */
async function flushReads(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const text = productText['zh-CN'].pages.intelligence.portal.analysisTimeline
let root: Root | undefined

/**
 * The list is presentational: data and selection come from the workspace hook,
 * exactly as the dashboard layout wires them.
 */
function Timeline({ text: timelineText, onSelect, onSelectionStateChange, onBack, policy }: {
  text: typeof text
  onBack?: () => void
  onSelect?: (binding: AnalysisWorkspaceBinding | undefined) => void
  onSelectionStateChange?: (state: AnalysisSelectionState) => void
  policy?: Parameters<typeof useMarketAnalysisTimeline>[0]['policy']
}): React.ReactElement {
  const timeline = useMarketAnalysisTimeline({ text: timelineText, onSelect, onSelectionStateChange, ...(policy ? { policy } : {}) })
  return createElement(MarketAnalysisTimeline, { text: timelineText, timeline, onBack })
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('MarketAnalysisTimeline', () => {
  it('shows a persisted analysis failure and permits an explicit retry after refresh', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-failed', status: 'invalid-output', failureCode: 'analysis-invalid-output-schema', queuedAt: asOf, evidenceCount: 0 }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    expect(container.textContent).toContain('模型输出格式不符合要求')
    expect(container.textContent).toContain('mi-ar-failed')
    // The empty state's persisted failure wears the same banner as a live one.
    expect(container.querySelector('[data-analysis-error]')?.textContent).toContain('mi-ar-failed')
    const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '重试分析')
    expect(retry?.disabled).toBe(false)
    await act(async () => retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.requestInitialAnalysis', { retryRunId: 'mi-ar-failed' })
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === '重试分析')?.disabled).toBe(false)
  })
  it('loads the actual product IPC timeline and opens safe summary and prediction detail', async () => {
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return {
        schemaVersion: 1,
        items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '市场情绪偏谨慎', version: 1, triggerStatus: null }],
        nextCursor: null
      }
      if (method === 'marketAnalysis.getAnalysisRun') return {
        id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null,
        queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 2, change: null
      }
      if (method === 'marketAnalysis.getSummary') return {
        id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1, eventAssessment: '市场情绪偏谨慎',
        knownFacts: [{ factId: 'fact-1', statement: '恐惧贪婪指数处于高位。', evidenceRefIds: ['ev-1'] }],
        transmissionHypotheses: [{ statement: '风险偏好可能影响短期波动。', evidenceRefIds: ['ev-1'] }],
        marketReaction: [], supportingEvidence: [{ statement: '情绪指数来源可追溯。', evidenceRefId: 'ev-1' }], counterEvidence: [], scenarios: [],
        nextCatalysts: [{ statement: '等待新的可比行情数据。', evidenceRefIds: ['ev-1'] }], dataCaveats: ['资金费率不可比'], evidenceRefs: ['ev-1', 'ev-2'], createdAt: asOf
      }
      return [{ id: 'mi-pr-1', summaryId: 'mi-as-1', asset: 'BTC', horizonStart: asOf, horizonEnd: '2026-09-28T01:00:00.000Z', baseCase: '震荡', conditions: ['区间不破'], invalidation: '跌破支撑', nextCatalyst: null, status: 'pending', verificationDueAt: '2026-09-28T01:00:00.000Z', createdAt: asOf }]
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const onSelect = vi.fn()
    await act(async () => root?.render(createElement(Timeline, { text, onSelect })))
    await act(async () => container.querySelector<HTMLButtonElement>('.mi-analysis-timeline__entry')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(container.textContent).toContain(text.title)
    // The list owns navigation only: the node detail is surfaced by the
    // main-area drawer, and selecting a node reports its safe binding.
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', summaryId: 'mi-as-1' }))
    expect(container.querySelector('.mi-analysis-timeline__detail')).toBeNull()
    expect(productCalls(invoke)).toHaveLength(4)
  })

  it('shows the complete published AI conclusion instead of a stored preview truncation', async () => {
    const completeConclusion = `${'宏观数据已发布，资本流向与价格反应需要结合后续证据判断。'.repeat(12)}结论仍需观察。`
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return {
        schemaVersion: 1,
        items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: completeConclusion, version: 1, triggerStatus: null }],
        nextCursor: null
      }
      if (method === 'marketAnalysis.getAnalysisRun') return {
        id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null,
        queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 2, change: null
      }
      if (method === 'marketAnalysis.getSummary') return {
        id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1, eventAssessment: completeConclusion,
        knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [], scenarios: [],
        nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-1'], createdAt: asOf
      }
      return []
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const onSelect = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text, onSelect })))
    await act(async () => container.querySelector<HTMLButtonElement>('.mi-analysis-timeline__entry')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    // The card excerpt already carries the restored conclusion; the list must
    // never shorten it and must report the node instead of rendering the detail.
    // New row contract: the row shows the conclusion itself (no stored-preview truncation, no
    // labelled parts). The change list and the causal chain belong to the drawer this row opens.
    const line = container.querySelector('.mi-analysis-timeline__conclusion-line')?.textContent ?? ''
    expect(line).toContain('宏观数据已发布，资本流向与价格反应需要结合后续证据判断。')
    expect(line).toContain('结论仍需观察。')
    expect(line).not.toContain('本次变化')
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ summaryId: 'mi-as-1' }))
  })

  it('shows the Chinese empty state when no analysis has been published', async () => {
    vi.stubGlobal('platform', { products: { invoke: vi.fn(async () => ({ schemaVersion: 1, items: [], nextCursor: null })) } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { onBack: vi.fn(), text })))
    expect(container.textContent).toContain(text.empty)
  })

  it('offers a controlled first-analysis action from the empty state', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => method === 'marketAnalysis.listTimeline'
      ? { schemaVersion: 1, items: [], nextCursor: null }
      : { itemId: 'item-1', queued: true })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { onBack: vi.fn(), text })))
    const request = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.requestInitialAnalysis)
    expect(request).toBeDefined()
    await act(async () => request?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain(text.initialAnalysisQueued)
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.requestInitialAnalysis', {})
  })

  it('keeps the first read in its loading state until the retry budget is spent, then says it failed', async () => {
    // A transient startup failure must not be painted as a failure: the bounded retry is the
    // endpoint, and the empty list is never allowed to stand in for "could not read".
    const policy = { ...analysisTimelineRefreshPolicy, initialRetryAttempts: 2, initialRetryDelayMs: 40, initialRetryMaxDelayMs: 40 }
    vi.stubGlobal('platform', { products: { invoke: vi.fn(async () => { throw Error('private failure') }) } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { onBack: vi.fn(), text, policy })))
    await flushReads()

    // Nothing applied yet: no error surface, and no empty state pretending the list is empty.
    expect(container.querySelector('[data-state="error"]')).toBeNull()
    expect(container.querySelector('.mi-analysis-timeline__list')?.textContent ?? '').not.toContain(text.empty)

    // The budget runs out, and only now does the failure become visible — 判据是统一错误面本身，
    // 不是某一句话：那句「读不到」的措辞会随产品口径改，而「有没有出口」不会。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); await Promise.resolve() })
    expect(container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(container.textContent).not.toContain('private failure')
  })

  it('never shows a failure when the first read heals on its own', async () => {
    const policy = { ...analysisTimelineRefreshPolicy, initialRetryAttempts: 4, initialRetryDelayMs: 40, initialRetryMaxDelayMs: 40 }
    let reads = 0
    vi.stubGlobal('platform', { products: { invoke: vi.fn(async (_product: string, method: string) => {
      if (method !== 'marketAnalysis.listTimeline') return null
      reads += 1
      if (reads === 1) throw Error('transient')
      return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: null, kind: 'system', status: 'published', occurredAt: asOf, summaryRef: null, safeTitle: '恢复后的节点', safeExcerpt: '恢复后的摘要', version: 1, triggerStatus: null }], nextCursor: null }
    }) } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { onBack: vi.fn(), text, policy })))
    await flushReads()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); await Promise.resolve() })

    expect(container.textContent).not.toContain(text.unavailable)
    expect(container.textContent).toContain('恢复后的摘要')
  })

  it('continues the timeline with the opaque next cursor', async () => {
    const invoke = vi.fn(async (_product: string, _method: string, input: { cursor?: string }) => ({
      schemaVersion: 1, nextCursor: input.cursor ? null : 'opaque-next', items: [{
        id: input.cursor ? 'mi-tl-2' : 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: null,
        kind: 'system', status: 'published', occurredAt: asOf, summaryRef: null,
        safeTitle: input.cursor ? '第二页节点' : '第一页节点', safeExcerpt: input.cursor ? '第二页摘要' : '第一页摘要', version: 1, triggerStatus: null
      }]
    }))
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { onBack: vi.fn(), text })))
    const more = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '加载更多')
    expect(more).toBeDefined()
    await act(async () => more?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    // Rows no longer show the generated title or the summary version; the excerpt identifies one.
    expect(container.textContent).toContain('第一页摘要')
    expect(container.textContent).toContain('第二页摘要')
    expect(invoke).toHaveBeenLastCalledWith('market-intelligence', 'marketAnalysis.listTimeline', { cursor: 'opaque-next' })
  })

  it('offers an explicit refresh when a published analysis already exists', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => method === 'marketAnalysis.listTimeline'
      ? { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      : { itemId: 'item-1', queued: true })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    expect(refresh).toBeDefined()
    expect(refresh?.querySelector('.loading-spinner')).toBeNull()
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.requestInitialAnalysis', { mode: 'refresh' })
    // The button keeps its label while the run is queued (the label is the action, not a status)
    // and stops accepting clicks until the run settles. The standard ring shows for the whole run,
    // not only for the short request call.
    const queuedButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    expect(queuedButton?.disabled).toBe(true)
    expect(queuedButton?.querySelector('.loading-spinner')).not.toBeNull()
  })

  it('offers the header refresh on a sentiment group too, because the click now runs a market analysis', async () => {
    // 2026-11-20：手动入口已改成永远走市场线（不再分流到新闻解读），
    // 「消息面组的重跑产出落在新闻抽屉」这个前提不再成立，按组类别藏按钮等于藏一个安全入口。
    const invoke = vi.fn(async (_product: string, method: string) => method === 'marketAnalysis.listTimeline'
      ? { schemaVersion: 1, items: [{ id: 'mi-tl-sent', eventGroupId: 'mi-eg-sent', analysisRunId: 'mi-ar-sent', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-sent', safeTitle: '解读已生成', safeExcerpt: '摘要', version: 1, triggerStatus: null, groupType: 'sentiment', groupSubject: 'Binance 公告' }], nextCursor: null }
      : { itemId: 'item-1', queued: true })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    expect(refresh).toBeDefined()
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.requestInitialAnalysis', { mode: 'refresh' })
  })

  it('replaces the queued refresh state when the new correction timeline node is published', async () => {
    let timelineReads = 0
    let attemptReads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') {
        timelineReads += 1
        return {
          schemaVersion: 1,
          items: [{ id: timelineReads > 1 ? 'mi-tl-2' : 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: timelineReads > 1 ? 'mi-ar-refresh' : 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: timelineReads > 1 ? 'mi-as-2' : 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: timelineReads > 1 ? '新摘要' : '旧摘要', version: timelineReads > 1 ? 2 : 1, triggerStatus: null }],
          nextCursor: null
        }
      }
      if (method === 'marketAnalysis.getLatestAttempt') {
        attemptReads += 1
        return { id: 'mi-ar-refresh', status: attemptReads > 1 ? 'succeeded' : 'running', failureCode: null, queuedAt: asOf, evidenceCount: 2 }
      }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain('新摘要')
    expect(container.textContent).not.toContain(text.analysisRefreshFailed)
  })

  it('keeps the failure reason when a background read refreshes the list', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-failed', status: 'invalid-output', failureCode: 'analysis-missing-evidence', queuedAt: asOf, evidenceCount: 2 }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain(text.failureReasons['analysis-missing-evidence'])
    // The recorded reason is the banner's second line, under the sentence that names the failure.
    const banner = container.querySelector('[data-analysis-error]')
    expect(banner?.querySelector('strong')?.textContent).toBe(text.attemptFailed)
    expect(banner?.querySelector('[data-analysis-error-detail]')?.textContent).toBe(text.failureReasons['analysis-missing-evidence'])

    // The 60s background poll reads the page without the attempt. It used to clear the known
    // attempt, which left "重新分析未发布" on screen with no reason at all.
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(container.textContent).toContain(text.failureReasons['analysis-missing-evidence'])
  })

  it('keeps waiting while the run itself repairs a rejected answer, without re-enqueuing', async () => {
    // The repair attempt lives in the analysis orchestrator: the same run goes back to the model
    // against the same snapshot, so the panel must not spend a second request of its own.
    let refreshRequests = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') {
        return { id: 'mi-ar-1', status: 'running', failureCode: null, queuedAt: asOf, evidenceCount: 2 }
      }
      if (method === 'marketAnalysis.requestInitialAnalysis') {
        refreshRequests += 1
        return { itemId: 'item-1', queued: true }
      }
      if (method === 'marketAnalysis.getSettings') return { enabled: true, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
      return undefined
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    // Still queued, still spinning: the repair is not a failure the reader has to act on.
    const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === text.refreshAnalysis)
    expect(button?.disabled).toBe(true)
    expect(container.querySelector('[data-analysis-error]')).toBeNull()
    expect(invoke.mock.calls.filter(([, method]) => method === 'marketAnalysis.requestInitialAnalysis')).toHaveLength(1)
    expect(refreshRequests).toBe(1)
  })

  it('does not retry a refusal before a run exists', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      if (method === 'marketAnalysis.requestInitialAnalysis') throw new Error('analysis-provider-error')
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const banner = container.querySelector('[data-analysis-error]')
    expect(banner?.querySelector('strong')?.textContent).toBe(text.analysisRefreshFailed)
    expect(invoke.mock.calls.filter(([, method]) => method === 'marketAnalysis.requestInitialAnalysis')).toHaveLength(1)
  })

  it('does not reuse the previous run reason for a refused click', async () => {
    let refreshRequests = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-failed', status: 'invalid-output', failureCode: 'analysis-invalid-output-schema', queuedAt: asOf, evidenceCount: 2 }
      if (method === 'marketAnalysis.getSettings') return { enabled: true, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
      refreshRequests += 1
      // The first refresh is queued and then rejected; the second click fails before any run.
      if (refreshRequests === 1) return { itemId: 'item-1', queued: true }
      throw new Error('analysis-provider-error')
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = (): HTMLButtonElement | undefined => Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis) as HTMLButtonElement | undefined

    await act(async () => refresh()?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    // The rejected run shows its reason.
    expect(container.querySelector('[data-analysis-error] strong')?.textContent).toBe(text.attemptFailed)
    expect(container.querySelector('[data-analysis-error-detail]')?.textContent).toBe(text.failureReasons['analysis-invalid-output-schema'])

    await act(async () => refresh()?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    // This click never reached a run, so the old run's reason must not be shown under it.
    expect(container.querySelector('[data-analysis-error] strong')?.textContent).toBe(text.analysisRefreshFailed)
    expect(container.querySelector('[data-analysis-error-detail]')).toBeNull()
  })

  it('says the analysis is still running when the bounded wait ends, and releases the action', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-1', status: 'running', failureCode: null, queuedAt: asOf, evidenceCount: 2 }
      if (method === 'marketAnalysis.getSettings') return { enabled: true, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    // Two ticks instead of the production 660: the same cap path, in milliseconds.
    const policy = { ...analysisTimelineRefreshPolicy, maxPollAttempts: 2, pollIntervalMs: 5 }
    await act(async () => root?.render(createElement(Timeline, { text, policy })))
    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })

    expect(container.textContent).toContain(text.analysisStillRunning)
    expect(container.querySelector('[data-analysis-error]')).toBeNull()
    const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === text.refreshAnalysis)
    expect(button?.disabled).toBe(false)
  })

  it('releases the refresh action when the follow-up read fails instead of spinning forever', async () => {
    let timelineReads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') {
        timelineReads += 1
        // The first read is the mounted list; the poll's read fails.
        if (timelineReads > 1) throw new Error('read failed')
        return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      }
      if (method === 'marketAnalysis.getSettings') return { enabled: true, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    // `queued` here was a dead state: no poll was left to clear it, so the button stayed disabled.
    const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent === text.refreshAnalysis)
    expect(button?.disabled).toBe(false)
    expect(container.querySelector('[data-analysis-error]')).toBeNull()
  })

  it('never lets the bounded poll join a background read that does not fetch the attempt', async () => {
    let releaseBackgroundRead: (() => void) | undefined
    let timelineReads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') {
        timelineReads += 1
        // The second read is the background one, held open across the click below.
        if (timelineReads === 2) await new Promise<void>(resolve => { releaseBackgroundRead = resolve })
        return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      }
      if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-failed', status: 'invalid-output', failureCode: 'analysis-missing-evidence', queuedAt: asOf, evidenceCount: 2 }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    await act(async () => { window.dispatchEvent(new Event('focus')) })

    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

    // Joined to the background read the poll would never see the terminal failure: it reported the
    // refresh as unpublishable while the run had in fact already finished.
    expect(container.textContent).toContain(text.failureReasons['analysis-missing-evidence'])
    await act(async () => { releaseBackgroundRead?.() })
  })

  it('restores the refresh action and shows a failure when enqueueing fails', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      throw new Error('analysis-provider-error')
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain(text.analysisRefreshFailed)
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)?.disabled).toBe(false)
  })

  // The failure used to be one more muted status line, indistinguishable from "loading…" and
  // "already available". It is an error: announced, red, and dismissible.
  it('announces a failed request as a dismissible error banner', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      throw new Error('analysis-provider-error')
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)
    await act(async () => refresh?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const banner = container.querySelector('[data-analysis-error]')
    expect(banner?.getAttribute('role')).toBe('alert')
    expect(banner?.textContent).toContain(text.analysisRefreshFailed)
    // The request never reached a run, so there is no recorded reason and none is invented.
    expect(banner?.querySelector('[data-analysis-error-detail]')).toBeNull()

    const dismiss = container.querySelector('[data-analysis-error-dismiss]')
    expect(dismiss?.getAttribute('aria-label')).toBe(text.dismissError)
    await act(async () => dismiss?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('[data-analysis-error]')).toBeNull()
    // Putting the message away does not put the action away.
    expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis)?.disabled).toBe(false)
  })

  it('shows the banner again for a later failure the reader has not dismissed', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{ id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '旧摘要', version: 1, triggerStatus: null }], nextCursor: null }
      throw new Error('analysis-provider-error')
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const refresh = (): HTMLButtonElement | undefined => Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.refreshAnalysis) as HTMLButtonElement | undefined
    await act(async () => refresh()?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => container.querySelector('[data-analysis-error-dismiss]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('[data-analysis-error]')).toBeNull()

    await act(async () => refresh()?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('[data-analysis-error]')).not.toBeNull()
  })

  it('masks the module while AI analysis is off and starts it from the mask', async () => {
    let enabled = false
    const invoke = vi.fn(async (_product: string, method: string, payload?: { enabled?: boolean }) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      if (method === 'marketAnalysis.getSettings') return { enabled, providerId: '', modelId: '', updatedAt: asOf }
      if (method === 'marketAnalysis.saveSettings') {
        enabled = payload?.enabled ?? enabled
        return { enabled, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
      }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke }, modelProviders: { list: vi.fn(async () => []) } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    await flushReads()

    // Off by default: the content still says what history exists, but it cannot be interacted with.
    const mask = container.querySelector('.mi-analysis-timeline__mask')
    expect(mask).not.toBeNull()
    expect(container.querySelector('.mi-analysis-timeline__workspace')?.getAttribute('aria-hidden')).toBe('true')
    // The mask covers the whole module, the title row included: the header is under it and out of
    // the accessibility tree while the capability is off.
    expect(container.querySelector('.mi-analysis-timeline__header')?.getAttribute('aria-hidden')).toBe('true')
    expect(mask?.parentElement?.classList.contains('mi-analysis-timeline')).toBe(true)
    // One action only: the header already carries "设置", so the mask does not repeat it.
    expect(mask?.querySelectorAll('button')).toHaveLength(1)

    const enable = Array.from(mask?.querySelectorAll('button') ?? []).find(button => labelled(button, text.enableAnalysis))
    await act(async () => enable?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushReads()
    // It opens the settings dialog on the stored state — off — rather than switching it on behind
    // the reader's back; opening the dialog must not claim a change that was never saved.
    expect(invoke).not.toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.saveSettings', expect.anything())
    expect(document.body.textContent).toContain(text.settingsTitle)
    const dialogSwitch = document.querySelector('.ant-switch')
    expect(dialogSwitch?.getAttribute('aria-checked')).toBe('false')
    await act(async () => dialogSwitch?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushReads()

    const save = Array.from(document.querySelectorAll('button')).find(button => labelled(button, text.save))
    await act(async () => save?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushReads()
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.saveSettings', { enabled: true, providerId: '', modelId: '' })
    expect(container.querySelector('.mi-analysis-timeline__mask')).toBeNull()
  })

  it('shows a stored model that is the platform default as following the default', async () => {
    const provider = {
      id: 'provider-1', name: 'TokenRhythm',
      endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://example.test' }],
      enabled: true, baseUrl: 'https://example.test', hasApiKey: true, apiKeyPreview: 'sk-**********test', isSystem: false,
      models: [{ id: 'model-1', name: 'deepseek-v4.1-flash-1017', capabilities: { chat: true } }]
    }
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      if (method === 'marketAnalysis.getSettings') return { enabled: true, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', {
      products: { invoke },
      modelProviders: { list: vi.fn(async () => [provider]) },
      settings: { get: vi.fn(async () => ({ modelDefaults: { assistantModelId: 'provider-1:model-1' } })) }
    })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    await flushReads()

    const settings = Array.from(container.querySelectorAll('button')).find(button => labelled(button, text.settings))
    expect(settings).toBeDefined()
    await act(async () => settings?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushReads()

    // The reader followed the platform default, so the picker says so instead of printing the
    // snapshot it happens to equal. The raw "modelIdproviderId" trigger only appears when the
    // candidates cannot be resolved.
    expect(document.body.textContent).toContain(`${text.followsDefaultPrefix}TokenRhythm / deepseek-v4.1-flash-1017`)
    expect(document.body.textContent).not.toContain('model-1provider-1')
  })

  it('hands the settings entry to the host instead of opening a second dialog', async () => {
    // C9：同一个设置面只许一份草稿。宿主给了入口，这一屏就不再挂自己的对话框——
    // 否则页面上的按钮和抽屉里那条「去设置改」会各开一份，保存互相覆盖。
    vi.stubGlobal('platform', { products: { invoke: vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return undefined
    }) }, modelProviders: { list: vi.fn(async () => []) } })
    const onOpenSettings = vi.fn()
    const timeline = {
      state: { entries: [], loading: false, error: null }, select: vi.fn(), reload: vi.fn(), requestState: 'idle',
      // 这一例只关心设置入口；失败页的手工替身给空列表即可。
      failedRuns: { loading: false, entries: [] }, ensureFailedRuns: vi.fn(), loadMoreFailedRuns: vi.fn()
    }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(MarketAnalysisTimeline, {
      text, timeline: timeline as never, onOpenSettings
    } as never)))
    await flushReads()

    const settings = Array.from(container.querySelectorAll('button')).find(button => labelled(button, text.settings))
    expect(settings).toBeDefined()
    await act(async () => settings?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushReads()
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain(text.settingsTitle)
  })

  it('opens the analysis settings dialog and saves the chosen switch', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      if (method === 'marketAnalysis.getSettings') return { enabled: true, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
      if (method === 'marketAnalysis.saveSettings') return { enabled: true, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke }, modelProviders: { list: vi.fn(async () => []) } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    await flushReads()

    const settings = Array.from(container.querySelectorAll('button')).find(button => labelled(button, text.settings))
    await act(async () => settings?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(document.body.textContent).toContain(text.settingsTitle)
    expect(document.body.textContent).toContain(text.analysisEnabled)

    // antd inserts a space between two CJK characters in a two-character button label.
    const save = Array.from(document.querySelectorAll('button')).find(button => labelled(button, text.save))
    await act(async () => save?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await flushReads()
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.saveSettings', expect.objectContaining({ enabled: true }))
  })

  it('keeps a settled empty state on screen while a background read refreshes it', async () => {
    let releaseBackgroundRead: (() => void) | undefined
    let timelineReads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') {
        timelineReads += 1
        if (timelineReads === 2) await new Promise<void>(resolve => { releaseBackgroundRead = resolve })
        return { schemaVersion: 1, items: [], nextCursor: null }
      }
      if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-queued', status: 'queued', failureCode: null, queuedAt: asOf, evidenceCount: 20 }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    expect(container.textContent).toContain(text.empty)
    expect(container.textContent).not.toContain(text.loading)

    // A focus read runs on top of the settled view. It used to set `loading`, which unmounted the
    // empty state and put "正在加载消息分析…" back on screen once per poll tick — the panel appeared
    // to restart between two states even though nothing had changed.
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(container.textContent).toContain(text.empty)
    expect(container.textContent).not.toContain(text.loading)
    await act(async () => { releaseBackgroundRead?.() })
  })

  it('says a queued first analysis once and keeps the action a stable label', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-queued', status: 'queued', failureCode: null, queuedAt: asOf, evidenceCount: 20 }
      return { itemId: 'item-1', queued: true }
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    const request = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.requestInitialAnalysis)
    await act(async () => request?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    // The button used to *become* the queued sentence while the status line below said the same
    // thing, so the empty state printed it twice.
    expect(container.textContent?.split(text.initialAnalysisQueued).length).toBe(2)
    expect(Array.from(container.querySelectorAll('button')).every(button => button.textContent !== text.initialAnalysisQueued)).toBe(true)
  })
})

it('shows a reader-triggered analysis as that, with a moment instead of a "since"', async () => {
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{
      id: 'mi-tl-manual', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-manual', kind: 'analysis', status: 'published', occurredAt: asOf,
      summaryRef: 'mi-as-manual', safeTitle: '市场分析已生成', safeExcerpt: '手动结论', version: 1,
      triggerStatus: { triggerKey: 'manual.refresh', reasonCode: 'manual-request', decidedAt: asOf }
    }], nextCursor: null }
    if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-manual', status: 'succeeded', failureCode: null, queuedAt: asOf, evidenceCount: 2 }
    return { itemId: 'item-1', queued: true }
  })
  vi.stubGlobal('platform', { products: { invoke } })
  const container = document.createElement('div')
  document.body.append(container)
  const localRoot = createRoot(container)
  await act(async () => localRoot.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(Timeline, { text }) })))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })

  const status = container.querySelector('[data-trigger-status]')!
  expect(status.getAttribute('data-trigger-status')).toBe('manual-request')
  expect(status.textContent).toContain(text.triggerStatus.reasons['manual-request'])
  // A click is one moment: "since <time>" belongs to a condition the gate keeps re-observing.
  expect(status.textContent).toContain('（2026-09-28 00:00:00 GMT）')
  expect(status.textContent).not.toContain(text.triggerStatus.since)
  await act(async () => localRoot.unmount())
})

it('shows why the newest automatic decision was made, in the reader time zone', async () => {
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{
      id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf,
      summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: null, version: 1,
      triggerStatus: { triggerKey: 'calendar.refresh', reasonCode: 'interval-active', decidedAt: asOf }
    }], nextCursor: null }
    if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-1', status: 'succeeded', failureCode: null, queuedAt: asOf, evidenceCount: 2 }
    return { itemId: 'item-1', queued: true }
  })
  vi.stubGlobal('platform', { products: { invoke } })
  const container = document.createElement('div')
  document.body.append(container)
  const localRoot = createRoot(container)
  await act(async () => localRoot.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC', children: createElement(Timeline, { text }) })))
  // The list read is async: flush the IPC promise before querying the DOM.
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  const status = container.querySelector('[data-trigger-status]')
  expect(status?.getAttribute('data-trigger-status')).toBe('interval-active')
  expect(status?.textContent).toContain(text.triggerStatus.label)
  expect(status?.textContent).toContain(text.triggerStatus.reasons['interval-active'])
  await act(async () => localRoot.unmount())
})

it('renders no placeholder when there is no decision to show', async () => {
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [{
      id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published', occurredAt: asOf,
      summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: null, version: 1, triggerStatus: null
    }], nextCursor: null }
    if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-1', status: 'succeeded', failureCode: null, queuedAt: asOf, evidenceCount: 2 }
    return { itemId: 'item-1', queued: true }
  })
  vi.stubGlobal('platform', { products: { invoke } })
  const container = document.createElement('div')
  document.body.append(container)
  const localRoot = createRoot(container)
  await act(async () => localRoot.render(createElement(Timeline, { text })))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(container.querySelector('[data-trigger-status]')).toBeNull()
  await act(async () => localRoot.unmount())
})

describe('the timeline pages eight nodes at a time', () => {
  /** One read node; the fixture is the shape the client's page sanitizer admits (see the tests above). */
  const entryAt = (index: number) => ({
    id: `mi-tl-${index}`, eventGroupId: 'mi-eg-1', analysisRunId: null, kind: 'system', status: 'published',
    occurredAt: asOf, summaryRef: null, safeTitle: `节点 ${index}`, safeExcerpt: `摘要 ${index}`, version: 1, triggerStatus: null
  })
  async function renderList(invoke: ReturnType<typeof vi.fn>): Promise<HTMLDivElement> {
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    return container
  }
  const rows = (container: HTMLElement) => container.querySelectorAll('.mi-analysis-timeline__entry')
  const pull = (container: HTMLElement) => Array.from(container.querySelectorAll('button')).find(button => button.textContent === text.loadMore)
  const click = async (control: HTMLButtonElement | undefined) => { await act(async () => control?.dispatchEvent(new MouseEvent('click', { bubbles: true }))) }

  it('shows the first eight and reveals the next eight as the reader pulls', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => method === 'marketAnalysis.listTimeline'
      ? { schemaVersion: 1, items: Array.from({ length: 20 }, (_, index) => entryAt(index)), nextCursor: null }
      : { itemId: 'item-1', queued: true })
    const container = await renderList(invoke)

    expect(rows(container)).toHaveLength(8)
    expect(container.textContent).toContain('摘要 7')
    expect(container.textContent).not.toContain('摘要 8')
    await click(pull(container))
    expect(rows(container)).toHaveLength(16)
    expect(container.textContent).toContain('摘要 15')
    await click(pull(container))
    expect(rows(container)).toHaveLength(20)
    // Everything that was read is on screen, so there is nothing left to pull.
    expect(pull(container)).toBeUndefined()
  })

  it('reads the next product page only once the reader has caught up with what was read', async () => {
    const invoke = vi.fn(async (_product: string, _method: string, input: { cursor?: string }) => input.cursor
      ? { schemaVersion: 1, items: [entryAt(100)], nextCursor: null }
      : { schemaVersion: 1, items: Array.from({ length: 16 }, (_, index) => entryAt(index)), nextCursor: 'opaque-next' })
    const container = await renderList(invoke)

    expect(rows(container)).toHaveLength(8)
    // Sixteen nodes were read, so this pull only widens the window: nothing crosses the wire.
    await click(pull(container))
    expect(rows(container)).toHaveLength(16)
    expect(productCalls(invoke)).toHaveLength(1)
    // The window has now run out of read nodes, so this pull is what reads on.
    await click(pull(container))
    expect(invoke).toHaveBeenLastCalledWith('market-intelligence', 'marketAnalysis.listTimeline', { cursor: 'opaque-next' })
    expect(rows(container)).toHaveLength(17)
    expect(container.textContent).toContain('摘要 100')
    expect(pull(container)).toBeUndefined()
  })

  it('pulls by itself when the end of the list comes into view', async () => {
    // The mobile gesture, not a button press: the sentinel at the end of the list is what is watched.
    const viewers: { callback: IntersectionObserverCallback; target?: Element; rootMargin?: string }[] = []
    class Watching {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        viewers.push({ callback, rootMargin: options?.rootMargin })
      }
      observe(target: Element): void { viewers[viewers.length - 1]!.target = target }
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] { return [] }
    }
    vi.stubGlobal('IntersectionObserver', Watching)
    const invoke = vi.fn(async (_product: string, method: string) => method === 'marketAnalysis.listTimeline'
      ? { schemaVersion: 1, items: Array.from({ length: 20 }, (_, index) => entryAt(index)), nextCursor: null }
      : { itemId: 'item-1', queued: true })
    const container = await renderList(invoke)

    expect(rows(container)).toHaveLength(8)
    const viewer = viewers[viewers.length - 1]!
    // The sentinel it watches is the end of the list, and it loads a little before it is reached.
    expect(viewer.target).toBe(container.querySelector('.mi-analysis-timeline__pull'))
    expect(viewer.rootMargin).toBe('0px 0px 160px 0px')
    // What the browser reports when the reader's pull brings that sentinel into view.
    await act(async () => viewer.callback([{ isIntersecting: true } as IntersectionObserverEntry], viewer as never))
    expect(rows(container)).toHaveLength(16)
  })
})

describe('analysis request refusals', () => {
  it('treats the already-available refusal as a status and every other error as a failure', () => {
    // The main process throws this when a refresh has nothing to do, including right after the run it
    // just completed; reporting it as "not published" made a successful re-analysis look broken.
    expect(isAlreadyAvailableError(new Error('analysis-already-available'))).toBe(true)
    expect(isAlreadyAvailableError(new Error('model-configuration-missing'))).toBe(false)
    expect(isAlreadyAvailableError('analysis-already-available')).toBe(true)
  })
})

describe('market analysis timeline event captions', () => {
  const entry = (id: string, eventGroupId: string, occurredAt: string, groupType: string | null, groupSubject: string | null) => ({
    id, eventGroupId, analysisRunId: null, kind: 'analysis', status: 'published', occurredAt,
    summaryRef: null, safeTitle: '市场分析已生成', safeExcerpt: '偏空。', version: 1, triggerStatus: null, groupType, groupSubject
  })

  async function renderEntries(entries: unknown[]): Promise<HTMLElement> {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: entries, nextCursor: null }
      return undefined
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    return container
  }

  it('names the event on every row when the list mixes events', async () => {
    // The reported defect: two rows twenty seconds apart were two different events (a news item
    // and a macro series), which read as one conclusion posted twice.
    const container = await renderEntries([
      entry('mi-tl-2', 'mi-eg-news', '2026-10-31T13:36:23.000Z', 'sentiment', 'A Nasdaq-listed company may sell $450 million bitcoin'),
      entry('mi-tl-1', 'mi-eg-macro', '2026-10-31T13:36:04.000Z', 'macro', 'Fed Funds Target Range Upper')
    ])

    const captions = Array.from(container.querySelectorAll('.mi-analysis-timeline__group')).map(node => node.textContent)
    expect(captions).toEqual([
      '消息面 · A Nasdaq-listed company may sell $450 million bitcoin',
      '宏观 · Fed Funds Target Range Upper'
    ])
  })

  it('says nothing about the event on a list scoped to one event, or on a row whose event has no name', async () => {
    const scoped = await renderEntries([
      entry('mi-tl-2', 'mi-eg-1', '2026-10-31T13:36:23.000Z', 'sentiment', '某条消息'),
      entry('mi-tl-1', 'mi-eg-1', '2026-10-31T13:00:00.000Z', 'sentiment', '某条消息')
    ])
    expect(scoped.querySelector('.mi-analysis-timeline__group')).toBeNull()
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    const unnamed = await renderEntries([
      entry('mi-tl-2', 'mi-eg-1', '2026-10-31T13:36:23.000Z', 'funding', null),
      entry('mi-tl-1', 'mi-eg-2', '2026-10-31T13:00:00.000Z', 'macro', null)
    ])
    expect(unnamed.querySelector('.mi-analysis-timeline__group')).toBeNull()
  })
})

describe('market analysis timeline clickable row', () => {
  const entry = (id: string, eventGroupId: string) => ({
    id, eventGroupId, analysisRunId: null, kind: 'analysis', status: 'published',
    occurredAt: '2026-10-31T13:36:23.000Z', summaryRef: null, safeTitle: '市场分析已生成',
    safeExcerpt: '偏空。', version: 1, triggerStatus: null, groupType: null, groupSubject: null
  })

  async function renderRows(entries: unknown[]): Promise<HTMLElement> {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: entries, nextCursor: null }
      return undefined
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    return container
  }

  it('shows it opens something, and announces the selected row to assistive tech', async () => {
    // Registered clickable row, not a button: the chevron is the visible affordance, and selection is
    // carried by aria-current rather than by background colour alone.
    const container = await renderRows([entry('mi-tl-1', 'mi-eg-1')])
    const row = container.querySelector<HTMLButtonElement>('.mi-analysis-timeline__entry')!
    expect(row.querySelector('.mi-analysis-timeline__chevron')).not.toBeNull()
    expect(row.getAttribute('aria-current')).toBeNull()

    await act(async () => row.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const selected = container.querySelector('.mi-analysis-timeline__entry.is-selected')!
    expect(selected.getAttribute('aria-current')).toBe('true')
  })
})

describe('market analysis timeline client refusals', () => {
  it('normalizes the already-available refusal instead of reporting a failed publish', async () => {
    // The client is where the refusal used to be collapsed into 'failed'; the hook never saw the
    // error, which is why the message survived the first fix.
    const invoke = vi.fn(async () => { throw new Error('analysis-already-available') })
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    try {
      await expect(marketAnalysisTimelineClient.requestInitialAnalysis(undefined, 'refresh'))
        .resolves.toEqual({ state: 'unavailable', reason: 'already-available' })
    } finally {
      delete (window as unknown as { platform?: unknown }).platform
    }
  })
})

describe('正在解析：条目、按钮禁用与就地换状态（用户 2026-11-17）', () => {
  const publishedRow = {
    id: 'mi-tl-done', eventGroupId: 'mi-eg-done', analysisRunId: 'mi-ar-done', kind: 'analysis',
    status: 'published', runKey: 'mi-ar-done', failureCode: null, occurredAt: asOf,
    summaryRef: 'mi-as-done', safeTitle: '市场分析已生成', safeExcerpt: '市场情绪偏谨慎', version: 1,
    triggerStatus: null, groupType: 'macro', groupSubject: '上一次那条结论'
  }
  // 服务侧对还没有发布的行：`safeTitle` 是空串、没有 summaryRef / safeExcerpt，
  // 状态词与「正在解析」由界面文案表给，不由服务端给。
  const runningRow = {
    id: 'run:mi-ar-run', eventGroupId: 'mi-eg-run', analysisRunId: 'mi-ar-run', kind: 'analysis',
    status: 'running', runKey: 'mi-ar-run', failureCode: null, occurredAt: asOf,
    summaryRef: null, safeTitle: '', safeExcerpt: null, version: 1, triggerStatus: null,
    groupType: 'macro', groupSubject: '美联储官员暗示放缓缩表'
  }

  /** 时间轴页面数据；其余 IPC（设置）给一个读不出来的空载荷，面板照常可见。 */
  const page = (items: readonly unknown[]) => (method: string): unknown =>
    method === 'marketAnalysis.listTimeline'
      ? { schemaVersion: 1, items, nextCursor: null }
      : { schemaVersion: 1, items: [], nextCursor: null }

  async function mount(stub: (method: string) => unknown): Promise<HTMLDivElement> {
    vi.stubGlobal('platform', { products: { invoke: vi.fn(async (_product: string, method: string) => stub(method)) } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    await flushReads()
    return container
  }

  it('running 行显示「正在解析」且不可点；「立即分析」禁用但不再附一句原因', async () => {
    const container = await mount(page([runningRow]))
    const rows = container.querySelectorAll('.mi-analysis-timeline__entry')
    // 空标题的 running 行必须活下来：sanitizer 若按「标题不可为空」判死，整屏会一条不剩。
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain(text.status.running)
    // 没有摘要可看，所以不可点：不是按钮，也不出 chevron。
    expect(container.querySelector('button.mi-analysis-timeline__entry')).toBeNull()
    expect(container.querySelector('.mi-analysis-timeline__chevron')).toBeNull()
    // 禁用原因由可见状态承担（行上的「正在解析」+ 按钮转圈），不再写第二句「跑完再试」；
    // 读屏仍要知道「正在忙」：aria-busy 保留。
    const action = Array.from(container.querySelectorAll('button')).find((button) => labelled(button, text.refreshAnalysis))
    expect(action?.disabled).toBe(true)
    expect(action?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelector('.mi-analysis-timeline__reanalyse-reason')).toBeNull()
  })

  it('已发布行与 running 行同屏时，两条都显示', async () => {
    const container = await mount(page([publishedRow, runningRow]))
    const rows = container.querySelectorAll('.mi-analysis-timeline__entry')
    expect(rows).toHaveLength(2)
    expect(container.textContent).toContain(text.status.published)
    expect(container.textContent).toContain(text.status.running)
  })

  it('同一条运行：runKey 不变 → 那一行变「已发布」，条数不变、按钮恢复可点', async () => {
    let items: readonly unknown[] = [runningRow]
    let reload: (() => Promise<void>) | undefined
    function WithReload(): React.ReactElement {
      const timeline = useMarketAnalysisTimeline({ text })
      reload = async () => { await timeline.load() }
      return createElement(MarketAnalysisTimeline, { text, timeline })
    }
    vi.stubGlobal('platform', { products: { invoke: vi.fn(async (_product: string, method: string) => page(items)(method)) } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(WithReload)))
    await flushReads()
    expect(container.querySelectorAll('.mi-analysis-timeline__entry')).toHaveLength(1)
    expect(container.textContent).toContain(text.status.running)

    // 同一次运行发布：`id` 换成真实时间轴行 id，`runKey` 不变——列表靠它认行，所以不是删一行加一行。
    items = [{ ...publishedRow, id: 'mi-tl-after-run', analysisRunId: 'mi-ar-run', runKey: 'mi-ar-run' }]
    await act(async () => { await reload?.() })
    await flushReads()

    const rows = container.querySelectorAll('.mi-analysis-timeline__entry')
    expect(rows).toHaveLength(1)
    expect(container.textContent).toContain(text.status.published)
    expect(container.textContent).not.toContain(text.status.running)
    // 跑到终态 → 按钮恢复可点，aria-busy 也撤掉。
    const action = Array.from(container.querySelectorAll('button')).find((button) => labelled(button, text.refreshAnalysis))
    expect(action?.disabled).toBe(false)
    expect(action?.getAttribute('aria-busy')).toBeNull()
  })
})

/** Product calls other than the panel's own settings read, which every mount performs. */
function productCalls(invoke: { mock: { calls: unknown[][] } }): unknown[][] {
  return invoke.mock.calls.filter(([, method]) => method !== 'marketAnalysis.getSettings')
}

/** antd spacing between two CJK characters is presentation, not part of the label. */
function labelled(button: Element, text: string): boolean {
  return (button.textContent ?? '').replace(/\s+/gu, '') === text.replace(/\s+/gu, '')
}

/**
 * 时间轴自己读不到时，不许落成「暂无已发布的消息分析」（2026-11-17，模块启动失败那次）。
 * 那一句在说「你没有分析」，而事实是「这次读不到」——两件事，两种面。
 */
describe('时间轴读失败：错误态 + 重试，不是「暂无」', () => {
  it('listTimeline 抛 product-runtime-unavailable → 统一错误面与重试，且不出现「暂无」', async () => {
    vi.useFakeTimers()
    let listReads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') { listReads += 1; throw new Error('product-runtime-unavailable') }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return undefined
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    // 有界重试跑完（10 次 / 30s 预算）才落失败态。
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000) })

    expect(container.textContent).not.toContain(text.empty)
    const stateView = container.querySelector('[data-state="error"]')
    expect(stateView).not.toBeNull()
    // 不再是那句没有出口的裸 <p role="alert">。
    expect(container.querySelector('p[role="alert"]')).toBeNull()
    const retry = stateView?.querySelector<HTMLButtonElement>('button.state-view__action')
    expect(retry).not.toBeNull()
    const before = listReads
    await act(async () => { retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(listReads).toBeGreaterThan(before)
    vi.useRealTimers()
  })
})

/**
 * 成功 / 失败两个页签（用户 2026-11-18 直接要求）。
 *
 * 成功页读 `listTimeline`；失败页读**独立的** `listFailedRuns`（按运行分页，能看到全部失败）。
 * 判据：① 两页各行其行，互不串门；② 标题那行不再出现；③ 切页签不重置已加载；④ 120 条失败
 * 翻三页取完且无重复；⑤ 旧注入的失败行与新读口同一次运行**只出现一行**。
 */
describe('成功 / 失败两个页签', () => {
  const publishedEntry = (index: number) => ({
    id: `mi-tl-${index}`, eventGroupId: 'mi-eg-1', analysisRunId: `mi-ar-${index}`, kind: 'analysis' as const,
    status: 'published' as const, runKey: `mi-ar-${index}`, failureCode: null,
    occurredAt: `2026-11-17T20:${String(index).padStart(2, '0')}:00.000Z`, summaryRef: `mi-as-${index}`,
    safeTitle: '市场分析已生成', safeExcerpt: '已发布的结论正文', version: 1, triggerStatus: null,
    groupType: 'sentiment', groupSubject: '新闻标题'
  })
  /** 失败运行行：没有摘要，`safeTitle` 空（服务侧约定）。 */
  const failedRun = (tag: string, occurredAt = '2026-11-18T00:54:00.000Z') => ({
    id: `run:${tag}`, eventGroupId: 'mi-eg-1', analysisRunId: tag, runKey: tag,
    kind: 'analysis' as const, status: 'failed' as const, failureCode: 'analysis-provider-error',
    occurredAt, summaryRef: null, safeTitle: '', safeExcerpt: null, version: 1, triggerStatus: null,
    groupType: null, groupSubject: null
  })

  type FailedPage = { items: unknown[]; nextCursor: string | null }

  async function mount(input: Readonly<{
    timeline?: readonly unknown[]
    failedPages?: Readonly<Record<string, FailedPage>>
  }>): Promise<HTMLDivElement> {
    const failedPages = input.failedPages ?? {}
    const invoke = vi.fn(async (_product: string, method: string, payload?: { cursor?: string }) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: input.timeline ?? [], nextCursor: null }
      if (method === 'marketAnalysis.listFailedRuns') {
        const cursor = payload?.cursor ?? ''
        return { schemaVersion: 1, ...(failedPages[cursor] ?? { items: [], nextCursor: null }) }
      }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return undefined
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    await flushReads()
    return container
  }

  const visiblePanel = (container: HTMLElement): Element | undefined =>
    Array.from(container.querySelectorAll('[role="tabpanel"]')).find((panel) => !panel.hasAttribute('hidden'))
  const tab = (container: HTMLElement, label: string): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent === label)
  const openFailed = async (container: HTMLElement): Promise<void> => {
    await act(async () => { tab(container, text.tabFailed)?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flushReads()
  }

  it('只在失败页的行不出现在成功页，反之亦然', async () => {
    const container = await mount({
      timeline: [publishedEntry(1)],
      failedPages: { '': { items: [failedRun('mi-ar-fail')], nextCursor: null } }
    })
    const [successPanel, failedPanel] = Array.from(container.querySelectorAll('[role="tabpanel"]')) as [Element, Element]

    // 成功页：有那条已发布，没有失败行
    expect(successPanel.querySelector('[data-entry-status="failed"]')).toBeNull()
    expect(successPanel.textContent).toContain('已发布的结论正文')
    // 默认停在成功页
    expect(visiblePanel(container)).toBe(successPanel)

    await openFailed(container)
    expect(visiblePanel(container)).toBe(failedPanel)
    // 失败页：那条失败在，已发布正文不在
    expect(failedPanel.querySelector('[data-entry-status="failed"]')).not.toBeNull()
    expect(failedPanel.textContent).not.toContain('已发布的结论正文')
  })

  it('标题那行不再出现，页签用「成功 / 失败」', async () => {
    const container = await mount({ timeline: [publishedEntry(1)] })
    // 原来那行 <h2>{text.timeline}</h2> 没了（要删的就是这一行）
    expect(container.querySelector('.mi-analysis-timeline__list h2')).toBeNull()
    expect(container.textContent).not.toContain(text.timeline)
    // 页签标签与可访问名
    expect(tab(container, text.tabSuccess)).toBeDefined()
    expect(tab(container, text.tabFailed)).toBeDefined()
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(text.tabsAria)
  })

  it('切页签不重置已加载的列表', async () => {
    const container = await mount({ timeline: Array.from({ length: 10 }, (_, index) => publishedEntry(index)) })
    const count = (): number => container.querySelectorAll('.mi-analysis-timeline__entry').length
    const more = (): HTMLButtonElement | undefined =>
      Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text.loadMore)
    if (more() !== undefined) await act(async () => { more()!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const grown = count()
    await openFailed(container)
    await act(async () => { tab(container, text.tabSuccess)?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(count()).toBe(grown)
  })

  it('120 条失败：翻三页取完，无重复', async () => {
    const pageOne = Array.from({ length: 50 }, (_, index) => failedRun(`mi-ar-a${index}`, `2026-11-18T00:${String(index).padStart(2, '0')}:00.000Z`))
    const pageTwo = Array.from({ length: 50 }, (_, index) => failedRun(`mi-ar-b${index}`, `2026-11-17T23:${String(index).padStart(2, '0')}:00.000Z`))
    const pageThree = Array.from({ length: 20 }, (_, index) => failedRun(`mi-ar-c${index}`, `2026-11-17T22:${String(index).padStart(2, '0')}:00.000Z`))
    const container = await mount({
      timeline: [publishedEntry(1)],
      failedPages: {
        '': { items: pageOne, nextCursor: 'c1' },
        c1: { items: pageTwo, nextCursor: 'c2' },
        c2: { items: pageThree, nextCursor: null }
      }
    })
    await openFailed(container)

    // 首屏一页：读一次，只看到第一屏那几条（不是 120 条）
    const failedPanel = (): Element => Array.from(container.querySelectorAll('[role="tabpanel"]'))[1]!
    const rows = (): Element[] => Array.from(failedPanel().querySelectorAll('.mi-analysis-timeline__entry'))
    expect(rows().length).toBeGreaterThan(0)
    expect(rows().length).toBeLessThan(50)

    // 一路「加载更多」翻到底：三轮之后 120 条全在，且键不重复
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const more = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text.loadMore)
      if (more === undefined) break
      await act(async () => { more.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      await flushReads()
    }
    const keys = rows().map((row) => row.getAttribute('data-key') ?? row.textContent)
    expect(rows()).toHaveLength(120)
    expect(new Set(keys).size).toBe(120)
  })

  it('旧注入的失败行与新读口同一次运行 → 失败页只有一行', async () => {
    // 旧行为：`listTimeline` 首屏仍会补进这条失败行；新读口也返回同一次运行。
    const injected = failedRun('mi-ar-same')
    const container = await mount({
      timeline: [publishedEntry(1), injected],
      failedPages: { '': { items: [failedRun('mi-ar-same')], nextCursor: null } }
    })
    await openFailed(container)
    const failedPanel = Array.from(container.querySelectorAll('[role="tabpanel"]'))[1] as Element
    expect(failedPanel.querySelectorAll('.mi-analysis-timeline__entry')).toHaveLength(1)
  })
})

/**
 * 页头那颗重跑按钮也按组类别（用户 2026-11-18）：消息面组不给，市场分析组照旧。
 */
describe('页头的重跑按钮不再按组类别隐藏', () => {
  const entryWithGroup = (groupType: string) => ({
    id: `mi-tl-${groupType}`, eventGroupId: `mi-eg-${groupType}`, analysisRunId: `mi-ar-${groupType}`,
    kind: 'analysis' as const, status: 'published' as const, runKey: `mi-ar-${groupType}`, failureCode: null,
    occurredAt: '2026-11-17T20:10:00.000Z', summaryRef: 'mi-as-1', safeTitle: '标题', safeExcerpt: '结论',
    version: 1, triggerStatus: null, groupType, groupSubject: '标题'
  })

  async function mountWithGroup(groupType: string): Promise<HTMLDivElement> {
    vi.stubGlobal('platform', { products: { invoke: vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [entryWithGroup(groupType)], nextCursor: null }
      if (method === 'marketAnalysis.listFailedRuns') return { schemaVersion: 1, items: [], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return undefined
    }) } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    await flushReads()
    return container
  }
  const refresh = (container: HTMLElement): Element | undefined =>
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent === text.refreshAnalysis)

  it('sentiment 组：页头也有「立即分析」', async () => {
    // 2026-11-20：手动入口已改成永远走市场线，这个组类型不再意味着「产出落在新闻抽屉」。
    const container = await mountWithGroup('sentiment')
    expect(refresh(container)?.textContent).toBe(text.refreshAnalysis)
  })

  it('市场分析组：页头有「立即分析」，文案一字不变', async () => {
    const container = await mountWithGroup('macro')
    expect(refresh(container)?.textContent).toBe(text.refreshAnalysis)
  })
})

/**
 * 同时有「正在解析」与「失败」时（Chief 点名要带的回归项）：
 * 顺序照服务给的倒序（新的在上），状态各自正确——running 在成功页、failed 在失败页，两页都不串。
 */
describe('running 与 failed 同时存在时的顺序与状态', () => {
  const base = {
    eventGroupId: 'mi-eg-1', kind: 'analysis' as const, version: 1, triggerStatus: null,
    groupType: 'macro', groupSubject: '美联储官员暗示放缓缩表'
  }
  const published = { ...base, id: 'mi-tl-old', analysisRunId: 'mi-ar-old', runKey: 'mi-ar-old', status: 'published' as const, failureCode: null,
    occurredAt: '2026-11-17T20:10:00.000Z', summaryRef: 'mi-as-old', safeTitle: '标题', safeExcerpt: '已发布的结论正文' }
  const failed = { ...base, id: 'run:mi-ar-fail', analysisRunId: 'mi-ar-fail', runKey: 'mi-ar-fail', status: 'failed' as const,
    failureCode: 'analysis-provider-error', occurredAt: '2026-11-18T08:06:00.000Z', summaryRef: null, safeTitle: '', safeExcerpt: null }
  const running = { ...base, id: 'run:mi-ar-live', analysisRunId: 'mi-ar-live', runKey: 'mi-ar-live', status: 'running' as const,
    failureCode: null, occurredAt: '2026-11-18T09:10:00.000Z', summaryRef: null, safeTitle: '', safeExcerpt: null }

  it('成功页：running 在 published 之前；失败页：只有那条 failed，且状态词各归各位', async () => {
    vi.stubGlobal('platform', { products: { invoke: vi.fn(async (_product: string, method: string) => {
      // 服务侧按 occurredAt 倒序：running 09:10 → failed 08:06 → published 前一日 20:10
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [running, failed, published], nextCursor: null }
      if (method === 'marketAnalysis.listFailedRuns') return { schemaVersion: 1, items: [failed], nextCursor: null }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return undefined
    }) } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { text })))
    await flushReads()

    const panels = Array.from(container.querySelectorAll('[role="tabpanel"]')) as [Element, Element]
    const successRows = Array.from(panels[0].querySelectorAll('.mi-analysis-timeline__entry'))
    expect(successRows).toHaveLength(2)
    // 顺序：新的在上（running 09:10 在 published 20:10 之前）
    expect(successRows[0]?.textContent).toContain(text.status.running)
    expect(successRows[1]?.textContent).toContain(text.status.published)
    // 失败行不进成功页
    expect(panels[0].querySelector('[data-entry-status="failed"]')).toBeNull()

    const failedTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) => button.textContent === text.tabFailed)
    await act(async () => { failedTab?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await flushReads()
    const failedRows = Array.from(panels[1].querySelectorAll('.mi-analysis-timeline__entry'))
    expect(failedRows).toHaveLength(1)
    expect(failedRows[0]?.textContent).toContain(text.status.failed)
    expect(failedRows[0]?.textContent).toContain(text.failureReasons['analysis-provider-error'])
  })
  it('says the original record is out of retention instead of telling the reader to retry', async () => {
    // 2026-11-20：真实拒因是新闻证据引不出来（原始记录已不在保留期），旧句子是
    // 「重新分析请求未成功」——读者会一直点一个永远不会成功的按钮。
    const timeline = {
      state: { entries: [], loading: false, error: null }, select: vi.fn(), reload: vi.fn(),
      requestState: 'insufficient-evidence',
      failedRuns: { loading: false, entries: [] }, ensureFailedRuns: vi.fn(), loadMoreFailedRuns: vi.fn()
    }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(MarketAnalysisTimeline, { text, timeline: timeline as never } as never)))
    await flushReads()

    expect(document.body.textContent).toContain(text.analysisInsufficientEvidence)
    expect(document.body.textContent).not.toContain(text.analysisRefreshFailed)
  })

  it('says no usable model when the request is refused for that reason', async () => {
    // 2026-11-20 用户点「重新生成分析」被拒：旧句子是「重新分析请求未成功」，读者以为要重试。
    // 真实原因是没有可用模型；这一档必须让读者看到该改哪里。
    const timeline = {
      state: { entries: [], loading: false, error: null }, select: vi.fn(), reload: vi.fn(),
      requestState: 'provider-not-ready',
      failedRuns: { loading: false, entries: [] }, ensureFailedRuns: vi.fn(), loadMoreFailedRuns: vi.fn()
    }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(MarketAnalysisTimeline, { text, timeline: timeline as never } as never)))
    await flushReads()

    expect(document.body.textContent).toContain(text.analysisProviderNotReady)
    expect(document.body.textContent).not.toContain(text.analysisRefreshFailed)
  })

})
