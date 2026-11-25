import type { RuntimeStateStore } from '@platform/jobs'

import type { IntelligenceSourceDefinition } from '../schema/intelligenceSource'
import {
  evaluateSourceStaleness,
  normalizeStreakFromCheckpoint,
  type SourceStaleReason
} from './sourceStaleness'

/**
 * 一个源的运行时健康快照（数据投影，不含句子）。
 *
 * `staleReasons` 是 2026-11-21 事故补的：采集成功不等于产出条目，界面必须能分别看见
 * 「这个源没产出」与「产出在、但归一化一直失败」。两个都只是闭集值，文案归界面那一侧。
 */
export type IntelligencePipelineHealth = {
  sourceId: string
  runtimeStatus: 'healthy' | 'degraded' | 'failed' | 'paused'
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
  lastRunSummary?: string
  checkpointPreview?: string
  parserVersion?: string
  lastPublishedAt?: string
  cursor?: string
  supportsHistoricalBackfill?: boolean
  collectionGap?: boolean
  /** 可能同时为真：有产出但归一化失败，与完全没产出是两种病。 */
  staleReasons?: readonly SourceStaleReason[]
  /** 与 `staleReasons` 配套的测量值，只给文案插值用，不参与判据（状态本身仍是闭集）。 */
  staleMeasurements?: SourceStaleMeasurements
}

/** 两个原因各自的数字：界面拿它填 `{hours}` / `{count}`，不自己重算。 */
export type SourceStaleMeasurements = Readonly<{
  noOutputHours?: number
  normalizeFailureStreak?: number
}>

/**
 * 从运行时状态（采集 checkpoint）投影出健康快照。`nowMs` 可注入，判据本身在
 * `sourceStaleness` 里（纯函数、有用例）。
 */
export function buildPipelineHealthSnapshot(input: Readonly<{
  sourceId: string
  runtimeStateStore: Pick<RuntimeStateStore, 'get'>
  definition: IntelligenceSourceDefinition | undefined
  isRetired: (sourceId: string) => boolean
  nowMs?: number
}>): IntelligencePipelineHealth | undefined {
  if (input.isRetired(input.sourceId)) return undefined
  const state = input.runtimeStateStore.get('product', 'market-intelligence', input.sourceId)
  if (!state) return undefined
  const checkpoint = state.checkpoint as
    | {
        parserVersion?: string
        lastPublishedAt?: string
        cursor?: string
      }
    | undefined
  const isStreamSource = input.definition?.executionMode === 'websocket'
  const normalize = normalizeStreakFromCheckpoint(state.checkpoint as Record<string, unknown> | undefined)
  const nowMs = input.nowMs ?? Date.now()
  const staleReasons = evaluateSourceStaleness({
    sourceId: input.sourceId,
    ...(checkpoint?.lastPublishedAt === undefined ? {} : { lastOutputAt: checkpoint.lastPublishedAt }),
    normalize
  }, nowMs)
  const lastOutputMs = checkpoint?.lastPublishedAt === undefined ? Number.NaN : Date.parse(checkpoint.lastPublishedAt)
  const staleMeasurements: SourceStaleMeasurements = {
    ...(staleReasons.includes('no-output') && Number.isFinite(lastOutputMs)
      ? { noOutputHours: Math.floor((nowMs - lastOutputMs) / 3_600_000) }
      : {}),
    ...(staleReasons.includes('normalize-failing') ? { normalizeFailureStreak: normalize.streak } : {})
  }
  return {
    sourceId: input.sourceId,
    runtimeStatus: state.status === 'failed' ? 'failed' : state.consecutiveFailures > 0 ? 'degraded' : 'healthy',
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    consecutiveFailures: state.consecutiveFailures,
    lastRunSummary: state.cursorPreview,
    checkpointPreview: state.cursorPreview,
    parserVersion: checkpoint?.parserVersion,
    lastPublishedAt: checkpoint?.lastPublishedAt,
    cursor: checkpoint?.cursor,
    supportsHistoricalBackfill: !isStreamSource,
    collectionGap: isStreamSource,
    ...(staleReasons.length > 0 ? { staleReasons } : {}),
    ...(Object.keys(staleMeasurements).length > 0 ? { staleMeasurements } : {})
  }
}
