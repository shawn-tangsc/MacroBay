import { useEffect, useState } from 'react'

import type { DailyBriefingText } from './dailyBriefingText'
import {
  failedStage,
  generationStageIds,
  stageDurationMs,
  traceDurationMs,
  type GenerationTrace,
  type GenerationTraceStage
} from './dailyBriefingGenerationTrace'
import { readableFailureDetail } from './dailyBriefingFailureDetail'

/**
 * The right rail's first block: the fixed generation stages, with the status and timing the service
 * recorded for each.
 *
 * A stage the trace does not carry is shown as not recorded. The timeline never fills a gap with a
 * guessed success, a guessed duration or a guessed stage: a reader auditing a failed generation
 * needs to see exactly where it stopped. A failed attempt opens on its failed stage; a successful
 * one stays folded until the reader asks for it.
 */
export function DailyBriefingGenerationTimeline({ trace, text, formatTime }: Readonly<{
  trace: GenerationTrace | undefined
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
}>): React.ReactElement {
  const labels = text.generationTrace
  const [open, setOpen] = useState(trace?.state === 'failed')
  useEffect(() => { setOpen(trace?.state === 'failed') }, [trace?.attemptId, trace?.state])
  const failed = trace ? failedStage(trace) : undefined
  const failedLabel = failed ? labels.stages[failed.id] : labels.notRecorded
  const duration = trace ? traceDurationMs(trace) : undefined
  return <section className="mi-generation-trace" data-generation-trace-state={trace?.state ?? 'missing'} data-failed-stage={failed?.id ?? 'none'}>
    <header className="mi-generation-trace__head">
      <h3>{labels.title}</h3>
      <span data-trace-state={trace?.state ?? 'missing'}>{trace ? trace.state === 'failed' ? labels.failed : labels.completed : labels.notRecorded}</span>
      {trace ? <button className="mi-generation-trace__toggle" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {open ? labels.collapse : labels.expand}
      </button> : null}
    </header>
    {trace ? <>
      <p className="mi-generation-trace__summary">
        {labels.attempt} · {formatTime(trace.startedAt, 'second')} – {formatTime(trace.finishedAt, 'second')}
        {duration !== undefined ? ` · ${labels.duration.replace('{duration}', formatDuration(duration, text))}` : ''}
      </p>
      {trace.state === 'failed' ? <p className="mi-generation-trace__failed" data-failed-stage-label>
        {labels.failedAt.replace('{stage}', failedLabel)}
      </p> : null}
      {open ? <ol className="mi-generation-trace__stages">
        {generationStageIds.map((id) => {
          const stage = trace.stages.find((entry) => entry.id === id)
          const state = stage?.state ?? 'pending'
          return <li className="mi-generation-trace__stage" key={id} data-stage={id} data-stage-state={state}>
            <span className="mi-generation-trace__stage-dot" data-stage-dot={state} aria-hidden="true" />
            <span className="mi-generation-trace__stage-name">{labels.stages[id]}</span>
            <span className="mi-generation-trace__stage-time">{stage ? stageTiming(stage, text, formatTime) : labels.notRecorded}</span>
            {failed?.id === id && stage?.failureCode ? <span className="mi-generation-trace__stage-failure" data-stage-failure-code={stage.failureCode}>
              {failureLabel(stage.failureCode, text)}
              {stage.failureDetail ? ` · ${readableFailureDetail(stage.failureDetail, text.failurePanel.detail) ?? ''}` : ''}
            </span> : null}
          </li>
        })}
      </ol> : null}
    </> : <p className="mi-generation-trace__missing" data-generation-trace-missing="true">{labels.missing}</p>}
  </section>
}

function stageTiming(
  stage: GenerationTraceStage,
  text: DailyBriefingText,
  formatTime: (value: string, precision?: 'minute' | 'second') => string
): string {
  const start = stage.startedAt ? formatTime(stage.startedAt, 'second') : undefined
  const finish = stage.finishedAt ? formatTime(stage.finishedAt, 'second') : undefined
  const range = start && finish ? `${start} – ${finish}` : start ?? finish ?? ''
  const duration = stageDurationMs(stage)
  const parts = [range, duration !== undefined ? formatDuration(duration, text) : ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : text.generationTrace.notRecorded
}

function formatDuration(milliseconds: number, text: DailyBriefingText): string {
  const units = text.generationTrace.durationUnits
  if (milliseconds < 1_000) return units.milliseconds.replace('{count}', String(Math.round(milliseconds)))
  const seconds = milliseconds / 1_000
  if (seconds < 60) return units.seconds.replace('{count}', String(Math.round(seconds * 10) / 10))
  const minutes = Math.floor(seconds / 60)
  return units.minutes.replace('{count}', String(minutes)).replace('{seconds}', String(Math.round(seconds % 60)))
}

function failureLabel(code: string, text: DailyBriefingText): string {
  return (text.aiSettings.failure as Readonly<Record<string, string>>)[code] ?? text.failurePanel.unknownCode
}
