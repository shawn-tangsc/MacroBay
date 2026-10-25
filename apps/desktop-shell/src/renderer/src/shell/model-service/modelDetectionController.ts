import type {
  ModelDetectionMode,
  ModelDetectionResult
} from '@platform/ai/providers/modelDetection/types'

/**
 * PLAT-82：检测结果的**内存 store**（模块级单例）。
 *
 * 不变量：
 *  - 结果只存内存：不 upsert、不写库，重启/重置即消失；
 *  - 切页 / 切供应商 / 关弹窗都**不取消** run；只有「停止」或进程退出才取消；
 *  - 一次 run 一模型一条结果（progress 携带完整 `ModelDetectionResult`），done 只标结束。
 *
 * 组件通过 `useModelDetection`（`useSyncExternalStore`）读取；快照按版本号做引用稳定，
 * 避免每次 getSnapshot 生成新对象导致无限渲染。
 */
export type ModelDetectionRun = {
  runId: string
  providerId: string
  modes: ModelDetectionMode[]
  results: Readonly<Record<string, ModelDetectionResult>>
  /** run 开始时供应商的模型数（进度分母）。 */
  total: number
  /**
   * 本次 run 的目标模型；缺省 = 该供应商全部模型（全量检测）。
   * 单模型测试只包含一个 id ⇒ `statusFor` 只把这个模型标成「测试中」。
   */
  modelIds?: readonly string[]
  /** 主进程已发 done（正常结束或停止）。 */
  finished: boolean
  stopped: boolean
}

export type ModelDetectionSnapshot = {
  readonly version: number
  readonly runs: Readonly<Record<string, ModelDetectionRun>>
}

type MutableRun = {
  runId: string
  providerId: string
  modes: ModelDetectionMode[]
  results: Map<string, ModelDetectionResult>
  total: number
  modelIds?: readonly string[]
  finished: boolean
  stopped: boolean
}

const runs = new Map<string, MutableRun>()
const listeners = new Set<() => void>()
let snapshot: ModelDetectionSnapshot = { version: 0, runs: {} }
let unsubscribeBridge: (() => void) | null = null
let sequence = 0

function publish(): void {
  const next: Record<string, ModelDetectionRun> = {}
  for (const [runId, run] of runs) {
    next[runId] = {
      runId,
      providerId: run.providerId,
      modes: run.modes,
      stopped: run.stopped,
      results: Object.fromEntries(run.results),
      total: run.total,
      ...(run.modelIds === undefined ? {} : { modelIds: run.modelIds }),
      finished: run.finished
    }
  }
  snapshot = { version: snapshot.version + 1, runs: next }
  for (const listener of listeners) listener()
}

/** 懒订阅主进程事件（同一页面只注册一次；渲染层不再有其它探测入口）。 */
function ensureBridge(): void {
  if (unsubscribeBridge) return
  const api = window.platform?.modelProviders
  if (!api?.onModelDetectionProgress) return
  const offProgress = api.onModelDetectionProgress((result) => {
    const run = runs.get(result.runId)
    if (!run) return
    run.results.set(result.modelId, result)
    publish()
  })
  const offDone = api.onModelDetectionDone((runId, payload) => {
    const run = runs.get(runId)
    if (!run) return
    run.stopped = payload.stopped
    run.finished = true
    publish()
  })
  unsubscribeBridge = () => {
    offProgress()
    offDone()
  }
}

export function getModelDetectionSnapshot(): ModelDetectionSnapshot {
  return snapshot
}

export function subscribeModelDetection(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 启动一次检测；`accepted === false`（重复 runId）时不登记 run。 */
export async function startModelDetection(
  providerId: string,
  modes: readonly ModelDetectionMode[],
  modelIds?: readonly string[]
): Promise<string | null> {
  const api = window.platform?.modelProviders
  if (!api?.detectModels) return null
  ensureBridge()
  sequence += 1
  const runId = `detection-${Date.now()}-${sequence}`
  const accepted = await api.detectModels(providerId, {
    modes: [...modes],
    runId,
    ...(modelIds === undefined ? {} : { modelIds: [...modelIds] })
  })
  if (!accepted.accepted) return null
  runs.set(runId, {
    runId,
    providerId,
    modes: [...modes],
    results: new Map(),
    total: accepted.total,
    ...(modelIds === undefined ? {} : { modelIds: [...modelIds] }),
    finished: false,
    stopped: false
  })
  publish()
  return runId
}

/** 停止一次（或全部）run；未知 runId 幂等。 */
export function stopModelDetection(runId?: string): void {
  const api = window.platform?.modelProviders
  const targets = runId === undefined ? [...runs.keys()] : [runId]
  for (const target of targets) {
    const run = runs.get(target)
    if (!run || run.stopped || run.finished) continue
    run.stopped = true
    void api?.cancelModelDetection?.(target)
  }
  publish()
}

/** 仅测试：清空内存 + 释放事件桥。 */
export function resetModelDetectionControllerForTests(): void {
  runs.clear()
  snapshot = { version: 0, runs: {} }
  unsubscribeBridge?.()
  unsubscribeBridge = null
  sequence = 0
  publish()
}

export function resultForModel(
  current: ModelDetectionSnapshot,
  providerId: string,
  modelId: string
): ModelDetectionResult | undefined {
  const providerRuns = Object.values(current.runs).filter((run) => run.providerId === providerId)
  // 从**最新一轮**往前找：重新检测后必须显示新结论，不能读上一轮的旧结果。
  for (let index = providerRuns.length - 1; index >= 0; index -= 1) {
    const run = providerRuns[index]
    const result = run.results[modelId]
    if (result) return result
    // 最新一轮还在跑 ⇒ 该模型是「测试中」，不要退化到旧结论。
    if (!run.finished && !run.stopped) return undefined
  }
  return undefined
}

/** 该供应商是否有 run 仍在跑（用于「停止」与「测试中…」）。 */
export function isDetectionRunning(current: ModelDetectionSnapshot, providerId: string): boolean {
  return Object.values(current.runs).some((run) => run.providerId === providerId && !run.finished && !run.stopped)
}

/** 这个模型是否属于某个仍在跑的 run（单模型 run 不把同供应商的其它模型标成「测试中」）。 */
export function isModelBeingDetected(
  current: ModelDetectionSnapshot,
  providerId: string,
  modelId: string
): boolean {
  return Object.values(current.runs).some((run) =>
    run.providerId === providerId
    && !run.finished
    && !run.stopped
    && (run.modelIds === undefined || run.modelIds.includes(modelId))
  )
}

/** 全局可停止的 run（切到别的供应商后仍能停 A）。 */
export function runningModelDetectionIds(current: ModelDetectionSnapshot): string[] {
  return Object.values(current.runs).filter((run) => !run.finished && !run.stopped).map((run) => run.runId)
}
