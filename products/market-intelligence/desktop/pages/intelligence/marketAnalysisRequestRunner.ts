import { isAlreadyAvailableError } from './marketAnalysisTimelineRead'
import type { AnalysisTimelineRefreshPolicy } from './analysisTimelineRefreshPolicy'
import type {
  MarketAnalysisAttempt, MarketAnalysisTimelineClient, MarketAnalysisTimelineEntry
} from '../../shared/ipc/marketAnalysisTimelineClient'
import type { NewsInterpretationRequestView } from '../../shared/ipc/newsInterpretationClient'
import type { AnalysisRequestFailure, AnalysisRequestState } from './marketAnalysisRequestState'

/**
 * 「请求一次分析、等它发布」的状态机：排队、有界轮询、终态判别、把拒绝与「跑了没发布」分开报。
 *
 * 从 `useMarketAnalysisTimeline` 抽出来，hook 只留编排与渲染态。时间轴自己的按钮与按条「AI 解读」
 * 共用这一份，所以界面上只有一种「正在解析」；两者只是入口不同、落点不同。
 */
export type PollOutcome = 'published' | 'failed' | 'pending' | 'unreadable'
export type PollResult = Readonly<{ outcome: PollOutcome }>

export type AnalysisRequestRunner = Readonly<{
  requestInitialAnalysis: () => Promise<void>
  requestRefreshAnalysis: () => Promise<void>
  requestItemAnalysis: (itemId: string) => Promise<NewsInterpretationRequestView>
  regenerateConclusion: (eventGroupId: string) => Promise<void>
}>

/**
 * 一个拒绝原因 → 界面状态。分开列，不做（原因 ∪ 状态）的隐式映射：
 * 「服务还没起来」与「还没有可用的模型」对读者是两件事，句子不一样。
 */
function stateForRefusal(reason: 'not-eligible' | 'not-ready' | 'provider-not-ready' | 'failed' | 'already-available'): AnalysisRequestState {
  if (reason === 'not-eligible') return 'unavailable'
  if (reason === 'not-ready') return 'not-ready'
  if (reason === 'provider-not-ready') return 'provider-not-ready'
  if (reason === 'already-available') return 'already-available'
  return 'failed'
}

export function createAnalysisRequestRunner(deps: Readonly<{
  policy: AnalysisTimelineRefreshPolicy
  load: (cursor?: string, readAttempt?: boolean) => Promise<{ entries: readonly MarketAnalysisTimelineEntry[]; attempt: MarketAnalysisAttempt | null } | undefined>
  latestEntryId: () => string | undefined
  retryRunId: () => string | undefined
  setRequestState: (state: AnalysisRequestState) => void
  setRequestFailure: (failure?: AnalysisRequestFailure) => void
  pollTimer: { current: ReturnType<typeof setTimeout> | undefined }
  client: Pick<MarketAnalysisTimelineClient, 'requestInitialAnalysis'>
  requestNewsInterpretation: (itemId: string) => Promise<NewsInterpretationRequestView>
}>): AnalysisRequestRunner {
  const pollForCompletion = async (baselineEntryId: string | undefined, pollAttempt = 0): Promise<PollResult> => {
    deps.setRequestState('queued')
    const loaded = await deps.load(undefined, true)
    if (!loaded) {
      // The read itself failed. Leaving the request `queued` kept the action disabled forever with
      // no poll left to end it; the list already reports the read failure, so release the action.
      deps.setRequestState('idle')
      return { outcome: 'unreadable' }
    }
    const published = loaded.entries[0]
    if (published && published.id !== baselineEntryId) {
      deps.setRequestState('idle')
      return { outcome: 'published' }
    }
    const latest = loaded.attempt
    // `stale`/`superseded` never publish either: they are terminal for this reader's purposes,
    // and leaving them out made the poll run to its limit and report a failure with no reason.
    const terminalFailure = latest && ['failed', 'invalid-output', 'cancelled', 'stale', 'superseded'].includes(latest.status)
    if (terminalFailure) {
      deps.setRequestState('failed')
      deps.setRequestFailure('run')
      return { outcome: 'failed' }
    }
    if (latest?.status === 'succeeded') {
      // A succeeded run whose node never appeared is a real "not published", unlike a run that
      // is still working inside its budget.
      deps.setRequestState('failed')
      deps.setRequestFailure('run')
      return { outcome: 'failed' }
    }
    if (pollAttempt >= deps.policy.maxPollAttempts) {
      const stillRunning = Boolean(latest && ['queued', 'running'].includes(latest.status))
      if (stillRunning) {
        // Stop watching without claiming a failure: the run is past the job budget but may still
        // land, and the live poll will show it. The action is released and the panel says it is
        // still running; `queued` here would leave the button disabled with no timer left.
        deps.setRequestState('still-running')
        return { outcome: 'pending' }
      }
      deps.setRequestState('failed')
      deps.setRequestFailure('run')
      return { outcome: 'failed' }
    }
    await new Promise<void>(resolve => { deps.pollTimer.current = setTimeout(resolve, deps.policy.pollIntervalMs) })
    return pollForCompletion(baselineEntryId, pollAttempt + 1)
  }

  const requestInitialAnalysis = async (): Promise<void> => {
    deps.setRequestState('loading')
    deps.setRequestFailure(undefined)
    const result = await deps.client.requestInitialAnalysis(deps.retryRunId())
    if (result.state !== 'queued') {
      const next = stateForRefusal(result.reason)
      deps.setRequestState(next)
      if (next === 'failed') deps.setRequestFailure('request')
      return
    }
    await pollForCompletion(undefined)
  }

  /**
   * One refresh request: queue the run and wait for it to publish or fail.
   *
   * A refusal (`already-available`, `not-ready`, an IPC error) is reported as `request`; a run
   * that finished without publishing is reported as `run`, so the surface can say which happened.
   */
  const enqueueRefresh = async (baselineEntryId: string | undefined, eventGroupId?: string): Promise<PollResult | 'refused'> => {
    deps.setRequestState('loading')
    deps.setRequestFailure(undefined)
    let result: Awaited<ReturnType<MarketAnalysisTimelineClient['requestInitialAnalysis']>>
    try {
      result = await deps.client.requestInitialAnalysis(undefined, 'refresh', eventGroupId)
    } catch (error) {
      // The service refuses with `analysis-already-available` when a usable analysis already exists —
      // including the run it just finished. That is not a failure to report as "not published".
      const already = isAlreadyAvailableError(error)
      deps.setRequestState(already ? 'already-available' : 'failed')
      if (!already) deps.setRequestFailure('request')
      return 'refused'
    }
    if (result.state !== 'queued') {
      const next = stateForRefusal(result.reason)
      deps.setRequestState(next)
      if (next === 'failed') deps.setRequestFailure('request')
      return 'refused'
    }
    return pollForCompletion(baselineEntryId)
  }

  /**
   * Per-item request behind "AI 解读". It deliberately reuses `pollForCompletion`, the same state
   * machine the timeline's own action uses: one `queued` means one thing on every surface. A refusal
   * (no judgment, not eligible, not ready, transport) never started a run, so it releases the action
   * instead of pretending something is in flight; the caller shows its own sentence for that case.
   */
  const requestItemAnalysis = async (itemId: string): Promise<NewsInterpretationRequestView> => {
    deps.setRequestState('loading')
    deps.setRequestFailure(undefined)
    const result = await deps.requestNewsInterpretation(itemId)
    if (result.state === 'queued' || result.state === 'in-flight') {
      await pollForCompletion(deps.latestEntryId())
      return result
    }
    if (result.state === 'already-available') {
      deps.setRequestState('already-available')
      void deps.load()
      return result
    }
    deps.setRequestState('idle')
    return result
  }

  const requestRefreshAnalysis = async (): Promise<void> => {
    // The retry after a contract rejection lives in the analysis orchestrator, not here: it must
    // also cover scheduled runs and runs whose panel is closed, and it re-asks against the same
    // frozen snapshot. The poll simply keeps waiting while that second answer is produced.
    await enqueueRefresh(deps.latestEntryId())
  }

  /**
   * 旧结论的语言与当前界面不同时，读者点的「重新生成」：同一事件组再跑一次，产生**新记录**。
   * 旧记录原样留着（结论可追溯）——这里从不覆盖已发布的东西。
   */
  const regenerateConclusion = async (eventGroupId: string): Promise<void> => {
    await enqueueRefresh(deps.latestEntryId(), eventGroupId)
  }
  return { requestInitialAnalysis, requestRefreshAnalysis, requestItemAnalysis, regenerateConclusion }
}
