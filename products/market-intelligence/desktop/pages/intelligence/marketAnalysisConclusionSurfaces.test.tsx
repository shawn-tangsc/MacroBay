// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { analysisTimelineRefreshPolicy, useMarketAnalysisTimeline, type UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'
import { MarketAnalysisTimeline } from './MarketAnalysisTimeline'
import { LatestAnalysisConclusionCard, selectLatestPublishedEntry } from './LatestAnalysisConclusionCard'
import { AnalysisDetailDrawer } from './AnalysisDetailDrawer'
import { TimelinePanel } from './TimelinePanel'
import { AnalysisConclusionDetail } from './AnalysisConclusionDetail'
import { parseConclusionDirection } from './analysisConclusionDirectionPolicy'

const asOf = '2026-09-28T00:00:00.000Z'
const portal = productText['zh-CN'].pages.intelligence.portal
const timelineText = portal.analysisTimeline
const workspaceText = portal.analysisWorkspace
const completeConclusion = `${'宏观数据已发布，资本流向与价格反应需要结合后续证据判断。'.repeat(12)}结论仍需观察。`
let root: Root | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis', status: 'published',
  occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: completeConclusion, version: 1, ...overrides
})

const summary = () => ({
  id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1, eventAssessment: completeConclusion,
  knownFacts: [{ factId: 'fact-1', statement: '恐惧贪婪指数处于高位。', evidenceRefIds: ['ev-1'] }],
  transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [], scenarios: [],
  nextCatalysts: [], dataCaveats: ['资金费率不可比'], evidenceRefs: ['ev-1'], createdAt: asOf
})

function stubPlatform(entries: readonly unknown[], summaryValue: unknown = summary(), settings?: { enabled: boolean }) {
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'marketAnalysis.getSettings') {
      return settings
        ? { enabled: settings.enabled, providerId: 'provider-1', modelId: 'model-1', updatedAt: asOf }
        : []
    }
    if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: entries, nextCursor: null }
    if (method === 'marketAnalysis.getLatestAttempt') return { id: 'mi-ar-1', status: 'succeeded', failureCode: null, queuedAt: asOf, evidenceCount: 2 }
    if (method === 'marketAnalysis.getAnalysisRun') return {
      id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null,
      queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 2, change: null
    }
    if (method === 'marketAnalysis.getSummary') return summaryValue
    return []
  })
  vi.stubGlobal('platform', { products: { invoke } })
  return invoke
}

/**
 * One React root per test. The workspace hook and the rendered surface share it
 * so effects, async detail reads and synthetic events behave as in the app.
 */
async function mountSurface(
  entries: readonly unknown[],
  surface: (timeline: UseMarketAnalysisTimelineResult) => React.ReactElement,
  options: Readonly<{ onSelect?: (binding: unknown) => void; summaryValue?: unknown; timeZone?: string; analysisSettings?: { enabled: boolean } }> = {}
): Promise<{ container: HTMLElement; invoke: ReturnType<typeof stubPlatform> }> {
  const invoke = stubPlatform(entries, options.summaryValue ?? summary(), options.analysisSettings)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  function Host(): React.ReactElement {
    const timeline = useMarketAnalysisTimeline({ text: timelineText, onSelect: options.onSelect as never })
    return <ShellTimeZoneProvider timeZone={options.timeZone ?? 'UTC'}>{surface(timeline)}</ShellTimeZoneProvider>
  }
  await act(async () => root?.render(createElement(Host)))
  await act(async () => {})
  return { container, invoke }
}

const clickEntry = async (container: HTMLElement) => {
  await act(async () => { container.querySelector<HTMLButtonElement>('.mi-analysis-timeline__entry')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

/**
 * Mounts the workspace hook with the same "read the newest node" effect the conclusion card runs,
 * and a summary read that fails `failures` times before it answers.
 */
async function mountDetailProbe(options: Readonly<{ failures: number }>): Promise<{ reads: () => number; holder: { current: UseMarketAnalysisTimelineResult } }> {
  vi.useFakeTimers()
  let summaryReads = 0
  const invoke = vi.fn(async (_product: string, method: string) => {
    if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, items: [entry()], nextCursor: null }
    if (method === 'marketAnalysis.getLatestAttempt') return null
    if (method === 'marketAnalysis.getAnalysisRun') return {
      id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null,
      queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 1, change: null
    }
    if (method === 'marketAnalysis.getSummary') {
      summaryReads += 1
      if (summaryReads <= options.failures) throw new Error('analysis-summary-not-found')
      return summary()
    }
    return []
  })
  vi.stubGlobal('platform', { products: { invoke } })
  const holder = { current: undefined as unknown as UseMarketAnalysisTimelineResult }
  function Probe(): null {
    const timeline = useMarketAnalysisTimeline({ text: timelineText })
    holder.current = timeline
    const latest = selectLatestPublishedEntry(timeline.state.entries)
    useEffect(() => { if (latest) timeline.ensureDetail(latest) }, [latest?.id])
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root?.render(createElement(Probe)))
  await act(async () => {})
  await act(async () => {})
  return { reads: () => summaryReads, holder }
}

describe('analysis conclusion direction markers', () => {
  it('reads the controlled direction vocabulary and strips the marker from the body', () => {
    expect(parseConclusionDirection('方向：偏多：ETF 连续流入，资金面转强。')).toEqual({ direction: 'bullish', body: 'ETF 连续流入，资金面转强。' })
    expect(parseConclusionDirection('方向：偏空：资金费率转负。')).toEqual({ direction: 'bearish', body: '资金费率转负。' })
    expect(parseConclusionDirection('方向：震荡：区间未破。')).toEqual({ direction: 'range', body: '区间未破。' })
    expect(parseConclusionDirection('方向：暂不判断：缺少 consensus。')).toEqual({ direction: 'undecided', body: '缺少 consensus。' })
    expect(parseConclusionDirection('方向：信号冲突：ETF 流入但 funding 转负。')).toEqual({ direction: 'mixed', body: 'ETF 流入但 funding 转负。' })
  })

  it('never guesses a direction for an unmarked conclusion', () => {
    const legacy = '截至2026-10-06T05:23Z，宏观日历显示：美国9月非农实际+29K，但可能偏多。'
    expect(parseConclusionDirection(legacy)).toEqual({ body: legacy })
    expect(parseConclusionDirection('方向：看心情：数据不足。')).toEqual({ body: '方向：看心情：数据不足。' })
  })

  it('colors a marked conclusion and leaves an unmarked one neutral', async () => {
    const detailFor = (assessment: string) => ({
      run: { id: 'mi-ar-1', eventGroupId: 'mi-eg-1', analysisPhase: 'initial', status: 'succeeded', failureCode: null, queuedAt: asOf, startedAt: asOf, completedAt: asOf, asOf, dataCutoff: asOf, evidenceCount: 2, change: null },
      summary: { ...summary(), eventAssessment: assessment },
      predictions: []
    })
    const marked = await mountSurface([entry()], () => createElement(AnalysisConclusionDetail, { detail: detailFor('方向：偏多：ETF 连续流入，资金面转强。') as never, text: workspaceText }))
    const chip = marked.container.querySelector('.mi-analysis-conclusion__direction')
    expect(chip?.textContent).toBe('偏多')
    expect(marked.container.querySelector('.mi-analysis-conclusion__body')?.textContent).toBe('ETF 连续流入，资金面转强。')
    const section = marked.container.querySelector('.mi-analysis-timeline__conclusion') as HTMLElement
    expect(section.getAttribute('data-direction')).toBe('bullish')
    expect(section.style.getPropertyValue('--mi-conclusion-direction')).toBe('var(--mi-conclusion-positive)')

    const unmarked = await mountSurface([entry()], () => createElement(AnalysisConclusionDetail, { detail: detailFor(summary().eventAssessment) as never, text: workspaceText }))
    expect(unmarked.container.querySelector('.mi-analysis-conclusion__direction')).toBeNull()
    expect(unmarked.container.querySelector('.mi-analysis-timeline__conclusion')?.getAttribute('data-direction')).toBe('none')
  })
})

describe('market analysis conclusion surfaces', () => {
  it('selects the newest published analysis node and skips newer non-analysis nodes', () => {
    const latest = selectLatestPublishedEntry([
      entry({ id: 'mi-tl-new', kind: 'event', status: 'published' }),
      entry({ id: 'mi-tl-stale', status: 'stale' }),
      entry({ id: 'mi-tl-published' }),
      entry({ id: 'mi-tl-old' })
    ])
    expect(latest?.id).toBe('mi-tl-published')
    expect(selectLatestPublishedEntry([entry({ kind: 'system' })])).toBeUndefined()
  })

  it('reads the latest conclusion into the main-area card without a model run', async () => {
    const { container, invoke } = await mountSurface([entry()], timeline =>
      createElement(LatestAnalysisConclusionCard, { text: timelineText, workspaceText, timeline, onOpenDetail: vi.fn() }))

    const conclusion = container.querySelector('.mi-analysis-conclusion-card__conclusion')
    // The body is split into labelled blocks, so the text is compared with collapsed
    // whitespace; the published conclusion itself must still be present in full.
    expect(conclusion?.textContent?.replace(/\s+/gu, '')).toBe(completeConclusion.replace(/\s+/gu, ''))
    expect(container.textContent).toContain(workspaceText.latestConclusion)
    expect(invoke).toHaveBeenCalledWith('market-intelligence', 'marketAnalysis.getSummary', { id: 'mi-as-1' })
  })

  it('shows the verdict from the structured conclusion, not only the operation directions', async () => {
    // Reported symptom: the card showed 操作方向建议 and no conclusion text. The card read
    // `eventAssessment`, which current runs no longer write; the verdict now lives in the
    // structured `conclusion`, the same contract the detail drawer already reads.
    const structured = {
      direction: 'bearish',
      summary: '通胀读数高于前值压低实际利率下行空间，稳定币收缩叠加 ETF 净流出，现货买盘转弱。',
      change: '无变化。',
      causalChain: '通胀高于前值 → 实际利率下行受限 → 现货需求下降。',
      conditions: ['稳定币继续收缩。'],
      macro: null,
      evidenceStrength: null,
      dataGaps: []
    }
    // Same merged text the dashboard layout hands the card, so the direction label is real here.
    const { container } = await mountSurface([entry()], timeline =>
      createElement(LatestAnalysisConclusionCard, { text: { ...timelineText, ...workspaceText }, workspaceText, timeline, onOpenDetail: vi.fn() }),
      { summaryValue: { ...summary(), eventAssessment: undefined, conclusion: structured } })

    const card = container.querySelector('.mi-analysis-conclusion-card') as HTMLElement
    expect(card.querySelector('.mi-analysis-conclusion-card__conclusion')?.textContent).toContain(structured.summary)
    expect(card.querySelector('.mi-analysis-conclusion__direction')?.textContent).toBe('偏空')
    expect(card.querySelector('.mi-analysis-conclusion-card__body')?.getAttribute('data-direction')).toBe('bearish')
  })

  it('keeps the newest conclusion on screen when the run cites more evidence than a page holds', async () => {
    // Reported symptom: 最新 AI 结论 alternated between the verdict and "最新结论详情暂不可用". The
    // newest summary cited 62 evidence rows, and the renderer refused any string list longer than
    // the 50-item timeline page, so the richest node was the one that blanked — until a smaller run
    // became the newest. The card must read the published conclusion here, not the failure copy.
    const { container } = await mountSurface([entry()], timeline =>
      createElement(LatestAnalysisConclusionCard, { text: { ...timelineText, ...workspaceText }, workspaceText, timeline, onOpenDetail: vi.fn() }),
      {
        summaryValue: {
          ...summary(),
          evidenceRefs: Array.from({ length: 62 }, (_, index) => `query:source:metric:${index}`),
          dataCaveats: Array.from({ length: 54 }, (_, index) => `限制 ${index}`)
        }
      })

    const text = container.textContent ?? ''
    expect(text).not.toContain(workspaceText.latestConclusionUnavailable)
    expect(container.querySelector('.mi-analysis-conclusion-card__conclusion')?.textContent).toContain(completeConclusion)
  })

  it('keeps the card but shows the off state while the capability is off', async () => {
    const disabled = await mountSurface([entry()], timeline =>
      createElement(LatestAnalysisConclusionCard, { text: timelineText, workspaceText, timeline, onOpenDetail: vi.fn() }),
      { analysisSettings: { enabled: false } })
    const offCard = disabled.container.querySelector('.mi-analysis-conclusion-card')
    expect(offCard).not.toBeNull()
    expect(offCard?.querySelector('.mi-analysis-conclusion-card__state')).not.toBeNull()

    const enabled = await mountSurface([entry()], timeline =>
      createElement(LatestAnalysisConclusionCard, { text: timelineText, workspaceText, timeline, onOpenDetail: vi.fn() }),
      { analysisSettings: { enabled: true } })
    // Off is the only state that hides it: an unread setting must not blank the card.
    expect(enabled.container.querySelector('.mi-analysis-conclusion-card')).not.toBeNull()
  })

  it('shows an explicit empty state in the card when nothing is published', async () => {
    const { container } = await mountSurface([], timeline =>
      createElement(LatestAnalysisConclusionCard, { text: timelineText, workspaceText, timeline, onOpenDetail: vi.fn() }))

    expect(container.textContent).toContain(workspaceText.latestConclusionEmpty)
  })

  it('re-reads a node whose detail read failed, so the card heals without a reload', async () => {
    // Nothing re-read a node after a failed detail read, so one transient fault — the service
    // reloading its store, a summary written a moment after the run — pinned the newest conclusion
    // to "暂不可用" until a different node became the newest, which read as the card coming and going.
    const { reads, holder } = await mountDetailProbe({ failures: 1 })

    expect(holder.current.detailState['mi-tl-1']).toBe('unavailable')
    await act(async () => { await vi.advanceTimersByTimeAsync(analysisTimelineRefreshPolicy.detailRetryDelaysMs[0]) })
    expect(holder.current.details['mi-tl-1']).toBeDefined()
    expect(holder.current.detailState['mi-tl-1']).toBeUndefined()
    expect(reads()).toBe(2)
  })

  it('stops retrying a detail that keeps failing instead of polling it forever', async () => {
    const { reads } = await mountDetailProbe({ failures: Number.POSITIVE_INFINITY })

    const totalRetryMs = analysisTimelineRefreshPolicy.detailRetryDelaysMs.reduce((sum, delay) => sum + delay, 0)
    await act(async () => { await vi.advanceTimersByTimeAsync(totalRetryMs + 60_000) })
    expect(reads()).toBe(1 + analysisTimelineRefreshPolicy.detailRetryDelaysMs.length)
  })

  it('never stays in the loading state when the service never answers', async () => {
    // The reported symptom: the timeline stuck on "loading" forever. A read that
    // never settles must become a visible failure, not a permanent spinner.
    vi.useFakeTimers()
    const invoke = vi.fn((_product: string, method: string) => method === 'marketAnalysis.listTimeline'
      ? new Promise(() => {})
      : Promise.resolve(null))
    vi.stubGlobal('platform', { products: { invoke } })
    const holder = { current: undefined as unknown as UseMarketAnalysisTimelineResult }
    function Probe(): null {
      holder.current = useMarketAnalysisTimeline({ text: timelineText })
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root?.render(createElement(Probe)))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(holder.current.state.loading).toBe(false)
    expect(holder.current.state.failed).toBe(true)
    vi.useRealTimers()
  })

  it('populates the timeline from the mount read, without waiting for a manual refresh', async () => {
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') return { schemaVersion: 1, nextCursor: null, items: [entry()] }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return []
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const holder = { current: undefined as unknown as UseMarketAnalysisTimelineResult }
    function Probe(): null {
      holder.current = useMarketAnalysisTimeline({ text: timelineText })
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root?.render(createElement(Probe)))
    await act(async () => {})
    expect(holder.current.state.entries).toHaveLength(1)
    expect(holder.current.state.loading).toBe(false)
    expect(holder.current.state.failed).toBeUndefined()
  })

  it('still populates after the development double mount discards the first read', async () => {
    // StrictMode mounts, unmounts and mounts again: the cleanup invalidates the
    // first read, so the second mount must run its own read instead of joining the
    // invalidated one - otherwise the list stays empty until the user refreshes.
    let releaseFirst: (() => void) | undefined
    let reads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') {
        reads += 1
        // The first mount's read is still in flight when the cleanup runs.
        if (reads === 1) await new Promise<void>(resolve => { releaseFirst = resolve })
        return { schemaVersion: 1, nextCursor: null, items: [entry()] }
      }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return []
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const holder = { current: undefined as unknown as UseMarketAnalysisTimelineResult }
    function Probe(): null {
      holder.current = useMarketAnalysisTimeline({ text: timelineText })
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root?.render(createElement(Probe, { key: 'first' })))
    // Unmount while the first read is still pending, exactly like StrictMode does.
    await act(async () => root?.render(createElement('div', { key: 'between' })))
    await act(async () => root?.render(createElement(Probe, { key: 'second' })))
    await act(async () => { releaseFirst?.() })
    await act(async () => {})
    expect(reads).toBeGreaterThanOrEqual(2)
    expect(holder.current.state.entries).toHaveLength(1)
    expect(holder.current.state.loading).toBe(false)
  })

  it('retries an empty first page instead of requiring a manual refresh', async () => {
    // The read can succeed while returning nothing (the producing side is still
    // settling), so an empty first page must retry too - not only a failed one.
    vi.useFakeTimers()
    let reads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') {
        reads += 1
        return { schemaVersion: 1, nextCursor: null, items: reads === 1 ? [] : [entry()] }
      }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return []
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const holder = { current: undefined as unknown as UseMarketAnalysisTimelineResult }
    function Probe(): null {
      holder.current = useMarketAnalysisTimeline({ text: timelineText })
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root?.render(createElement(Probe)))
    await act(async () => { await vi.advanceTimersByTimeAsync(analysisTimelineRefreshPolicy.initialRetryDelayMs + 50) })
    await act(async () => {})
    expect(reads).toBeGreaterThan(1)
    expect(holder.current.state.entries).toHaveLength(1)
    vi.useRealTimers()
  })

  it('keeps retrying while the product still reports queued work', async () => {
    // A longer startup than the retry window must not end in a permanent empty
    // list: work in flight is the signal that rows are about to appear.
    vi.useFakeTimers()
    let reads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') {
        reads += 1
        return { schemaVersion: 1, nextCursor: null, items: reads >= 3 ? [entry()] : [] }
      }
      if (method === 'marketAnalysis.getLatestAttempt') {
        return { id: 'run-1', status: 'running', failureCode: null, queuedAt: at, evidenceCount: 1 }
      }
      return []
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const holder = { current: undefined as unknown as UseMarketAnalysisTimelineResult }
    function Probe(): null {
      holder.current = useMarketAnalysisTimeline({ text: timelineText })
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root?.render(createElement(Probe)))
    await act(async () => { await vi.advanceTimersByTimeAsync(analysisTimelineRefreshPolicy.initialRetryDelayMs * 4) })
    await act(async () => {})
    expect(holder.current.state.entries).toHaveLength(1)
    vi.useRealTimers()
  })

  it('retries a failed first read instead of requiring a manual refresh', async () => {
    // Reported symptom: the list stayed empty on entry and only appeared after
    // clicking refresh, i.e. the mount read failed once and nothing retried it.
    vi.useFakeTimers()
    let reads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') {
        reads += 1
        if (reads === 1) throw new Error('product not ready yet')
        return { schemaVersion: 1, nextCursor: null, items: [entry()] }
      }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return []
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const holder = { current: undefined as unknown as UseMarketAnalysisTimelineResult }
    function Probe(): null {
      holder.current = useMarketAnalysisTimeline({ text: timelineText })
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root?.render(createElement(Probe)))
    await act(async () => { await vi.advanceTimersByTimeAsync(analysisTimelineRefreshPolicy.initialRetryDelayMs + 50) })
    await act(async () => {})
    expect(reads).toBeGreaterThan(1)
    expect(holder.current.state.entries).toHaveLength(1)
    vi.useRealTimers()
  })

  it('does not churn the loading state when the first page is already in flight', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    let reads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') {
        reads += 1
        await gate
        return { schemaVersion: 1, nextCursor: null, items: [entry()] }
      }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return []
    })
    vi.stubGlobal('platform', { products: { invoke } })
    const holder = { current: undefined as unknown as UseMarketAnalysisTimelineResult }
    function Probe(): null {
      holder.current = useMarketAnalysisTimeline({ text: timelineText })
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root?.render(createElement(Probe)))
    // A second trigger while the first page is still in flight must not start a
    // second read: that is what made the loading copy flash.
    await act(async () => { void holder.current.load(); void holder.current.load() })
    expect(reads).toBe(1)
    release?.()
    await act(async () => {})
    expect(holder.current.state.loading).toBe(false)
  })

  it('opens a non-modal drawer with the selected node detail and no backdrop', async () => {
    const { container } = await mountSurface([entry()], timeline =>
      createElement(AnalysisDetailDrawer, { text: timelineText, workspaceText, timeline, openEntry: entry() as never, onOpenChange: vi.fn() }))

    const drawer = container.querySelector('.mi-analysis-drawer')
    expect(drawer?.getAttribute('role')).toBe('complementary')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('.ant-drawer-mask, .ant-modal-mask, [data-backdrop]')).toBeNull()
    const conclusion = container.querySelector('.mi-analysis-conclusion__body')
    // The body is split into labelled blocks, so the text is compared with collapsed
    // whitespace; the published conclusion itself must still be present in full.
    expect(conclusion?.textContent?.replace(/\s+/gu, '')).toBe(completeConclusion.replace(/\s+/gu, ''))
    expect(container.textContent).toContain('恐惧贪婪指数处于高位。')
    expect(container.querySelector('.mi-analysis-timeline__audit')?.hasAttribute('open')).toBe(false)
  })

  it('shows a conclusion published before the fix with names and approximate magnitudes', async () => {
    // Quoted from a real published conclusion: the model copied the machine identifiers and raw
    // integers it was handed, so both surfaces have to name and scale them at display time.
    const legacy = '方向：偏空：本次变化：稳定币current-usd由257,970,817,433.68085降至257,938,932,953.4702；'
      + 'change-1d-usd由-406,814,368.04333496变为-439,273,208.6280823；其余输入字段无新变化。'
      + '数据缺口：缺少 cross-asset 价格反应，且缺乏 consensus 无法判断预期差方向。'
    const legacySummary = { ...summary(), eventAssessment: legacy }
    // The workspace layout merges both registries before handing text to the detail surfaces.
    const detailText = { ...timelineText, ...workspaceText }
    // The card shows the verdict sentence and nothing else: the labelled parts belong to the drawer,
    // so this is a current-shaped conclusion with its verdict first.
    const current = '方向：偏空：稳定币current-usd由257,970,817,433.68085降至257,938,932,953.4702，'
      + 'change-1d-usd由-406,814,368.04333496变为-439,273,208.6280823，资金面转弱。'
      + '本次变化：同上。数据缺口：缺少 cross-asset 价格反应，且缺乏 consensus 无法判断预期差方向。'
    const card = await mountSurface([entry()], timeline =>
      createElement(LatestAnalysisConclusionCard, { text: detailText, workspaceText, timeline, onOpenDetail: vi.fn() }),
    { summaryValue: { ...summary(), eventAssessment: current } })
    const cardConclusion = card.container.querySelector('.mi-analysis-conclusion-card__conclusion')

    expect(cardConclusion?.textContent).toContain('稳定币当前值由2579.71 亿降至2579.39 亿')
    expect(cardConclusion?.textContent).toContain('1 日变化由-4.07 亿变为-4.39 亿')
    expect(cardConclusion?.textContent).not.toMatch(/current-usd|change-1d-usd|cross-asset|consensus|257,970,817,433|04333496/)
    // Verdict only on the card: no labelled block reaches it.
    expect(card.container.querySelector('.mi-analysis-conclusion__block')).toBeNull()
    expect(cardConclusion?.textContent).not.toContain('缺少 跨资产 价格反应')

    const drawer = await mountSurface([entry()], timeline =>
      createElement(AnalysisDetailDrawer, { text: detailText, workspaceText, timeline, openEntry: entry() as never, onOpenChange: vi.fn() }),
    { summaryValue: legacySummary })
    const detail = drawer.container.querySelector('.mi-analysis-conclusion__body')
    expect(detail?.textContent).not.toMatch(/current-usd|change-1d-usd|cross-asset|consensus|257,970,817,433/)
    // The labelled parts still split, so nothing was shortened into a preview.
    expect(drawer.container.querySelector('.mi-analysis-conclusion__block[data-block="change"]')).not.toBeNull()
    expect(drawer.container.querySelector('.mi-analysis-conclusion__block[data-block="data-gap"]')).not.toBeNull()
  })

  it('shows a published analysis in the reader time zone instead of raw UTC', async () => {
    // 真机症状：`2026-09-28 00:00 UTC`（其实是本地 08:00）被当成当地时间读。
    const { container } = await mountSurface([entry()], timeline =>
      createElement(LatestAnalysisConclusionCard, { text: { ...timelineText, ...workspaceText }, workspaceText, timeline, onOpenDetail: vi.fn() }),
    { timeZone: 'Asia/Shanghai' })
    const time = container.querySelector('.mi-analysis-conclusion-card time')

    expect(time?.textContent).toBe('2026-09-28 08:00:00 GMT+8')
    expect(container.textContent).not.toContain('UTC')
  })

  it('names the timeline entry the same way as the card beside it', async () => {
    const legacy = '本次变化：change-1d-usd由-406,814,368.04333496变为-439,273,208.6280823。'
    const { container } = await mountSurface([entry({ safeExcerpt: legacy })], timeline =>
      createElement(TimelinePanel, { text: timelineText, timeline, onOpenChange: vi.fn() }))
    // New row contract: a row carries the conclusion only, and this legacy excerpt has none — its
    // labelled parts (with their readable names) are rendered by the drawer, which the cases above
    // cover. So the row is silent here rather than echoing machine encodings.
    expect(container.querySelector('.mi-analysis-timeline__conclusion-line')?.textContent ?? '').toBe('')
    expect(container.textContent).not.toMatch(/change-1d-usd|406,814,368/)
  })

  it('names a Chinese conclusion in Chinese even when the surrounding UI is English', async () => {
    const legacy = '方向：偏空：稳定币current-usd由257,970,817,433.68085降至257,938,932,953.4702，资金面转弱。'
    const legacySummary = { ...summary(), eventAssessment: legacy }
    const english = productText['en-US'].pages.intelligence.portal
    const englishDetailText = { ...english.analysisTimeline, ...english.analysisWorkspace }

    const card = await mountSurface([entry()], timeline =>
      createElement(LatestAnalysisConclusionCard, { text: englishDetailText, workspaceText: english.analysisWorkspace, timeline, onOpenDetail: vi.fn() }),
    { summaryValue: legacySummary })
    const conclusion = card.container.querySelector('.mi-analysis-conclusion-card__conclusion')

    // The prose is Chinese, so its identifiers are named in Chinese; only the chrome is English.
    expect(conclusion?.textContent).toContain('稳定币当前值由2579.71 亿降至2579.39 亿')
    expect(conclusion?.textContent).not.toContain('Current')
  })

  it('dismisses the drawer with Escape and with the close control', async () => {
    const onOpenChange = vi.fn()
    const { container } = await mountSurface([entry()], timeline =>
      createElement(AnalysisDetailDrawer, { text: timelineText, workspaceText, timeline, openEntry: entry() as never, onOpenChange }))

    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onOpenChange).toHaveBeenCalledWith(undefined)
    await act(async () => container.querySelector<HTMLButtonElement>('.mi-analysis-drawer__header button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onOpenChange).toHaveBeenCalledTimes(2)
  })

  it('reports a selected timeline node to the dashboard without dropping the chat binding', async () => {
    const onSelect = vi.fn()
    const reported: string[] = []
    const { container } = await mountSurface([entry()], timeline =>
      createElement(TimelinePanel, { text: timelineText, timeline, onOpenChange: selected => reported.push(selected?.id ?? 'none') }), { onSelect })

    await clickEntry(container)
    expect(reported).toEqual(['mi-tl-1'])
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', summaryId: 'mi-as-1' }))
  })

  it('renders the selected node conclusion in full inside the drawer', async () => {
    function Surface({ timeline }: { timeline: UseMarketAnalysisTimelineResult }): React.ReactElement {
      const [openEntry, setOpenEntry] = useState<ReturnType<typeof entry>>()
      return createElement('div', {},
        createElement(TimelinePanel, { text: timelineText, timeline, onOpenChange: selected => setOpenEntry(selected as never) }),
        createElement(AnalysisDetailDrawer, { text: timelineText, workspaceText, timeline, openEntry: openEntry as never, onOpenChange: selected => setOpenEntry(selected as never) })
      )
    }
    const { container } = await mountSurface([entry()], timeline => createElement(Surface, { timeline }))

    await clickEntry(container)
    const conclusion = container.querySelector('.mi-analysis-conclusion__body')
    // The body is split into labelled blocks, so the text is compared with collapsed
    // whitespace; the published conclusion itself must still be present in full.
    expect(conclusion?.textContent?.replace(/\s+/gu, '')).toBe(completeConclusion.replace(/\s+/gu, ''))
    // Dismissing is presentation-only: the list keeps the node selected.
    await act(async () => container.querySelector<HTMLButtonElement>('.mi-analysis-drawer__header button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.mi-analysis-drawer')).toBeNull()
    expect(container.querySelector('.mi-analysis-timeline__entry')?.className).toContain('is-selected')
  })
})
