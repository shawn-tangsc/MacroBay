import { Fragment, useEffect, useRef, useState } from 'react'

import { Button } from 'antd'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'

import type {
  SyncRunAggregateResult,
  SyncRunAggregateUnavailableReason,
  SyncRunAnalysisResult,
  SyncRunQuery,
  SyncRunRow,
  SyncRunWindow
} from '../../../contracts/syncRunRecords'
import { isAnalysisRunId, syncRunsCsv } from '../../../contracts/syncRunRecords'
import { syncRunClient } from '../../shared/ipc/syncRunClient'
import { AnalysisCell, AnalysisRecord, analysisRecordId, formatSyncRunTime } from './SyncRunAnalysisCell'
import { syncRunSourceLabel, syncRunTaskLabel, syncRunTallyText } from './syncRunRowText'
import './sync-run-section.css'

/**
 * The run record: what each sync job did, in one read-only table.
 *
 * It exists because a source could look enabled while every collection was skipped, and no surface
 * in the product said so. Rows come from the platform's job runs; nothing here writes.
 */
/** 来源筛的「无来源」档：一个不可能与真实 sourceId 相撞的值，替掉原来空串兼职的做法。 */
const NO_SOURCE_FILTER = '__no-source__'

export type SyncRunText = Readonly<{
  title: string; window: Record<SyncRunWindow, string>; outcome: Record<'any' | 'succeeded' | 'failed' | 'running', string>
  columns: Readonly<Record<'time' | 'task' | 'source' | 'action' | 'outcome' | 'analysis' | 'duration' | 'detail', string>>
  /**
   * The analysis side of a row. The task's own outcome and the analysis result are two facts: the
   * analysis job completes even when the analysis was rejected, so this block never merges with
   * `outcomes`.
   */
  analysis: Readonly<{
    states: Readonly<Record<SyncRunAnalysisResult['state'], string>>
    notApplicable: string
    notApplicableHint: string
    unlinked: string
    unlinkedHint: string
    unavailable: string
    unavailableHint: string
    reasonFallback: string
    open: string
    close: string
    recordTitle: string
    fields: Readonly<Record<'runId' | 'started' | 'completed' | 'model' | 'reason' | 'code' | 'detailCode', string>>
    notRecorded: string
  }>
  /**
   * A notification can point at one analysis run. The page locates it, says so when it cannot, and
   * never turns "the link is stale" into "there is no such analysis".
   */
  focus: Readonly<{ missing: string; missingHint: string }>
  /** The separator between two names on one line, so a locale can pick its own glyph. */
  joiner: string
  /** What is left of a task's history once its run details are dropped. */
  aggregates: Readonly<{
    title: string
    note: string
    columns: Readonly<Record<'day' | 'task' | 'runs' | 'failures', string>>
    empty: string
    /** A store that cannot answer says why; it is never drawn as an empty history. */
    unavailable: Readonly<Record<SyncRunAggregateUnavailableReason, string>>
  }>
  allTasks: string
  /** Shown when a run names no source: it reads stored records or every source at once. */
  allSourcesNote: string
  noSourceHint: string
  allSources: string
  /** 来源筛的第三档：**没有来源**的记录（翻译这类）自成一档，不再靠空串顺带放行。 */
  sourceFilterNone: string
  /** 触到装载上限时说实话：取回一些 ≠ 窗口里只有这些。 */
  truncatedNotice: string
  /** 导出同样不许静默截断：少了多少要写在读者看得见的地方。 */
  exportTruncated: string
  showing: string
  retention: string
  page: string
  previous: string
  next: string
  csvHeader: readonly string[]
  loading: string; exportCsv: string; exported: string; exportFailed: string
  /** The batch's own tally, filled in by the caller; the cell composes the parts. */
  counts: string
  countsFailed: string
  countsSkipped: string
  countsSeparator: string
  /** Shown instead of numbers for a run that predates them: never as zero. */
  oldRecordNote: string
  /** Stable `resultReasonCode` → the reader's sentence; the code itself never reaches the cell. */
  resultReasons: Readonly<Record<string, string>>
  resultReasonUnknown: string
  actions: Readonly<Record<'collect' | 'refresh' | 'analysis' | 'configure' | 'test' | 'import' | 'other', string>>
  /** `handlerId` → the reader's name for that job; the service catalogue's own labels are data. */
  tasks: Readonly<Record<string, string>>
  /** `sourceId` → the product's name for that source, the same map the source list uses. */
  sourceNames?: Readonly<Record<string, string>>
  outcomes: Readonly<Record<'succeeded' | 'failed' | 'cancelled' | 'running', string>>
  /** Failure code → the reader's sentence. The code itself never reaches the visible cell. */
  failureCodes: Readonly<Record<string, string>>
  failureUnknown: string
  /** Title text for the humanised failure, so the code stays available without being on screen. */
  failureCodeHint: string
}>

const WINDOWS: readonly SyncRunWindow[] = ['24h', '7d', 'all']
/** Thirty rows a page: one screen of recent history without a wall of scroll. */
const SYNC_RUN_PAGE_SIZE = 30
/** A year of daily counts across every task would be a wall of rows; the newest days come first. */
const SYNC_RUN_AGGREGATE_ROWS = 60

export function SyncRunSection({ analysisFailureReasons, focusAnalysisRunId, knownSources, text }: Readonly<{
  text: SyncRunText
  /** The analysis run a notification pointed at; absent means the reader opened the page normally. */
  focusAnalysisRunId?: string | null
  /** Every registered source, so a source that has not run lately can still be filtered to. */
  knownSources?: readonly Readonly<{ sourceId: string; label: string }>[]
  /**
   * Analysis failure code → the reader's sentence. It is the timeline's own map, passed in rather
   * than copied, so one code never ends up with two different sentences.
   */
  analysisFailureReasons?: Readonly<Record<string, string>>
}>): React.ReactElement {
  const timeZone = useShellTimeZone()
  /**
   * A located row may be older than the default window, so a focus request reads the widest window
   * the contract allows from the start — one read, no second round trip, and page 5 is reachable.
   */
  const focusRequested = focusAnalysisRunId !== undefined && focusAnalysisRunId !== null && focusAnalysisRunId !== ''
  const [window, setWindow] = useState<SyncRunWindow>(focusRequested ? 'all' : '24h')
  const [outcome, setOutcome] = useState<SyncRunQuery['outcome']>()
  const [state, setState] = useState<'loading' | 'available' | 'unavailable'>('loading')
  /** 窗口里还有没取回来的记录（装载上限）。说过一句，才不算假装取全了。 */
  const [truncated, setTruncated] = useState(false)
  const [rows, setRows] = useState<readonly SyncRunRow[]>([])
  const [taskFilter, setTaskFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [page, setPage] = useState(0)
  const [notice, setNotice] = useState<string>()
  const [aggregates, setAggregates] = useState<SyncRunAggregateResult>()
  /** Bumped by every retry so both reads re-run without duplicating their effects. */
  const [reloadToken, setReloadToken] = useState(0)
  /** The analysis record the reader opened. One at a time: this page answers one question. */
  const [expandedAnalysisRunId, setExpandedAnalysisRunId] = useState<string>()
  /** Where the notification's target stands: still being looked for, located, or not here. */
  const [focusOutcome, setFocusOutcome] = useState<'idle' | 'pending' | 'found' | 'not-found'>(
    focusRequested ? 'pending' : 'idle'
  )
  /** Scrolling and focusing happen once; later filter changes must not drag the reader back. */
  const focusAppliedRef = useRef(false)
  const retry = (): void => setReloadToken((current) => current + 1)
  /**
   * The window and the task are **server-side** filters: a page that fetches the newest 500 runs and
   * then filters in the browser can never show a task that runs 45 times a day next to collectors
   * that run every 17 seconds — that is how "翻译任务" ended up invisible.
   *
   * Source and outcome still narrow what is already on screen, so those lists come from the same
   * fetch instead of a second round trip.
   */
  const query: SyncRunQuery = {
    window,
    limit: 500,
    ...(taskFilter === '' ? {} : { handlerId: taskFilter }),
    ...(focusRequested && focusAnalysisRunId ? { analysisRunId: focusAnalysisRunId } : {})
  }

  useEffect(() => {
    if (window !== 'all') { setAggregates(undefined); return }
    let cancelled = false
    void syncRunClient.aggregates().then((result) => { if (!cancelled) setAggregates(result) })
    return () => { cancelled = true }
  }, [window, reloadToken])

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void syncRunClient.list(query).then((result) => {
      if (cancelled) return
      if (result.state === 'available') {
        setRows(result.rows)
        setTruncated(result.truncated === true)
        setState('available')
      } else setState('unavailable')
    })
    return () => { cancelled = true }
  }, [window, taskFilter, reloadToken, focusAnalysisRunId])

  /**
   * Locate the run a notification pointed at, once the widest window has been read.
   *
   * A malformed id is treated exactly like a missing record: both mean "this link cannot show you
   * the thing it promised", and the page must say that instead of stopping at the top of the list.
   */
  useEffect(() => {
    if (focusOutcome !== 'pending' || state === 'loading') return
    const id = focusAnalysisRunId ?? ''
    const index = isAnalysisRunId(id) && state === 'available'
      ? rows.findIndex((row) => row.analysis.state === 'linked' && row.analysis.result.runId === id)
      : -1
    if (index < 0) {
      setFocusOutcome('not-found')
      return
    }
    // The row lives on whichever page holds it: locating must not assume the first page.
    setPage(Math.floor(index / SYNC_RUN_PAGE_SIZE))
    setExpandedAnalysisRunId(id)
    setFocusOutcome('found')
  }, [focusAnalysisRunId, focusOutcome, rows, state])

  // Once, after the located page has rendered: bring the row into view and put keyboard focus on
  // the record's toggle. Without this the page "locates" a row the reader cannot see.
  useEffect(() => {
    if (focusOutcome !== 'found' || focusAppliedRef.current) return
    focusAppliedRef.current = true
    const element = document.querySelector<HTMLElement>(`[data-analysis-run-id="${focusAnalysisRunId}"]`)
    element?.scrollIntoView?.({ block: 'center' })
    element?.querySelector<HTMLElement>('.mi-sync-run__analysis-button')?.focus()
  }, [focusAnalysisRunId, focusOutcome, page, rows])

  /**
   * Task options come from the catalogue, not from the rows on screen: once a task is selected the
   * list collapses to that task, and building the options from it would leave the reader with no way
   * back. It also matches the source filter's rule — a task that has not run lately is exactly the
   * one someone opens this page to look for.
   */
  const tasks = Object.entries(text.tasks)
    .map(([handlerId, label]) => ({ handlerId, label }))
    .sort((left, right) => left.label.localeCompare(right.label))
  const sources = [...new Map([
    ...(knownSources ?? []).map((source) => [source.sourceId, source.label] as const),
    ...rows.flatMap((row) => row.sources).map((source) => [source.sourceId, syncRunSourceLabel(source, text)] as const)
  ]).entries()].sort((left, right) => left[1].localeCompare(right[1]))
  // 三档显式：全部 / 无来源 / 某个来源。空串不再兼职表示「无来源也算」。
  const sourceMatches = (row: SyncRunRow): boolean =>
    sourceFilter === ''
    || (sourceFilter === NO_SOURCE_FILTER ? row.sources.length === 0 : row.sources.some((source) => source.sourceId === sourceFilter))
  const filtered = rows
    // The server already narrowed by task; this keeps the product-side (audit) rows in step.
    .filter((row) => taskFilter === '' || row.handlerId === taskFilter)
    .filter(sourceMatches)
    .filter((row) => outcome === undefined || row.outcome === outcome)
  const pageSize = SYNC_RUN_PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize)

  const exportCsv = async () => {
    // Export exactly what the filters produced, not the unfiltered window the IPC read returned.
    // 导出走的就是页面这一条路（同一份 `rows` 与同一组筛选），只是**取回不全时也要说**：
    // 页面上写着「还有更多」，导出却像是全量，那是最容易被当成丢数据的一种不一致。
    const csv = syncRunsCsv(filtered.map((row) => ({
      ...row,
      taskLabel: syncRunTaskLabel(row, text),
      sources: row.sources.map((source) => ({ ...source, label: syncRunSourceLabel(source, text) }))
    })), text.csvHeader)
    try {
      await navigator.clipboard.writeText(csv)
      setNotice(truncated
        ? text.exportTruncated.replace('{count}', String(filtered.length))
        : text.exported)
    } catch {
      // A clipboard the shell refuses is not a reason to claim success.
      setNotice(text.exportFailed)
    }
  }

  return <section className="mi-sync-run" aria-label={text.title}>
    <header className="mi-sync-run__head">
      <h2>{text.title}</h2>
      <div className="mi-sync-run__filters">
        <label>{text.columns.time}
          <select value={window} onChange={(event) => { setWindow(event.target.value as SyncRunWindow); setPage(0) }}>
            {WINDOWS.map((value) => <option key={value} value={value}>{text.window[value]}</option>)}
          </select>
        </label>
        <label>{text.columns.task}
          <select value={taskFilter} onChange={(event) => { setTaskFilter(event.target.value); setPage(0) }}>
            <option value="">{text.allTasks}</option>
            {tasks.map((task) => <option key={task.handlerId} value={task.handlerId}>{task.label}</option>)}
          </select>
        </label>
        <label>{text.columns.source}
          <select value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value); setPage(0) }}>
            <option value="">{text.allSources}</option>
            <option value={NO_SOURCE_FILTER}>{text.sourceFilterNone}</option>
            {sources.map(([sourceId, label]) => <option key={sourceId} value={sourceId}>{label}</option>)}
          </select>
        </label>
        <label>{text.columns.outcome}
          <select value={outcome ?? ''} onChange={(event) => { setOutcome((event.target.value || undefined) as SyncRunQuery['outcome']); setPage(0) }}>
            <option value="">{text.outcome.any}</option>
            {(['succeeded', 'failed', 'running'] as const).map((value) => <option key={value} value={value}>{text.outcome[value]}</option>)}
          </select>
        </label>
        <Button onClick={() => void exportCsv()} size="small">{text.exportCsv}</Button>
        {notice ? <span className="mi-sync-run__notice" role="status">{notice}</span> : null}
      </div>
    </header>
    {/* A link that cannot be honoured says so above the list; it never silently leaves the reader
        at the top of an unrelated page. */}
    {focusOutcome === 'not-found'
      ? <p className="mi-sync-run__focus-missing" role="status">
        <strong>{text.focus.missing}</strong>
        {text.joiner}
        {text.focus.missingHint}
      </p>
      : null}
    {state === 'loading' ? <LoadingState label={text.loading} minHeight={160} /> : null}
    {state === 'unavailable'
      ? <StateView
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: retry }}
        reasonCode="unreadable"
        size="md"
        state="error"
      />
      : null}
    {/* Nothing ran in this window: the reader can widen it, so this is not "not yet". */}
    {state === 'available' && rows.length === 0
      ? <StateView
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.widen_time_window, onSelect: () => { setWindow('all'); setPage(0) } }}
        reasonCode="filtered-out"
        size="md"
        state="empty"
      />
      : null}
    {/* Records exist but the filters hide them: clearing the filters is the way out. */}
    {state === 'available' && rows.length > 0 && visible.length === 0
      ? <StateView
        action={{
          labelKey: STATE_VIEW_ACTION_KEYS.clear_filter,
          onSelect: () => { setTaskFilter(''); setSourceFilter(''); setOutcome(undefined); setPage(0) }
        }}
        reasonCode="filtered-out"
        size="md"
        state="empty"
      />
      : null}
    {state === 'available' && visible.length > 0 ? <div className="mi-sync-run__scroll" role="table" aria-label={text.title}>
      {/* A grid, not a table: the header and every row share one column template, so a sticky header
          cannot lay itself out on a different grid from the body. */}
      <div className="mi-sync-run__grid mi-sync-run__grid--head" role="row">
        <span role="columnheader">{text.columns.time}</span>
        <span role="columnheader">{text.columns.task}</span>
        <span role="columnheader">{text.columns.source}</span>
        <span role="columnheader">{text.columns.action}</span>
        <span role="columnheader">{text.columns.outcome}</span>
        {/* 任务成功 ≠ 分析成功：分析任务以 completed 收尾时，分析本身仍可能没有发布。 */}
        <span role="columnheader">{text.columns.analysis}</span>
        <span role="columnheader">{text.columns.duration}</span>
        <span role="columnheader">{text.columns.detail}</span>
      </div>
      <p className="mi-sync-run__legend">{text.noSourceHint}</p>
      {/* One line for the whole table, not one per row: a run that predates the tally shows no
          numbers, and without this the empty spot reads as "zero items". Only shown when such a row
          is actually on screen — a legend for an absent case is noise. */}
      {visible.some((row) => row.counts === undefined)
        ? <p className="mi-sync-run__legend mi-sync-run__legend--tally">{text.oldRecordNote}</p>
        : null}
      {visible.map((row) => <Fragment key={row.runId}>
        <div
          className="mi-sync-run__grid"
          data-analysis-run-id={row.analysis.state === 'linked' ? row.analysis.result.runId : undefined}
          data-focused={
            focusOutcome === 'found' && row.analysis.state === 'linked' && row.analysis.result.runId === focusAnalysisRunId
              ? 'true'
              : undefined
          }
          data-outcome={row.outcome}
          role="row"
        >
        <span className="mi-sync-run__time" role="cell">{formatSyncRunTime(row.at, timeZone)}</span>
        <span className="mi-sync-run__task" role="cell">{syncRunTaskLabel(row, text)}</span>
        {/* Nothing here is hidden behind a hover: the count is visible text, and the full list is
            the cell's accessible name, so a keyboard or a screen reader gets the same facts. */}
        <span
          aria-label={row.sources.length === 0 ? text.noSourceHint : row.sources.map((source) => syncRunSourceLabel(source, text)).join(text.joiner)}
          className="mi-sync-run__source"
          role="cell"
        >
          {row.sources.length === 0
            ? text.allSourcesNote
            : row.sources.slice(0, 2).map((source) => syncRunSourceLabel(source, text)).join(text.joiner)}
          {row.sources.length > 2 ? <span className="mi-sync-run__more">{` +${row.sources.length - 2}`}</span> : null}
        </span>
        <span role="cell">{text.actions[row.action]}</span>
        <span role="cell" data-outcome={row.outcome}>
          {text.outcomes[row.outcome]}
          {syncRunTallyText(row, text) === undefined
            ? null
            : <span className="mi-sync-run__tally">{text.joiner}{syncRunTallyText(row, text)}</span>}
        </span>
        {/* The second result. Never merged into the one above: "task completed, analysis not
            published" is exactly the state this column exists to make visible. */}
        <span className="mi-sync-run__analysis" role="cell">
          <AnalysisCell
            analysis={row.analysis}
            analysisFailureReasons={analysisFailureReasons}
            expanded={row.analysis.state === 'linked' && expandedAnalysisRunId === row.analysis.result.runId}
            onToggle={(runId) => setExpandedAnalysisRunId(expandedAnalysisRunId === runId ? undefined : runId)}
            text={text}
          />
        </span>
        <span className="mi-sync-run__duration" role="cell">{row.durationMs === undefined ? '—' : `${(row.durationMs / 1000).toFixed(1)}s`}</span>
        <span className="mi-sync-run__detail" role="cell">
          {/* The code and the raw error are a sentence built from data, so they live in the cell's
              accessible name instead of a bubble: a keyboard reader gets the same facts, and nothing
              here is reachable only by hovering an unfocusable span. */}
          {row.failureCode ? <span
            aria-label={[text.failureCodeHint.replace('{code}', row.failureCode),
              // The raw error text is implementation wording; it belongs with the code, not on the row.
              ...(row.detail ? [row.detail] : [])].join(' · ')}
            className="mi-sync-run__failure"
          >{text.failureCodes[row.failureCode] ?? text.failureUnknown}</span> : null}
          {!row.failureCode && row.detail ? <span>{row.detail}</span> : null}
        </span>
        </div>
        {/* The record the reader asked for: what the analysis itself recorded. */}
        {row.analysis.state === 'linked' && expandedAnalysisRunId === row.analysis.result.runId
          ? <div className="mi-sync-run__grid mi-sync-run__grid--analysis" role="row">
            <div
              className="mi-sync-run__analysis-record"
              id={analysisRecordId(row.analysis.result.runId)}
              role="cell"
            >
              <AnalysisRecord
                analysisFailureReasons={analysisFailureReasons}
                result={row.analysis.result}
                text={text}
                timeZone={timeZone}
              />
            </div>
          </div>
          : null}
      </Fragment>)}
    </div> : null}
    {state === 'available' && filtered.length > 0
      ? <footer className="mi-sync-run__foot">
        <span>{text.showing.replace('{shown}', String(visible.length)).replace('{total}', String(filtered.length))}{text.joiner}{text.retention}</span>
        {/* 取回一部分就明说：读者要能分清「这段时间只有这些」和「这里还没取完」。 */}
        {truncated ? <span role="status">{text.truncatedNotice.replace('{count}', String(rows.length))}</span> : null}
        {pageCount > 1 ? <span className="mi-sync-run__pager">
          <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} size="small">{text.previous}</Button>
          <span>{text.page.replace('{page}', String(currentPage + 1)).replace('{pages}', String(pageCount))}</span>
          <Button disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} size="small">{text.next}</Button>
        </span> : null}
      </footer>
      : null}
    {window === 'all' ? <section className="mi-sync-run__aggregates" aria-label={text.aggregates.title}>
      <h3>{text.aggregates.title}</h3>
      <p className="mi-sync-run__aggregate-note">{text.aggregates.note}</p>
      {!aggregates ? <LoadingState label={text.loading} minHeight={80} /> : null}
      {aggregates?.state === 'unavailable'
        ? (aggregates.reason === 'memory-store-has-no-aggregates'
          ? <StateView reasonCode="capability-not-wired" size="md" state="disabled" />
          : <StateView
            action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: retry }}
            reasonCode="unreadable"
            size="md"
            state="error"
          />)
        : null}
      {/* Detail is kept 30 days; a younger install has nothing folded yet, and there is nothing to
          do about that, so no action. */}
      {aggregates?.state === 'available' && aggregates.rows.length === 0
        ? <StateView reasonCode="not-yet" size="md" state="empty" />
        : null}
      {aggregates?.state === 'available' && aggregates.rows.length > 0
        ? <div className="mi-sync-run__aggregate-table" role="table" aria-label={text.aggregates.title}>
          <div className="mi-sync-run__grid mi-sync-run__grid--aggregate" role="row">
            <span role="columnheader">{text.aggregates.columns.day}</span>
            <span role="columnheader">{text.aggregates.columns.task}</span>
            <span role="columnheader">{text.aggregates.columns.runs}</span>
            <span role="columnheader">{text.aggregates.columns.failures}</span>
          </div>
          {[...aggregates.rows]
            .sort((left, right) => right.day.localeCompare(left.day) || left.taskLabel.localeCompare(right.taskLabel))
            .slice(0, SYNC_RUN_AGGREGATE_ROWS)
            .map((row) => <div className="mi-sync-run__grid mi-sync-run__grid--aggregate" key={`${row.day}:${row.handlerId}`} role="row">
            <span role="cell">{row.day}</span>
            <span role="cell">{row.taskLabel}</span>
            <span role="cell">{String(row.runs)}</span>
            <span role="cell" data-has-failures={row.failures > 0 ? 'true' : undefined}>{String(row.failures)}</span>
          </div>)}
        </div>
        : null}
    </section> : null}
  </section>
}
