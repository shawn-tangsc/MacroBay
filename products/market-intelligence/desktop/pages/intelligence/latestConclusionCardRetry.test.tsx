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

/**
 * 「读不到」不许画成「没有」（2026-11-17，用户截图「暂无已发布的 AI 结论」，而库里 20:10 有一条）。
 *
 * 根因链：情报模块启动失败 → IPC 置 unavailable → `listTimeline` 抛 `product-runtime-unavailable`
 * → 卡片在 `!latest && !state.loading` 上直接印了「暂无」。那一句是在说「你没有结论」，而事实是
 * 「这次读不到」。两条判据：① 读失败要落错误态 + 重试，且不许出现「暂无」；② 只有读成功且确实为空
 * 才是「暂无」。
 */
describe('the latest conclusion card when the timeline itself cannot be read', () => {
  /** 每次 `listTimeline` 都抛模块不可用；其余 IPC 给一个读不出来的空载荷。 */
  function stubUnavailableRuntime(): { reads: () => number } {
    let listReads = 0
    const invoke = vi.fn(async (_product: string, method: string) => {
      if (method === 'marketAnalysis.listTimeline') {
        listReads += 1
        throw new Error('product-runtime-unavailable')
      }
      if (method === 'marketAnalysis.getLatestAttempt') return null
      return undefined
    })
    vi.stubGlobal('platform', { products: { invoke } })
    return { reads: () => listReads }
  }

  it('模块不可用 → 错误态 + 重试，绝不出现「暂无已发布」', async () => {
    vi.useFakeTimers()
    const stub = stubUnavailableRuntime()
    const holder: { current?: UseMarketAnalysisTimelineResult } = {}
    function Probe(): React.ReactElement {
      const timeline = useMarketAnalysisTimeline({ text })
      holder.current = timeline
      return createElement(LatestAnalysisConclusionCard, { text, workspaceText, timeline, onOpenDetail: vi.fn() } as never)
    }
    await act(async () => root?.render(createElement(ShellTimeZoneProvider, null, createElement(Probe))))
    // 有界重试跑完才落失败态（10 次 / 30s 预算）。
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000) })

    expect(holder.current?.state.failed).toBe(true)
    // 原因要真的带出来：模块没起来，不是「读到了但没有」。
    expect(holder.current?.state.failure).toBe('product-runtime-unavailable')
    // ① 不许说「暂无」——那句话在说读者没有结论。
    expect(host?.textContent).not.toContain(workspaceText.latestConclusionEmpty)
    // ② 错误态走统一状态面，并且有出口。
    const stateView = host?.querySelector('[data-state="error"]')
    expect(stateView).not.toBeNull()
    const retry = stateView?.querySelector<HTMLButtonElement>('button.state-view__action')
    expect(retry).not.toBeNull()
    // ③ 那个出口真的再读一次，不是装饰。
    const before = stub.reads()
    await act(async () => { retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(stub.reads()).toBeGreaterThan(before)
    vi.useRealTimers()
  })

  it('读成功且确实没有已发布条目 → 才是「暂无」', async () => {
    const timeline = {
      state: { entries: [], loading: false, failed: false, nextCursor: null },
      details: {},
      detailState: {},
      load: vi.fn()
    } as unknown as UseMarketAnalysisTimelineResult
    await act(async () => root?.render(createElement(ShellTimeZoneProvider, null,
      createElement(LatestAnalysisConclusionCard, { text, workspaceText, timeline, onOpenDetail: vi.fn() } as never))))
    expect(host?.textContent).toContain(workspaceText.latestConclusionEmpty)
    expect(host?.querySelector('[data-state="error"]')).toBeNull()
  })
})

/**
 * 外层卡也要说「刚才失败了」（用户 2026-11-18：「出现这种情况了，外面那层也要显示出来」）。
 *
 * 时间轴里有 00:54 的解析失败，卡上却还是 20:10 的成功结论、一个字不提——读者会把上次成功当成
 * 现在。判据：① 有比已发布更新的失败时，卡上同时出现「那条已发布结论」与「最近一次解析失败（时刻）·
 * 重试」；② 只有已发布时不许出现失败条；③ 时刻走统一格式化（`<time>`），句子用失败码对应的人话。
 */
describe('the latest conclusion card when the newest attempt failed', () => {
  const publishedEntry = {
    id: 'mi-tl-published', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-ok', kind: 'analysis' as const,
    status: 'published' as const, runKey: 'mi-ar-ok', failureCode: null,
    occurredAt: '2026-11-17T20:10:00.000Z', summaryRef: 'mi-as-1', safeTitle: '市场分析已生成',
    safeExcerpt: '摘要', version: 1, triggerStatus: null, groupType: 'sentiment', groupSubject: '新闻标题'
  }
  const failedEntry = {
    ...publishedEntry,
    id: 'run:mi-ar-fail', analysisRunId: 'mi-ar-fail', runKey: 'mi-ar-fail', status: 'failed' as const,
    failureCode: 'analysis-provider-error', occurredAt: '2026-11-18T00:54:00.000Z',
    summaryRef: null, safeTitle: '', safeExcerpt: null
  }
  const cardDetail = {
    summary: {
      id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-ok', eventGroupId: 'mi-eg-1', version: 1,
      eventAssessment: '市场情绪偏谨慎', knownFacts: [], transmissionHypotheses: [], marketReaction: [],
      supportingEvidence: [], counterEvidence: [], scenarios: [], nextCatalysts: [], dataCaveats: [],
      evidenceRefs: [], createdAt: asOf
    }
  }
  const cardWorkspaceText = {
    ...workspaceText,
    retryAnalysis: text.retryAnalysis,
    failureReasons: text.failureReasons
  }

  function timelineWith(entries: readonly unknown[], extra: Record<string, unknown> = {}) {
    return {
      state: { entries, loading: false, failed: false, nextCursor: null },
      details: { 'mi-tl-published': cardDetail },
      detailState: {},
      requestRefreshAnalysis: vi.fn(),
      ensureDetail: vi.fn(),
      ...extra
    } as unknown as UseMarketAnalysisTimelineResult
  }

  async function mount(timeline: UseMarketAnalysisTimelineResult): Promise<void> {
    await act(async () => root?.render(createElement(ShellTimeZoneProvider, null,
      createElement(LatestAnalysisConclusionCard, { text, workspaceText: cardWorkspaceText, timeline, onOpenDetail: vi.fn() } as never))))
  }

  it('已发布 20:10 + 失败 00:54 → 结论与失败条同时在，重试真的重排一次', async () => {
    const timeline = timelineWith([failedEntry, publishedEntry])
    await mount(timeline)

    // ① 上次成功的那条仍然在（不许把已发布内容撤掉）
    expect(host?.textContent).toContain('市场情绪偏谨慎')
    // ② 失败条可见：抬头 + 时刻 + 人话原因
    const strip = host?.querySelector('[data-attempt-failure]')
    expect(strip).not.toBeNull()
    expect(strip?.textContent).toContain(cardWorkspaceText.latestConclusionAttemptFailed)
    expect(strip?.querySelector('time')?.textContent ?? '').not.toBe('')
    expect(strip?.textContent).toContain(text.failureReasons['analysis-provider-error'])
    // 不印码
    expect(strip?.textContent).not.toContain('analysis-provider-error')
    // ③ 重试走「再分析一次」，不是刷新页面
    const retry = Array.from(strip?.querySelectorAll('button') ?? []).find((button) => button.textContent === text.retryAnalysis)
    expect(retry).toBeDefined()
    await act(async () => { retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect((timeline as unknown as { requestRefreshAnalysis: ReturnType<typeof vi.fn> }).requestRefreshAnalysis).toHaveBeenCalledTimes(1)
  })

  it('只有已发布时，不许出现失败条', async () => {
    await mount(timelineWith([publishedEntry]))
    expect(host?.querySelector('[data-attempt-failure]')).toBeNull()
    expect(host?.textContent).toContain('市场情绪偏谨慎')
  })

  it('只有失败、没有已发布时：说失败，不说「暂无」', async () => {
    await mount(timelineWith([failedEntry], { details: {} }))
    expect(host?.querySelector('[data-attempt-failure]')).not.toBeNull()
    expect(host?.textContent).not.toContain(workspaceText.latestConclusionEmpty)
  })
})

/**
 * 失败条只属于**这张卡那一组**，而且进行中不许显示（用户 2026-11-18 直接要求）。
 *
 * 真库里的错法：卡片显示 A 组的成功结论，下面却挂着 B 组 08:06 那次失败——别组失败串到这张卡。
 * 三条判据：① 别组失败不出现；② 本组有运行在跑时那条消失（点了「重新分析」立刻收掉）；
 * ③ 这次重试再失败，失败条重新出现且时刻是新的。
 */
describe('the latest conclusion card: the failure strip belongs to its own group', () => {
  const groupA = 'mi-eg-A'
  const groupB = 'mi-eg-B'
  const published = (occurredAt: string, group = groupA) => ({
    id: `mi-tl-${group}`, eventGroupId: group, analysisRunId: `mi-ar-ok-${group}`, kind: 'analysis' as const,
    status: 'published' as const, runKey: `mi-ar-ok-${group}`, failureCode: null, occurredAt,
    summaryRef: 'mi-as-1', safeTitle: '市场分析已生成', safeExcerpt: '摘要', version: 1,
    triggerStatus: null, groupType: 'sentiment', groupSubject: '标题'
  })
  const failed = (occurredAt: string, group = groupA, id = `mi-ar-fail-${group}`) => ({
    ...published(occurredAt, group), id: `run:${id}`, analysisRunId: id, runKey: id, status: 'failed' as const,
    failureCode: 'analysis-provider-error', summaryRef: null, safeTitle: '', safeExcerpt: null
  })
  const running = (group = groupA) => ({
    ...published('2026-11-18T09:10:00.000Z', group), id: `run:${group}-live`, analysisRunId: `${group}-live`,
    runKey: `${group}-live`, status: 'running' as const, summaryRef: null, safeTitle: '', safeExcerpt: null
  })
  const cardDetail = {
    summary: {
      id: 'mi-as-1', schemaVersion: 1, analysisRunId: 'mi-ar-ok', eventGroupId: groupA, version: 1,
      eventAssessment: '市场情绪偏谨慎', knownFacts: [], transmissionHypotheses: [], marketReaction: [],
      supportingEvidence: [], counterEvidence: [], scenarios: [], nextCatalysts: [], dataCaveats: [],
      evidenceRefs: [], createdAt: '2026-11-17T20:10:00.000Z'
    }
  }
  const cardText = { ...workspaceText, retryAnalysis: text.retryAnalysis, failureReasons: text.failureReasons }

  function timelineWith(entries: readonly unknown[], extra: Record<string, unknown> = {}): UseMarketAnalysisTimelineResult {
    return {
      state: { entries, loading: false, failed: false, nextCursor: null },
      details: { [`mi-tl-${groupA}`]: cardDetail },
      detailState: {},
      requestState: 'idle',
      requestRefreshAnalysis: vi.fn(),
      ensureDetail: vi.fn(),
      ...extra
    } as unknown as UseMarketAnalysisTimelineResult
  }

  async function mount(timeline: UseMarketAnalysisTimelineResult): Promise<void> {
    await act(async () => root?.render(createElement(ShellTimeZoneProvider, null,
      createElement(LatestAnalysisConclusionCard, { text, workspaceText: cardText, timeline, onOpenDetail: vi.fn() } as never))))
  }

  it('别组的失败不出现（本组成功 20:10 + 别组失败 08:06 更晚）', async () => {
    await mount(timelineWith([failed('2026-11-18T08:06:00.000Z', groupB), published('2026-11-17T20:10:00.000Z')]))
    expect(host?.textContent).toContain('市场情绪偏谨慎')
    expect(host?.querySelector('[data-attempt-failure]')).toBeNull()
  })

  it('本组失败 → 点重试、该组有运行在跑 → 失败条立刻消失', async () => {
    const timeline = timelineWith([failed('2026-11-18T08:06:00.000Z'), published('2026-11-17T20:10:00.000Z')])
    await mount(timeline)
    expect(host?.querySelector('[data-attempt-failure]')).not.toBeNull()

    // 点了重试：请求在飞（`queued`）时那条报错就该收掉
    await mount(timelineWith([failed('2026-11-18T08:06:00.000Z'), published('2026-11-17T20:10:00.000Z')], { requestState: 'queued' }))
    expect(host?.querySelector('[data-attempt-failure]')).toBeNull()

    // 运行真的出现在列表里（该组 running）时也不显示
    await mount(timelineWith([running(), failed('2026-11-18T08:06:00.000Z'), published('2026-11-17T20:10:00.000Z')]))
    expect(host?.querySelector('[data-attempt-failure]')).toBeNull()
  })

  it('这次重试再失败 → 失败条重新出现，时刻是新的', async () => {
    await mount(timelineWith([failed('2026-11-18T08:06:00.000Z'), published('2026-11-17T20:10:00.000Z')]))
    const firstTime = host?.querySelector('[data-attempt-failure] time')?.textContent
    expect(firstTime ?? '').not.toBe('')

    await mount(timelineWith([failed('2026-11-18T09:12:00.000Z', groupA, 'mi-ar-fail-retry'), published('2026-11-17T20:10:00.000Z')]))
    const strip = host?.querySelector('[data-attempt-failure]')
    expect(strip).not.toBeNull()
    expect(strip?.querySelector('time')?.textContent ?? '').not.toBe('')
    expect(strip?.querySelector('time')?.textContent).not.toBe(firstTime)
  })
})
