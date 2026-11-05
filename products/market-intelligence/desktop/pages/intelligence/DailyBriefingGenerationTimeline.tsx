import type { BriefingGenerationWaiting } from '../../../contracts/dailyBriefing'
import { useProductTextKey } from '../../shared/i18n/productTextKey'

import { DailyBriefingStageSteps, type DailyBriefingStageRowState } from './DailyBriefingStageList'
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
export function DailyBriefingGenerationTimeline({ trace, text, formatTime, running = false, waiting }: Readonly<{
  trace: GenerationTrace | undefined
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  /** The run is still in flight: the same list, with a running word instead of a verdict. */
  running?: boolean
  /**
   * The run exists but has not opened an attempt yet: it is waiting for the market it is about to
   * read. Said here because "one running, no attempt, no session" is otherwise unreadable.
   */
  waiting?: BriefingGenerationWaiting | undefined
}>): React.ReactElement {
  const resolveText = useProductTextKey()
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
  // A failure without a trace still has stages: they are shown as never reached instead of a blank.
  const emptyTrace: GenerationTrace = {
    attemptId: '',
    startedAt: '',
    finishedAt: '',
    state: 'success',
    stages: generationStageIds.map((id) => ({ id, state: 'pending' as const }))
  }
  const rendered = trace ?? emptyTrace
  const summaryLine = waiting
    ? labels.waitingSummary
    : running
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
    {waiting
      ? <p className="mi-generation-trace__summary" data-generation-waiting="true">
        {labels.notStartedYet} · {labels.waitingElapsed.replace('{seconds}', String(Math.round(waiting.waitedMs / 1_000))).replace('{polls}', String(waiting.polls))}
      </p>
      : trace
      ? <p className="mi-generation-trace__summary">
        {labels.attempt} · {labels.startedAt.replace('{time}', formatInstant(trace.startedAt, formatTime))}
        {!running && duration !== undefined ? ` · ${labels.duration.replace('{duration}', formatDuration(duration, text))}` : ''}
      </p>
      : <p className="mi-generation-trace__missing" data-generation-trace-missing="true">{labels.missing}</p>}
    {waiting ? <p className="mi-generation-trace__waiting-hint" data-generation-waiting-hint="true">{labels.waitingHint}</p> : null}
    <>
      {trace && trace.state === 'failed' ? <p className="mi-generation-trace__failed" data-failed-stage-label>
        {labels.failedAt.replace('{stage}', failedLabel)}
      </p> : null}
      {/* One stepper for every state: the live run draws the same container, so "generating" and
          "finished/failed" cannot drift apart in spacing, indentation or connector placement. */}
      <DailyBriefingStageSteps rows={generationStageIds.map((id) => {
        const stage = rendered.stages.find((entry) => entry.id === id)
        const state = stage?.state ?? 'pending'
        const skipReason = state === 'skipped' ? skipReasonFor(generationStageIds.indexOf(id), failedIndex) : undefined
        const failure = failed?.id === id ? stage : undefined
        return {
          id,
          // A stage that ran more than once says so: the row keeps the last segment's time, so without
          // the count a run that checked four times reads exactly like a run that checked once.
          name: stage && (stage.runs ?? 1) > 1 ? `${labels.stages[id]} ×${stage.runs}` : labels.stages[id],
          state: rowStateFor(stage, skipReason),
          detail: stage ? stageResult(stage, id, skipReason, text, formatTime, running) : running ? text.generationTrace.states.notStarted : labels.notRecorded,
          ...(labels.stageHelp?.[id]?.trim()
            ? { help: { labelKey: STAGE_HELP_KEYS[id], triggerLabelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.generationTrace.stageHelpLabel', triggerLabelParams: { stage: labels.stages[id] }, dataAttributes: { 'data-stage-help': id } } }
            : {}),
          attributes: { 'data-stage-skip': skipReason ?? 'none' },
          ...(failure?.failureCode
            ? { failure: { code: failure.failureCode, label: `${failureLabel(failure.failureCode, text)}${failure.failureDetail ? ` · ${readableFailureDetail(failure.failureDetail, text.failurePanel.detail) ?? ''}` : ''}` } }
            : {})
        }
      })} resolveText={resolveText} />
    </>
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
function rowStateFor(stage: GenerationTraceStage | undefined, skipReason: SkipReason | undefined): DailyBriefingStageRowState {
  if (!stage) return 'waiting'
  if (stage.state === 'success') return 'done'
  if (stage.state === 'failed') return 'failed'
  if (stage.state === 'pending') return stage.startedAt ? 'running' : 'waiting'
  return skipReason === 'blocked' ? 'waiting' : 'not-needed'
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

function stageResult(
  stage: GenerationTraceStage,
  id: GenerationStageId,
  skipReason: SkipReason | undefined,
  text: DailyBriefingText,
  formatTime: (value: string, precision?: 'minute' | 'second') => string,
  running: boolean
): string {
  // The start instant, not a range: the duration beside it already says how long the stage took,
  // and "07:21:26 → 07:21:27" answers a question the reader did not ask.
  const instant = formatInstant(stage.startedAt ?? stage.finishedAt, formatTime)
  // No end, no duration: a step still running must not print "0 ms" as if it had taken no time.
  const duration = stage.finishedAt ? stageDurationMs(stage) : undefined
  const parts = [instant, duration !== undefined ? formatDuration(duration, text) : ''].filter(Boolean)
  // A step that is executing says so; without the word its row is only a clock, and the reader
  // cannot tell "working on it" from "finished at that moment".
  if (running && stage.state === 'pending' && stage.startedAt) parts.push(text.generationProgress.running)
  if (parts.length > 0) return parts.join(' · ')
  if (stage.state === 'skipped') {
    if (skipReason === 'blocked') return text.generationTrace.states.notRun
    // Only the repair stages mean "no repair was needed"; any other clean skip just says skipped.
    return id === 'repair-1' || id === 'repair-2' ? text.generationTrace.states.notNeeded : text.generationTrace.states.skipped
  }
  // A step the run has not reached yet has not started; "not recorded" is what a finished run says
  // about a step that left no row behind.
  return running ? text.generationTrace.states.notStarted : text.generationTrace.notRecorded
}

/**
 * One instant per stage: the moment it started. A stage's end is not printed — the duration next to
 * it says how long it took — so a row never reads as "from this time to that time".
 *
 * The shell formatter writes `YYYY-MM-DD HH:mm:ss`; the date is dropped here because an attempt
 * lives inside one edition and the reader is looking at one day.
 */
function formatInstant(
  value: string | undefined,
  formatTime: (value: string, precision?: 'minute' | 'second') => string
): string {
  if (!value) return ''
  const [first, second] = formatTime(value, 'second').split(' ')
  return second && /^\d{4}-\d{2}-\d{2}$/.test(first ?? '') ? second : first ?? ''
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
