import { CircleHelp } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import { briefingGenerationDisplayRows, type BriefingGenerationProgress, type BriefingGenerationStage } from '../../../contracts/dailyBriefing'
import { DailyBriefingStageSteps, type DailyBriefingStageRowState } from './DailyBriefingStageList'
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

type RowState = DailyBriefingStageRowState

export type DailyBriefingLiveStepsProps = Readonly<{
  progress: BriefingGenerationProgress
  text: DailyBriefingText
  /** Milliseconds, so the running row can show the time it has been running. */
  nowMs: number
  /** Resolves the help popover's labels and body; absent means no help trigger is rendered. */
  resolveText?: (key: string) => string
}>

export function DailyBriefingLiveSteps({ progress, text, nowMs, resolveText }: DailyBriefingLiveStepsProps): React.ReactElement {
  const byId = new Map(progress.stages.map((stage) => [stage.id, stage]))
  const copy = text.generationProgress
  const rows = briefingGenerationDisplayRows.map((row) => {
    const stages = row.stages.map((id) => byId.get(id)).filter((stage) => stage !== undefined)
    const state = rowState(stages)
    const startedAt = stages.find((stage) => stage.startedAt)?.startedAt
    const elapsed = state === 'running' && startedAt ? nowMs - Date.parse(startedAt) : undefined
    return { id: row.id, name: rowName(row.id, text, copy.repair), state, detail: detail(state, elapsed, copy, text) }
  })
  return <div className="mi-brief-steps" role="status" data-live-steps="true">
    <div className="mi-brief-steps__head">
      {/* The trigger comes before the title it explains, and before the list in DOM order, so the
          keyboard reaches it in the same order the eye does. */}
      {resolveText ? <Popover
        labelKey="pages.intelligence.portal.dashboard.dailyBriefing.generationProgress.note"
        resolveText={resolveText}
        trigger={(triggerProps) => <IconButton
          {...triggerProps}
          ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.help.progress"
          dataAttributes={{ 'data-steps-help': 'true' }}
          icon={CircleHelp}
          resolveText={resolveText}
          size="sm"
          variant="plain"
        />}
      /> : null}
      <h3 className="mi-brief-steps__title">{copy.title}</h3>
    </div>
    <DailyBriefingStageSteps rows={rows} />
  </div>
}

/** The name the rail uses for "generating now": the row that is actually running. */
/**
 * How long this run has been going, for the row that says where it is.
 *
 * While the run is still waiting for the market it has not opened an attempt, and the wait itself
 * knows its own elapsed time; after that the attempt's start is the reference. `undefined` when
 * neither can answer — the row then says only "generating" rather than inventing a number.
 */
export function runningElapsedMsFor(progress: BriefingGenerationProgress, now = Date.now()): number | undefined {
  if (progress.waiting) return progress.waiting.waitedMs
  const startedAt = Date.parse(progress.startedAt)
  if (!Number.isFinite(startedAt)) return undefined
  const elapsed = now - startedAt
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined
}

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
