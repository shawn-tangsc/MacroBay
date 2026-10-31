import { useEffect, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'

import type { SyncRunQuery, SyncRunRow, SyncRunWindow } from '../../../contracts/syncRunRecords'
import { syncRunsCsv } from '../../../contracts/syncRunRecords'
import { syncRunClient } from '../../shared/ipc/syncRunClient'
import './sync-run-section.css'

/**
 * The run record: what each sync job did, in one read-only table.
 *
 * It exists because a source could look enabled while every collection was skipped, and no surface
 * in the product said so. Rows come from the platform's job runs; nothing here writes.
 */
export type SyncRunText = Readonly<{
  title: string; window: Record<SyncRunWindow, string>; outcome: Record<'any' | 'succeeded' | 'failed' | 'running', string>
  columns: Readonly<Record<'time' | 'task' | 'source' | 'action' | 'outcome' | 'duration' | 'detail', string>>
  /** The separator between two names on one line, so a locale can pick its own glyph. */
  joiner: string
  allTasks: string
  /** Shown when a run names no source: it reads stored records or every source at once. */
  allSourcesNote: string
  noSourceHint: string
  allSources: string
  showing: string
  retention: string
  page: string
  previous: string
  next: string
  csvHeader: readonly string[]
  empty: string; unavailable: string; loading: string; exportCsv: string; exported: string; exportFailed: string
  actions: Readonly<Record<'collect' | 'refresh' | 'analysis' | 'configure' | 'test' | 'import' | 'other', string>>
  /** `handlerId` → the reader's name for that job; the service catalogue's own labels are data. */
  tasks: Readonly<Record<string, string>>
  /** `sourceId` → the product's name for that source, the same map the source list uses. */
  sourceNames?: Readonly<Record<string, string>>
  outcomes: Readonly<Record<'succeeded' | 'failed' | 'cancelled' | 'running', string>>
}>

const WINDOWS: readonly SyncRunWindow[] = ['24h', '7d', 'all']
/** Thirty rows a page: one screen of recent history without a wall of scroll. */
const SYNC_RUN_PAGE_SIZE = 30

export function SyncRunSection({ text }: Readonly<{ text: SyncRunText }>): React.ReactElement {
  const [window, setWindow] = useState<SyncRunWindow>('24h')
  const [outcome, setOutcome] = useState<SyncRunQuery['outcome']>()
  const [state, setState] = useState<'loading' | 'available' | 'unavailable'>('loading')
  const [rows, setRows] = useState<readonly SyncRunRow[]>([])
  const [taskFilter, setTaskFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [page, setPage] = useState(0)
  const [notice, setNotice] = useState<string>()
  // The window is the server-side filter; outcome and source narrow what is already on screen so
  // the source list can be built from the same fetch instead of a second round trip.
  const query: SyncRunQuery = { window, limit: 500 }

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void syncRunClient.list({ window, limit: 500 }).then((result) => {
      if (cancelled) return
      if (result.state === 'available') { setRows(result.rows); setState('available') } else setState('unavailable')
    })
    return () => { cancelled = true }
  }, [window, outcome])

  // A run's task and source arrive as data. Product-side rows use their action as the handler id,
  // so the audit actions are the fallback before the raw label — otherwise an English reader gets
  // Chinese job names with no translation path at all.
  const auditTaskLabel = (handlerId: string): string | undefined =>
    Object.prototype.hasOwnProperty.call(text.actions, handlerId)
      ? text.actions[handlerId as keyof SyncRunText['actions']]
      : undefined
  const taskLabelOf = (row: SyncRunRow): string =>
    text.tasks[row.handlerId] ?? auditTaskLabel(row.handlerId) ?? row.taskLabel
  const sourceLabelOf = (source: SyncRunRow['sources'][number]): string =>
    text.sourceNames?.[source.sourceId] ?? source.label
  const tasks = [...new Set(rows.map(taskLabelOf))].sort()
  const sources = [...new Map(rows.flatMap((row) => row.sources).map((source) => [source.sourceId, sourceLabelOf(source)])).entries()].sort((left, right) => left[1].localeCompare(right[1]))
  const filtered = rows
    .filter((row) => taskFilter === '' || taskLabelOf(row) === taskFilter)
    .filter((row) => sourceFilter === '' || row.sources.some((source) => source.sourceId === sourceFilter))
    .filter((row) => outcome === undefined || row.outcome === outcome)
  const pageSize = SYNC_RUN_PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize)

  const exportCsv = async () => {
    // Export exactly what the filters produced, not the unfiltered window the IPC read returned.
    const csv = syncRunsCsv(filtered.map((row) => ({
      ...row,
      taskLabel: taskLabelOf(row),
      sources: row.sources.map((source) => ({ ...source, label: sourceLabelOf(source) }))
    })), text.csvHeader)
    try {
      await navigator.clipboard.writeText(csv)
      setNotice(text.exported)
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
            {tasks.map((task) => <option key={task} value={task}>{task}</option>)}
          </select>
        </label>
        <label>{text.columns.source}
          <select value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value); setPage(0) }}>
            <option value="">{text.allSources}</option>
            {sources.map(([sourceId, label]) => <option key={sourceId} value={sourceId}>{label}</option>)}
          </select>
        </label>
        <label>{text.columns.outcome}
          <select value={outcome ?? ''} onChange={(event) => { setOutcome((event.target.value || undefined) as SyncRunQuery['outcome']); setPage(0) }}>
            <option value="">{text.outcome.any}</option>
            {(['succeeded', 'failed', 'running'] as const).map((value) => <option key={value} value={value}>{text.outcome[value]}</option>)}
          </select>
        </label>
        <button onClick={() => void exportCsv()} type="button">{text.exportCsv}</button>
        {notice ? <span className="mi-sync-run__notice" role="status">{notice}</span> : null}
      </div>
    </header>
    {state === 'loading' ? <LoadingState label={text.loading} minHeight={160} /> : null}
    {state === 'unavailable' ? <p className="mi-sync-run__empty">{text.unavailable}</p> : null}
    {state === 'available' && rows.length === 0 ? <p className="mi-sync-run__empty">{text.empty}</p> : null}
    {state === 'available' && rows.length > 0 && visible.length === 0 ? <p className="mi-sync-run__empty">{text.empty}</p> : null}
    {state === 'available' && visible.length > 0 ? <div className="mi-sync-run__scroll" role="table" aria-label={text.title}>
      {/* A grid, not a table: the header and every row share one column template, so a sticky header
          cannot lay itself out on a different grid from the body. */}
      <div className="mi-sync-run__grid mi-sync-run__grid--head" role="row">
        <span role="columnheader">{text.columns.time}</span>
        <span role="columnheader">{text.columns.task}</span>
        <span role="columnheader">{text.columns.source}</span>
        <span role="columnheader">{text.columns.action}</span>
        <span role="columnheader">{text.columns.outcome}</span>
        <span role="columnheader">{text.columns.duration}</span>
        <span role="columnheader">{text.columns.detail}</span>
      </div>
      {visible.map((row) => <div className="mi-sync-run__grid" data-outcome={row.outcome} key={row.runId} role="row">
        <span className="mi-sync-run__time" role="cell">{formatTime(row.at, window)}</span>
        <span className="mi-sync-run__task" role="cell" title={taskLabelOf(row)}>{taskLabelOf(row)}</span>
        <span className="mi-sync-run__source" role="cell" title={row.sources.map(sourceLabelOf).join(text.joiner)}>
          {row.sources.length === 0 ? <span title={text.noSourceHint}>{text.allSourcesNote}</span> : row.sources.slice(0, 2).map(sourceLabelOf).join(text.joiner)}
          {row.sources.length > 2 ? ` +${row.sources.length - 2}` : ''}
        </span>
        <span role="cell">{text.actions[row.action]}</span>
        <span role="cell" data-outcome={row.outcome}>{text.outcomes[row.outcome]}</span>
        <span className="mi-sync-run__duration" role="cell">{row.durationMs === undefined ? '—' : `${(row.durationMs / 1000).toFixed(1)}s`}</span>
        <span className="mi-sync-run__detail" role="cell">
          {row.failureCode ? <code>{row.failureCode}</code> : null}
          {row.detail ? <span>{row.detail}</span> : null}
        </span>
      </div>)}
    </div> : null}
    {state === 'available' && filtered.length > 0
      ? <footer className="mi-sync-run__foot">
        <span>{text.showing.replace('{shown}', String(visible.length)).replace('{total}', String(filtered.length))}{text.joiner}{text.retention}</span>
        {pageCount > 1 ? <span className="mi-sync-run__pager">
          <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} type="button">{text.previous}</button>
          <span>{text.page.replace('{page}', String(currentPage + 1)).replace('{pages}', String(pageCount))}</span>
          <button disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} type="button">{text.next}</button>
        </span> : null}
      </footer>
      : null}
  </section>
}

/** A time alone is only unambiguous inside one day; wider windows carry the date. */
function formatTime(at: string, window: SyncRunWindow): string {
  const parsed = new Date(at)
  if (Number.isNaN(parsed.getTime())) return at
  const time = parsed.toLocaleTimeString(undefined, { hour12: false })
  if (window === '24h') return time
  return `${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')} ${time}`
}
