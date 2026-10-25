import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalysisWorkspaceBinding } from '../../../contracts/analysisWorkspaceContracts'
import { analysisWorkspacePolicy } from '../../../contracts/analysisWorkspaceContracts'
import {
  marketAnalysisTimelineClient,
  type MarketAnalysisAttempt,
  type MarketAnalysisTimelineDetail,
  type MarketAnalysisTimelineEntry
} from '../../shared/ipc/marketAnalysisTimelineClient'

export type AnalysisSelectionState = 'none' | 'loading' | 'ready' | 'unavailable'
export type AnalysisRequestState = 'idle' | 'loading' | 'queued' | 'unavailable' | 'not-ready' | 'failed' | 'already-available'

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

// The product IPC has no push notification for a completed analysis. This
// bounded polling policy is owned by the workspace data hook and is covered by
// the timeline refresh regression test; it stops on a published node or a
// terminal failure.
export const analysisTimelineRefreshPolicy = Object.freeze({
  pollIntervalMs: 1_000,
  /**
   * Bounded, but not shorter than one run can legitimately take: the run job's own timeout is
   * 360s, so a shorter poll gave up on work that was still inside its budget and told the reader
   * it had failed. Giving up while the run is still queued/running is now reported as
   * still-running rather than as "not published", and this window matches the job's budget so a
   * slow model that does finish is seen finishing instead of needing a manual refresh.
   */
  maxPollAttempts: 360,
  /**
   * The bounded poll above stops as soon as a node is published — which is precisely when the
   * reader stops watching a spinner and starts expecting new analyses. With no push notification
   * from the product IPC, the list only grew when someone pressed refresh, so a slow background poll
   * (plus a refresh on focus) keeps it live.
   */
  livePollIntervalMs: 60_000,
  /**
   * The first page retries on its own. A read can fail transiently while the
   * product is still starting up, and requiring the user to press refresh for
   * their own timeline is not acceptable.
   */
  initialRetryAttempts: 10,
  initialRetryDelayMs: 500,
  initialRetryMaxDelayMs: 6_000,
  /**
   * A timeline read must settle. Local reads are far faster than this, so hitting
   * it means the service is not answering; turning that into a visible failure is
   * better than a spinner that never ends.
   */
  readTimeoutMs: 15_000,
  /**
   * A node detail is a second read of the store the list just answered from, and it can fail on
   * its own: the run, the summary and the snapshot are three separate reads, and the service may be
   * reloading the store behind them. Nothing re-read a node after a failure, so one transient fault
   * pinned the newest conclusion to "暂不可用" until a different node became the newest. These are the
   * wait intervals between the bounded retries; after the last one the failure is final.
   */
  detailRetryDelaysMs: [1_500, 4_000, 10_000] as readonly number[]
})

/** Resolves a read against a bounded wait so a silent service cannot hang the UI. */
async function withReadTimeout<T>(read: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read,
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs) })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type UseMarketAnalysisTimelineResult = Readonly<{
  state: State
  attempt: MarketAnalysisAttempt | null
  requestState: AnalysisRequestState
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
}>): UseMarketAnalysisTimelineResult {
  const [state, setState] = useState<State>({ loading: true, entries: [] })
  const [requestState, setRequestState] = useState<AnalysisRequestState>('idle')
  const [attempt, setAttempt] = useState<MarketAnalysisAttempt | null>(null)
  const generation = useRef(0)
  const selectionGeneration = useRef(0)
  /** True once a read has settled, so the panel has something to keep on screen. */
  const settled = useRef(false)
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
      const result = await withReadTimeout(marketAnalysisTimelineClient.listTimeline(cursor ? { cursor } : {}), analysisTimelineRefreshPolicy.readTimeoutMs)
      const trace = result?.state === 'available'
        ? `${result.state}:${result.page.items.length}`
        : result?.state ?? 'timeout'
      setState(current => ({ ...current, lastRead: trace }))
      // A read that never settled or was unavailable is a visible failure, never a
      // permanent spinner; a background retry below heals a transient one.
      if (!result || result.state !== 'available') {
        if (cursor && generation.current !== request) return undefined
        setState(current => ({ ...current, lastRead: `${trace}->unavailable` }))
        setState(current => ({ ...current, failed: true }))
        if (!cursor) scheduleInitialRetry()
        return undefined
      }
      const readsAttempt = readAttempt || !result.page.items.length
      const latest = readsAttempt
        ? await withReadTimeout(marketAnalysisTimelineClient.getLatestAttempt(), analysisTimelineRefreshPolicy.readTimeoutMs) ?? null
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
      settled.current = true
      setState(current => current.loading || current.refreshing ? { ...current, loading: false, refreshing: false } : current)
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
    const timer = setInterval(() => { if (!busyRef.current) void load() }, analysisTimelineRefreshPolicy.livePollIntervalMs)
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
    if (retryTimer.current) clearTimeout(retryTimer.current)
    let attempt = 0
    const step = () => {
      if (attempt >= analysisTimelineRefreshPolicy.initialRetryAttempts) return
      const delay = Math.min(analysisTimelineRefreshPolicy.initialRetryDelayMs * (attempt + 1), analysisTimelineRefreshPolicy.initialRetryMaxDelayMs)
      attempt += 1
      retryTimer.current = setTimeout(() => { void retryOnce() }, delay)
    }
    const retryOnce = async () => {
      const result = await marketAnalysisTimelineClient.listTimeline({})
      // Reload as soon as the read carries anything, or as soon as the product
      // reports work in flight, because that is when rows are about to appear.
      if (result.state === 'available' && result.page.items.length > 0) {
        retryTimer.current = undefined
        void load()
        return
      }
      const attempt = await marketAnalysisTimelineClient.getLatestAttempt()
      if (attempt && ['queued', 'running'].includes(attempt.status)) {
        retryTimer.current = undefined
        void load()
        return
      }
      step()
    }
    step()
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

  const pollForCompletion = async (baselineEntryId: string | undefined, pollAttempt = 0): Promise<void> => {
    setRequestState('queued')
    const loaded = await load(undefined, true)
    if (!loaded) return
    const published = loaded.entries[0]
    if (published && published.id !== baselineEntryId) {
      setRequestState('idle')
      return
    }
    const latest = loaded.attempt
    // `stale`/`superseded` never publish either: they are terminal for this reader's purposes,
    // and leaving them out made the poll run to its limit and report a failure with no reason.
    const terminalFailure = latest && ['failed', 'invalid-output', 'cancelled', 'stale', 'superseded'].includes(latest.status)
    if (terminalFailure) {
      setRequestState('failed')
      return
    }
    if (latest?.status === 'succeeded') {
      // A succeeded run whose node never appeared is a real "not published", unlike a run that
      // is still working inside its budget.
      setRequestState('failed')
      return
    }
    if (pollAttempt >= analysisTimelineRefreshPolicy.maxPollAttempts) {
      setRequestState(latest && ['queued', 'running'].includes(latest.status) ? 'queued' : 'failed')
      return
    }
    await new Promise<void>(resolve => { pollTimer.current = setTimeout(resolve, analysisTimelineRefreshPolicy.pollIntervalMs) })
    await pollForCompletion(baselineEntryId, pollAttempt + 1)
  }

  const requestInitialAnalysis = async (): Promise<void> => {
    setRequestState('loading')
    const result = await marketAnalysisTimelineClient.requestInitialAnalysis(attempt && ['failed', 'invalid-output', 'cancelled'].includes(attempt.status) ? attempt.id : undefined)
    if (result.state !== 'queued') {
      setRequestState(result.reason === 'not-eligible' ? 'unavailable' : result.reason === 'not-ready' ? 'not-ready' : result.reason === 'already-available' ? 'already-available' : 'failed')
      return
    }
    await pollForCompletion(undefined)
  }

  const requestRefreshAnalysis = async (): Promise<void> => {
    setRequestState('loading')
    let result: Awaited<ReturnType<typeof marketAnalysisTimelineClient.requestInitialAnalysis>>
    try {
      result = await marketAnalysisTimelineClient.requestInitialAnalysis(undefined, 'refresh')
    } catch (error) {
      // The service refuses with `analysis-already-available` when a usable analysis already exists —
      // including the run it just finished. That is not a failure to report as "not published".
      setRequestState(isAlreadyAvailableError(error) ? 'already-available' : 'failed')
      return
    }
    if (result.state !== 'queued') {
      setRequestState(result.reason === 'not-eligible' ? 'unavailable' : result.reason === 'not-ready' ? 'not-ready' : result.reason === 'already-available' ? 'already-available' : 'failed')
      return
    }
    await pollForCompletion(state.entries[0]?.id)
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
      // The failure copy stays on screen while a retry runs: alternating it with "正在读取…" once
      // per attempt is the flashing this card was reported for. A successful retry replaces it.
      setDetailState(current => ({ ...current, [entry.id]: 'unavailable' }))
      const delay = analysisTimelineRefreshPolicy.detailRetryDelaysMs[failure]
      if (delay === undefined) {
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
    state, attempt, requestState, selectionState, details, detailState, load, select, clearSelection, ensureDetail,
    loadMore: () => { void load(state.nextCursor ?? undefined) },
    requestInitialAnalysis, requestRefreshAnalysis
  }
}

/** The refusal the main process throws when a refresh has nothing new to do. */
export function isAlreadyAvailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('analysis-already-available')
}
