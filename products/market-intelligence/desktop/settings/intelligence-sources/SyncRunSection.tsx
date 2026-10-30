import { useEffect, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'

import type { SyncRunQuery, SyncRunRow, SyncRunWindow } from '../../../contracts/syncRunRecords'
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
  columns: Readonly<Record<'time' | 'source' | 'action' | 'outcome' | 'duration' | 'detail', string>>
  empty: string; unavailable: string; loading: string; exportCsv: string; exported: string; exportFailed: string
  actions: Readonly<Record<'collect' | 'refresh' | 'analysis' | 'configure' | 'test' | 'import' | 'other', string>>
  outcomes: Readonly<Record<'succeeded' | 'failed' | 'cancelled' | 'running', string>>
}>

const WINDOWS: readonly SyncRunWindow[] = ['24h', '7d', 'all']

export function SyncRunSection({ text }: Readonly<{ text: SyncRunText }>): React.ReactElement {
  const [window, setWindow] = useState<SyncRunWindow>('24h')
  const [outcome, setOutcome] = useState<SyncRunQuery['outcome']>()
  const [state, setState] = useState<'loading' | 'available' | 'unavailable'>('loading')
  const [rows, setRows] = useState<readonly SyncRunRow[]>([])
  const [notice, setNotice] = useState<string>()
  const query: SyncRunQuery = { window, limit: 200, ...(outcome ? { outcome } : {}) }

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void syncRunClient.list({ window, limit: 200, ...(outcome ? { outcome } : {}) }).then((result) => {
      if (cancelled) return
      if (result.state === 'available') { setRows(result.rows); setState('available') } else setState('unavailable')
    })
    return () => { cancelled = true }
  }, [window, outcome])

  const exportCsv = async () => {
    const result = await syncRunClient.exportCsv(query)
    if (result.state !== 'available') return
    try {
      await navigator.clipboard.writeText(result.csv)
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
          <select value={window} onChange={(event) => setWindow(event.target.value as SyncRunWindow)}>
            {WINDOWS.map((value) => <option key={value} value={value}>{text.window[value]}</option>)}
          </select>
        </label>
        <label>{text.columns.outcome}
          <select value={outcome ?? ''} onChange={(event) => setOutcome((event.target.value || undefined) as SyncRunQuery['outcome'])}>
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
    {state === 'available' && rows.length > 0 ? <table className="mi-sync-run__table">
      <thead><tr>
        <th>{text.columns.time}</th><th>{text.columns.source}</th><th>{text.columns.action}</th>
        <th>{text.columns.outcome}</th><th>{text.columns.duration}</th><th>{text.columns.detail}</th>
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={row.runId} data-outcome={row.outcome}>
        <td className="mi-sync-run__time">{formatTime(row.at)}</td>
        <td>{row.sourceLabel}</td>
        <td>{text.actions[row.action]}</td>
        <td><span data-outcome={row.outcome}>{text.outcomes[row.outcome]}</span></td>
        <td className="mi-sync-run__duration">{row.durationMs === undefined ? '—' : `${(row.durationMs / 1000).toFixed(1)}s`}</td>
        <td className="mi-sync-run__detail">{row.failureCode ? <code>{row.failureCode}</code> : null}{row.detail ? <span>{row.detail}</span> : null}</td>
      </tr>)}</tbody>
    </table> : null}
  </section>
}

function formatTime(at: string): string {
  const parsed = new Date(at)
  return Number.isNaN(parsed.getTime()) ? at : parsed.toLocaleTimeString(undefined, { hour12: false })
}
