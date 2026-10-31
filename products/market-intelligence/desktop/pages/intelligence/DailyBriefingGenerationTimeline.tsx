import { useEffect, useState } from 'react'
import { Steps, Tooltip } from 'antd'
import { CircleHelp } from 'lucide-react'

import type { DailyBriefingText } from './dailyBriefingText'
import {
  failedStage,
  generationStageIds,
  stageDurationMs,
  traceDurationMs,
  type GenerationStageId,
  type GenerationTrace,
  type GenerationTraceStage
} from './dailyBriefingGenerationTrace'
import { readableFailureDetail } from './dailyBriefingFailureDetail'

type StepStatus = 'finish' | 'error' | 'wait' | 'process'

/**
 * The right rail's first block: the fixed generation stages as a vertical stepper, with the status
 * and timing the service recorded for each. Every stage is always visible; there is nothing to fold.
 *
 * A stage the trace does not carry is shown as not recorded. The timeline never fills a gap with a
 * guessed success, a guessed duration or a guessed stage: a reader auditing a failed generation
 * needs to see exactly where it stopped. Each stage carries its fixed logic behind a question mark
 * instead of a paragraph, while the recorded result — timing, failure code and detail — stays in
 * the step's description.
 */
export function DailyBriefingGenerationTimeline({ trace, text, formatTime }: Readonly<{
  trace: GenerationTrace | undefined
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
}>): React.ReactElement {
  const labels = text.generationTrace
  const failed = trace ? failedStage(trace) : undefined
  const failedLabel = failed ? labels.stages[failed.id] : labels.notRecorded
  const duration = trace ? traceDurationMs(trace) : undefined
  const failedIndex = failed ? generationStageIds.indexOf(failed.id) : -1
  return <section className="mi-generation-trace" data-generation-trace-state={trace?.state ?? 'missing'} data-failed-stage={failed?.id ?? 'none'}>
    <header className="mi-generation-trace__head">
      <h3>{labels.title}</h3>
      <span data-trace-state={trace?.state ?? 'missing'}>{trace ? trace.state === 'failed' ? labels.failed : labels.completed : labels.notRecorded}</span>
    </header>
    {trace ? <>
      <p className="mi-generation-trace__summary">
        {labels.attempt} · {formatRange(trace.startedAt, trace.finishedAt, formatTime)}
        {duration !== undefined ? ` · ${labels.duration.replace('{duration}', formatDuration(duration, text))}` : ''}
      </p>
      {trace.state === 'failed' ? <p className="mi-generation-trace__failed" data-failed-stage-label>
        {labels.failedAt.replace('{stage}', failedLabel)}
      </p> : null}
      <Steps
        className="mi-generation-trace__steps"
        direction="vertical"
        size="small"
        items={generationStageIds.map((id) => {
          const stage = trace.stages.find((entry) => entry.id === id)
          const state = stage?.state ?? 'pending'
          const skipReason = state === 'skipped' ? skipReasonFor(generationStageIds.indexOf(id), failedIndex) : undefined
          const failure = failed?.id === id ? stage : undefined
          return {
            status: stepStatus(stage, skipReason),
            title: <span className="mi-generation-trace__stage-title" data-stage={id} data-stage-state={state} data-stage-skip={skipReason ?? 'none'}>
              <span className="mi-generation-trace__stage-name">{labels.stages[id]}</span>
              <StageHelp id={id} text={text} />
            </span>,
            description: <span className="mi-generation-trace__stage-result" data-stage-result={id} data-stage-result-state={state}>
              <span className="mi-generation-trace__stage-time">{stage ? stageResult(stage, id, skipReason, text, formatTime) : labels.notRecorded}</span>
              {failure?.failureCode ? <span className="mi-generation-trace__stage-failure" data-stage-failure-code={failure.failureCode}>
                {failureLabel(failure.failureCode, text)}
                {failure.failureDetail ? ` · ${readableFailureDetail(failure.failureDetail, text.failurePanel.detail) ?? ''}` : ''}
              </span> : null}
            </span>
          }
        })}
      />
    </> : <p className="mi-generation-trace__missing" data-generation-trace-missing="true">{labels.missing}</p>}
  </section>
}

type SkipReason = 'not-needed' | 'blocked'

/**
 * A skipped stage before the failing one was not needed (a clean validation needs no repair), so it
 * still counts as a success. Only a stage after the failure was cut off by it and stays grey.
 */
function skipReasonFor(index: number, failedIndex: number): SkipReason {
  return failedIndex >= 0 && index > failedIndex ? 'blocked' : 'not-needed'
}

/** Not needed is a finished stage; blocked and absent stages wait; a started, unended stage is in process. */
function stepStatus(stage: GenerationTraceStage | undefined, skipReason: SkipReason | undefined): StepStatus {
  if (!stage) return 'wait'
  if (stage.state === 'success') return 'finish'
  if (stage.state === 'failed') return 'error'
  if (stage.state === 'pending') return stage.startedAt ? 'process' : 'wait'
  return skipReason === 'blocked' ? 'wait' : 'finish'
}

/**
 * The fixed logic of one stage, behind the question mark. Hover and keyboard focus preview it,
 * a click pins or closes it, and Escape closes it from anywhere. The help is a stage's own copy:
 * when the locale has no line for a stage the icon is not rendered, so no empty tooltip appears.
 */
function StageHelp({ id, text }: Readonly<{ id: GenerationStageId; text: DailyBriefingText }>): React.ReactElement | null {
  const labels = text.generationTrace
  const help = labels.stageHelp[id]
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  // A dismiss (click on a pinned icon, or Escape) outranks the pointer still resting on the icon.
  const [dismissed, setDismissed] = useState(false)
  const open = (pinned || hovered) && !dismissed

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setPinned(false)
      setHovered(false)
      setDismissed(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!help?.trim()) return null
  return <Tooltip open={open} title={help} trigger={[]} placement="top" styles={{ root: { maxWidth: 360 } }}>
    <button
      className="mi-generation-trace__stage-help"
      type="button"
      data-stage-help={id}
      aria-label={labels.stageHelpLabel.replace('{stage}', labels.stages[id])}
      aria-expanded={open}
      onMouseEnter={() => { setHovered(true); setDismissed(false) }}
      onMouseLeave={() => { setHovered(false); setDismissed(false) }}
      onFocus={() => { setHovered(true); setDismissed(false) }}
      onBlur={() => { setHovered(false); setPinned(false); setDismissed(false) }}
      onClick={() => {
        if (pinned) { setPinned(false); setDismissed(true) } else { setPinned(true); setDismissed(false) }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        setPinned(false)
        setHovered(false)
        setDismissed(true)
      }}
    >
      <CircleHelp size={10} aria-hidden="true" />
    </button>
  </Tooltip>
}

function stageResult(
  stage: GenerationTraceStage,
  id: GenerationStageId,
  skipReason: SkipReason | undefined,
  text: DailyBriefingText,
  formatTime: (value: string, precision?: 'minute' | 'second') => string
): string {
  const range = formatRange(stage.startedAt, stage.finishedAt, formatTime)
  const duration = stageDurationMs(stage)
  const parts = [range, duration !== undefined ? formatDuration(duration, text) : ''].filter(Boolean)
  if (parts.length > 0) return parts.join(' · ')
  if (stage.state === 'skipped') {
    if (skipReason === 'blocked') return text.generationTrace.states.notRun
    // Only the repair stages mean "no repair was needed"; any other clean skip just says skipped.
    return id === 'repair-1' || id === 'repair-2' ? text.generationTrace.states.notNeeded : text.generationTrace.states.skipped
  }
  return text.generationTrace.notRecorded
}

/**
 * A generation run rarely crosses midnight, so the date is noise on almost every row: print
 * `20:56:53 → 20:58:31` and only add `MM-DD` on the side that falls on another day.
 */
function formatRange(
  startedAt: string | undefined,
  finishedAt: string | undefined,
  formatTime: (value: string, precision?: 'minute' | 'second') => string
): string {
  const start = startedAt ? timePoint(startedAt, formatTime) : undefined
  const finish = finishedAt ? timePoint(finishedAt, formatTime) : undefined
  if (start && finish) {
    const sameDay = !start.date || !finish.date || start.date === finish.date
    return `${sameDay ? start.time : withDate(start)} → ${sameDay ? finish.time : withDate(finish)}`
  }
  const only = start ?? finish
  return only ? only.time : ''
}

function timePoint(
  value: string,
  formatTime: (value: string, precision?: 'minute' | 'second') => string
): Readonly<{ date?: string; time: string }> {
  // The shell formatter writes `YYYY-MM-DD HH:mm:ss GMT±n`; a test double may pass the clock alone.
  const [first, second] = formatTime(value, 'second').split(' ')
  if (second && /^\d{4}-\d{2}-\d{2}$/.test(first ?? '')) return { date: first, time: second }
  return { time: first ?? '' }
}

function withDate(point: Readonly<{ date?: string; time: string }>): string {
  return point.date ? `${point.date.slice(5)} ${point.time}` : point.time
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
