import { formatShellClock } from '@platform/ui/time/shellTimeFormat'

import type { SyncRunAnalysisResult, SyncRunRow } from '../../../contracts/syncRunRecords'

import type { SyncRunText } from './SyncRunSection'

/**
 * The analysis column of the run log, and the record behind it.
 *
 * Kept apart from the table for one reason: this is a second reading of the same run — an analysis
 * can fail where the collection succeeded — and it has its own vocabulary (four states, a code that
 * only appears after the reader asks, a panel per record). The table does not need to know any of it.
 */

/** A time alone is only unambiguous inside one day; wider windows carry the date. */
export function formatSyncRunTime(at: string, timeZone: string): string {
  // 同一显示日只给时刻，跨日带日期；时区来自窗口级 provider，产品不再自己取本地时间。
  // 失败时原样返回原始值，宁可显示未格式化的串，也不猜一个时刻。
  return formatShellClock(at, { timeZone }) ?? at
}

/** One id per analysis record, so the toggle and the panel it controls cannot drift apart. */
export function analysisRecordId(runId: string): string {
  return `sync-run-analysis-${runId}`
}

/**
 * The reader's sentence for a failed analysis.
 *
 * The sentences are the timeline's own map (passed in), not a second copy: one code must not end up
 * with two different explanations depending on which screen the reader is on.
 */
function analysisSentence(
  result: SyncRunAnalysisResult,
  text: SyncRunText,
  reasons: Readonly<Record<string, string>> | undefined
): string | undefined {
  if (result.state !== 'failed' && result.state !== 'invalid-output') return undefined
  return (result.failureCode ? reasons?.[result.failureCode] : undefined) ?? text.analysis.reasonFallback
}

/**
 * The analysis column's cell.
 *
 * Four answers, and only one of them opens: a task that owns an analysis but has no record tied to
 * it says `unlinked`, and a record that carried no analysis says `unavailable` — because "the link
 * is missing" and "we could not read it" are facts the reader came here to tell apart.
 */
export function AnalysisCell({ analysis, analysisFailureReasons, expanded, onToggle, text }: Readonly<{
  analysis: SyncRunRow['analysis']
  analysisFailureReasons?: Readonly<Record<string, string>>
  expanded: boolean
  onToggle: (runId: string) => void
  text: SyncRunText
}>): React.ReactElement {
  if (analysis.state === 'not-applicable') {
    return <span aria-label={text.analysis.notApplicableHint} className="mi-sync-run__analysis-note">
      {text.analysis.notApplicable}
    </span>
  }
  if (analysis.state === 'unlinked') {
    return <span aria-label={text.analysis.unlinkedHint} className="mi-sync-run__analysis-note">
      {text.analysis.unlinked}
    </span>
  }
  if (analysis.state === 'unavailable') {
    return <span aria-label={text.analysis.unavailableHint} className="mi-sync-run__analysis-note">
      {text.analysis.unavailable}
    </span>
  }
  const result = analysis.result
  const state = text.analysis.states[result.state]
  const reason = analysisSentence(result, text, analysisFailureReasons)
  const visible = reason ? `${state}${text.joiner}${reason}` : state
  return <button
    aria-controls={analysisRecordId(result.runId)}
    aria-expanded={expanded}
    aria-label={`${visible}${text.joiner}${expanded ? text.analysis.close : text.analysis.open}`}
    className="mi-sync-run__analysis-button"
    onClick={() => onToggle(result.runId)}
    type="button"
  >{visible}</button>
}

/** The analysis record behind the cell: what it recorded, including the code, once asked for. */
export function AnalysisRecord({ analysisFailureReasons, result, text, timeZone }: Readonly<{
  analysisFailureReasons?: Readonly<Record<string, string>>
  result: SyncRunAnalysisResult
  text: SyncRunText
  timeZone: string
}>): React.ReactElement {
  const reason = analysisSentence(result, text, analysisFailureReasons)
  const fields: Array<readonly [string, string]> = []
  if (reason) fields.push([text.analysis.fields.reason, reason])
  fields.push([
    text.analysis.fields.started,
    result.startedAt ? formatSyncRunTime(result.startedAt, timeZone) : text.analysis.notRecorded
  ])
  fields.push([
    text.analysis.fields.completed,
    result.completedAt ? formatSyncRunTime(result.completedAt, timeZone) : text.analysis.notRecorded
  ])
  if (result.modelProviderId || result.modelId) {
    fields.push([
      text.analysis.fields.model,
      [result.modelProviderId, result.modelId].filter(Boolean).join(text.joiner)
    ])
  }
  // Codes are diagnosis, so they appear here — after the reader asked — and never on the row.
  if (result.failureCode) fields.push([text.analysis.fields.code, result.failureCode])
  if (result.failureDetailCode) fields.push([text.analysis.fields.detailCode, result.failureDetailCode])
  return <>
    <p className="mi-sync-run__analysis-record-head">
      {`${text.analysis.recordTitle}${text.joiner}${result.runId}`}
    </p>
    <dl className="mi-sync-run__analysis-record-fields">
      {fields.map(([label, value]) => <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>)}
    </dl>
  </>
}
