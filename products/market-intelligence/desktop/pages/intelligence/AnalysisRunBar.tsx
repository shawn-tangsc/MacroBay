import { ChevronDown, ChevronUp } from 'lucide-react'
import { useId, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { analysisRunRecords, type AnalysisRunRecord } from './analysisRunBarModel'
import { useSampleNow } from './SampleModeProvider'
import './analysisRunBar.css'

/**
 * The wording the runs bar needs. `reasons` is the timeline's own trigger-status vocabulary, handed
 * in rather than copied: one decision, one set of sentences.
 */
export type AnalysisRunBarText = Readonly<{
  title: string
  /** "最近一次" — the collapsed line names the newest run, never a count. */
  latestPrefix: string
  loading: string
  unavailable: string
  empty: string
  ranTitle: string
  skippedTitle: string
  /** A run that exists but carries no decision; not an "unanalysed" one. */
  unattributed: string
  reasons: Record<string, string>
}>

/**
 * 本次运行 — the region-level footer under the dashboard.
 *
 * Two lists live here and they are not the same list:
 * - "为什么分析了" reads the timeline entries, i.e. runs that were published;
 * - "哪些没分析" is the ledger's skipped decisions, whose read projection is not wired yet (S2), so
 *   it states "记录没拿到" instead of pretending the day had no skips. An empty skipped list is a
 *   claim we cannot make today; the "nothing happened" sentence is reserved for after S2.
 *
 * The bar shows no counts and no allowance numbers: one timeline row is one analysis, not one
 * signal, so a count taken from rows would be the second truth ("1 on screen, 4 actually happened").
 */
export function AnalysisRunBar({ entries, loading, failed, text }: Readonly<{
  entries: readonly MarketAnalysisTimelineEntry[]
  loading: boolean
  failed: boolean
  text: AnalysisRunBarText
}>): React.ReactElement {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const timeZone = useShellTimeZone()
  const formatTime = useShellTimeFormat()
  const now = useSampleNow()
  const records = analysisRunRecords(entries, now().toISOString(), timeZone)
  const latest = records[0]
  // A code without copy is a guard failure (the timeline asserts every reason has a sentence);
  // saying "原因没记录" is still closer to the truth than printing the code.
  const reasonOf = (record: AnalysisRunRecord): string =>
    (record.reasonCode ? text.reasons[record.reasonCode] : undefined) ?? text.unattributed
  const summary = loading && !latest ? text.loading
    : failed && !latest ? text.unavailable
      : latest ? `${text.latestPrefix}：${reasonOf(latest)} · ${formatTime(latest.at)}` : text.empty

  return <section className="mi-analysis-run-bar" aria-label={text.title}>
    <button aria-controls={panelId} aria-expanded={open} className="mi-analysis-run-bar__summary"
      onClick={() => setOpen(current => !current)} type="button">
      <span className="mi-analysis-run-bar__title">{text.title}</span>
      <span className="mi-analysis-run-bar__latest">{summary}</span>
      {open
        ? <ChevronDown aria-hidden="true" size={14} />
        : <ChevronUp aria-hidden="true" size={14} />}
    </button>
    {/* 可滚动区域要能拿到焦点，键盘与读屏才滚得动（WCAG「可滚区域必须可聚焦」）；
        没有可聚焦子元素的静态列表，这是唯一的进入方式。 */}
    {open ? <div aria-label={text.title} className="mi-analysis-run-bar__records" id={panelId} role="group" tabIndex={0}>
      <h3>{text.ranTitle}</h3>
      {loading ? <LoadingState label={text.loading} layout="inline" size="sm" /> : null}
      {failed ? <p className="mi-analysis-run-bar__state" data-state="unavailable">{text.unavailable}</p> : null}
      {records.length > 0 ? <ul>
        {records.map(record => <li className="mi-analysis-run-bar__row" data-reason={record.reasonCode ?? 'unrecorded'} key={record.id}>
          <time dateTime={record.at}>{formatTime(record.at)}</time>
          <span>{reasonOf(record)}</span>
        </li>)}
      </ul> : !loading && !failed
        // Nothing ran today and the read succeeded: this is the one "确实没有" we can prove.
        ? <p className="mi-analysis-run-bar__state">{text.empty}</p>
        : null}
      <h3>{text.skippedTitle}</h3>
      {/* The skipped decisions' read projection is not wired yet: say so, never show an empty list
          that would read as "nothing was skipped". */}
      <p className="mi-analysis-run-bar__state" data-state="unavailable">{text.unavailable}</p>
    </div> : null}
  </section>
}
