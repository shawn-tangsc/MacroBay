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
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/**
 * The list is presentational: data and selection come from the workspace hook,
 * exactly as the dashboard layout wires them.
 */
function Timeline({ text: timelineText, onSelect, onSelectionStateChange, onBack }: {
  text: typeof text
  onBack?: () => void
  onSelect?: (binding: AnalysisWorkspaceBinding | undefined) => void
  onSelectionStateChange?: (state: AnalysisSelectionState) => void
}): React.ReactElement {
  const timeline = useMarketAnalysisTimeline({ text: timelineText, onSelect, onSelectionStateChange })
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

  it('does not present an IPC failure as an empty timeline', async () => {
    vi.stubGlobal('platform', { products: { invoke: vi.fn(async () => { throw Error('private failure') }) } })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(Timeline, { onBack: vi.fn(), text })))
    expect(container.textContent).toContain(text.unavailable)
    expect(container.querySelector('.mi-analysis-timeline__list')?.textContent).not.toContain(text.empty)
    expect(container.textContent).not.toContain('private failure')
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
    expect(banner?.querySelector('[data-analysis-error-detail]')?.textContent).toBe(text.failureReasons['analysis-missing-evidence'])

    // The 60s background poll reads the page without the attempt. It used to clear the known
    // attempt, which left "重新分析未发布" on screen with no reason at all.
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    expect(container.textContent).toContain(text.failureReasons['analysis-missing-evidence'])
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
  await act(async () => localRoot.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(Timeline, { text }))))
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
  await act(async () => localRoot.render(createElement(ShellTimeZoneProvider, { timeZone: 'UTC' }, createElement(Timeline, { text }))))
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

/** Product calls other than the panel's own settings read, which every mount performs. */
function productCalls(invoke: { mock: { calls: unknown[][] } }): unknown[][] {
  return invoke.mock.calls.filter(([, method]) => method !== 'marketAnalysis.getSettings')
}

/** antd spacing between two CJK characters is presentation, not part of the label. */
function labelled(button: Element, text: string): boolean {
  return (button.textContent ?? '').replace(/\s+/gu, '') === text.replace(/\s+/gu, '')
}
