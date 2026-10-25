import { useSyncExternalStore } from 'react'

import type { ModelDetectionMode, ModelDetectionResult } from '@platform/ai/providers/modelDetection/types'

import {
  getModelDetectionSnapshot,
  isDetectionRunning,
  resultForModel,
  runningModelDetectionIds,
  startModelDetection,
  stopModelDetection,
  subscribeModelDetection,
  type ModelDetectionRun,
  type ModelDetectionSnapshot
} from './modelDetectionController'

export type ModelDetectionModelStatus = 'testing' | 'ok' | 'failed' | 'skipped' | 'cancelled'

export type ModelDetectionProgress = { done: number; total: number }

export type UseModelDetection = {
  snapshot: ModelDetectionSnapshot
  /** 该供应商的 run（按启动顺序）。 */
  runs: ModelDetectionRun[]
  /** 该供应商**最近一次** run（对话框进度/停止用）。 */
  run: ModelDetectionRun | undefined
  running: boolean
  /** 全局可停止的 run（切到别的供应商后仍能停 A）。 */
  runningRunIds: string[]
  progress: ModelDetectionProgress
  resultFor: (modelId: string) => ModelDetectionResult | undefined
  /** 行内状态：有结果取结果；run 在跑且无结果 ⇒ testing。 */
  statusFor: (modelId: string) => ModelDetectionModelStatus | undefined
  /** `modelIds` 缺省 = 该供应商全部模型（自动检测只传新增/变更/过期的那几个）。 */
  start: (modes: readonly ModelDetectionMode[], modelIds?: readonly string[]) => Promise<string | null>
  stop: (runId?: string) => void
}

function toRowStatus(
  snapshot: ModelDetectionSnapshot,
  providerId: string,
  modelId: string
): ModelDetectionModelStatus | undefined {
  const result = resultForModel(snapshot, providerId, modelId)
  if (result) {
    if (result.status === 'ok') return 'ok'
    if (result.status === 'skipped') return 'skipped'
    if (result.status === 'cancelled') return 'cancelled'
    return 'failed'
  }
  return isDetectionRunning(snapshot, providerId) ? 'testing' : undefined
}

/** 进度分母来自 run 登记时的模型数，分子只数**已产出结果**的模型（一模型一条结果）。 */
export function progressOf(run: ModelDetectionRun | undefined): ModelDetectionProgress {
  return { done: run === undefined ? 0 : Object.keys(run.results).length, total: run?.total ?? 0 }
}

/**
 * PLAT-82 检测结果的只读视图（`useSyncExternalStore`）。
 *
 * 结果只在内存：切页 / 切供应商 / 关弹窗都不取消 run，也不清结果；
 * 只有 `stop()` 或进程退出才取消。刷新页面即消失（无持久化）。
 */
export function useModelDetection(providerId: string | undefined): UseModelDetection {
  const snapshot = useSyncExternalStore(
    subscribeModelDetection,
    getModelDetectionSnapshot,
    getModelDetectionSnapshot
  )
  const runs = providerId
    ? Object.values(snapshot.runs).filter((run) => run.providerId === providerId)
    : []
  const run = runs.length === 0 ? undefined : runs[runs.length - 1]
  return {
    snapshot,
    runs,
    run,
    running: providerId ? isDetectionRunning(snapshot, providerId) : false,
    runningRunIds: runningModelDetectionIds(snapshot),
    progress: progressOf(run),
    resultFor: (modelId) => (providerId ? resultForModel(snapshot, providerId, modelId) : undefined),
    statusFor: (modelId) => (providerId ? toRowStatus(snapshot, providerId, modelId) : undefined),
    start: (modes, modelIds) => (providerId ? startModelDetection(providerId, modes, modelIds) : Promise.resolve(null)),
    stop: (runId) => stopModelDetection(runId)
  }
}
