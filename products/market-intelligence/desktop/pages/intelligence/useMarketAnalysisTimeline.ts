import { useCallback, useEffect, useRef, useState } from 'react'

import { analysisTimelineRefreshPolicy } from './analysisTimelineRefreshPolicy'
import type { AnalysisWorkspaceBinding } from '../../../contracts/analysisWorkspaceContracts'
import { analysisWorkspacePolicy } from '../../../contracts/analysisWorkspaceContracts'
import { isAlreadyAvailableError, withReadTimeout } from './marketAnalysisTimelineRead'

// Kept importable from here: callers and tests already name this module.
export { isAlreadyAvailableError } from './marketAnalysisTimelineRead'
import {
  marketAnalysisTimelineClient,
  type MarketAnalysisAttempt,
  type MarketAnalysisTimelineDetail,
  type MarketAnalysisTimelineEntry
} from '../../shared/ipc/marketAnalysisTimelineClient'

export type AnalysisSelectionState = 'none' | 'loading' | 'ready' | 'unavailable'
export type AnalysisRequestState = 'idle' | 'loading' | 'queued' | 'still-running' | 'unavailable' | 'not-ready' | 'failed' | 'already-available'
/**
 * Where a failed request failed.
 *
 * A refusal before a run exists ("the service said no") and a run that finished without
 * publishing are different failures, and rendering both as "the request did not go through"
 * told the reader nothing about the analysis they had just asked for.
 */
export type AnalysisRequestFailure = 'request' | 'run'

/** Text slice the workspace surfaces need; owned by the product i18n registry. */
export type AnalysisTimelineText = Readonly<{
  loading: string
  unavailable: string
  attemptFailed: string
  failureReasons: Record<string, string>
  initialAnalysisFailed: string
}>

type State = Readonly<{
  loading: boolean
  /**
   * A read is running on top of a view that has already settled. Deliberately not `loading`:
   * the panel must keep showing what it already knows while the poll refreshes it, or the
   * empty state and the loading copy alternate once per poll tick.
   */
  refreshing?: boolean
  failed?: boolean
  /**
   * Outcome of the most recent read, kept only so the empty state can say what
   * actually happened. The renderer console does not reach the host terminal, so
   * this is the only way to see the renderer's own view of a read.
   */
  lastRead?: string
  nextCursor?: string | null
  entries: readonly MarketAnalysisTimelineEntry[]
  selected?: MarketAnalysisTimelineEntry
  detail?: MarketAnalysisTimelineDetail
  detailLoading?: boolean
}>


export type UseMarketAnalysisTimelineResult = Readonly<{
  state: State
  attempt: MarketAnalysisAttempt | null
  requestState: AnalysisRequestState
  /** Set with `requestState === 'failed'`; absent for every other state. */
  requestFailure?: AnalysisRequestFailure
  selectionState: AnalysisSelectionState
  /** Detail cache so the latest-conclusion card and the drawer share one fetch per node. */
  details: Readonly<Record<string, MarketAnalysisTimelineDetail>>
  detailState: Readonly<Record<string, 'loading' | 'unavailable'>>
  load: (cursor?: string, readAttempt?: boolean) => Promise<{ entries: readonly MarketAnalysisTimelineEntry[]; attempt: MarketAnalysisAttempt | null } | undefined>
  select: (entry: MarketAnalysisTimelineEntry) => Promise<void>
  clearSelection: () => void
  /** Reads a node detail without changing the selection or the chat binding. */
  ensureDetail: (entry: MarketAnalysisTimelineEntry) => void
  loadMore: () => void
  requestInitialAnalysis: () => Promise<void>
  requestRefreshAnalysis: () => Promise<void>
}>

/**
 * Owns the timeline data for the whole market analysis workspace.
 *
 * The latest-conclusion card, the timeline list and the detail drawer must all
 * read one source of truth, so list fetching, entry selection and detail
 * loading live here instead of inside the timeline component. Fetching on mount
 * runs once: parent callbacks are read through refs so a re-created callback
 * cannot restart the timeline.
 */
export function useMarketAnalysisTimeline(input: Readonly<{
  text: AnalysisTimelineText
  onSelect?: (binding: AnalysisWorkspaceBinding | undefined) => void
  onSelectionStateChange?: (state: AnalysisSelectionState) => void
  /**
   * False keeps this instance dormant. The workspace always calls the hook so the
   * hook order stays stable, but when the dashboard layout already owns the
   * timeline this fallback must not issue a second, unused read.
   */
  enabled?: boolean
  /**
   * Test seam only: the production policy with shorter waits. The bounded poll needs 660 ticks to
   * reach its cap, which is too slow for a UI test; the hook is otherwise identical.
   */
  policy?: typeof analysisTimelineRefreshPolicy
}>): UseMarketAnalysisTimelineResult {
  const policy = input.policy ?? analysisTimelineRefreshPolicy
  const [state, setState] = useState<State>({ loading: true, entries: [] })
  const [requestState, setRequestState] = useState<AnalysisRequestState>('idle')
  const [requestFailure, setRequestFailure] = useState<AnalysisRequestFailure>()
  const [attempt, setAttempt] = useState<MarketAnalysisAttempt | null>(null)
  const generation = useRef(0)
  const selectionGeneration = useRef(0)
  /** True once a read has settled, so the panel has something to keep on screen. */
  const settled = useRef(false)
  /**
   * Failed first-page reads since the last successful one.
   *
   * Before anything has been applied there is nothing to show and nothing to refresh, so a failed
   * read is not the reader's problem yet: the bounded retry is the endpoint, and only spending it
   * turns the read into a visible failure. Counting here (not inside the retry timer) keeps one
   * number for one thing.
   */
  const initialFailures = useRef(0)
  /** When the first-page wait began; the wall-clock half of the retry budget. */
  const initialFailureSince = useRef<number | undefined>(undefined)
  /**
   * Set while a failed first read is still inside its retry budget.
   *
   * The read's `finally` clears `loading`, and a surface with no rows reads that as "empty". Holding
   * the loading flag here is what keeps the panel from showing its empty state during a wait it has
   * not given up on.
   */
  const holdLoading = useRef(false)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const callbacks = useRef({ onSelect: input.onSelect, onSelectionStateChange: input.onSelectionStateChange, text: input.text })
  callbacks.current = { onSelect: input.onSelect, onSelectionStateChange: input.onSelectionStateChange, text: input.text }
  const enabled = input.enabled !== false

  const inFlight = useRef(new Map<string, Promise<{ entries: readonly MarketAnalysisTimelineEntry[]; attempt: MarketAnalysisAttempt | null } | undefined>>())

  const load = useCallback((cursor?: string, readAttempt = false) => {
    // One read per cursor *and per kind*: a second trigger while the same page is still
    // in flight must join it instead of flipping `loading` on and off again, which is
    // what made the timeline loading copy flash. The bounded poll must never join the
    // background read: that one does not fetch the attempt, so the poll would never see
    // the run finish and would report "not published" for a run that was still working.
    const key = `${cursor ?? ''}\u0000${readAttempt ? 'attempt' : 'page'}`
    const pending = inFlight.current.get(key)
    if (pending) return pending
    const promise = runLoad(cursor, readAttempt).finally(() => { inFlight.current.delete(key) })
    inFlight.current.set(key, promise)
    return promise
  }, [])

  const runLoad = async (cursor?: string, readAttempt = false) => {
    const request = ++generation.current
    if (!cursor) {
      selectionGeneration.current += 1
      callbacks.current.onSelect?.(undefined)
      callbacks.current.onSelectionStateChange?.('none')
    }
    // Only the first read is a loading state. Every later read — the live poll, the self-healing
    // retry, and the 1s poll that follows a request — runs on top of a settled view, so it reports
    // `refreshing` and leaves the current copy (including a known failure) on screen. Flipping
    // `loading` here is what made the list and the conclusion card alternate between their empty
    // state and "正在加载…" once per tick, which read as the panel restarting.
    setState(current => settled.current
      ? { ...current, refreshing: true }
      : { ...current, loading: true, failed: false })
    try {
      const result = await withReadTimeout(marketAnalysisTimelineClient.listTimeline(cursor ? { cursor } : {}), policy.readTimeoutMs)
      const trace = result?.state === 'available'
        ? `${result.state}:${result.page.items.length}`
        : result?.state ?? 'timeout'
      setState(current => ({ ...current, lastRead: trace }))
      // A read that never settled or was unavailable is a visible failure, never a
      // permanent spinner; a background retry below heals a transient one.
      if (!result || result.state !== 'available') {
        if (cursor && generation.current !== request) return undefined
        const retryBudgetSpent = initialFailureSince.current !== undefined
          && Date.now() - initialFailureSince.current >= policy.initialRetryBudgetMs
        if (!cursor && !settled.current && !retryBudgetSpent && initialFailures.current < policy.initialRetryAttempts) {
          initialFailureSince.current ??= Date.now()
          // Nothing has ever been applied, so the reader has nothing to keep: stay in the loading
          // state and retry. The previous behaviour flipped the error surface on immediately and the
          // self-healing retry then removed it, which read as "failed, then suddenly data".
          initialFailures.current += 1
          holdLoading.current = true
          setState(current => ({ ...current, lastRead: `${trace}->waiting(${initialFailures.current})` }))
          scheduleInitialRetry()
          return undefined
        }
        // Either data was already on screen (keep it, mark it stale) or the budget is spent (this is
        // the first and final failure, so it may be shown).
        initialFailureSince.current = undefined
        setState(current => ({ ...current, lastRead: `${trace}->unavailable`, failed: true }))
        if (!cursor) settled.current = true
        return undefined
      }
      const readsAttempt = readAttempt || !result.page.items.length
      const latest = readsAttempt
        ? await withReadTimeout(marketAnalysisTimelineClient.getLatestAttempt(), policy.readTimeoutMs) ?? null
        : null
      // Only a paging read can be superseded. A successful first page is applied
      // whenever it arrives: the retry path bumps the generation counter, and
      // guarding it here threw away data that had already been read, which left the
      // list empty right next to a successful read.
      if (cursor && generation.current !== request) {
        setState(current => ({ ...current, lastRead: `${trace}->stale` }))
        return undefined
      }
      // An empty first page is not proof that there is nothing to show: the read
      // can win a race against the producing side, so it retries like a failure.
      // Without this the list stayed empty until the user pressed refresh.
      if (!cursor && result.page.items.length === 0) scheduleInitialRetry()
      // A read that did not ask for the attempt must not erase the known one: a background
      // refresh used to blank the failure the reader was looking at, leaving the panel with
      // "not published" and no reason at all.
      if (readsAttempt) setAttempt(latest)
      if (latest) setRequestState(['queued', 'running'].includes(latest.status) ? 'queued' : 'idle')
      settled.current = true
      initialFailures.current = 0
      initialFailureSince.current = undefined
      setState(current => result.state === 'available'
        ? { loading: false, lastRead: `${trace}->applied`, entries: cursor ? [...current.entries, ...result.page.items] : result.page.items, nextCursor: result.page.nextCursor,
          ...(cursor ? { selected: current.selected, detail: current.detail } : {}) }
        : { ...current, loading: false, failed: true })
      return result.state === 'available' ? { entries: result.page.items, attempt: latest } : undefined
    } finally {
      // Whichever read finishes must clear both flags — including a stale one that lost the
      // generation race — because they are the only inputs the surfaces use to decide whether
      // they have something to show. From here on the view is settled, so later reads refresh it
      // instead of replacing it with a loading state.
      // `settled` means "the reader has something on screen". A failed first read has nothing, so it
      // must not settle: settling is what switched later reads to `refresh` mode and what made the
      // error surface legal. It is set by the apply path, or by the retry budget running out.
      if (holdLoading.current) {
        // Still waiting on the first read: keep the loading state instead of falling through to an
        // empty surface that would claim the list has nothing in it.
        holdLoading.current = false
        setState(current => ({ ...current, loading: true, refreshing: false }))
      } else {
        setState(current => current.loading || current.refreshing ? { ...current, loading: false, refreshing: false } : current)
      }
    }
  }

  // A read on top of a settled view is invisible, so it must not start another one.
  const busyRef = useRef(false)
  busyRef.current = state.loading || Boolean(state.refreshing)

  // Keeps the timeline live after the bounded poll has stopped, and refreshes the moment the reader
  // comes back to the window, so a completed analysis shows up without pressing 刷新.
  useEffect(() => {
    if (input.enabled === false) return undefined
    // Never start a read on top of one that is still in flight: a service that never answers must
    // leave the list settled, not re-enter loading every interval.
    const timer = setInterval(() => { if (!busyRef.current) void load() }, policy.livePollIntervalMs)
    const refresh = () => { void load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [input.enabled, load])

  /**
   * Retries the first page in the background after a failure.
   *
   * The failure stays visible immediately (the user must not be left guessing),
   * but a transient startup failure heals itself, so the list appears without the
   * user having to press refresh.
   */
  const scheduleInitialRetry = () => {
    // One timer, one read. The retry is the same first-page load: its failure path is what counts
    // the budget and decides when the wait becomes a visible failure, so a separate probe here
    // would spend attempts without ever counting them.
    if (retryTimer.current) return
    const delay = Math.min(policy.initialRetryDelayMs * Math.max(initialFailures.current, 1), policy.initialRetryMaxDelayMs)
    retryTimer.current = setTimeout(() => {
      retryTimer.current = undefined
      void load()
    }, delay)
  }

  useEffect(() => {
    if (!enabled) return undefined
    void load()
    return () => {
      generation.current += 1
      if (pollTimer.current) clearTimeout(pollTimer.current)
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [load, enabled])

  const select = async (entry: MarketAnalysisTimelineEntry): Promise<void> => {
    const selection = ++selectionGeneration.current
    callbacks.current.onSelect?.(undefined)
    callbacks.current.onSelectionStateChange?.('loading')
    setState(current => ({ ...current, selected: entry, detail: undefined, detailLoading: true }))
    const result = await marketAnalysisTimelineClient.getDetail(entry)
    // Only the newest selection may report; a concurrent list refresh must not
    // cancel a user selection, otherwise the chat binding silently never binds.
    if (selectionGeneration.current !== selection) return
    callbacks.current.onSelectionStateChange?.(result.state === 'available' ? 'ready' : 'unavailable')
    if (result.state === 'available') callbacks.current.onSelect?.({ agentId: analysisWorkspacePolicy.agentId, eventGroupId: entry.eventGroupId, analysisRunId: result.detail.run.id, summaryId: result.detail.summary.id, asOf: result.detail.run.asOf })
    setState(current => current.selected?.id === entry.id
      ? { ...current, detailLoading: false, detail: result.state === 'available' ? result.detail : undefined }
      : current)
  }

  const clearSelection = (): void => {
    selectionGeneration.current += 1
    callbacks.current.onSelect?.(undefined)
    callbacks.current.onSelectionStateChange?.('none')
    setState(current => ({ ...current, selected: undefined, detail: undefined, detailLoading: false }))
  }

  type PollOutcome = 'published' | 'failed' | 'pending' | 'unreadable'
  type PollResult = Readonly<{ outcome: PollOutcome }>

  const pollForCompletion = async (baselineEntryId: string | undefined, pollAttempt = 0): Promise<PollResult> => {
    setRequestState('queued')
    const loaded = await load(undefined, true)
    if (!loaded) {
      // The read itself failed. Leaving the request `queued` kept the action disabled forever with
      // no poll left to end it; the list already reports the read failure, so release the action.
      setRequestState('idle')
      return { outcome: 'unreadable' }
    }
    const published = loaded.entries[0]
    if (published && published.id !== baselineEntryId) {
      setRequestState('idle')
      return { outcome: 'published' }
    }
    const latest = loaded.attempt
    // `stale`/`superseded` never publish either: they are terminal for this reader's purposes,
    // and leaving them out made the poll run to its limit and report a failure with no reason.
    const terminalFailure = latest && ['failed', 'invalid-output', 'cancelled', 'stale', 'superseded'].includes(latest.status)
    if (terminalFailure) {
      setRequestState('failed')
      setRequestFailure('run')
      return { outcome: 'failed' }
    }
    if (latest?.status === 'succeeded') {
      // A succeeded run whose node never appeared is a real "not published", unlike a run that
      // is still working inside its budget.
      setRequestState('failed')
      setRequestFailure('run')
      return { outcome: 'failed' }
    }
    if (pollAttempt >= policy.maxPollAttempts) {
      const stillRunning = Boolean(latest && ['queued', 'running'].includes(latest.status))
      if (stillRunning) {
        // Stop watching without claiming a failure: the run is past the job budget but may still
        // land, and the live poll will show it. The action is released and the panel says it is
        // still running; `queued` here would leave the button disabled with no timer left.
        setRequestState('still-running')
        return { outcome: 'pending' }
      }
      setRequestState('failed')
      setRequestFailure('run')
      return { outcome: 'failed' }
    }
    await new Promise<void>(resolve => { pollTimer.current = setTimeout(resolve, policy.pollIntervalMs) })
    return pollForCompletion(baselineEntryId, pollAttempt + 1)
  }

  const requestInitialAnalysis = async (): Promise<void> => {
    setRequestState('loading')
    setRequestFailure(undefined)
    const result = await marketAnalysisTimelineClient.requestInitialAnalysis(attempt && ['failed', 'invalid-output', 'cancelled'].includes(attempt.status) ? attempt.id : undefined)
    if (result.state !== 'queued') {
      const next: AnalysisRequestState = result.reason === 'not-eligible' ? 'unavailable' : result.reason === 'not-ready' ? 'not-ready' : result.reason === 'already-available' ? 'already-available' : 'failed'
      setRequestState(next)
      if (next === 'failed') setRequestFailure('request')
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
  const enqueueRefresh = async (baselineEntryId: string | undefined): Promise<PollResult | 'refused'> => {
    setRequestState('loading')
    setRequestFailure(undefined)
    let result: Awaited<ReturnType<typeof marketAnalysisTimelineClient.requestInitialAnalysis>>
    try {
      result = await marketAnalysisTimelineClient.requestInitialAnalysis(undefined, 'refresh')
    } catch (error) {
      // The service refuses with `analysis-already-available` when a usable analysis already exists —
      // including the run it just finished. That is not a failure to report as "not published".
      const already = isAlreadyAvailableError(error)
      setRequestState(already ? 'already-available' : 'failed')
      if (!already) setRequestFailure('request')
      return 'refused'
    }
    if (result.state !== 'queued') {
      const next: AnalysisRequestState = result.reason === 'not-eligible' ? 'unavailable' : result.reason === 'not-ready' ? 'not-ready' : result.reason === 'already-available' ? 'already-available' : 'failed'
      setRequestState(next)
      if (next === 'failed') setRequestFailure('request')
      return 'refused'
    }
    return pollForCompletion(baselineEntryId)
  }

  const requestRefreshAnalysis = async (): Promise<void> => {
    // The retry after a contract rejection lives in the analysis orchestrator, not here: it must
    // also cover scheduled runs and runs whose panel is closed, and it re-asks against the same
    // frozen snapshot. The poll simply keeps waiting while that second answer is produced.
    await enqueueRefresh(state.entries[0]?.id)
  }

  const selectionState: AnalysisSelectionState = state.selected
    ? state.detailLoading ? 'loading' : state.detail ? 'ready' : 'unavailable'
    : 'none'

  const [details, setDetails] = useState<Record<string, MarketAnalysisTimelineDetail>>({})
  const [detailState, setDetailState] = useState<Record<string, 'loading' | 'unavailable'>>({})
  const detailCache = useRef(details)
  detailCache.current = details
  const detailRequests = useRef(new Set<string>())
  const detailRetryTimers = useRef(new Set<ReturnType<typeof setTimeout>>())

  /** One detail read, plus a bounded self-heal: a failed read is retried, then reported. */
  const readDetail = (entry: MarketAnalysisTimelineEntry, failure = 0): void => {
    // The id stays reserved across the retries, so a second surface asking for the same node joins
    // this attempt chain instead of starting another one beside it.
    detailRequests.current.add(entry.id)
    void marketAnalysisTimelineClient.getDetail(entry).then(result => {
      if (result.state === 'available') {
        detailRequests.current.delete(entry.id)
        setDetailState(current => { const next = { ...current }; delete next[entry.id]; return next })
        setDetails(current => ({ ...current, [entry.id]: result.detail }))
        return
      }
      // Nothing has been read for this node yet, so the first failure is not the reader's news:
      // stay in the loading state while the bounded retries run, and only report the failure once
      // they are spent. Reporting it immediately is the flash this card was reported for.
      const delay = policy.detailRetryDelaysMs[failure]
      if (delay === undefined) {
        setDetailState(current => ({ ...current, [entry.id]: 'unavailable' }))
        detailRequests.current.delete(entry.id)
        return
      }
      const timer = setTimeout(() => {
        detailRetryTimers.current.delete(timer)
        readDetail(entry, failure + 1)
      }, delay)
      detailRetryTimers.current.add(timer)
    })
  }

  const ensureDetail = (entry: MarketAnalysisTimelineEntry): void => {
    if (detailCache.current[entry.id] || detailRequests.current.has(entry.id)) return
    setDetailState(current => ({ ...current, [entry.id]: current[entry.id] ?? 'loading' }))
    readDetail(entry)
  }

  // A pending detail retry belongs to this workspace: it must not fire after it is gone.
  useEffect(() => () => {
    for (const timer of detailRetryTimers.current) clearTimeout(timer)
    detailRetryTimers.current.clear()
  }, [])

  return {
    state, attempt, requestState, requestFailure, selectionState, details, detailState, load, select, clearSelection, ensureDetail,
    loadMore: () => { void load(state.nextCursor ?? undefined) },
    requestInitialAnalysis, requestRefreshAnalysis
  }
}

/** The refusal the main process throws when a refresh has nothing new to do. */
