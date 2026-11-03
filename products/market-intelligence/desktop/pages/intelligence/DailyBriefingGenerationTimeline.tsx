import { Steps } from 'antd'
import { CircleHelp } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import { useProductTextKey } from '../../shared/i18n/productTextKey'

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
export function DailyBriefingGenerationTimeline({ trace, text, formatTime, running = false }: Readonly<{
  trace: GenerationTrace | undefined
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  /** The run is still in flight: the same list, with a running word instead of a verdict. */
  running?: boolean
}>): React.ReactElement {
  const labels = text.generationTrace
  const failed = trace ? failedStage(trace) : undefined
  const failedLabel = failed ? labels.stages[failed.id] : labels.notRecorded
  const duration = trace ? traceDurationMs(trace) : undefined
  const failedIndex = failed ? generationStageIds.indexOf(failed.id) : -1
  // Collapsed it is one line that still answers "did it finish, where did it fail"; only the detail
  // folds away. Default: open while running or after a failure, closed once it succeeded.
  const steps = generationStageIds.length
  const notStarted = trace ? trace.stages.filter((stage) => !stage.startedAt).length : steps
  const durationLabel = duration !== undefined ? formatDuration(duration, text) : ''
  const summaryLine = running
    ? text.generationProgress.running
    : trace
      ? trace.state === 'failed'
        ? `${labels.failedAt.replace('{stage}', failedLabel)} · ${labels.notExecutedCount.replace('{count}', String(notStarted))}`
        : `${labels.stepsCount.replace('{count}', String(steps))} · ${durationLabel} · ${labels.allCompleted}`
      : labels.notRecorded
  // Open by default in every state: the reader asked to see the steps without a click, so the
  // summary line is the place to collapse from, not the place to start.
  return <details className="mi-generation-trace" data-generation-trace-state={running ? 'running' : trace?.state ?? 'missing'} data-failed-stage={failed?.id ?? 'none'} open>
    <summary className="mi-generation-trace__head">
      <h3>{labels.title}</h3>
      <span data-trace-state={running ? 'running' : trace?.state ?? 'missing'} data-stage-summary="true">{summaryLine}</span>
    </summary>
    {trace ? <>
      <p className="mi-generation-trace__summary">
        {labels.attempt} · {running ? formatTime(trace.startedAt) : formatRange(trace.startedAt, trace.finishedAt, formatTime)}
        {!running && duration !== undefined ? ` · ${labels.duration.replace('{duration}', formatDuration(duration, text))}` : ''}
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
  </details>
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
 * One literal key per stage: the guard only validates literals it can see, so the keys live here
 * rather than being built by string interpolation at the call site.
 */
const STAGE_HELP_KEYS: Record<GenerationStageId, string> = {
  source: 'pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelp.source',
  candidates: 'pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelp.candidates',
  selection: 'pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelp.selection',
  'field-backfill': 'pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelp.field-backfill',
  writing: 'pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelp.writing',
  validation: 'pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelp.validation',
  'repair-1': 'pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelp.repair-1',
  'repair-2': 'pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelp.repair-2',
  store: 'pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelp.store'
}

/**
 * The fixed logic of one stage, behind the question mark: it is a paragraph, so it opens as a
 * popover — hover and focus preview it, a click pins it, Escape closes it and returns the focus.
 * The sentence is the stage's own copy, taken by key; a stage the locale has no line for renders no
 * icon, so an empty bubble cannot appear.
 */
function StageHelp({ id, text }: Readonly<{ id: GenerationStageId; text: DailyBriefingText }>): React.ReactElement | null {
  const labels = text.generationTrace
  const resolveProductText = useProductTextKey()
  if (!labels.stageHelp[id]?.trim()) return null
  return <Popover
    labelKey={STAGE_HELP_KEYS[id]}
    resolveText={resolveProductText}
    trigger={(triggerProps) => (
      <IconButton
        {...triggerProps}
        ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelpLabel"
        ariaLabelParams={{ stage: labels.stages[id] }}
        dataAttributes={{ 'data-stage-help': id }}
        icon={CircleHelp}
        resolveText={resolveProductText}
        size="sm"
        variant="plain"
      />
    )}
  />
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
    // A run that starts and ends in the same second has one instant to print, not two joined by an
    // arrow: "15:54:23 → 15:54:23" reads like a bug because it is one.
    if (start.time === finish.time && (start.date ?? '') === (finish.date ?? '')) return start.time
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
