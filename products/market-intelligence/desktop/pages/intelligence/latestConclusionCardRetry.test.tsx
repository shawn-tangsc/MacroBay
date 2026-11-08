// @vitest-environment happy-dom

import { act, createElement, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { productText } from '../../shared/i18n/productText'
import { selectLatestPublishedEntry } from '../../../contracts/latestPublishedAnalysis'
import { LatestAnalysisConclusionCard } from './LatestAnalysisConclusionCard'
import { useMarketAnalysisTimeline, type UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'

/**
 * 「卡片卡死」的出口（2026-11-08，用户原话「也不卡住才对」）。
 *
 * 根因（白名单不认得 `divergences`）已经在读取端修了，但**失败后没有出口**这个设计缺陷还在：
 * 有界重试（1.5s / 4s / 10s）跑完落到 `unavailable` 之后，卡片的 `useEffect` 依赖 `[latest?.id]`、
 * id 不变就永不重读，只能等下一次分析出现。
 *
 * 两条判据：① 错态走统一状态面 `StateView(state="error")` 并带「再试一次」；② 那个动作真的重读。
 */
const asOf = '2026-09-28T00:00:00.000Z'
const text = productText['zh-CN'].pages.intelligence.portal.analysisTimeline
const workspaceText = productText['zh-CN'].pages.intelligence.portal.analysisWorkspace

const entry = () => ({
  id: 'mi-tl-1', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1', kind: 'analysis' as const,
  status: 'published' as const, occurredAt: asOf, summaryRef: 'mi-as-1', safeTitle: '市场分析已生成',
  safeExcerpt: '摘要', direction: null, version: 1, triggerStatus: null, groupType: null, groupSubject: null
})

const summary = () => ({
  id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-1', eventGroupId: 'mi-eg-1', version: 1,
  eventAssessment: '市场情绪偏谨慎', knownFacts: [], transmissionHypotheses: [], marketReaction: [],
  supportingEvidence: [], counterEvidence: [], scenarios: [], nextCatalysts: [], dataCaveats: [],
  evidenceRefs: ['mi-ev-1'], createdAt: asOf
})

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** 摘要读取失败 `failures` 次后才成功；走的是与页面同一条 IPC。 */
function stubReads(failures: number): { invoke: ReturnType<typeof vi.fn>; reads: () => number } {
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
      if (summaryReads <= failures) throw new Error('analysis-summary-not-found')
      return summary()
    }
    return []
  })
  vi.stubGlobal('platform', { products: { invoke } })
  return { invoke, reads: () => summaryReads }
}

describe('the latest conclusion card when the detail cannot be read', () => {
  it('lets the reader retry, and that retry really re-reads the node', async () => {
    vi.useFakeTimers()
    const { reads } = stubReads(4)
    const holder: { current?: UseMarketAnalysisTimelineResult } = {}
    function Probe(): null {
      const timeline = useMarketAnalysisTimeline({ text })
      holder.current = timeline
      // 与卡片一样：最新节点一出现就读它的详情。
      const latest = selectLatestPublishedEntry(timeline.state.entries)
      useEffect(() => { if (latest) timeline.ensureDetail(latest) }, [latest?.id])
      return null
    }
    await act(async () => root?.render(createElement(Probe)))
    await act(async () => {})
    // 有界重试（1.5s / 4s / 10s）跑完 → 落到 unavailable，四次都读不到。
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(holder.current?.detailState['mi-tl-1']).toBe('unavailable')
    const readsAfterRetries = reads()
    expect(readsAfterRetries).toBeGreaterThanOrEqual(4)

    // 读者点「再试一次」：与抽屉同一条 `ensureDetail`，真的再走一次读取。
    await act(async () => { holder.current?.ensureDetail(entry() as never) })
    await act(async () => {})
    expect(reads()).toBeGreaterThan(readsAfterRetries)
    expect(holder.current?.details['mi-tl-1']).toBeDefined()
    expect(holder.current?.detailState['mi-tl-1']).toBeUndefined()
  })

  it('draws the unreadable state with the shared StateView, not a bare alert paragraph', async () => {
    const ensureDetail = vi.fn()
    const timeline = {
      state: { entries: [entry()], loading: false, failed: false, nextCursor: null },
      details: {},
      detailState: { 'mi-tl-1': 'unavailable' },
      ensureDetail
    } as unknown as UseMarketAnalysisTimelineResult
    await act(async () => root?.render(createElement(ShellTimeZoneProvider, null,
      // 作用域工程里 props 的可选/必填推导与整棵项目不同，这里按组件签名收窄一次，避免把
    // 「测试替身的形状」当成产品契约的一部分。
      createElement(LatestAnalysisConclusionCard, { text, workspaceText, timeline, onOpenDetail: vi.fn() } as never))))

    // 统一状态面（`data-state="error"`），不是自绘的裸 <p role="alert">。
    const stateView = host?.querySelector('[data-state="error"]')
    expect(stateView).not.toBeNull()
    expect(host?.querySelector('p[role="alert"]')).toBeNull()

    const retry = stateView?.querySelector<HTMLButtonElement>('button.state-view__action')
    expect(retry).not.toBeNull()
    // 卡片挂载时自己会读一次；这里只关心「点重试」又真的再读一次。
    const before = ensureDetail.mock.calls.length
    await act(async () => { retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(ensureDetail.mock.calls.length).toBe(before + 1)
    expect(ensureDetail.mock.calls.at(-1)?.[0]).toMatchObject({ id: 'mi-tl-1' })
  })
})
