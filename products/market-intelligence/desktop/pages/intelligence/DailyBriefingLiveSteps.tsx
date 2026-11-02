import { Check, CircleAlert, Loader, Minus } from 'lucide-react'

import { briefingGenerationDisplayRows, type BriefingGenerationProgress, type BriefingGenerationStage } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The steps of the generation that is running right now.
 *
 * Rows come from the contract's mapping, not from this file: the pipeline has nine stages, the
 * reader sees eight, and the fold (two repair rounds, one row) is defined once in the contract.
 * A page that combined them itself would be computing the same fact a second time.
 *
 * What a row says is what was observed. A step that has not begun says it is waiting; it never
 * borrows the previous step's timing, and there is no percentage anywhere — writing and validation
 * are single model calls, so a percentage would be invented rather than measured.
 */

type RowState = 'done' | 'not-needed' | 'running' | 'waiting' | 'failed'

export type DailyBriefingLiveStepsProps = Readonly<{
  progress: BriefingGenerationProgress
  text: DailyBriefingText
  /** Milliseconds, so the running row can show the time it has been running. */
  nowMs: number
}>

export function DailyBriefingLiveSteps({ progress, text, nowMs }: DailyBriefingLiveStepsProps): React.ReactElement {
  const byId = new Map(progress.stages.map((stage) => [stage.id, stage]))
  const copy = text.generationProgress
  return <div className="mi-brief-steps" role="status" data-live-steps="true">
    <ol className="mi-brief-steps__list">
      {briefingGenerationDisplayRows.map((row) => {
        const stages = row.stages.map((id) => byId.get(id)).filter((stage) => stage !== undefined)
        const state = rowState(stages)
        const startedAt = stages.find((stage) => stage.startedAt)?.startedAt
        const elapsed = state === 'running' && startedAt ? nowMs - Date.parse(startedAt) : undefined
        return <li key={row.id} className="mi-brief-steps__row" data-step={row.id} data-step-state={state}>
          <StepIcon state={state} />
          <span className="mi-brief-steps__name">{rowName(row.id, text, copy.repair)}</span>
          <span className="mi-brief-steps__detail">{detail(state, elapsed, copy, text)}</span>
        </li>
      })}
    </ol>
    {/* Says out loud what the rows cannot: a row that holds still is still working. */}
    <p className="mi-brief-steps__note" data-live-steps-note="true">{copy.note}</p>
  </div>
}

/** The name the rail uses for "generating now": the row that is actually running. */
export function runningRowName(progress: BriefingGenerationProgress, text: DailyBriefingText): string | undefined {
  const byId = new Map(progress.stages.map((stage) => [stage.id, stage]))
  for (const row of briefingGenerationDisplayRows) {
    const stages = row.stages.map((id) => byId.get(id)).filter((stage) => stage !== undefined)
    if (rowState(stages) === 'running') return rowName(row.id, text, text.generationProgress.repair)
  }
  return undefined
}

function rowState(stages: readonly BriefingGenerationStage[]): RowState {
  if (stages.length === 0) return 'waiting'
  if (stages.some((stage) => stage.state === 'failed')) return 'failed'
  if (stages.every((stage) => stage.state === 'success')) return 'done'
  if (stages.every((stage) => stage.state === 'skipped')) return 'not-needed'
  if (stages.some((stage) => stage.state === 'pending' && stage.startedAt)) return 'running'
  return 'waiting'
}

function rowName(id: (typeof briefingGenerationDisplayRows)[number]['id'], text: DailyBriefingText, repair: string): string {
  if (id === 'repair') return repair
  return text.generationTrace.stages[id]
}

function detail(state: RowState, elapsed: number | undefined, copy: DailyBriefingText['generationProgress'], text: DailyBriefingText): string {
  if (state === 'running') {
    // No timestamp, no number: an invented duration reads as "this is measured" when it is not.
    return elapsed === undefined || !Number.isFinite(elapsed) ? copy.running : `${copy.running} · ${copy.elapsed.replace('{duration}', formatElapsed(elapsed))}`
  }
  if (state === 'waiting') return copy.waiting
  if (state === 'not-needed') return text.generationTrace.states.notNeeded
  if (state === 'failed') return text.generationTrace.states.failed
  return copy.finished
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function StepIcon({ state }: Readonly<{ state: RowState }>): React.ReactElement {
  const size = 12
  if (state === 'done') return <Check aria-hidden="true" className="mi-brief-steps__icon" size={size} />
  if (state === 'failed') return <CircleAlert aria-hidden="true" className="mi-brief-steps__icon" size={size} />
  if (state === 'not-needed') return <Minus aria-hidden="true" className="mi-brief-steps__icon" size={size} />
  return <Loader aria-hidden="true" className="mi-brief-steps__icon" size={size} />
}
