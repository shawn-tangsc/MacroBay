import {
  briefingGenerationStageIds,
  type BriefingGenerationProgress,
  type BriefingGenerationStage,
  type BriefingGenerationStageId,
  type BriefingGenerationStageState,
  type BriefingGenerationTrace
} from '../../../contracts/dailyBriefing'

/**
 * Collects the stage timings of one generation attempt.
 *
 * The recorder only stores what the service actually observed. A stage that never began is filled
 * as `skipped` when the attempt completes, so the trace still lists the fixed stage order without
 * claiming work that did not happen. A failure keeps the failing stage's code and detail; the
 * service persists the finished trace even when no document is stored.
 */
export type DailyBriefingGenerationRecorder = Readonly<{
  begin: (id: BriefingGenerationStageId) => void
  end: (
    id: BriefingGenerationStageId,
    state: Extract<BriefingGenerationStageState, 'success' | 'failed'>,
    outcome?: Readonly<{ failureCode?: string; failureDetail?: string }>
  ) => void
  skip: (id: BriefingGenerationStageId) => void
  /** The attempt so far, without pretending unfinished stages were skipped. */
  snapshot: () => BriefingGenerationProgress
  complete: (state: BriefingGenerationTrace['state']) => BriefingGenerationTrace
}>

export function createDailyBriefingGenerationRecorder(input: Readonly<{
  attemptId: string
  now: () => string
  /** Called after every change, so a live reader can publish a fresh snapshot without polling the recorder. */
  onChange?: () => void
}>): DailyBriefingGenerationRecorder {
  const startedAt = input.now()
  const stages = new Map<BriefingGenerationStageId, BriefingGenerationStage>()
  const changed = (): void => input.onChange?.()
  const begin = (id: BriefingGenerationStageId): void => {
    if (stages.has(id)) return
    stages.set(id, { id, state: 'pending', startedAt: input.now() })
    changed()
  }
  const end: DailyBriefingGenerationRecorder['end'] = (id, state, outcome) => {
    const existing = stages.get(id)
    const stageStartedAt = existing?.startedAt ?? input.now()
    const finishedAt = input.now()
    const startedMs = Date.parse(stageStartedAt)
    const finishedMs = Date.parse(finishedAt)
    const durationMs = Number.isFinite(startedMs) && Number.isFinite(finishedMs)
      ? Math.max(0, finishedMs - startedMs)
      : undefined
    stages.set(id, Object.freeze({
      id,
      state,
      startedAt: stageStartedAt,
      finishedAt,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(outcome?.failureCode ? { failureCode: outcome.failureCode } : {}),
      ...(outcome?.failureDetail ? { failureDetail: outcome.failureDetail } : {})
    }))
    changed()
  }
  const skip = (id: BriefingGenerationStageId): void => {
    if (stages.has(id)) return
    stages.set(id, Object.freeze({ id, state: 'skipped' }))
    changed()
  }
  const complete = (state: BriefingGenerationTrace['state']): BriefingGenerationTrace => {
    const finishedAt = input.now()
    const ordered = briefingGenerationStageIds.map((id) => stages.get(id) ?? Object.freeze({ id, state: 'skipped' as const }))
    return Object.freeze({
      attemptId: input.attemptId,
      startedAt,
      finishedAt,
      state,
      stages: Object.freeze(ordered)
    })
  }
  const snapshot = (): BriefingGenerationProgress => Object.freeze({
    attemptId: input.attemptId,
    startedAt,
    // Unstarted stages stay `pending` here: `complete` is the only place that may say "skipped",
    // because only a finished attempt knows a stage was not needed.
    stages: Object.freeze(briefingGenerationStageIds.map((id) => stages.get(id) ?? Object.freeze({ id, state: 'pending' as const })))
  })
  return Object.freeze({ begin, end, skip, snapshot, complete })
}
