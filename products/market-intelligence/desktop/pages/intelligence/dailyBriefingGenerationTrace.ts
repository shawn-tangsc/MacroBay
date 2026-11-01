/**
 * The generation stage trace carried by a successful edition or a failed attempt.
 *
 * The service writes it; the renderer only reads it. A renderer must never invent a stage, a time or
 * a duration: when a stage is absent it is shown as not recorded, and the timeline still says where
 * a failed attempt stopped.
 */
export const generationStageIds = [
  'source',
  'candidates',
  'selection',
  'field-backfill',
  'writing',
  'validation',
  'repair-1',
  'repair-2',
  'store'
] as const

export type GenerationStageId = (typeof generationStageIds)[number]
export type GenerationStageState = 'success' | 'failed' | 'skipped' | 'pending'

export type GenerationTraceStage = Readonly<{
  id: GenerationStageId
  state: GenerationStageState
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  failureCode?: string
  failureDetail?: string
}>

export type GenerationTrace = Readonly<{
  attemptId: string
  startedAt: string
  finishedAt: string
  state: 'success' | 'failed'
  stages: readonly GenerationTraceStage[]
}>

const stageIds: ReadonlySet<string> = new Set(generationStageIds)
const stageStates: ReadonlySet<string> = new Set(['success', 'failed', 'skipped', 'pending'])

/** Lenient read of the optional trace: an older edition without one is normal, a malformed one is ignored. */
export function readGenerationTrace(value: unknown): GenerationTrace | undefined {
  if (!isRecord(value)) return undefined
  if (!text(value.attemptId, 200) || !instant(value.startedAt) || !instant(value.finishedAt)) return undefined
  if (value.state !== 'success' && value.state !== 'failed') return undefined
  if (!Array.isArray(value.stages) || value.stages.length === 0) return undefined
  const seen = new Set<string>()
  const stages: GenerationTraceStage[] = []
  for (const raw of value.stages) {
    const stage = readStage(raw)
    if (!stage || seen.has(stage.id)) continue
    seen.add(stage.id)
    stages.push(stage)
  }
  if (stages.length === 0) return undefined
  return Object.freeze({
    attemptId: value.attemptId as string,
    startedAt: value.startedAt as string,
    finishedAt: value.finishedAt as string,
    state: value.state,
    stages: Object.freeze(stages)
  })
}

function readStage(value: unknown): GenerationTraceStage | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.id !== 'string' || !stageIds.has(value.id)) return undefined
  if (typeof value.state !== 'string' || !stageStates.has(value.state)) return undefined
  const startedAt = instant(value.startedAt) ? value.startedAt : undefined
  const finishedAt = instant(value.finishedAt) ? value.finishedAt : undefined
  const durationMs = typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs >= 0
    ? value.durationMs
    : undefined
  const failureCode = text(value.failureCode, 200)
  const failureDetail = text(value.failureDetail, 2_000)
  return Object.freeze({
    id: value.id as GenerationStageId,
    state: value.state as GenerationStageState,
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(failureCode ? { failureCode } : {}),
    ...(failureDetail ? { failureDetail } : {})
  })
}

export function failedStage(trace: GenerationTrace): GenerationTraceStage | undefined {
  return trace.stages.find((stage) => stage.state === 'failed')
}

/** Whole-attempt duration, from the trace's own instants. Never estimated from wall-clock reads. */
export function traceDurationMs(trace: GenerationTrace): number | undefined {
  const elapsed = Date.parse(trace.finishedAt) - Date.parse(trace.startedAt)
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined
}

export function stageDurationMs(stage: GenerationTraceStage): number | undefined {
  if (stage.durationMs !== undefined) return stage.durationMs
  if (!stage.startedAt || !stage.finishedAt) return undefined
  const elapsed = Date.parse(stage.finishedAt) - Date.parse(stage.startedAt)
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit ? value : undefined
}

function instant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
}
